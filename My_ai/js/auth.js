// ═══════════════════════════════════════════════════════════════════════
// auth.js — app lock: PIN pad, PIN hashing, lock/unlock screen, WebAuthn
// fingerprint.
// ═══════════════════════════════════════════════════════════════════════

let pinBuffer = '';

let pinMode = 'unlock'; // 'unlock' | 'set' | 'confirm-disable'

let firstPinEntry = '';


async function hashPin(pin) {
  const enc = new TextEncoder().encode('chamanai_salt_' + pin);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}


function renderPinDots(errState) {
  const wrap = document.getElementById('pin-dots');
  const len = cfg.lockPinLen || 6;
  wrap.innerHTML = '';
  for (let i = 0; i < len; i++) {
    const d = document.createElement('div');
    d.className = 'pin-dot' + (i < pinBuffer.length ? ' filled' : '') + (errState ? ' err' : '');
    wrap.appendChild(d);
  }
}


function showLockScreen() {
  pinBuffer = '';
  document.getElementById('lock-title').textContent = 'Chaman AI';
  document.getElementById('lock-sub').textContent = 'PIN dalo unlock karne ke liye';
  renderPinDots(false);
  document.getElementById('lock-screen').classList.remove('hidden');
  const fpBtn = document.getElementById('fp-unlock-btn');
  const fpStatus = document.getElementById('fp-status');
  if (cfg.lockWebauthnEnabled && cfg.lockWebauthnId) {
    fpBtn.classList.remove('hidden');
    fpStatus.classList.remove('hidden');
    fpStatus.textContent = 'Fingerprint se unlock karo';
    setTimeout(() => tryFingerprintUnlock(), 350);
  } else {
    fpBtn.classList.add('hidden');
    fpStatus.classList.add('hidden');
  }
}

function hideLockScreen() {
  document.getElementById('lock-screen').classList.add('hidden');
}

function lockNow() {
  if (!cfg.lockEnabled || !cfg.lockPinHash) { toast('Pehle Settings mein PIN set karo'); return; }
  showLockScreen();
}


async function onPinKey(k) {
  if (k === 'back') {
    pinBuffer = pinBuffer.slice(0, -1);
    renderPinDots(false);
    return;
  }
  if (pinBuffer.length >= (cfg.lockPinLen || 6)) return;
  pinBuffer += k;
  renderPinDots(false);
  if (pinBuffer.length === (cfg.lockPinLen || 6)) {
    const h = await hashPin(pinBuffer);
    if (h === cfg.lockPinHash) {
      hideLockScreen();
    } else {
      renderPinDots(true);
      document.getElementById('lock-card').classList.add('shake');
      document.getElementById('lock-sub').textContent = 'Galat PIN, dobara try karo';
      setTimeout(() => {
        document.getElementById('lock-card').classList.remove('shake');
        pinBuffer = '';
        renderPinDots(false);
      }, 420);
    }
  }
}


async function setNewPin() {
  const p1 = document.getElementById('new-pin-inp').value.trim();
  const p2 = document.getElementById('confirm-pin-inp').value.trim();
  if (!/^\d{4,6}$/.test(p1)) { toast('PIN 4-6 digit ka number hona chahiye'); return; }
  if (p1 !== p2) { toast('Dono PIN match nahi kar rahe'); return; }
  cfg.lockPinHash = await hashPin(p1);
  cfg.lockPinLen = p1.length;
  cfg.lockEnabled = true;
  LS.set('chaman_cfg', cfg);
  document.getElementById('new-pin-inp').value = '';
  document.getElementById('confirm-pin-inp').value = '';
  document.getElementById('lock-enable-inp').checked = true;
  updateLockUI();
  toast('🔒 PIN set ho gaya!');
}

function updateLockUI() {
  const hint = document.getElementById('lock-status-hint');
  const lockBtn = document.getElementById('lock-now-btn');
  if (cfg.lockEnabled && cfg.lockPinHash) {
    hint.textContent = `Lock ON hai (${cfg.lockPinLen}-digit PIN). Naya PIN daalke update kar sakte ho.`;
    lockBtn.style.display = 'flex';
  } else {
    hint.textContent = 'Lock abhi off hai';
    lockBtn.style.display = 'none';
  }
  const fpHint = document.getElementById('fp-status-hint');
  const fpBtn = document.getElementById('fp-enable-btn');
  if (cfg.lockWebauthnEnabled && cfg.lockWebauthnId) {
    fpHint.textContent = '👆 Fingerprint ON hai';
    fpBtn.textContent = '🗑️ Fingerprint Hatao';
  } else {
    fpHint.textContent = cfg.lockEnabled ? 'PIN ke saath fingerprint bhi jod sakte ho' : 'Pehle PIN set karo, fir fingerprint jod sakte ho';
    fpBtn.textContent = '👆 Fingerprint Enable karo';
  }
}

// ── WebAuthn (device fingerprint / Windows Hello) ──

const WA_RP_ID = location.hostname;

function randBytes(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; }

function b64url(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

function b64urlToBuf(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

async function waSupported() {
  return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
}


async function toggleFingerprint() {
  if (cfg.lockWebauthnEnabled && cfg.lockWebauthnId) {
    cfg.lockWebauthnEnabled = false;
    cfg.lockWebauthnId = '';
    LS.set('chaman_cfg', cfg);
    updateLockUI();
    toast('Fingerprint hata diya');
    return;
  }
  if (!cfg.lockEnabled || !cfg.lockPinHash) { toast('Pehle PIN set karo'); return; }
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
    toast('Fingerprint sirf HTTPS pe kaam karega'); return;
  }
  if (!(await waSupported())) { toast('Is device/browser mein fingerprint support nahi hai'); return; }
  try {
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: randBytes(32),
        rp: { name: 'Chaman AI', id: WA_RP_ID },
        user: { id: randBytes(16), name: 'chaman', displayName: 'Chaman' },
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
        timeout: 60000
      }
    });
    cfg.lockWebauthnId = b64url(cred.rawId);
    cfg.lockWebauthnEnabled = true;
    LS.set('chaman_cfg', cfg);
    updateLockUI();
    toast('👆 Fingerprint enable ho gaya!');
  } catch (e) {
    toast('Fingerprint set nahi ho paya');
  }
}


async function tryFingerprintUnlock() {
  if (!cfg.lockWebauthnEnabled || !cfg.lockWebauthnId) return false;
  document.getElementById('fp-status').textContent = 'Fingerprint scan ho raha hai...';
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randBytes(32),
        allowCredentials: [{ id: b64urlToBuf(cfg.lockWebauthnId), type: 'public-key' }],
        userVerification: 'required',
        timeout: 60000
      }
    });
    if (assertion) { hideLockScreen(); return true; }
  } catch (e) {
    document.getElementById('fp-status').textContent = 'Fingerprint fail, PIN daalo';
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════
// PHASE 2 — ACCOUNT AUTH (Google login + Guest/anonymous login)
//
// This is a SEPARATE layer from the PIN lock above — PIN lock is an
// optional "keep my chats private on THIS device" feature; this section
// is "who is this account" (needed so /api/chat knows whose key-pool
// rotation seed + guest message-cap to use — see lib/keyManager.js +
// lib/userStore.js). Both can be active at once.
//
// currentUser (below) mirrors firebase.auth().currentUser — kept as a
// plain variable so other files (chat-core.js, providers.js) don't need
// to touch the Firebase SDK directly, just read `currentUser` /
// `isGuestUser()` / call `getAuthToken()`.
// ═══════════════════════════════════════════════════════════════════════

let currentUser = null;      // firebase.User object, or null before auth resolves
let authReadyPromise = null; // resolves once the FIRST auth state is known (login-screen gate waits on this)

function isGuestUser() {
  return !!(currentUser && currentUser.isAnonymous);
}

/**
 * getAuthToken() — fresh Firebase ID token for the CURRENT user, sent as
 * `idToken` in every /api/chat request (see providers.js). Firebase SDK
 * auto-refreshes this under the hood; getIdToken() without `true` reuses
 * the cached token until it's near expiry, so this is cheap to call every
 * message.
 */
async function getAuthToken() {
  if (!currentUser) return null;
  try {
    return await currentUser.getIdToken();
  } catch (e) {
    return null;
  }
}

function initAuthListener() {
  if (authReadyPromise) return authReadyPromise;
  authReadyPromise = new Promise((resolve) => {
    let firstResolve = true;
    fbAuth.onAuthStateChanged((user) => {
      currentUser = user;
      if (user) {
        hideLoginScreen();
        maybeShowGuestNudge();
      } else {
        showLoginScreen();
      }
      if (firstResolve) { firstResolve = false; resolve(user); }
    });
  });
  return authReadyPromise;
}

// ═══════════════════════════════════════════════════════════════════════
// PHASE 8 — GUEST NUDGE SCREEN (plan Section 5: "an extra screen
// encouraging Google login — soft message... shown to guests only").
// Dismissible, never blocks anything, shown at most once per calendar day
// so it never feels naggy. The login screen itself already states the
// guest limits once up front (see #login-screen hint in index.html) — this
// is just a gentle re-reminder for guests who stick around across days.
// ═══════════════════════════════════════════════════════════════════════

const GUEST_NUDGE_DELAY_MS = 1500; // small delay so it doesn't fight the app's own load/transition animation

function maybeShowGuestNudge() {
  if (!isGuestUser()) return;
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD — local "once per day" is good enough here, no need for server time
  if (cfg.guestNudgeLastShown === today) return;
  setTimeout(() => {
    const modal = document.getElementById('guest-nudge-modal');
    if (!modal || !isGuestUser()) return; // re-check — user may have logged into Google during the delay
    modal.classList.remove('hidden');
    cfg.guestNudgeLastShown = today;
    LS.set('chaman_cfg', cfg);
  }, GUEST_NUDGE_DELAY_MS);
}

function showLoginScreen() {
  const el = document.getElementById('login-screen');
  if (el) el.classList.remove('hidden');
}

function hideLoginScreen() {
  const el = document.getElementById('login-screen');
  if (el) el.classList.add('hidden');
  // Login → next-screen (onboarding/lock/app) transition is done.
  hidePageLoader();
}

async function signInWithGoogle() {
  const btn = document.getElementById('login-google-btn');
  if (btn) btn.disabled = true;
  showPageLoader(); // hidden by hideLoginScreen() on success, or below on failure
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    await fbAuth.signInWithPopup(provider);
    // onAuthStateChanged above handles hiding the login screen + setting currentUser
  } catch (e) {
    hidePageLoader();
    toast('Google login fail ho gaya — dobara try karo');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function signInAsGuest() {
  const btn = document.getElementById('login-guest-btn');
  if (btn) btn.disabled = true;
  showPageLoader(); // hidden by hideLoginScreen() on success, or below on failure
  try {
    await fbAuth.signInAnonymously();
  } catch (e) {
    hidePageLoader();
    toast('Guest login fail ho gaya — dobara try karo');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function signOutUser() {
  try {
    await fbAuth.signOut();
    // Guest data is device-local only (per plan) — signing out of a guest
    // session doesn't delete cfg/localStorage, just returns to the login
    // screen so a fresh sign-in (guest or Google) can happen.
    toast('Logout ho gaya');
  } catch (e) {
    toast('Logout fail ho gaya');
  }
}
