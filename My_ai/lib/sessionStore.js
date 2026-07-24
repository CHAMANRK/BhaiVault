// ═══════════════════════════════════════════════════════════════════════
// lib/sessionStore.js — Firestore chat-session CRUD (Phase 3: Sessions /
// Chat History).
//
// Storage shape: users/{uid}/sessions/{sessionId}
//   {
//     title: string,          // auto-derived from first message, user-renamable
//     messages: [{role, content}, ...],   // FULL raw history, nothing hidden
//     summary: string,        // short AI summary — feeds the "[RECENT SESSIONS]"
//                              // block in systemPrompt.js for OTHER sessions'
//                              // context, and the session-list preview
//     msgCount: number,
//     createdAt, updatedAt: Firestore Timestamps
//   }
//
// Only Google (non-anonymous) users get a Firestore-backed record — guests
// stay device-local per plan Section 5 ("Guest: data stays device-local
// only, no sync"). api/sessions.js enforces that split; this file assumes
// every uid it's given is allowed to be here.
//
// Admin (Phase 5) will read this same collection read-only for "what did
// user X ask about" — no separate admin copy of the data needed.
// ═══════════════════════════════════════════════════════════════════════

const { db, FieldValue } = require('./firebaseAdmin');

const MAX_SESSIONS_LISTED = 100;   // sidebar/list cap — oldest just stop showing, never auto-deleted
const MAX_MESSAGES_PER_SESSION = 400; // sanity cap so one runaway session can't blow past Firestore's 1MB doc limit
const MAX_TITLE_LEN = 80;

function sessionsCol(uid) {
  return db().collection('users').doc(uid).collection('sessions');
}

/**
 * listSessions(uid) — metadata only (no `messages`), newest-updated first.
 * This is what the client's session-switcher list renders, and also what
 * gets cached client-side (cfg.sessions, metadata only for Google users) to
 * feed the "[RECENT SESSIONS]" prompt context without a full-message
 * round-trip on every chat message.
 */
async function listSessions(uid) {
  const snap = await sessionsCol(uid)
    .orderBy('updatedAt', 'desc')
    .limit(MAX_SESSIONS_LISTED)
    .get();
  return snap.docs.map(d => {
    const v = d.data();
    return {
      id: d.id,
      title: v.title || 'Untitled chat',
      summary: v.summary || '',
      msgCount: v.msgCount || 0,
      updatedAt: v.updatedAt?.toMillis?.() || null,
      createdAt: v.createdAt?.toMillis?.() || null,
    };
  });
}

/** getSession(uid, id) — full doc including messages, or null. */
async function getSession(uid, id) {
  if (!id) return null;
  const snap = await sessionsCol(uid).doc(id).get();
  if (!snap.exists) return null;
  const v = snap.data();
  return {
    id: snap.id,
    title: v.title || 'Untitled chat',
    messages: Array.isArray(v.messages) ? v.messages : [],
    summary: v.summary || '',
    msgCount: v.msgCount || 0,
    updatedAt: v.updatedAt?.toMillis?.() || null,
    createdAt: v.createdAt?.toMillis?.() || null,
  };
}

/**
 * saveSession(uid, {id, title, messages, summary}) — upsert. `id` is
 * client-generated (crypto.randomUUID()) so the client can optimistically
 * render before the round-trip completes.
 */
async function saveSession(uid, { id, title, messages, summary }) {
  if (!id) throw new Error('session id required');
  if (!Array.isArray(messages)) throw new Error('messages must be an array');

  const trimmedMessages = messages.slice(-MAX_MESSAGES_PER_SESSION).map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: typeof m.content === 'string' ? m.content.slice(0, 20000) : String(m.content || '').slice(0, 20000),
  }));

  const ref = sessionsCol(uid).doc(id);
  const snap = await ref.get();
  const isNew = !snap.exists;

  const payload = {
    messages: trimmedMessages,
    msgCount: trimmedMessages.length,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (title) payload.title = String(title).slice(0, MAX_TITLE_LEN);
  if (typeof summary === 'string') payload.summary = summary.slice(0, 600);
  if (isNew) {
    payload.createdAt = FieldValue.serverTimestamp();
    if (!payload.title) payload.title = 'Untitled chat';
  }

  await ref.set(payload, { merge: true });
  return { id, isNew };
}

async function renameSession(uid, id, title) {
  if (!id || !title) throw new Error('id and title required');
  await sessionsCol(uid).doc(id).set({
    title: String(title).slice(0, MAX_TITLE_LEN),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function deleteSession(uid, id) {
  if (!id) throw new Error('id required');
  await sessionsCol(uid).doc(id).delete();
}

/** deleteAllSessions(uid) — used by the "Sab clear" button in the Memory modal. */
async function deleteAllSessions(uid) {
  const snap = await sessionsCol(uid).limit(500).get();
  const batch = db().batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
  return snap.size;
}

module.exports = {
  listSessions,
  getSession,
  saveSession,
  renameSession,
  deleteSession,
  deleteAllSessions,
  MAX_SESSIONS_LISTED,
  MAX_MESSAGES_PER_SESSION,
};
