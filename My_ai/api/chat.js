// ═══════════════════════════════════════════════════════════════════════
// api/chat.js — Vercel serverless function, main AI call handler.
// Phase 1 (Core Architecture Shift + Build Order item 1): walks the
// server-side key pool (lib/keyManager.js), builds the system prompt
// server-side (lib/systemPrompt.js), and proxies the upstream
// OpenAI-compatible SSE stream straight through to the client unchanged.
//
// Phase 2 (Auth): every request now carries a Firebase ID token
// (verified here via lib/firebaseAdmin.js). Guest (anonymous) users are
// capped at GUEST_DAILY_LIMIT messages/day (lib/userStore.js); Google
// users are uncapped. No valid token → request rejected (401) — the
// client's login-screen gate (auth.js) means this should only happen if
// someone calls the endpoint directly, not through normal app use.
//
// Client never sees a provider API key. Client sends prompt-building
// INPUTS (memory, sessions, language, etc — see systemPrompt.js jsdoc),
// never the raw system prompt text.
// ═══════════════════════════════════════════════════════════════════════

const { buildAttemptChain, markKeyFailed, markKeyOk } = require('../lib/keyManager');
const { buildPrompt } = require('../lib/systemPrompt');
const { verifyIdToken } = require('../lib/firebaseAdmin');
const { checkGuestLimit, incrementMessageCount, GUEST_DAILY_LIMIT } = require('../lib/userStore');

// PHASE 7 (plan Section 9, "Model routing: simple queries → fast/cheap
// model; complex/coding queries → bigger model"). Deterministic, no extra
// AI call to classify (that would defeat the whole cost-saving point) —
// just a length + keyword heuristic on the CURRENT user turn. Errs toward
// 'big' when unsure (a wrongly-fast reply on a complex question is a worse
// user experience than a wrongly-big reply on a simple one, which just
// costs a bit more).
const COMPLEX_SIGNAL_RE = /```|code|debug|error|explain in detail|analy[sz]e|refactor|architecture|algorithm|compare|summari[sz]e|research|step[- ]by[- ]step|multi[- ]step|write (a|an) (essay|article|story|script|program|function)/i;
const SIMPLE_QUERY_MAX_LEN = 350; // above this, default to 'big' regardless of keywords

function extractLastUserText(messages) {
  const last = messages[messages.length - 1];
  if (!last) return '';
  if (typeof last.content === 'string') return last.content;
  if (Array.isArray(last.content)) return last.content.filter(c => c.type === 'text').map(c => c.text).join(' ');
  return '';
}

function classifyTier(messages, promptInputs) {
  // BARE MODE (follow-up chips, session summaries — see providers.js
  // callServerBare / js/sessions.js autosaveSession) never needs the big
  // model — these are short, low-stakes utility calls by design.
  if (promptInputs?.bare) return 'fast';

  const text = extractLastUserText(messages);
  if (text.length > SIMPLE_QUERY_MAX_LEN) return 'big';
  if (COMPLEX_SIGNAL_RE.test(text)) return 'big';
  return 'fast';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  const {
    idToken,           // Firebase ID token — client gets this from firebase.auth().currentUser.getIdToken() (see auth.js)
    sessionId,        // any stable per-chat-session string the client already tracks (fallback rotation seed if no uid)
    messages,          // [{role:'user'|'assistant', content}, ...] — chat history, client-managed (no system msg here)
    promptInputs,       // see lib/systemPrompt.js buildPrompt() jsdoc for the exact shape
    userKeyOverride,    // optional { base, key, model, label } — user's OWN key from Settings, tried FIRST if present (plan Section 1: "unless user enters their own key")
    maxTokens,          // optional — small utility calls (follow-ups, session summary) pass a lower cap; defaults to 2000 for normal chat
  } = req.body || {};

  const decoded = await verifyIdToken(idToken);
  if (!decoded) {
    res.status(401).json({ error: 'Login expired ya invalid — dobara login karo' });
    return;
  }

  let allowed, remaining;
  try {
    ({ allowed, remaining } = await checkGuestLimit(decoded));
  } catch (e) {
    console.error('[api/chat] checkGuestLimit failed:', e);
    res.status(500).json({ error: 'User record check fail hua — Firebase Admin env vars ya Firestore rules check karo. Detail: ' + e.message });
    return;
  }
  if (!allowed) {
    res.status(429).json({
      error: `Aaj ke ${GUEST_DAILY_LIMIT} guest messages khatam ho gaye — Google se login karo unlimited ke liye`,
      guestLimitReached: true,
    });
    return;
  }

  const tokenCap = Number.isFinite(maxTokens) && maxTokens > 0 ? Math.min(maxTokens, 4000) : 2000;

  if (!Array.isArray(messages) || !messages.length) {
    res.status(400).json({ error: 'messages required' });
    return;
  }

  let sysPrompt;
  try {
    sysPrompt = buildPrompt(promptInputs || {});
  } catch (e) {
    console.error('[api/chat] buildPrompt failed:', e);
    res.status(500).json({ error: 'Prompt build fail hua' });
    return;
  }

  const tier = classifyTier(messages, promptInputs);
  const chain = buildAttemptChain(decoded.uid || sessionId, tier);
  if (userKeyOverride && userKeyOverride.key && userKeyOverride.base) {
    chain.unshift({
      provider: 'user-override',
      index: -1,
      key: userKeyOverride.key,
      base: userKeyOverride.base,
      model: userKeyOverride.model || 'gpt-oss-120b',
      label: userKeyOverride.label || 'Apni Key',
    });
  }

  if (!chain.length) {
    res.status(503).json({ error: 'Koi provider configure nahi hai server pe — env vars check karo' });
    return;
  }

  let lastErr = null;
  let streamStarted = false;

  for (const attempt of chain) {
    try {
      // Same request shape client used to send directly — server just owns
      // the key + system prompt now. Providers are OpenAI-compatible so
      // this shape works unchanged across Groq/Together/Cerebras/Mistral/etc.
      const upstream = await fetch(attempt.base, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(attempt.key || '').replace(/[^\x00-\xFF]/g, '').trim()}`,
        },
        body: JSON.stringify({
          model: attempt.model,
          messages: [{ role: 'system', content: sysPrompt }, ...messages],
          stream: true,
          max_tokens: tokenCap,
        }),
      });

      if (!upstream.ok || !upstream.body) {
        const errBody = await upstream.text().catch(() => '');
        throw new Error(`${attempt.label}: API error ${upstream.status} ${errBody.slice(0, 200)}`);
      }

      if (attempt.provider !== 'user-override') markKeyOk(attempt.provider, attempt.index);

      // Headers must go out before any res.write() — once we start
      // streaming we can't fall back to the next attempt anymore, so this
      // is the point of no return.
      streamStarted = true;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Provider-Label': attempt.label,
        'X-Provider-Model': attempt.model || '',
        'X-Provider-Tier': attempt.tier || tier,
      });

      const reader = upstream.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
      // Fire-and-forget — only counts AFTER a successful completion, so a
      // failed/errored attempt doesn't cost the user their daily quota.
      incrementMessageCount(decoded.uid).catch(() => {});
      return;
    } catch (e) {
      lastErr = e;
      if (attempt.provider !== 'user-override') markKeyFailed(attempt.provider, attempt.index);
      console.warn('[api/chat] attempt failed:', attempt.label, e.message);
      if (streamStarted) {
        // Stream already started with headers sent to a PREVIOUS attempt in
        // a rare race — shouldn't normally hit this since we return right
        // after res.end(), but guard anyway instead of trying to fall back
        // mid-stream (which would corrupt the response).
        try { res.end(); } catch {}
        return;
      }
      // else: fall through to next attempt in chain
    }
  }

  res.status(502).json({ error: (lastErr && lastErr.message) || 'Sab providers fail ho gaye' });
};

// Node.js serverless runtime (default) — streaming via res.write/res.end
// works fine here, no special config needed. If this needs Edge runtime
// later for lower cold-start latency, add:
//   export const config = { runtime: 'edge' };
// and switch module.exports to a Web-standard `export default` handler
// (Request/Response instead of req/res) — not done now to keep this file
// consistent with plain CommonJS, no build step, matching the rest of the
// project.
