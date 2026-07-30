// ═══════════════════════════════════════════════════════════════════════
// api/cron/dailySummary.js — PHASE 6 (plan Section 6 + Section 8): runs
// once/day via Vercel Cron (see vercel.json). Summarizes each active
// (Google, non-anonymous) user's day into a short digest — NOT full raw
// logs — feeding both:
//   (a) that user's own memory  → users/{uid}/dailySummaries/{date}
//   (b) admin's overview        → adminDigest/{date}
// via lib/dailySummaryStore.js.
//
// Guests are skipped entirely — their data is device-local only (plan
// Section 5), nothing server-side to summarize.
//
// TWO ways to trigger:
//   GET  + `Authorization: Bearer ${CRON_SECRET}` header — this is what
//        Vercel's own Cron scheduler sends automatically once CRON_SECRET
//        is set as an env var (Vercel docs: "Securing Cron Jobs").
//   POST + { idToken } or { adminBackupToken } — manual re-run from the
//        admin panel/chat (e.g. "aaj ka digest abhi banao"), reuses the
//        same requireAdmin() gate as api/admin/*.js.
//
// Cost/scale note: one AI call per ACTIVE user per day (inactive users
// cost nothing — skipped before any AI call). Matches lib/adminStore.js's
// own "personal-project scale" caveat — revisit batching if the user base
// grows well past a few hundred.
// ═══════════════════════════════════════════════════════════════════════

const { db } = require('../../lib/firebaseAdmin');
const { requireAdmin } = require('../../lib/adminAuth');
const { getUserCounts } = require('../../lib/adminStore');
const { getHealthSnapshot } = require('../../lib/keyManager');
const { completeText } = require('../../lib/aiComplete');
const {
  saveUserDailySummary,
  saveAdminDigest,
} = require('../../lib/dailySummaryStore');

const DIGEST_SYS_PROMPT =
  'Tu ek AI hai jo user ke poore din ka short digest bana raha hai, uske ' +
  'apne alag-alag chat sessions ke mini-summaries se. 2-4 sentences max, ' +
  'Hinglish mein, second-person mein ("aaj tumne...") — sirf key themes/ ' +
  'topics/decisions, koi filler nahi.';

function dateStrFromDate(d) {
  return d.toISOString().slice(0, 10);
}

/** Resolves the UTC calendar day this cron run should summarize — "yesterday" relative to now, since a run shortly after 00:00 UTC is summarizing the day that just closed. */
function resolveTargetDay(now = new Date()) {
  const target = new Date(now);
  target.setUTCDate(target.getUTCDate() - 1);
  const dateStr = dateStrFromDate(target);
  return {
    dateStr,
    dayStart: new Date(dateStr + 'T00:00:00.000Z'),
    dayEnd: new Date(dateStr + 'T23:59:59.999Z'),
  };
}

/**
 * getSessionsUpdatedInRange — collection-group query across EVERY user's
 * `sessions` subcollection at once (cheaper than looping every user doc
 * and querying each one individually, most of which touched nothing that
 * day). Requires a Firestore collection-group index on `updatedAt` —
 * Firestore will show a console link to create it on first run if it's
 * missing (same as any other composite-query index in this project).
 */
async function getSessionsUpdatedInRange(dayStart, dayEnd) {
  const snap = await db().collectionGroup('sessions')
    .where('updatedAt', '>=', dayStart)
    .where('updatedAt', '<=', dayEnd)
    .get();
  return snap.docs.map(d => {
    const v = d.data();
    return {
      uid: d.ref.parent.parent.id,
      title: v.title || 'Untitled chat',
      summary: v.summary || '',
      msgCount: v.msgCount || 0,
    };
  });
}

/** New (non-anonymous) users created within the target day — mirrors adminStore.getUserCounts()'s bounded-scan approach, just for an arbitrary day instead of "today". */
async function countNewUsersOnDay(dayStart, dayEnd) {
  const snap = await db().collection('users')
    .where('createdAt', '>=', dayStart)
    .where('createdAt', '<=', dayEnd)
    .get()
    .catch(() => null);
  return snap ? snap.size : null;
}

async function summarizeOneUser(uid, sessions, dateStr) {
  const lines = sessions.map(s => `- "${s.title}" (${s.msgCount} messages): ${s.summary || '(no summary)'}`).join('\n');
  const userPrompt = `Aaj ke ${sessions.length} chat sessions:\n${lines}\n\nEk short daily digest bana do.`;

  let digest = await completeText({
    seed: `digest-${uid}-${dateStr}`,
    systemPrompt: DIGEST_SYS_PROMPT,
    userPrompt,
    maxTokens: 220,
  });

  // AI pool fully down — degrade gracefully rather than skip the user
  // entirely (project-wide philosophy: never a hard failure the user/
  // admin sees, just a lower-quality fallback).
  if (!digest) {
    digest = sessions.slice(0, 3).map(s => s.title).join(', ');
  }

  const msgCount = sessions.reduce((sum, s) => sum + (s.msgCount || 0), 0);
  await saveUserDailySummary(uid, dateStr, { digest, sessionCount: sessions.length, msgCount });
}

async function runDailySummary(dateStr, dayStart, dayEnd) {
  const allSessions = await getSessionsUpdatedInRange(dayStart, dayEnd);

  const byUser = new Map();
  for (const s of allSessions) {
    if (!byUser.has(s.uid)) byUser.set(s.uid, []);
    byUser.get(s.uid).push(s);
  }

  let summarized = 0;
  const errors = [];
  for (const [uid, sessions] of byUser) {
    try {
      await summarizeOneUser(uid, sessions, dateStr);
      summarized++;
    } catch (e) {
      console.error('[cron/dailySummary] user failed', uid, e.message);
      errors.push({ uid, error: e.message });
    }
  }

  // ── admin-wide rollup ──
  const [counts, newUsersToday] = await Promise.all([
    getUserCounts(),
    countNewUsersOnDay(dayStart, dayEnd),
  ]);
  const keyHealth = getHealthSnapshot(); // in-memory, this cold start only — see keyManager.js caveat

  const notableEvents = [];
  notableEvents.push(`${byUser.size} users active, ${allSessions.length} sessions touched`);
  if (errors.length) notableEvents.push(`${errors.length} user summaries failed`);
  for (const [provider, info] of Object.entries(keyHealth)) {
    const dead = info.keys.filter(k => k.status === 'cooling_down').length;
    if (dead && dead === info.totalKeys) notableEvents.push(`${provider}: ALL keys cooling down`);
    else if (dead) notableEvents.push(`${provider}: ${dead}/${info.totalKeys} keys cooling down`);
  }

  await saveAdminDigest(dateStr, {
    activeUsers: byUser.size,
    newUsersToday,
    totalUsers: counts.totalUsers,
    keyHealth,
    notableEvents,
  });

  return { dateStr, usersSummarized: summarized, usersFailed: errors.length, sessionsSeen: allSessions.length, errors };
}

module.exports = async function handler(req, res) {
  // ── auth: Vercel Cron (GET + CRON_SECRET) OR manual admin trigger (POST) ──
  if (req.method === 'GET') {
    const auth = req.headers.authorization || '';
    if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  } else if (req.method === 'POST') {
    const { idToken, adminBackupToken } = req.body || {};
    try {
      await requireAdmin({ idToken, adminBackupToken });
    } catch (e) {
      res.status(e.status || 401).json({ error: e.message });
      return;
    }
  } else {
    res.status(405).json({ error: 'GET (cron) or POST (manual admin trigger) only' });
    return;
  }

  try {
    // Manual trigger can optionally override which day to summarize —
    // e.g. { "date": "2026-07-21" } — for backfill/testing. Cron's own GET
    // call never sends a body, so this always falls through to "yesterday".
    const overrideDate = req.method === 'POST' ? req.body?.date : null;
    let dateStr, dayStart, dayEnd;
    if (overrideDate) {
      dateStr = overrideDate;
      dayStart = new Date(dateStr + 'T00:00:00.000Z');
      dayEnd = new Date(dateStr + 'T23:59:59.999Z');
    } else {
      ({ dateStr, dayStart, dayEnd } = resolveTargetDay());
    }

    const result = await runDailySummary(dateStr, dayStart, dayEnd);
    res.status(200).json({ ok: true, ...result });
  } catch (e) {
    console.error('[cron/dailySummary] run failed', e);
    res.status(500).json({ error: e.message || 'Daily summary run fail hua' });
  }
};
