// ═══════════════════════════════════════════════════════════════════════
// lib/dailySummaryStore.js — PHASE 6 (plan Section 8, "Daily Summary
// System"): storage for what cron/dailySummary.js produces once/day —
//   (a) a short per-user digest that feeds THAT USER's own memory
//   (b) one admin-wide digest that feeds Najeef's "daily digest on login"
//       (plan Section 7)
//
// Storage shape:
//   users/{uid}/dailySummaries/{date}   — { date, digest, sessionCount,
//                                            msgCount, createdAt }
//   users/{uid}.lastDailySummary        — { date, digest } mirror on the
//                                          user doc itself, so a future
//                                          systemPrompt.js hook can read
//                                          "yesterday's summary" with a
//                                          single doc get() instead of a
//                                          subcollection query on every
//                                          chat message (Section 9: token/
//                                          cost optimization).
//   adminDigest/{date}                  — { date, activeUsers,
//                                            newUsersToday, totalUsers,
//                                            keyHealth, notableEvents,
//                                            createdAt }
//
// `date` is always a UTC 'YYYY-MM-DD' string (matches userStore.js
// todayStr() / adminStore.js startOfTodayUTC() — same day-boundary
// convention project-wide) — and doc IDs are lexicographically sortable,
// so "most recent digest" is just an orderBy(documentId(), 'desc') limit 1.
// ═══════════════════════════════════════════════════════════════════════

const { db, FieldValue } = require('./firebaseAdmin');

const MAX_NOTABLE_EVENTS = 20;

// ── per-user daily summary ──

async function saveUserDailySummary(uid, date, { digest, sessionCount, msgCount }) {
  if (!uid || !date) throw new Error('uid and date required');
  const clean = String(digest || '').trim().slice(0, 800);

  const ref = db().collection('users').doc(uid).collection('dailySummaries').doc(date);
  await ref.set({
    date,
    digest: clean,
    sessionCount: sessionCount || 0,
    msgCount: msgCount || 0,
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  // Mirror onto the user doc for cheap single-read access later.
  await db().collection('users').doc(uid).set({
    lastDailySummary: { date, digest: clean },
  }, { merge: true });
}

async function getUserDailySummary(uid, date) {
  if (!uid || !date) return null;
  const snap = await db().collection('users').doc(uid).collection('dailySummaries').doc(date).get();
  return snap.exists ? snap.data() : null;
}

/** listUserDailySummaries(uid, limit) — most recent first, for a future "memory timeline" view. */
async function listUserDailySummaries(uid, limit = 7) {
  if (!uid) return [];
  const snap = await db().collection('users').doc(uid).collection('dailySummaries')
    .orderBy('date', 'desc')
    .limit(Math.min(limit, 30))
    .get();
  return snap.docs.map(d => d.data());
}

// ── admin-wide daily digest ──

async function saveAdminDigest(date, { activeUsers, newUsersToday, totalUsers, keyHealth, notableEvents }) {
  if (!date) throw new Error('date required');
  const ref = db().collection('adminDigest').doc(date);
  await ref.set({
    date,
    activeUsers: activeUsers || 0,
    newUsersToday: newUsersToday ?? null,
    totalUsers: totalUsers ?? null,
    keyHealth: keyHealth || {},
    notableEvents: (notableEvents || []).slice(0, MAX_NOTABLE_EVENTS),
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function getAdminDigest(date) {
  if (!date) return null;
  const snap = await db().collection('adminDigest').doc(date).get();
  return snap.exists ? snap.data() : null;
}

/** getLatestAdminDigest() — for "on login, AI proactively reports" (plan Section 7). */
async function getLatestAdminDigest() {
  const snap = await db().collection('adminDigest')
    .orderBy('date', 'desc')
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0].data();
}

module.exports = {
  saveUserDailySummary,
  getUserDailySummary,
  listUserDailySummaries,
  saveAdminDigest,
  getAdminDigest,
  getLatestAdminDigest,
};
