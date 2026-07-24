// ═══════════════════════════════════════════════════════════════════════
// lib/aiComplete.js — PHASE 6: minimal, NON-streaming one-shot completion
// helper for server-side jobs (currently: cron/dailySummary.js) that need
// to ask the AI something once and get plain text back — no SSE, no
// bubble/typing UI, none of the [ASK_USER]/[WEB_SEARCH]/[TOOL] plumbing
// that api/chat.js carries for live chat.
//
// Reuses the SAME key pool + fallback chain as live chat
// (lib/keyManager.js) so cron summarization draws from the same rotation/
// health tracking — a cooling-down key stays cooling down for both. This
// file does NOT duplicate keyManager's logic, just drives it.
//
// Kept deliberately separate from providers.js (that's client-side) and
// from api/chat.js (that's the streaming live-chat path) — same reasoning
// api/admin/*.js already uses its own small handlers instead of routing
// through the main chat handler.
// ═══════════════════════════════════════════════════════════════════════

const { buildAttemptChain, markKeyFailed, markKeyOk } = require('./keyManager');

/**
 * completeText({ seed, systemPrompt, userPrompt, maxTokens }) — tries the
 * full attempt chain (all keys/providers, same order live chat would get
 * for this `seed`) until one succeeds. Returns the plain text content, or
 * '' if every attempt failed (caller decides how to degrade — cron should
 * fall back to a non-AI templated summary rather than crash the whole
 * run, see cron/dailySummary.js).
 *
 * `seed` plays the same role `sessionId` does in live chat (per-session
 * key hashing) — for cron we just pass something stable-ish per call
 * (e.g. `digest-${uid}-${date}`) so repeated runs/retries tend to reuse
 * the same key, not because smoothness matters here, but so cron doesn't
 * fan out across every key in the pool on every single run.
 */
async function completeText({ seed, systemPrompt, userPrompt, maxTokens = 300, tier = 'fast' }) {
  const chain = buildAttemptChain(seed, tier);
  if (!chain.length) {
    console.warn('[aiComplete] no providers configured (check *_KEYS env vars)');
    return '';
  }

  for (const attempt of chain) {
    try {
      const res = await fetch(attempt.base, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${attempt.key}`,
        },
        body: JSON.stringify({
          model: attempt.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: maxTokens,
          stream: false,
        }),
      });

      if (!res.ok) {
        markKeyFailed(attempt.provider, attempt.index);
        continue;
      }

      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content || '';
      if (!text.trim()) {
        markKeyFailed(attempt.provider, attempt.index);
        continue;
      }
      markKeyOk(attempt.provider, attempt.index);
      return text.trim();
    } catch (e) {
      console.warn('[aiComplete] attempt failed', attempt.provider, attempt.index, e.message);
      markKeyFailed(attempt.provider, attempt.index);
      // keep trying next attempt in chain
    }
  }

  return ''; // everything failed — caller falls back gracefully
}

module.exports = { completeText };
