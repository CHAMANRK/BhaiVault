// ═══════════════════════════════════════════════════════════════════════
// lib/adminStore.js — Phase 5 (Admin Mode, plan Section 7): Firestore
// reads that power the "secret agent" data-analysis layer — "how many new
// users today?", "what did user X ask about?", etc.
//
// Reads the SAME collections Phase 2/3 already write (users/{uid},
// users/{uid}/sessions/{id}) — no separate admin copy of the data, per
// sessionStore.js's own header note ("Admin will read this same
// collection read-only").
//
// Default posture per plan: user data shown as SUMMARIES; raw chat only
// when explicitly asked BY NAME/uid. Enforced by the caller (api/admin/
// users.js): listUserSummaries() never includes message content,
// getUserRawSessions() is a separate, explicit call.
// ═══════════════════════════════════════════════════════════════════════

const { db } = require('./firebaseAdmin');

function startOfTodayUTC() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * getUserCounts() — total users + new-today count. Firestore doesn't do
 * a cheap "count where createdAt >= X" without a composite setup beyond
 * this project's scope, so for "new today" we do a bounded scan (users
 * collection is expected to stay in the hundreds/low-thousands for a
 * personal-project scale app — revisit with a counter doc if it ever
 * grows past that).
 */
async function getUserCounts() {
  const totalSnap = await db().collection('users').count().get();
  const totalUsers = totalSnap.data().count;

  const todayStart = startOfTodayUTC();
  const recentSnap = await db().collection('users')
    .where('createdAt', '>=', todayStart)
    .get()
    .catch(() => null); // createdAt is a serverTimestamp field — query works once indexed; null-safe if index isn't built yet

  const newUsersToday = recentSnap ? recentSnap.size : null; // null = "couldn't compute, check Firestore index"
  return { totalUsers, newUsersToday };
}

/**
 * listUserSummaries(limit) — SUMMARY view only (plan: default to
 * summaries, never raw chat unless asked by name). One row per user:
 * uid, guest-or-google, join date, today's message count, session count.
 * Deliberately excludes anything from inside a session's `messages`.
 */
async function listUserSummaries(limit = 50) {
  const snap = await db().collection('users')
    .orderBy('createdAt', 'desc')
    .limit(Math.min(limit, 200))
    .get();

  const users = [];
  for (const doc of snap.docs) {
    const v = doc.data();
    let sessionCount = 0;
    if (!v.isAnonymous) {
      // Guests never have a Firestore sessions subcollection (device-local
      // only, plan Section 5) — skip the read entirely for them.
      const sessSnap = await db().collection('users').doc(doc.id).collection('sessions').count().get().catch(() => null);
      sessionCount = sessSnap ? sessSnap.data().count : 0;
    }
    users.push({
      uid: doc.id,
      isAnonymous: !!v.isAnonymous,
      displayName: v.displayName || null, // populated if userStore.setDisplayName() has been called for this user
      email: v.email || null,
      createdAt: v.createdAt?.toMillis?.() || null,
      msgCountToday: v.msgCountToday || 0,
      sessionCount,
    });
  }
  return users;
}

/**
 * findUserByNameOrEmail(query) — best-effort lookup so an admin can ask
 * "what did [name] ask about" without knowing a raw uid. Only matches
 * against fields that are actually populated (displayName/email) — many
 * users may have neither stored yet (see userStore.js TODO on capturing
 * displayName at onboarding time), in which case this returns [].
 */
async function findUserByNameOrEmail(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  // Firestore has no case-insensitive "contains" query — bounded scan +
  // in-memory filter, same scale caveat as getUserCounts() above.
  const snap = await db().collection('users').limit(500).get();
  return snap.docs
    .map(d => ({ uid: d.id, ...d.data() }))
    .filter(u =>
      (u.displayName && u.displayName.toLowerCase().includes(q)) ||
      (u.email && u.email.toLowerCase().includes(q))
    )
    .map(u => ({ uid: u.uid, displayName: u.displayName || null, email: u.email || null }));
}

/**
 * getUserRawSessions(uid, limit) — FULL message content. Only ever call
 * this when the admin explicitly named a user (plan: "raw chat; on
 * explicit request only") — api/admin/users.js is the enforcement point,
 * this function itself has no restriction beyond "give me what's there".
 */
async function getUserRawSessions(uid, limit = 20) {
  if (!uid) throw new Error('uid required');
  const snap = await db().collection('users').doc(uid).collection('sessions')
    .orderBy('updatedAt', 'desc')
    .limit(Math.min(limit, 100))
    .get();
  return snap.docs.map(d => {
    const v = d.data();
    return {
      id: d.id,
      title: v.title || 'Untitled chat',
      summary: v.summary || '',
      messages: Array.isArray(v.messages) ? v.messages : [],
      updatedAt: v.updatedAt?.toMillis?.() || null,
    };
  });
}

module.exports = { getUserCounts, listUserSummaries, findUserByNameOrEmail, getUserRawSessions };
