// ═══════════════════════════════════════════════════════════════════════
// admin.js — Phase 5 (Creator/Admin Mode, plan Section 7): access control
// + creator-verified acknowledgment message.
//
// REPLACES the old CREATOR_SECRET-in-client-JS scheme entirely. Two ways
// to be admin now, both verified SERVER-SIDE (lib/adminAuth.js):
//
//   1. PRIMARY — logged in as the admin Firebase account (email/password).
//      No command needed: checkAdminStatus() runs once after auth
//      resolves (called from main.js's continueInitAfterAuth) and asks
//      /api/admin/verify "is this idToken the admin account?". Result
//      cached in adminState for the rest of the session — re-checked
//      fresh on every app load (Firebase's currentUser already persists
//      across reloads, so this costs one network call, not a re-login).
//
//   2. BACKUP — /verify-t <code> in chat (see chat-core.js) sends the
//      code to /api/admin/verify, which checks it against
//      ADMIN_BACKUP_CODE server-side and returns a short-lived signed
//      token if correct. That token lives ONLY in adminState (runtime
//      memory, same as the old tempCreatorSession pattern) — never
//      localStorage, so it can't outlive the tab/reload and leaves no
//      trace on a borrowed device.
//
// isCreatorActive() keeps its old name/signature (used all over
// chat-core.js) so no other call site needs to change.
// ═══════════════════════════════════════════════════════════════════════

const adminState = {
  isAdmin: false,       // primary path result — real Firebase account check
  backupToken: null,    // backup path — short-lived signed token, memory-only
  creatorMemory: [],    // PHASE 5: cached list of Najeef's personal/project notes (lib/adminMemory.js) — fed into every prompt via js/systemPrompt.js once admin access is confirmed
};

// Temporary creator session flag (kept from the pre-Phase-5 file — set by
// chat-core.js's /verify-t handler, read by isCreatorActive() below and by
// systemPrompt inputs in chat-core.js's buildPrompt() call sites).
let tempCreatorSession = false;

function isCreatorActive() {
  return !!(adminState.isAdmin || tempCreatorSession);
}

/**
 * checkAdminStatus() — call once after Firebase auth resolves (main.js).
 * Silently no-ops (isAdmin stays false) if not logged in, on a network
 * error, or if the account just isn't the admin one — no error surfaced
 * to normal users, this check is invisible to everyone except the actual
 * admin account.
 */
async function checkAdminStatus() {
  try {
    const idToken = await getAuthToken();
    if (!idToken) { adminState.isAdmin = false; return; }
    const res = await fetch('/api/admin/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    const data = await res.json().catch(() => ({}));
    adminState.isAdmin = !!(data && data.isAdmin);
    if (adminState.isAdmin) {
      updateCreatorBadge();
      await refreshCreatorMemory();
      maybeShowAdminDailyDigest(); // fire-and-forget — never blocks normal app init
    }
  } catch (e) {
    adminState.isAdmin = false;
  }
}

/**
 * tryAdminBackupCode(code) — called from chat-core.js's /verify-t handler.
 * Returns true/false; on success, stores the signed backup token in
 * adminState (memory-only, see file header) for use on /api/admin/* calls
 * made during this temporary session (e.g. a future admin data-query
 * feature) and flips on the Creator Mode UI badge.
 */
async function tryAdminBackupCode(code) {
  if (!code) return false;
  try {
    const res = await fetch('/api/admin/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backupCode: code }),
    });
    const data = await res.json().catch(() => ({}));
    if (data && data.isAdmin && data.adminBackupToken) {
      adminState.backupToken = data.adminBackupToken;
      updateCreatorBadge();
      await refreshCreatorMemory();
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

function clearAdminBackupToken() {
  adminState.backupToken = null;
  updateCreatorBadge();
}

function updateCreatorBadge() {
  const badge = document.getElementById('creator-badge');
  if (badge) badge.style.display = isCreatorActive() ? 'inline-flex' : 'none';
}

/**
 * callAdminApi(path, extra) — shared fetch helper for future admin data
 * queries (stats/users), mirrors js/sessions.js's callSessionsApi style.
 * Sends BOTH idToken and backupToken if present — api/admin/*.js's
 * requireAdmin() accepts either.
 */
async function callAdminApi(path, extra) {
  const idToken = await getAuthToken().catch(() => null);
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken, adminBackupToken: adminState.backupToken, ...extra }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || ('Admin API error ' + res.status));
  return data;
}

/**
 * refreshCreatorMemory() — pulls Najeef's personal/project notes
 * (api/admin/memory.js → lib/adminMemory.js) into adminState.creatorMemory
 * so js/systemPrompt.js can include them in the next prompt build. Called
 * right after admin access is confirmed (either path) — never on a normal
 * user's device, since callAdminApi requires a token requireAdmin() will
 * actually accept.
 */
async function refreshCreatorMemory() {
  try {
    const data = await callAdminApi('/api/admin/memory', { action: 'list' });
    adminState.creatorMemory = (data.notes || []).map(n => n.text);
  } catch (e) {
    console.warn('[admin] creator memory refresh failed:', e.message);
  }
}

/**
 * maybeShowAdminDailyDigest() — plan Section 7: "Daily digest: on login,
 * AI proactively reports — new users today, key health, notable events."
 * Runs at most ONCE PER CALENDAR DAY (tracked in cfg.lastAdminDigestDate,
 * localStorage — harmless to persist since it's just a "already shown
 * today" debounce, not a credential). ONLY for the primary (real account)
 * path — a backup-code emergency session is for a specific task, not the
 * daily-overview ritual, so it's deliberately skipped there.
 */
async function maybeShowAdminDailyDigest() {
  if (!adminState.isAdmin) return;
  const today = new Date().toISOString().slice(0, 10);
  if (cfg.lastAdminDigestDate === today) return;
  cfg.lastAdminDigestDate = today;
  LS.set('chaman_cfg', cfg);

  try {
    const stats = await callAdminApi('/api/admin/stats', {});
    await renderAdminDigest(stats);
  } catch (e) {
    console.warn('[admin] daily digest failed:', e.message); // silent — not critical enough to bother Najeef with an error toast on login
  }
}

/**
 * renderAdminDigest(stats) — feeds the raw numbers to the AI as hidden
 * context (never shown to the user as raw JSON) and lets it write the
 * actual digest message in creator-mode tone (see lib/systemPrompt.js's
 * [CREATOR MODE TONE] line — direct, no fluff). Same pattern as
 * triggerCreatorVerifiedAck(): synthetic instruction turn, own bubble,
 * pushed into currentSession as a real exchange (nothing hidden from the
 * AI's own context on future turns, per plan Section 1).
 */
async function renderAdminDigest(stats) {
  const keyLines = Object.entries(stats.keyHealth || {}).map(([provider, info]) => {
    const down = info.keys.filter(k => k.status === 'cooling_down').length;
    return `${provider}: ${info.totalKeys - down}/${info.totalKeys} keys OK${down ? `, ${down} cooling down` : ''}`;
  }).join(' | ') || 'koi provider configured nahi hai';

  const instructionUser = `[ADMIN DAILY DIGEST — SYSTEM AUTO-TRIGGER, USER NE ABHI KUCH TYPE NAHI KIYA HAI]
Aaj ka pehla login hai — neeche raw numbers hain, apne words mein ek CHHOTA digest bana ke de (creator-mode tone: seedha, no fluff):
- Total users: ${stats.totalUsers}
- Naye users aaj: ${stats.newUsersToday === null ? 'pata nahi chal saka (Firestore index check karo)' : stats.newUsersToday}
- Key pool health: ${keyLines}

[INSTRUCTION] 3-5 chhoti lines mein digest de, bullet points theek hain. Koi greeting/preamble mat laga ("Good morning" jaisa kuch nahi), seedha data pe aa ja. Agar sab kuch normal/healthy lag raha hai to bhi confirm kar de ki sab thik hai — chhota reassurance kaafi hai, lamba mat kar.`;

  document.getElementById('welcome')?.remove();
  const aiBub = appendMsg('in', '', null, true);
  scrollBottom();

  try {
    const messages = [...currentSession, { role: 'user', content: instructionUser }];
    let { text: full, label, model } = await streamChat(aiBub, buildPrompt(), messages);
    aiBub.innerHTML = '';
    aiBub.appendChild(parseMarkdown(full || '...'));

    const timEl = document.createElement('div');
    timEl.className = 'msg-time';
    if (cfg.showModelTag) {
      const tagEl = document.createElement('span');
      tagEl.className = 'model-tag-inline';
      tagEl.textContent = `${label} · ${model}`;
      timEl.appendChild(tagEl);
      timEl.appendChild(document.createTextNode(' · '));
    }
    timEl.appendChild(document.createTextNode(now()));
    aiBub.parentElement.appendChild(timEl);

    currentSession.push({ role: 'user', content: instructionUser });
    currentSession.push({ role: 'assistant', content: full });
    renderSuggChips();
  } catch (e) {
    aiBub.innerHTML = '';
    aiBub.appendChild(parseMarkdown('📊 Daily digest laane mein error: ' + (e.message || 'connection issue')));
  } finally {
    scrollBottom();
  }
}

async function triggerCreatorVerifiedAck() {
  document.getElementById('welcome')?.remove();

  const instructionUser = `[CREATOR VERIFIED — SYSTEM AUTO-TRIGGER, USER NE ABHI KUCH TYPE NAHI KIYA HAI]
Is device ne abhi /verify-t se secret code confirm kar diya hai — is waqt jo insaan tujhse baat kar raha hai, wahi Chaman/Najeef (creator) hai, poore confidence ke saath (jaisa [IDENTITY PROTOCOL] mein bataya gaya hai).

[INSTRUCTION] Ek chhota, casual acknowledgment message bhej jisse pata chale tu jaan gaya hai ki ye tera creator hai — apne creator se baat karne wale dost jaise tone mein. Lamba mat likh, formal mat ho, koi naya sawaal-jawab session shuru mat kar, bas ek warm chhota acknowledgment.`;

  const aiBub = appendMsg('in', '', null, true);
  scrollBottom();

  try {
    const messages = [...currentSession, { role: 'user', content: instructionUser }];
    let { text: full, label, model } = await streamChat(aiBub, buildPrompt(), messages);
    full = applyInsultStateMachine(full);
    aiBub.innerHTML = '';
    aiBub.appendChild(parseMarkdown(full || '...'));

    const timEl = document.createElement('div');
    timEl.className = 'msg-time';
    if (cfg.showModelTag) {
      const tagEl = document.createElement('span');
      tagEl.className = 'model-tag-inline';
      tagEl.textContent = `${label} · ${model}`;
      timEl.appendChild(tagEl);
      timEl.appendChild(document.createTextNode(' · '));
    }
    timEl.appendChild(document.createTextNode(now()));
    aiBub.parentElement.appendChild(timEl);

    currentSession.push({ role: 'user', content: instructionUser });
    currentSession.push({ role: 'assistant', content: full });
    renderSuggChips();
  } catch (e) {
    aiBub.innerHTML = '';
    aiBub.appendChild(parseMarkdown('✅ Verify ho gaya (auto-message bhejne mein error: ' + (e.message || 'connection issue') + ')'));
  } finally {
    scrollBottom();
  }
}
