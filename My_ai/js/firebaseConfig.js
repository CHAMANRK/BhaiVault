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
  apiKey: "AIzaSyDhezT9tpm0FEGfWX9ktvYoEJ9sABtsycw",
  authDomain: "chaman-ai.firebaseapp.com",
  projectId: "chaman-ai",
  storageBucket: "chaman-ai.firebasestorage.app",
  messagingSenderId: "60719361681",
  appId: "1:60719361681:web:60163f41bcfb5a11961930",
};

firebase.initializeApp(firebaseConfig);

const fbAuth = firebase.auth();
const fbDb = firebase.firestore();
