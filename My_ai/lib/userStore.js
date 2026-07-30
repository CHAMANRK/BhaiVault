// ═══════════════════════════════════════════════════════════════════════
// lib/userStore.js — Firestore user record read/write.
//
// Per plan Phase 2: "Guest users: full feature access, data stays
// device-local (no cloud sync), capped at 20-25 messages/day." Google
// users get a real Firestore-backed record (chats/memory/instructions —
// those land in Phase 3, this file just lays the user-record foundation).
// ═══════════════════════════════════════════════════════════════════════

const { db, FieldValue } = require('./firebaseAdmin');

const GUEST_DAILY_LIMIT = 25;

function todayStr() {
  return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD', UTC — fine as a rough daily-reset boundary
}

/**
 * getOrCreateUser(decodedToken) — decodedToken comes from
 * firebaseAdmin.verifyIdToken(). Creates a Firestore users/{uid} doc on
 * first sight, resets the daily guest counter if the date has rolled
 * over, and returns the current record.
 */
async function getOrCreateUser(decodedToken) {
  const uid = decodedToken.uid;
  const isAnonymous = decodedToken.firebase?.sign_in_provider === 'anonymous';
  const ref = db().collection('users').doc(uid);
  const snap = await ref.get();
  const today = todayStr();

  if (!snap.exists) {
    const record = {
      uid,
      isAnonymous,
      createdAt: FieldValue.serverTimestamp(),
      msgCountDate: today,
      msgCountToday: 0,
    };
    await ref.set(record);
    return record;
  }

  const record = snap.data();
  if (record.msgCountDate !== today) {
    await ref.update({ msgCountDate: today, msgCountToday: 0 });
    record.msgCountDate = today;
    record.msgCountToday = 0;
  }
  return record;
}

/**
 * checkGuestLimit(decodedToken) — for anonymous (guest) users only. Google
 * users always pass (no cap per plan). Returns { allowed, remaining }.
 */
async function checkGuestLimit(decodedToken) {
  const isAnonymous = decodedToken.firebase?.sign_in_provider === 'anonymous';
  if (!isAnonymous) return { allowed: true, remaining: Infinity };
  const record = await getOrCreateUser(decodedToken);
  const remaining = Math.max(0, GUEST_DAILY_LIMIT - (record.msgCountToday || 0));
  return { allowed: remaining > 0, remaining };
}

/**
 * incrementMessageCount(uid) — call AFTER a successful chat completion
 * (not before — a failed/errored attempt shouldn't cost the user their
 * daily quota).
 */
async function incrementMessageCount(uid) {
  const ref = db().collection('users').doc(uid);
  await ref.update({ msgCountToday: FieldValue.increment(1) }).catch(() => {});
}

module.exports = { getOrCreateUser, checkGuestLimit, incrementMessageCount, GUEST_DAILY_LIMIT };
