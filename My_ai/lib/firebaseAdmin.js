// ═══════════════════════════════════════════════════════════════════════
// lib/firebaseAdmin.js — server-side Firebase Admin SDK init (modular API
// — firebase-admin v14+; older `admin.apps`/`admin.auth()`/`admin.firestore()`
// namespaced style is deprecated/broken on current versions, don't copy
// that pattern from older tutorials).
//
// PREFERRED: one Vercel env var —
//   FIREBASE_SERVICE_ACCOUNT_BASE64
// — the WHOLE service-account JSON file (Firebase Console → Project
// Settings → Service Accounts → Generate new private key), base64-encoded
// as a single line. This sidesteps the classic Vercel private-key-newline
// corruption ("Failed to parse private key ... DECODER routines::unsupported")
// entirely, since nothing about a base64 string can get mangled by
// copy-paste/quoting the way a multi-line PEM key does.
//   To generate it: base64 -w0 serviceAccountKey.json   (Linux/Termux)
//                    (macOS: base64 -i serviceAccountKey.json | tr -d '\n')
//
// FALLBACK (legacy, kept for compat): 3 separate env vars —
//   FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY
// — fragile because FIREBASE_PRIVATE_KEY's embedded newlines/quotes are
// easy to corrupt when pasting into Vercel's dashboard.
//
// This file NEVER runs in the browser — only inside api/*.js.
// ═══════════════════════════════════════════════════════════════════════

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

let app;
if (!getApps().length) {
  let credentialInput = null;

  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    try {
      const json = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8');
      const sa = JSON.parse(json);
      credentialInput = { projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key };
    } catch (e) {
      console.warn('[firebaseAdmin] FIREBASE_SERVICE_ACCOUNT_BASE64 present but failed to decode/parse:', e.message);
    }
  }

  if (!credentialInput) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    if (projectId && clientEmail && privateKey) {
      credentialInput = { projectId, clientEmail, privateKey };
    }
  }

  if (credentialInput) {
    app = initializeApp({ credential: cert(credentialInput) });
  } else {
    // Env vars missing (e.g. local dev without them set) — don't crash the
    // whole function import, just log. Everything below fails gracefully
    // (verifyIdToken returns null, db() throws only when actually called).
    console.warn('[firebaseAdmin] No valid Firebase credentials found (checked FIREBASE_SERVICE_ACCOUNT_BASE64 and FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY) — auth calls will fail until set in Vercel.');
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
