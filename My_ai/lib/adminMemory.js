// ═══════════════════════════════════════════════════════════════════════
// lib/adminMemory.js — Phase 5 (plan Section 7): "Personal-assistant layer
// for Najeef's own project context (SeekhCode, Raza Art, etc) — recall via
// creator memory doc in Firestore."
//
// Storage shape: ONE doc, creatorMemory/najeef —
//   { notes: [{ id, text, createdAt }, ...] }
//
// Single doc (not a per-uid subcollection like sessions/instructions)
// because this is Najeef's OWN standing context, not tied to any one
// Firebase account/session — same note should show up whether he's on the
// primary admin login or a backup-code emergency session.
//
// This is DIFFERENT from [MERI IMPORTANT DETAILS] (permMemory, per-device
// localStorage) — that's the NORMAL end-user's own facts about themselves.
// This is the CREATOR's own project/personal notes, server-side, synced
// everywhere, only ever injected into the prompt when isCreatorActive.
// ═══════════════════════════════════════════════════════════════════════

const { db } = require('./firebaseAdmin');

const MAX_NOTES = 100; // generous cap — personal running notes, not per-user instructions
const MAX_TEXT_LEN = 500;
const DOC_REF = () => db().collection('creatorMemory').doc('najeef');

async function listCreatorMemory() {
  const snap = await DOC_REF().get();
  if (!snap.exists) return [];
  const notes = snap.data().notes || [];
  return notes.map(n => ({ id: n.id, text: n.text, createdAt: n.createdAt || null }));
}

async function addCreatorMemory(text) {
  const clean = String(text || '').trim().slice(0, MAX_TEXT_LEN);
  if (!clean) throw new Error('note text required');

  const ref = DOC_REF();
  const snap = await ref.get();
  const notes = snap.exists ? (snap.data().notes || []) : [];
  if (notes.length >= MAX_NOTES) {
    const err = new Error(`Max ${MAX_NOTES} notes already hain — pehle kuch purani hata do`);
    err.code = 'LIMIT_REACHED';
    throw err;
  }
  const note = { id: 'n_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: clean, createdAt: Date.now() };
  await ref.set({ notes: [...notes, note] }, { merge: true });
  return note;
}

async function deleteCreatorMemory(id) {
  if (!id) throw new Error('id required');
  const ref = DOC_REF();
  const snap = await ref.get();
  if (!snap.exists) return;
  const notes = (snap.data().notes || []).filter(n => n.id !== id);
  await ref.set({ notes }, { merge: true });
}

module.exports = { listCreatorMemory, addCreatorMemory, deleteCreatorMemory, MAX_NOTES };
