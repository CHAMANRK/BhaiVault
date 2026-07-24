// ═══════════════════════════════════════════════════════════════════════
// lib/instructionStore.js — Firestore CRUD for `/instruction` rules
// (Phase 4: User Instructions, plan Section 4).
//
// Storage shape: users/{uid}/instructions/{instructionId}
//   {
//     text: string,           // the rule itself, e.g. "use shorter replies"
//     createdAt: Timestamp,
//   }
//
// Google (non-anonymous) users ONLY — api/instructions.js enforces this
// (403 for guests), same split as sessions (plan Section 5 / Phase 3).
// This file assumes every uid it's given is allowed to be here.
//
// Scope per plan Section 4: tone/style/protocol preference only — that's
// enforced by the AI confirm-first flow (chat-core.js) BEFORE this store
// is ever written to, not by this file. This file just persists whatever
// text it's given, plus the hard cap.
// ═══════════════════════════════════════════════════════════════════════

const { db, FieldValue } = require('./firebaseAdmin');

const MAX_ACTIVE_INSTRUCTIONS = 10; // plan Section 4: "Max 10 active instructions per user"
const MAX_TEXT_LEN = 300;           // sanity cap — these are short tone/style rules, not essays

function instructionsCol(uid) {
  return db().collection('users').doc(uid).collection('instructions');
}

/**
 * listInstructions(uid) — all active instructions, oldest first (so
 * numbering in the settings-panel list and in the prompt stays stable as
 * new ones get added).
 */
async function listInstructions(uid) {
  const snap = await instructionsCol(uid).orderBy('createdAt', 'asc').get();
  return snap.docs.map(d => {
    const v = d.data();
    return {
      id: d.id,
      text: v.text || '',
      createdAt: v.createdAt?.toMillis?.() || null,
    };
  });
}

/**
 * addInstruction(uid, text) — throws if already at the cap; caller
 * (api/instructions.js) turns that into a 409 the client can show. Cap is
 * re-checked here (not just client-side) since this is the actual source
 * of truth.
 */
async function addInstruction(uid, text) {
  const clean = String(text || '').trim().slice(0, MAX_TEXT_LEN);
  if (!clean) throw new Error('Instruction text required');

  const col = instructionsCol(uid);
  const countSnap = await col.count().get();
  const current = countSnap.data().count;
  if (current >= MAX_ACTIVE_INSTRUCTIONS) {
    const err = new Error(`Max ${MAX_ACTIVE_INSTRUCTIONS} active instructions already hain — pehle koi hata do`);
    err.code = 'LIMIT_REACHED';
    throw err;
  }

  const ref = await col.add({
    text: clean,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { id: ref.id, text: clean };
}

async function deleteInstruction(uid, id) {
  if (!id) throw new Error('id required');
  await instructionsCol(uid).doc(id).delete();
}

/** deleteAllInstructions(uid) — used by a "clear all" action if the settings panel offers one. */
async function deleteAllInstructions(uid) {
  const snap = await instructionsCol(uid).get();
  const batch = db().batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
  return snap.size;
}

module.exports = {
  listInstructions,
  addInstruction,
  deleteInstruction,
  deleteAllInstructions,
  MAX_ACTIVE_INSTRUCTIONS,
};
