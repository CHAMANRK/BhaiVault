// ═══════════════════════════════════════════════════════════════════════
// js/sessions.js — Phase 3: Sessions / Chat History. Multi-chat
// create/switch/rename/delete, wired into the existing "Memory & History"
// modal (mem-modal) as a real session switcher instead of the old
// read-only summary list.
//
// Storage split (plan Section 5 — guest data stays device-local):
//   - Guest (anonymous):  cfg.sessions holds the FULL record per session
//                         (messages included) — localStorage is the only
//                         copy, nothing synced.
//   - Google user:        cfg.sessions holds METADATA ONLY (id/title/
//                         summary/msgCount/date) as a local cache — it's
//                         what feeds the "[RECENT SESSIONS]" prompt
//                         context (systemPrompt.js) without a network
//                         round-trip on every message. The actual
//                         `messages` live server-side (Firestore, via
//                         api/sessions.js) and are fetched on demand when
//                         a session is opened.
//
// Nothing here is hidden from the AI — full context of whichever session
// is open is always what's sent as `messages` to /api/chat (plan Section
// 1 / Section 6).
// ═══════════════════════════════════════════════════════════════════════

// ── id / title helpers ──

function newSessionId() {
  return (crypto.randomUUID && crypto.randomUUID()) || ('sess_' + Date.now() + '_' + Math.random().toString(36).slice(2));
}

function deriveSessionTitle(firstUserMsg) {
  const s = String(firstUserMsg || '').trim().replace(/\s+/g, ' ');
  if (!s) return 'Untitled chat';
  return s.length > 48 ? s.slice(0, 48) + '…' : s;
}

function sessionDateLabel(ms) {
  return new Date(ms || Date.now()).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── local (guest) cache helpers ──

function findLocalSessionIndex(id) {
  return (cfg.sessions || []).findIndex(s => s.id === id);
}

function upsertLocalSessionMeta(meta) {
  if (!cfg.sessions) cfg.sessions = [];
  const idx = findLocalSessionIndex(meta.id);
  if (idx === -1) cfg.sessions.push(meta);
  else cfg.sessions[idx] = { ...cfg.sessions[idx], ...meta };
  LS.set('chaman_cfg', cfg);
}

// ── autosave (called after every completed AI turn — see chat-core.js) ──

let _sessionSaveInFlight = false;
let _lastSavedMsgCount = 0; // avoids redundant Firestore writes + AI summary calls from the periodic safety-net timer when nothing changed
let _autosaveFailToastShown = false; // throttle: show the failure toast once per app session, not on every retry

// PHASE 7 (plan Section 9, "Sliding window + rolling summary": send last
// ~10-15 raw messages + a short summary of everything older, instead of
// the full session every time). chat-core.js already slices the last 20
// messages for the actual /api/chat payload (OLD_SUMMARY_WINDOW below
// matches that number) — what was missing was compressing everything
// BEFORE that window into cfg.oldSummary, which js/systemPrompt.js /
// lib/systemPrompt.js already read/inject but nothing ever wrote to.
// _oldSummaryFoldedCount tracks how many of currentSession's messages are
// already folded in, so each refresh only compresses the NEW excess chunk
// (merged with the previous oldSummary) rather than redoing the whole
// thing from scratch every time.
const OLD_SUMMARY_WINDOW = 20; // must match chat-core.js's currentSession.slice(-20)
let _oldSummaryFoldedCount = 0;

/**
 * autosaveSession() — fire-and-forget by design (callers don't await this
 * inline in the hot send path). Silently no-ops for: temp creator sessions
 * (never persisted, by design — see chat-core.js /verify-t), empty
 * sessions (nothing to save yet), and unchanged sessions (nothing new
 * since the last save — matters because main.js also calls this from a
 * periodic timer as a safety net).
 */
async function autosaveSession() {
  if (typeof tempCreatorSession !== 'undefined' && tempCreatorSession) return;
  if (!currentSession || currentSession.length < 2) return;
  if (currentSession.length === _lastSavedMsgCount) return; // nothing new to save
  if (_sessionSaveInFlight) return; // a save is already running for this turn; next call will catch up
  _sessionSaveInFlight = true;
  try {
    if (!currentSessionId) currentSessionId = newSessionId();

    const firstUserMsg = currentSession.find(m => m.role === 'user')?.content;
    const title = deriveSessionTitle(firstUserMsg);

    // Refresh the AI-generated summary only occasionally (first exchange,
    // then every ~6 messages) — regenerating it every single turn would be
    // an extra AI call per message for no real benefit to the preview/context.
    const msgCount = currentSession.length;
    const existingMeta = isGuestUser() ? (cfg.sessions || []).find(s => s.id === currentSessionId) : null;
    const shouldRefreshSummary = msgCount <= 3 || msgCount % 6 === 0 || !(existingMeta?.summary);
    let summary = existingMeta?.summary || '';
    if (shouldRefreshSummary) {
      try {
        const sumSysMsg = 'Yeh conversation ka brief summary do — sirf key points, decisions, topics discussed. 2-4 sentences max. Hinglish mein.';
        const sumUserMsg = 'Conversation:\n' + currentSession.map(m => `${m.role}: ${String(m.content).slice(0, 300)}`).join('\n');
        const gen = await callServerBare(sumSysMsg, sumUserMsg, 200);
        if (gen) summary = gen;
      } catch {}
      if (!summary) summary = currentSession.slice(0, 2).map(m => String(m.content).slice(0, 100)).join(' | ');
    }

    if (isGuestUser()) {
      upsertLocalSessionMeta({
        id: currentSessionId,
        title,
        date: sessionDateLabel(Date.now()),
        updatedAt: Date.now(),
        msgCount,
        summary,
        messages: currentSession.slice(-400), // mirrors lib/sessionStore.js MAX_MESSAGES_PER_SESSION
      });
    } else {
      await callSessionsApi('save', { id: currentSessionId, title, messages: currentSession, summary });
      // Local metadata cache only (no messages) — for the sidebar list +
      // prompt context, see file header.
      upsertLocalSessionMeta({
        id: currentSessionId,
        title,
        date: sessionDateLabel(Date.now()),
        updatedAt: Date.now(),
        msgCount,
        summary,
      });
    }
    _lastSavedMsgCount = msgCount;
    maybeRefreshOldSummary(); // fire-and-forget — see PHASE 7 note above; never blocks the save itself
  } catch (e) {
    console.warn('[sessions] autosave failed:', e.message); // _lastSavedMsgCount untouched — next tick retries
    // Google users can't see console errors on mobile — surface it once per
    // session so it's obvious the chat ISN'T syncing, instead of silently
    // losing history. Guests are local-only and effectively never hit this
    // path, so we don't bother them with it.
    if (!isGuestUser() && !_autosaveFailToastShown) {
      _autosaveFailToastShown = true;
      toast('⚠️ Chat save nahi ho paya: ' + (e.message || 'unknown error'));
    }
  } finally {
    _sessionSaveInFlight = false;
  }
}

/**
 * maybeRefreshOldSummary() — folds messages that have scrolled OUT of the
 * live sliding window (OLD_SUMMARY_WINDOW) into cfg.oldSummary, merging
 * with whatever was already there. No-ops if the session hasn't grown
 * past the window yet, or if there's nothing new to fold since last time.
 * Fire-and-forget by design (same reasoning as autosaveSession itself) —
 * a failed/slow fold just means oldSummary is one refresh cycle stale,
 * never a blocker for sending the next message.
 */
async function maybeRefreshOldSummary() {
  const total = currentSession.length;
  const excess = total - _oldSummaryFoldedCount - OLD_SUMMARY_WINDOW;
  if (excess <= 0) return; // still within the raw window, nothing to fold yet

  const chunk = currentSession.slice(_oldSummaryFoldedCount, total - OLD_SUMMARY_WINDOW);
  try {
    const sysMsg = 'Tu conversation ke PURANE messages (jo ab live window se bahar nikal chuke hain) ko compress kar raha hai. Agar pehle se ek summary di gayi hai, use NAYE chunk ke saath merge karke EK combined summary bana — purani cheez mat bhool, bas short kar. 3-5 sentences max, sirf key facts/decisions/context jo aage kaam aayega, Hinglish mein, koi filler nahi.';
    const userMsg = (cfg.oldSummary ? `Pehla (purana) summary:\n${cfg.oldSummary}\n\n` : '') +
      `Naya chunk jo ab compress karna hai:\n` +
      chunk.map(m => `${m.role}: ${String(m.content).slice(0, 300)}`).join('\n');
    const merged = await callServerBare(sysMsg, userMsg, 250);
    if (!merged) return; // AI pool down — leave oldSummary as-is, retry next cycle (chunk will just be a bit bigger)
    cfg.oldSummary = merged;
    _oldSummaryFoldedCount = total - OLD_SUMMARY_WINDOW;
    LS.set('chaman_cfg', cfg);
  } catch (e) {
    console.warn('[sessions] oldSummary fold failed:', e.message); // _oldSummaryFoldedCount untouched — next cycle retries with the bigger chunk
  }
}

// ── server call helper (mirrors providers.js callServerBare style) ──

async function callSessionsApi(action, extra) {
  const idToken = await getAuthToken();
  const res = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken, action, ...extra }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || ('Session API error ' + res.status));
  return data;
}

// ── list / render (mem-modal) ──

async function refreshSessionList() {
  if (isGuestUser()) return; // cfg.sessions already IS the authoritative local list
  try {
    const { sessions } = await callSessionsApi('list', {});
    cfg.sessions = sessions.map(s => ({
      id: s.id,
      title: s.title,
      date: sessionDateLabel(s.updatedAt),
      updatedAt: s.updatedAt,
      msgCount: s.msgCount,
      summary: s.summary,
    }));
    LS.set('chaman_cfg', cfg);
  } catch (e) {
    console.warn('[sessions] list refresh failed:', e.message);
  }
}

function renderSessions() {
  const list = document.getElementById('sess-list');
  if (!list) return;
  const sessions = [...(cfg.sessions || [])].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (!sessions.length) {
    list.innerHTML = '<div style="font-size:0.8rem;color:var(--text-ghost);padding:4px 0">(koi chat nahi abhi)</div>';
    return;
  }
  // Inline styles here (not css/style.css, which isn't part of this
  // patch) — keeps this self-contained regardless of stylesheet edits.
  list.innerHTML = sessions.map(s => `
    <div class="sess-item" data-id="${s.id}" style="display:flex;align-items:center;gap:6px;padding:6px 0;${s.id === currentSessionId ? 'background:rgba(255,255,255,0.04);border-radius:8px' : ''}">
      <div class="sess-main" data-act="open" data-id="${s.id}" style="flex:1;min-width:0;cursor:pointer;padding:2px 6px">
        <div class="sess-meta">${s.id === currentSessionId ? '💬 ' : ''}${s.title || 'Untitled chat'} · ${s.date || ''} · ${s.msgCount || 0} messages</div>
        <div class="sess-preview">${s.summary || 'No summary'}</div>
      </div>
      <div class="sess-actions" style="display:flex;gap:4px;flex-shrink:0">
        <button class="sess-act-btn" title="Rename" data-act="rename" data-id="${s.id}" style="background:none;border:none;cursor:pointer;font-size:0.95rem;padding:4px">✏️</button>
        <button class="sess-act-btn" title="Delete" data-act="delete" data-id="${s.id}" style="background:none;border:none;cursor:pointer;font-size:0.95rem;padding:4px">🗑️</button>
      </div>
    </div>
  `).join('');
}

// Delegated click handler — one listener on the list, works for items
// re-rendered any number of times (see main.js wiring).
async function onSessListClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const { act, id } = btn.dataset;
  if (act === 'open') return openSession(id);
  if (act === 'rename') return renameSessionUI(id);
  if (act === 'delete') return deleteSessionUI(id);
}

// ── open / resume a session ──

function renderMessagesIntoDom(messages) {
  const list = document.getElementById('msgs-list');
  document.getElementById('welcome')?.remove();
  list.innerHTML = '';
  (messages || []).forEach(m => appendMsg(m.role === 'user' ? 'out' : 'in', String(m.content || '')));
}

async function openSession(id) {
  if (!id || id === currentSessionId) { closeModal('mem-modal'); return; }
  if (loading) { toast('Pehle current reply complete hone do'); return; }

  // Save whatever's open right now before switching away from it.
  await autosaveSession();

  showPageLoader(); // this-chat -> that-chat transition
  try {
    let full;
    if (isGuestUser()) {
      full = (cfg.sessions || []).find(s => s.id === id);
      if (!full) { toast('Chat nahi mila'); return; }
    } else {
      const { session } = await callSessionsApi('get', { id });
      full = session;
    }
    currentSessionId = id;
    currentSession = (full.messages || []).map(m => ({ role: m.role, content: m.content }));
    _lastSavedMsgCount = currentSession.length; // just loaded from storage — already "saved" as of now

    // PHASE 7: this is a DIFFERENT conversation's context — any oldSummary
    // folded for the previously-open session doesn't belong here. If this
    // reopened session is already longer than the live window, kick off an
    // immediate fold in the background (fire-and-forget) so older context
    // isn't silently missing until enough new messages accumulate to
    // trigger the next natural refresh.
    cfg.oldSummary = '';
    _oldSummaryFoldedCount = 0;
    LS.set('chaman_cfg', cfg);
    maybeRefreshOldSummary();

    renderMessagesIntoDom(currentSession);
    renderSuggChips();
    closeModal('mem-modal');
    toast('📂 Chat resume ho gaya');
  } catch (e) {
    toast('Chat load nahi ho paya');
  } finally {
    hidePageLoader();
  }
}

async function renameSessionUI(id) {
  const current = (cfg.sessions || []).find(s => s.id === id);
  const next = prompt('Naya naam:', current?.title || '');
  if (!next || !next.trim()) return;
  const title = next.trim().slice(0, 80);
  try {
    if (!isGuestUser()) await callSessionsApi('rename', { id, title });
    upsertLocalSessionMeta({ id, title });
    renderSessions();
    toast('✏️ Naam badal diya');
  } catch (e) {
    toast('Rename fail ho gaya');
  }
}

async function deleteSessionUI(id) {
  if (!confirm('Ye chat permanently delete karni hai?')) return;
  try {
    if (!isGuestUser()) await callSessionsApi('delete', { id });
    const idx = findLocalSessionIndex(id);
    if (idx !== -1) cfg.sessions.splice(idx, 1);
    LS.set('chaman_cfg', cfg);
    if (id === currentSessionId) {
      // Active chat got deleted out from under itself — fresh start, same
      // as tapping "New Chat".
      currentSessionId = null;
      currentSession = [];
      _lastSavedMsgCount = 0;
      cfg.oldSummary = ''; // PHASE 7 — fresh start, no carried-over old context
      _oldSummaryFoldedCount = 0;
      LS.set('chaman_cfg', cfg);
      renderMessagesIntoDom([]);
      document.getElementById('msgs-list').innerHTML = `
        <div id="welcome">
          <div class="wc-icon">✨</div>
          <h2>Kya haal hai?</h2>
          <p>Bol kya karna hai — main yaad rakhta hoon sab</p>
          <div class="sugg-chips" id="sugg-chips"></div>
        </div>
      `;
      renderSuggChips();
    }
    renderSessions();
    toast('🗑️ Chat delete ho gayi');
  } catch (e) {
    toast('Delete fail ho gaya');
  }
}

/** clearAllSessions() — used by the "Sab clear" button (memory.js clearAllMemory). */
async function clearAllSessions() {
  try {
    if (!isGuestUser()) await callSessionsApi('deleteAll', {});
  } catch (e) {
    console.warn('[sessions] deleteAll failed:', e.message);
  }
  cfg.sessions = [];
  cfg.oldSummary = ''; // PHASE 7 — nothing left to carry a summary of
  _oldSummaryFoldedCount = 0;
  LS.set('chaman_cfg', cfg);
}
