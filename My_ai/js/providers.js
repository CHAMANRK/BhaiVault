// ═══════════════════════════════════════════════════════════════════════
// js/providers.js — PHASE 1 UPDATE: client no longer calls provider APIs
// directly. Every chat completion now goes through the server's
// /api/chat (key rotation + fallback + system prompt all live there now
// — see lib/keyManager.js + lib/systemPrompt.js in the repo root). This
// file keeps the SAME streamChat(bubbleEl, promptInputs, messages) call
// signature every chat-core.js call site already used — only WHERE it
// points changed.
//
// PROVIDER_PRESETS + the fallback-list UI (addFallback/delFallback/
// renderFallbacks) stay — per plan Section 1 ("API keys move server-side.
// Client never sees them unless user enters their OWN key — optional
// override, used first"), cfg.fallbacks is now that optional override,
// NOT the primary provider chain anymore. Only the FIRST entry is sent as
// an override for now (server currently accepts a single
// userKeyOverride) — the rest of the list UI still works, ready for
// later multi-override support.
// ═══════════════════════════════════════════════════════════════════════

const PROVIDER_PRESETS = {
  openrouter: { label: 'OpenRouter', base: 'https://openrouter.ai/api/v1/chat/completions', model: 'meta-llama/llama-3.3-70b-instruct:free' },
  groq: { label: 'Groq', base: 'https://api.groq.com/openai/v1/chat/completions', model: 'openai/gpt-oss-120b' },
  mistral: { label: 'Mistral AI', base: 'https://api.mistral.ai/v1/chat/completions', model: 'mistral-small-latest' },
  together: { label: 'Together AI', base: 'https://api.together.xyz/v1/chat/completions', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free' },
  cerebras: { label: 'Cerebras', base: 'https://api.cerebras.ai/v1/chat/completions', model: 'llama-3.3-70b' },
  custom: { label: 'Custom (koi aur free provider)', base: '', model: '' }
};

function renderFallbacks() {
  const list = document.getElementById('fallback-list');
  if (!list) return;
  if (!cfg.fallbacks || !cfg.fallbacks.length) {
    list.innerHTML = '<div style="font-size:0.8rem;color:var(--text-ghost);padding:4px 0">(koi apni key add nahi ki — AI server ke default providers use karega)</div>';
    return;
  }
  list.innerHTML = cfg.fallbacks.map((f, i) =>
    `<div class="mem-item"><span>${i + 1}. ${f.label} — ${f.model}${i === 0 ? ' (active override)' : ''}</span><button class="mem-del" onclick="delFallback(${i})">✕</button></div>`
  ).join('');
}

function onFbPresetChange() {
  const presetKey = document.getElementById('fb-preset').value;
  const preset = PROVIDER_PRESETS[presetKey];
  document.getElementById('fb-model').placeholder = preset?.model ? `e.g. ${preset.model}` : 'Model ID';
  document.getElementById('fb-custom-base-group').style.display = presetKey === 'custom' ? 'block' : 'none';
  document.getElementById('fb-groq-fetch-wrap').style.display = presetKey === 'groq' ? 'flex' : 'none';
}

function addFallback() {
  const presetKey = document.getElementById('fb-preset').value;
  const preset = PROVIDER_PRESETS[presetKey];
  const key = document.getElementById('fb-key').value.trim();
  let model = document.getElementById('fb-model').value.trim();
  if (!key) { toast('Pehle API key dalo'); return; }
  if (!model) model = preset.model;
  if (!model) { toast('Model ID dalo'); return; }
  let base = preset.base;
  if (presetKey === 'custom') {
    base = document.getElementById('fb-base').value.trim();
    if (!base) { toast('Custom provider ke liye Base URL dalo'); return; }
  }
  cfg.fallbacks = cfg.fallbacks || [];
  cfg.fallbacks.push({ label: preset.label, base, key, model });
  LS.set('chaman_cfg', cfg);
  document.getElementById('fb-key').value = '';
  document.getElementById('fb-model').value = '';
  document.getElementById('fb-base').value = '';
  renderFallbacks();
  renderObFbList();
  toast('✓ Apni key add ho gayi — ab pehle isi se try hoga');
}

function delFallback(i) {
  cfg.fallbacks.splice(i, 1);
  LS.set('chaman_cfg', cfg);
  renderFallbacks();
  renderObFbList();
}

// Groq ke sare free/active chat-models fetch karta hai — sirf tab use hota
// hai jab user APNI Groq key add kar raha ho (override slot), server ke
// apne pool ke liye zaroorat nahi (wo env var mein hardcoded model use
// karta hai).
async function fetchGroqModels(keyInputId, selectId, modelInputId) {
  const key = (document.getElementById(keyInputId).value || '').trim();
  const sel = document.getElementById(selectId);
  if (!key) { toast('Pehle Groq API key dalo'); return; }
  sel.innerHTML = '<option value="">Load ho raha hai...</option>';
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { 'Authorization': `Bearer ${key}` }
    });
    if (!res.ok) throw new Error('bad status ' + res.status);
    const data = await res.json();
    const chatModels = (data.data || []).filter(m => !/whisper|tts|guard/i.test(m.id));
    if (!chatModels.length) throw new Error('koi model nahi mila');
    sel.innerHTML = '<option value="">-- Select karo --</option>' +
      chatModels.map(m => `<option value="${m.id}">${m.id}</option>`).join('');
    toast('✓ Models load ho gaye');
  } catch (err) {
    sel.innerHTML = '<option value="">-- Fetch fail ho gaya --</option>';
    toast('Models fetch nahi ho paye — key check karo');
  }
}

function hasAnyProviderKey() {
  // PHASE 1: server always has its own key pool now, so this no longer
  // gates whether AI works at all — it's just UI copy ("apni key add ki
  // hai ya nahi") wherever it's referenced.
  return !!(cfg.fallbacks && cfg.fallbacks.length && cfg.fallbacks.some(f => f.key));
}

// Stable per-device id — used server-side (lib/keyManager.js) to hash a
// session onto the SAME key across a conversation (per-session rotation,
// not per-message, per plan Section 2: "smooth experience, no jarring
// mid-convo switches"). NOT a security/auth token, just a rotation seed.
function getDeviceSessionId() {
  if (!cfg.deviceSessionId) {
    cfg.deviceSessionId = 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    LS.set('chaman_cfg', cfg);
  }
  return cfg.deviceSessionId;
}

function getUserKeyOverride() {
  // Only the FIRST entry in cfg.fallbacks is sent (server currently
  // accepts a single userKeyOverride) — plan Section 1: "unless user
  // enters their own key (optional override — if present, used first)".
  const f = (cfg.fallbacks || [])[0];
  if (!f || !f.key || !f.base) return null;
  return { base: f.base, key: f.key, model: f.model, label: f.label };
}

// ── Runnable-fence detector notes (unchanged from Phase-0): sirf bash/sh/
// shell/zsh/console/terminal blocks (jo "▶ Run" button dikhate hain) ke
// CLOSE hone par generation ko cut karna hai — see findRunnableFenceEnd in
// chat-core.js. ──

async function streamChat(bubbleEl, promptInputs, messages) {
  try {
    return await attemptServerCall(bubbleEl, promptInputs, messages, null);
  } catch (e) {
    if (e.guestLimitReached) {
      toast('🔒 Aaj ka guest limit khatam — Google se login karo unlimited ke liye');
      throw e;
    }
    // PHASE 8 fix: a 401 (expired/invalid Firebase token) was previously
    // falling through to the generic "thoda slow chal raha hai" toast below
    // — misleading, since the real fix here is "login again", not "wait a
    // bit". Firebase ID tokens auto-refresh under the hood (getAuthToken()
    // in auth.js), so this should be rare — but if it does happen (e.g.
    // account disabled/revoked mid-session), tell the user what actually
    // needs to happen.
    if (e.authExpired) {
      toast('🔒 Session expire ho gayi — dobara login karo');
      throw e;
    }
    // PHASE 1: server already tried its WHOLE key/provider pool internally
    // before this ever threw — that's the point (plan Section 2, Error
    // UX: "on failure/degradation, response just feels a bit slow — no
    // scary error messages exposed to user"). If we get here, everything
    // failed server-side too — genuinely nothing left to fall back to.
    // The exact reason (e.message, from api/chat.js) is intentionally kept
    // out of the toast for UX — but it's still useful for debugging, so
    // log it to console (check via chrome://inspect or Vercel function logs).
    console.error('[Chaman AI] server call failed:', e.message);
    toast('⚠️ Abhi thoda slow/down chal raha hai, thodi der mein try karo');
    throw e;
  }
}

// Small internal utility calls (follow-up chip generation, session
// summary) that don't need the full persona/memory/identity stack — see
// lib/systemPrompt.js "BARE MODE". Returns plain text, no bubble/stream UI.
async function callServerBare(sysMsg, userMsg, maxTokens) {
  const idToken = await getAuthToken();
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idToken,
      sessionId: getDeviceSessionId(),
      messages: [{ role: 'user', content: userMsg }],
      promptInputs: { bare: true, sysPromptOverride: sysMsg },
      userKeyOverride: getUserKeyOverride(),
      maxTokens: maxTokens || 200,
    })
  });
  if (!res.ok) return '';
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let full = '';
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;
      try {
        const chunk = JSON.parse(data);
        full += chunk.choices?.[0]?.delta?.content || '';
      } catch {}
    }
  }
  return full;
}

async function attemptServerCall(bubbleEl, promptInputs, messages) {
  const cursor = document.createElement('span');
  cursor.className = 'stream-cursor';
  bubbleEl.textContent = '';
  bubbleEl.appendChild(cursor);

  // content:// and file:// URLs block true SSE streaming — detect and use non-stream-style fallback
  const isLocalURL = location.href.startsWith('content://') || location.href.startsWith('file://');

  const idToken = await getAuthToken();
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idToken,
      sessionId: getDeviceSessionId(),
      messages,
      promptInputs,
      userKeyOverride: getUserKeyOverride(),
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const e = new Error(err?.error || 'Server error ' + res.status);
    if (err?.guestLimitReached) e.guestLimitReached = true;
    if (res.status === 401) e.authExpired = true; // PHASE 8 — see streamChat() catch
    throw e;
  }

  const providerLabel = res.headers.get('X-Provider-Label') || 'Chaman AI';
  const providerModel = res.headers.get('X-Provider-Model') || '';

  // Non-true-streaming path for content:// and file:// — read the whole
  // SSE body at once then simulate the typewriter effect, same as Phase-0.
  if (isLocalURL) {
    const raw = await res.text();
    let full = '';
    for (const line of raw.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;
      try {
        const chunk = JSON.parse(data);
        full += chunk.choices?.[0]?.delta?.content || '';
      } catch {}
    }
    let stoppedForExec = false, stoppedForSearch = false, stoppedForTool = false;
    const cutAt = findRunnableFenceEnd(full);
    if (cutAt !== -1) { full = full.slice(0, cutAt); stoppedForExec = true; }
    else {
      const searchCutAt = findWebSearchBlockEnd(full);
      if (searchCutAt !== -1) { full = full.slice(0, searchCutAt); stoppedForSearch = true; }
      else {
        const toolCutAt = findToolBlockEnd(full);
        if (toolCutAt !== -1) { full = full.slice(0, toolCutAt); stoppedForTool = true; }
      }
    }
    const visibleLen = full.search(/\[ASK_USER\]|\[WEB_SEARCH\]|\[WIDGET\]|\[TOOL\]/i);
    const typeLimit = visibleLen === -1 ? full.length : visibleLen;
    let i = 0;
    await new Promise(resolve => {
      function type() {
        if (i >= typeLimit) { cursor.remove(); resolve(); return; }
        i = Math.min(i + 3, typeLimit);
        bubbleEl.textContent = full.slice(0, i);
        bubbleEl.appendChild(cursor);
        scrollBottom();
        setTimeout(type, 16);
      }
      type();
    });
    if (!full) throw new Error('khaali response aaya');
    return { text: full, label: providerLabel, model: providerModel, stoppedForExec, stoppedForSearch, stoppedForTool };
  }

  // True streaming path — identical SSE-parsing logic as Phase-0, just
  // reading from our own /api/chat response instead of a provider directly.
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let full = '';
  let buf = '';
  let stoppedForExec = false;
  let stoppedForSearch = false;
  let stoppedForTool = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;
      try {
        const chunk = JSON.parse(data);
        const delta = chunk.choices?.[0]?.delta?.content || '';
        if (delta) {
          full += delta;
          const cutAt = findRunnableFenceEnd(full);
          if (cutAt !== -1) { full = full.slice(0, cutAt); stoppedForExec = true; }
          else {
            const searchCutAt = findWebSearchBlockEnd(full);
            if (searchCutAt !== -1) { full = full.slice(0, searchCutAt); stoppedForSearch = true; }
            else {
              const toolCutAt = findToolBlockEnd(full);
              if (toolCutAt !== -1) { full = full.slice(0, toolCutAt); stoppedForTool = true; }
            }
          }
          const visible = full.split(/\[ASK_USER\]|\[WEB_SEARCH\]|\[WIDGET\]|\[TOOL\]/i)[0];
          bubbleEl.textContent = visible;
          bubbleEl.appendChild(cursor);
          scrollBottom();
        }
      } catch {}
      if (stoppedForExec || stoppedForSearch || stoppedForTool) break;
    }
    if (stoppedForExec || stoppedForSearch || stoppedForTool) {
      try { await reader.cancel(); } catch {} // provider ko aage generate karne se rok do, bandwidth/tokens bachao
      break;
    }
  }
  cursor.remove();
  if (!full) throw new Error('khaali response aaya');
  return { text: full, label: providerLabel, model: providerModel, stoppedForExec, stoppedForSearch, stoppedForTool };
}
