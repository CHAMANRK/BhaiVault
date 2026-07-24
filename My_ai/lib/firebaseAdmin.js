// ═══════════════════════════════════════════════════════════════════════
// lib/firebaseAdmin.js — server-side Firebase Admin SDK init (modular API
// — firebase-admin v14+; older `admin.apps`/`admin.auth()`/`admin.firestore()`
// namespaced style is deprecated/broken on current versions, don't copy
// that pattern from older tutorials).
//
// Requires 3 Vercel env vars (from a Firebase service-account JSON —
// Firebase Console → Project Settings → Service Accounts → Generate new
// private key):
//   FIREBASE_PROJECT_ID
//   FIREBASE_CLIENT_EMAIL
//   FIREBASE_PRIVATE_KEY   (paste the WHOLE key including
//                            -----BEGIN PRIVATE KEY----- lines; Vercel env
//                            vars can't hold literal newlines well, so
//                            paste it with \n escapes — we un-escape below)
//
// This file NEVER runs in the browser — only inside api/*.js.
// ═══════════════════════════════════════════════════════════════════════

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

let app;
if (!getApps().length) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (projectId && clientEmail && privateKey) {
    app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  } else {
    // Env vars missing (e.g. local dev without them set) — don't crash the
    // whole function import, just log. Everything below fails gracefully
    // (verifyIdToken returns null, db() throws only when actually called).
    console.warn('[firebaseAdmin] FIREBASE_* env vars missing — auth calls will fail until set in Vercel.');
  }
} else {
  app = getApps()[0];
}

/**
 * verifyIdToken(idToken) — verifies a Firebase ID token sent from the
 * client. Returns the decoded token (has .uid, .firebase.sign_in_provider
 * — 'anonymous' for guests, 'google.com' for Google login) or null if
 * invalid/expired/missing/not-configured.
 */
async function verifyIdToken(idToken) {
  if (!idToken || !app) return null;
  try {
    return await getAuth(app).verifyIdToken(idToken);
  } catch (e) {
    console.warn('[firebaseAdmin] verifyIdToken failed:', e.message);
    return null;
  }
}

function db() {
  if (!app) throw new Error('Firebase Admin not initialized — check FIREBASE_* env vars');
  return getFirestore(app);
}

module.exports = { verifyIdToken, db, FieldValue };
