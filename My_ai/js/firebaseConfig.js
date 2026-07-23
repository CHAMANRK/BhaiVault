// ═══════════════════════════════════════════════════════════════════════
// js/firebaseConfig.js — Firebase CLIENT init.
//
// ⚠️ Ye values PUBLIC hain by design — Firebase client SDK config koi
// secret nahi hota (isse security nahi milti). Real security do jagah se
// aati hai: (1) Firestore Security Rules (users apna data hi padh/likh
// sakein), (2) server-side ID-token verification (lib/firebaseAdmin.js —
// wahan REAL secret, service-account private key, hoti hai — kabhi client
// ko mat bhejo).
//
// Firebase Console → Project Settings → General → "Your apps" → Web app →
// SDK setup and configuration → yahan se ye 6 values copy karo.
// ═══════════════════════════════════════════════════════════════════════

const firebaseConfig = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME.firebaseapp.com",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME.appspot.com",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME",
};

firebase.initializeApp(firebaseConfig);

const fbAuth = firebase.auth();
const fbDb = firebase.firestore();
