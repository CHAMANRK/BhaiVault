// ╔══════════════════════════════════════════════════════╗
// ║  BhaiChara — app.js (ULTIMATE & FIXED)               ║
// ╚══════════════════════════════════════════════════════╝

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, set, get, push, onValue, off, update, serverTimestamp, onDisconnect } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getAuth, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, onAuthStateChanged, signOut, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ── Firebase Config ──────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyDPQPZjqnt-DWRmPFRXQV8n6rnhj8G6BNs",
  authDomain:        "bhaichara-87ceb.firebaseapp.com",
  projectId:         "bhaichara-87ceb",
  storageBucket:     "bhaichara-87ceb.firebasestorage.app",
  messagingSenderId: "293036528556",
  appId:             "1:293036528556:web:f5471c4fc1c63752ea2009",
  databaseURL:       "https://bhaichara-87ceb-default-rtdb.asia-southeast1.firebasedatabase.app/"
};

const fbApp  = initializeApp(firebaseConfig);
const auth   = getAuth(fbApp);
const db     = getDatabase(fbApp);

// ── App State ────────────────────────────────────────────
let currentUser         = null;
let currentChat         = null;
let groupPendingMembers = [];
let selectedEmoji       = "😎";
let activeTab           = "chats";
let typingTimer         = null;
let chatListeners       = {};
let presenceRef         = null;
let previousChatsState  = {}; // 🔔 Notifications track karne ke liye
let isAnonymousMode = false; // 🎭 Secret mode track karne ke liye
let destructTimer = 0;       // ⏳ Self-destruct delay in ms (0 = off)

// 🎙️ Voice recording state
let mediaRecorder    = null;
let audioChunks      = [];
let voiceRecTimer    = null;
let voiceRecSeconds  = 0;
let isRecording      = false;
let voiceCancelled   = false;


// ── EMOJI LIST ───────────────────────────────────────────
const EMOJIS = ["😎","🤙","🔥","💪","🤘","😂","🥳","👊","🙏","❤️","💯","👍","😊","🤣","😅","🫡","🤝","🎉","⚡","💀","🐐","🦁","🌟","🎯","🚀","👑","🤑","😤","😏","🫠","🧠","🤟","✌️","👻","🐺","🦊","🎮","💎","🍕","🌙"];
const KEYBOARD_EMOJIS = ["😀","😂","🥰","😎","🤙","🔥","💪","👍","❤️","💯","🎉","✅","🙏","👏","🤝","😅","🤣","😊","🫡","🤘","💀","🐐","⚡","🌟","🎯","🚀","👑","😤","😏","🫠","🧠","🤟","✌️","🎮","💎","🍕","🌙","🥳","🏆","😴","🤔","🤯","😭","😡","🥹","🫶","💜","🧡","💛","💚","💙","🤍","🖤","🤎"];

// ─────────────────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", async () => {
  populateEmojiGrid("emoji-grid", EMOJIS, (e) => {
    selectedEmoji = e;
    document.getElementById("avatar-initials").textContent = e;
    document.getElementById("emoji-picker").classList.add("hidden");
  });
  populateEmojiGrid("emoji-keyboard", KEYBOARD_EMOJIS, insertEmoji);

  // 🚨 RELOAD POPUP LOOP FIX 🚨
  if (isSignInWithEmailLink(auth, window.location.href)) {
    let email = localStorage.getItem("emailForSignIn");
    if (!email) email = window.prompt("Confirm karo — kaun sa email use kiya tha?");
    
    if (email) {
      try {
        await signInWithEmailLink(auth, email, window.location.href);
        localStorage.removeItem("emailForSignIn");
        showToast("Login ho gaya! 🎉");
      } catch (e) {
        showToast("Link invalid ya use ho chuka hai 😕");
      }
    }
    // Ye line URL ko turant clean kar degi, taaki reload karne par prompt wapas na aaye!
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  // ✅ BLANK SCREEN FIX — Splash ko auth ke saath sync karo
  // Splash tabhi hatega jab auth resolve ho, chahe 2400ms pehle ho ya baad mein
  let authResolved = false;
  const hideSplash = () => {
    const splash = document.getElementById("splash");
    if (splash) splash.style.display = "none";
  };

  // Minimum 2400ms splash dikhaao (branding ke liye), but auth ka wait karo
  setTimeout(() => {
    if (authResolved) hideSplash(); // Auth pehle resolve ho chuka — ab safe hai hatana
    // Agar auth abhi resolve nahi hua to onAuthStateChanged khud hatayega
  }, 2400);

  onAuthStateChanged(auth, async (user) => {
    authResolved = true;
    hideSplash(); // Auth resolve hote hi splash hatao (2400ms se pehle ya baad, koi fark nahi)
    if (user) {
      // Anon map check — phone login se aaya tha?
      const anonMapSnap = await get(ref(db, `anon_map/${user.uid}`));
      const realUid = anonMapSnap.exists() ? anonMapSnap.val() : user.uid;

      const snap = await get(ref(db, `users/${realUid}`));
      if (snap.exists()) {
        currentUser = { uid: realUid, ...snap.val() };
        showApp();
      } else {
        currentUser = { uid: realUid, email: user.email || "" };
        showScreen("profile");
      }
    } else {
      currentUser = null;
      showScreen("login-choice");
    }
  });
});


function showScreen(name) {
  document.getElementById("login-choice-screen").classList.toggle("hidden", name !== "login-choice");
  document.getElementById("auth-screen").classList.toggle("hidden", name !== "auth" && name !== "profile");
  document.getElementById("app-screen").classList.toggle("hidden", name !== "app");

  if (name === "profile") {
    document.getElementById("auth-screen").classList.remove("hidden");
    document.getElementById("profile-step").classList.remove("hidden");
    document.getElementById("email-step").classList.add("hidden");
    document.getElementById("waiting-step").classList.add("hidden");
    document.getElementById("phone-otp-step").classList.add("hidden");
    document.getElementById("otp-verify-step").classList.add("hidden");
  }
  if (name === "auth") {
    // auth-screen pe aao, pehle steps sab hide karo
    document.getElementById("email-step").classList.remove("hidden");
    document.getElementById("waiting-step").classList.add("hidden");
    document.getElementById("profile-step").classList.add("hidden");
    document.getElementById("phone-otp-step").classList.add("hidden");
    document.getElementById("otp-verify-step").classList.add("hidden");
  }
  if (name === "auth-phone") {
    // seedha phone OTP screen
    document.getElementById("auth-screen").classList.remove("hidden");
    document.getElementById("login-choice-screen").classList.add("hidden");
    document.getElementById("phone-otp-step").classList.remove("hidden");
    document.getElementById("email-step").classList.add("hidden");
    document.getElementById("waiting-step").classList.add("hidden");
    document.getElementById("profile-step").classList.add("hidden");
    document.getElementById("otp-verify-step").classList.add("hidden");
  }
}

// Login choice screen handlers
window.chooseMagicLink = function() {
  showScreen("auth"); // email-step dikhaayega
};

window.choosePhoneOtp = function() {
  showScreen("auth-phone"); // seedha phone OTP
};

function showApp() {
  showScreen("app");
  updateSidebarAvatar();
  setupPresence();
  loadChatList();
  askNotificationPermission(); // 🔔 Notification permission maango
}

// ─────────────────────────────────────────────────────────
//  AUTH & PROFILE
// ─────────────────────────────────────────────────────────
window.sendMagicLink = async function() {
  const email = document.getElementById("email-input").value.trim();
  if (!email || !email.includes("@")) { showToast("Sahi email dalo bhai"); return; }
  const btn = document.getElementById("send-link-btn");
  btn.disabled = true; btn.innerHTML = '<div class="spinner"></div>';
  try {
    await sendSignInLinkToEmail(auth, email, { url: window.location.href, handleCodeInApp: true });
    localStorage.setItem("emailForSignIn", email);
    document.getElementById("email-step").classList.add("hidden");
    document.getElementById("waiting-step").classList.remove("hidden");
    showToast("Magic link bhej diya! Email check karo ✅");
  } catch (e) {
    btn.disabled = false;
    btn.innerHTML = '<span>Magic Link Bhejo</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';

    // 🔄 Quota exceed ya koi bhi error? Options dikhao
    const errCode = e.code || "";
    const errMsg  = (e.message || "").toLowerCase();
    const isQuota = errCode === "auth/quota-exceeded"
                 || errCode === "auth/too-many-requests"
                 || errMsg.includes("quota")
                 || errMsg.includes("too many")
                 || errMsg.includes("exceeded")
                 || e.status === 400;
    if (isQuota) {
      showToast("Arey yaar, magic link ka quota khatam ho gaya 😅 Phone se try karo!");
      localStorage.setItem("pendingLoginEmail", email);
      // Choice screen pe wapas bhejo
      showScreen("login-choice");
    } else {
      showToast("Kuch gadbad ho gayi bhai: " + (e.message || e.code));
      showScreen("login-choice");
    }
  }
};

// ─────────────────────────────────────────────────────────
//  📱 PHONE OTP FALLBACK LOGIN (Quota exceed hone pe)
// ─────────────────────────────────────────────────────────
const FIXED_OTP = "409085";

window.sendPhoneOtp = async function() {
  const phone = document.getElementById("otp-phone-input").value.trim();
  const email = document.getElementById("otp-email-input").value.trim().toLowerCase();

  if (!phone || phone.length !== 10 || !/^\d+$/.test(phone)) {
    showToast("10 digit ka sahi phone number dalo bhai!"); return;
  }
  if (!email || !email.includes("@")) {
    showToast("Sahi email bhi dalo bhai!"); return;
  }

  const btn = document.querySelector("#phone-otp-step .btn-primary");
  btn.disabled = true; btn.innerHTML = '<div class="spinner"></div>';

  try {
    // Step 1: Phone se uid dhundo
    const uidSnap = await get(ref(db, `phone_index/${phone}`));

    if (!uidSnap.exists()) {
      // Naya user — seedha OTP pe jaao, account baad mein banega
      localStorage.setItem("otpPhone", phone);
      localStorage.setItem("otpEmail", email);
      localStorage.setItem("otpIsNewUser", "true");
      showOtpVerifyScreen(phone);
    } else {
      // Purana user — email bhi match karo
      const uid = uidSnap.val();
      const userSnap = await get(ref(db, `users/${uid}`));
      const userData = userSnap.val() || {};
      const storedEmail = (userData.email || "").toLowerCase();

      if (storedEmail !== email) {
        // Match nahi hua — user se puchho kya karna chahte hain
        showToast("Yaar, ye number kisi aur ke account se linked hai 🤔");
        btn.disabled = false;
        btn.innerHTML = '<span>OTP Bhejo</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
        // Options dikhao
        localStorage.setItem("otpPhone", phone);
        localStorage.setItem("otpEmail", email);
        document.getElementById("mismatch-options").classList.remove("hidden");
        return;
      }

      // Match! OTP screen dikhao
      localStorage.setItem("otpPhone", phone);
      localStorage.setItem("otpEmail", email);
      localStorage.setItem("otpIsNewUser", "false");
      localStorage.setItem("otpUid", uid);
      showOtpVerifyScreen(phone);
    }
  } catch(err) {
    showToast("Error: " + err.message);
    btn.disabled = false;
    btn.innerHTML = '<span>OTP Bhejo</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
  }
};

function showOtpVerifyScreen(phone) {
  document.getElementById("phone-otp-step").classList.add("hidden");
  document.getElementById("otp-verify-step").classList.remove("hidden");
  document.getElementById("otp-phone-display").textContent = "+91 " + phone;
  showToast("OTP bhej diya! 📱 (Testing: 409085)");
}

window.verifyPhoneOtp = async function() {
  const enteredOtp = document.getElementById("otp-input").value.trim();
  const phone      = localStorage.getItem("otpPhone");

  if (!phone) { showToast("Phone number nahi mila, wapas jao"); return; }
  if (enteredOtp !== FIXED_OTP) {
    showToast("Galat OTP bhai! Dobara try karo 🙅");
    document.getElementById("otp-input").value = "";
    document.getElementById("otp-input").classList.add("shake");
    setTimeout(() => document.getElementById("otp-input").classList.remove("shake"), 500);
    return;
  }

  const btn = document.getElementById("verify-otp-btn");
  btn.disabled = true; btn.innerHTML = '<div class="spinner"></div>';

  try {
    // Phone_index se uid dhundo
    const uidSnap = await get(ref(db, `phone_index/${phone}`));

    if (uidSnap.exists()) {
      // === Purana user — anonymous login karke uska data load karo ===
      const existingUid = uidSnap.val();
      const anonCred = await signInAnonymously(auth);
      // Anonymous UID alag hoga, isliye currentUser ko manually set karte hain
      const userSnap = await get(ref(db, `users/${existingUid}`));
      if (userSnap.exists()) {
        currentUser = { uid: existingUid, ...userSnap.val() };
        // Anonymous auth uid ko map karo taaki onAuthStateChanged kaam kare
        await set(ref(db, `anon_map/${anonCred.user.uid}`), existingUid);
        localStorage.removeItem("otpPhone");
        localStorage.removeItem("pendingLoginEmail");
        showToast("Wapas aa gaya bhai! 🔥");
        showApp();
      }
    } else {
      // === Naya user — pehle profile banao ===
      const anonCred = await signInAnonymously(auth);
      const pendingEmail = localStorage.getItem("pendingLoginEmail") || "";
      currentUser = { uid: phone, email: pendingEmail, phone: "+91" + phone, _anonUid: anonCred.user.uid };
      await set(ref(db, `anon_map/${anonCred.user.uid}`), phone);
      localStorage.removeItem("otpPhone");
      showToast("OTP sahi hai! 🎉 Pehle profile banao");
      showScreen("profile");
    }
  } catch(err) {
    btn.disabled = false;
    btn.innerHTML = '<span>OTP Verify Karo ✓</span>';
    showToast("Error: " + err.message);
  }
};

window.backToPhoneStep = function() {
  document.getElementById("otp-verify-step").classList.add("hidden");
  document.getElementById("phone-otp-step").classList.remove("hidden");
  document.getElementById("otp-input").value = "";
};

window.backToEmailFromPhone = function() {
  document.getElementById("phone-otp-step").classList.add("hidden");
  showScreen("login-choice");
};

// Quota exceed ke baad phone pe switch
window.switchToPhoneLogin = function() {
  const email = localStorage.getItem("pendingLoginEmail") || "";
  showScreen("auth-phone");
  if (email) {
    const emailField = document.getElementById("otp-email-input");
    if (emailField) emailField.value = email;
  }
};

// Mismatch ke baad naya account banana chahta hai
window.proceedAsNewUser = function() {
  const phone = localStorage.getItem("otpPhone");
  document.getElementById("mismatch-options").classList.add("hidden");
  localStorage.setItem("otpIsNewUser", "true");
  showOtpVerifyScreen(phone);
};

// Mismatch ke baad details change karna chahta hai
window.retryPhoneEmail = function() {
  document.getElementById("mismatch-options").classList.add("hidden");
  document.getElementById("otp-phone-input").value = "";
  document.getElementById("otp-email-input").value = "";
  document.getElementById("otp-phone-input").focus();
};


window.backToEmail = function() {
  document.getElementById("waiting-step").classList.add("hidden");
  document.getElementById("email-step").classList.remove("hidden");
  document.getElementById("email-input").value = "";
};

window.pickAvatar = function() { document.getElementById("emoji-picker").classList.toggle("hidden"); };

window.saveProfile = async function() {
  const name = document.getElementById("name-input").value.trim();
  const phone = document.getElementById("phone-number-input").value.trim();
  const status = document.getElementById("status-input").value.trim() || "Hey, BhaiChara pe hoon!";
  if (!name)  { showToast("Naam toh daal yaar"); return; }
  if (!phone || phone.length !== 10 || !/^\d+$/.test(phone)) { showToast("10 digit ka phone number daal"); return; }

  const profile = { name, status, avatar: selectedEmoji, phone: "+91" + phone, email: currentUser.email || auth.currentUser?.email || "", createdAt: Date.now() };
  await set(ref(db, `users/${currentUser.uid}`), profile);
  await set(ref(db, `phone_index/${phone}`), currentUser.uid);

  currentUser = { ...currentUser, ...profile };
  showToast("Profile set ho gaya! 🔥");
  showApp();
};

function setupPresence() {
  const uid = currentUser.uid;
  presenceRef = ref(db, `users/${uid}/online`);
  const lastRef = ref(db, `users/${uid}/lastSeen`);
  set(presenceRef, true);
  set(lastRef, serverTimestamp());
  onDisconnect(presenceRef).set(false);
  onDisconnect(lastRef).set(serverTimestamp());
}

// ─────────────────────────────────────────────────────────
//  BHAI NOTIFICATIONS (SOUND + PUSH)
// ─────────────────────────────────────────────────────────
window.askNotificationPermission = function() {
  if (!("Notification" in window)) {
    showToast("Tera browser notifications support nahi karta bhai! 😢");
    return;
  }
  
  if (Notification.permission === "granted") {
    showToast("Notifications pehle se ON hain bhai! 🔔");
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then(permission => {
      if (permission === "granted") {
        showToast("Bhai notifications ON ho gaye! 🚀");
      } else {
        showToast("Tune notifications allow nahi kiye! 🚫");
      }
    });
  } else {
    showToast("Notifications blocked hain. Browser ki site settings check kar! 🔒");
  }
};

window.triggerBhaiNotification = function(title, body) {
  try { // 🎵 Futuristic Sound
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
    osc.start(); osc.stop(ctx.currentTime + 0.1);
  } catch (e) {
    console.log("Sound bajne me issue: ", e);
  }

  if ("Notification" in window && Notification.permission === "granted") {
    const emojis = ["🤙", "🔥", "😎", "💪", "⚡", "🚀", "🎯"];
    const randEmoji = emojis[Math.floor(Math.random() * emojis.length)];
    new Notification(`${randEmoji} ${title} bola:`, { body: body, vibrate: [200, 100, 200] });
  }
};


// ─────────────────────────────────────────────────────────
//  CHAT LIST
// ─────────────────────────────────────────────────────────
function loadChatList() {
  const uid = currentUser.uid;
  // Purana listener hata do pehle
  if (chatListeners.chatList) {
    off(chatListeners.chatList.ref);
  }
  const chatListRef = ref(db, `user_chats/${uid}`);
  chatListeners.chatList = { ref: chatListRef };
  onValue(chatListRef, async (snap) => {
    const chats = snap.val() || {};
    const items = [];

    for (const [chatId, meta] of Object.entries(chats)) {
      // 🔔 NOTIFICATION LOGIC
      const prev = previousChatsState[chatId];
      const isChatOpen = (currentChat && currentChat.id === chatId);
      if (prev && meta.lastMessageTime > prev.lastMessageTime && meta.unread > (prev.unread || 0) && !isChatOpen) {
          triggerBhaiNotification(meta.name || "Bhai", meta.lastMessage);
      }
      previousChatsState[chatId] = meta;

      if (meta.type === "group" && activeTab !== "groups") continue;
      if (meta.type === "private" && activeTab !== "chats") continue;
      items.push({ chatId, ...meta });
    }

    items.sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0));
    renderChatList(items);
  });
}

function renderChatList(items) {
  const container = document.getElementById("chat-list");
  if (!items.length) {
    container.innerHTML = `<div class="empty-state"><span>${activeTab==="groups"?"👥":"💬"}</span><p>${activeTab==="groups"?"Koi group nahi":"Koi baat nahi shuru hui"}</p><button class="btn-sm" onclick="${activeTab==="groups"?"openNewGroup()":"openNewChat()"}">Naya ${activeTab==="groups"?"Group":"Chat"} Shuru Karo</button></div>`;
    return;
  }
  container.innerHTML = items.map(item => {
    const isActive = currentChat?.id === item.chatId;
    const time = item.lastMessageTime ? formatTime(item.lastMessageTime) : "";
    const onlineDot = item.type === "private" && item.peerOnline ? '<div class="online-dot"></div>' : "";
    return `
      <div class="chat-item${isActive?" active":""}" onclick="openChat('${item.chatId}','${item.type}')">
        <div class="ci-avatar">${item.avatar || "?"}${onlineDot}</div>
        <div class="ci-info">
          <div class="ci-row1"><span class="ci-name">${esc(item.name)}</span><span class="ci-time">${time}</span></div>
          <div class="ci-row2"><span class="ci-preview">${esc(item.lastMessage||"")}</span>${item.unread ? `<span class="unread-badge">${item.unread}</span>` : ""}</div>
        </div>
      </div>`;
  }).join("");
}

window.filterChats = function() {
  const q = document.getElementById("search-input").value.toLowerCase();
  document.querySelectorAll(".chat-item").forEach(el => el.style.display = el.querySelector(".ci-name").textContent.toLowerCase().includes(q) ? "" : "none");
};

window.switchTab = function(tab, el) {
  activeTab = tab;
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  el.classList.add("active");
  loadChatList();
};

// ─────────────────────────────────────────────────────────
//  OPEN & MANAGE CHAT
// ─────────────────────────────────────────────────────────
window.openChat = async function(chatId, type) {
  if (chatListeners.messages) off(chatListeners.messages.ref);
  currentChat = { id: chatId, type };

  // 🎭 Reset Anonymous Mode aur Button Visibility
  isAnonymousMode = false;
  const anonBtn = document.getElementById("anonymous-btn");
  if (anonBtn) {
    if (type === "group") {
      anonBtn.classList.remove("hidden");
      anonBtn.classList.remove("active");
    } else {
      anonBtn.classList.add("hidden");
    }
  }

  const metaSnap = await get(ref(db, `user_chats/${currentUser.uid}/${chatId}`));
  const meta = metaSnap.val() || {};
  currentChat.name = meta.name || "Chat";
  currentChat.avatar = meta.avatar || "?";
  updateChatHeader(currentChat.name, currentChat.avatar, "...", false);

  if (type === "private") {
    const snap = await get(ref(db, `chats/${chatId}`));
    const data = snap.val() || {};
    const peerId = (data.members || []).find(m => m !== currentUser.uid);
    if (peerId) {
      const peerSnap = await get(ref(db, `users/${peerId}`));
      const peer = peerSnap.val() || {};
      currentChat.peerId = peerId;
      updateChatHeader(peer.name || meta.name, peer.avatar || meta.avatar, peer.online ? "Online" : formatLastSeen(peer.lastSeen), peer.online);
      onValue(ref(db, `users/${peerId}/online`), s => {
        const online = s.val();
        document.getElementById("chat-status").textContent = online ? "Online" : "Last seen recently";
        document.getElementById("chat-status").style.color = online ? "var(--accent)" : "var(--text-secondary)";
      });
    }
  } else {
    const snap = await get(ref(db, `groups/${chatId}`));
    const g = snap.val() || {};
    updateChatHeader(g.name || meta.name, g.avatar || meta.avatar, `${(g.members||[]).length} members`, false);
  }

  document.getElementById("welcome-screen").style.display = "none";
  document.getElementById("chat-view").classList.remove("hidden");
  if (window.innerWidth <= 700) { document.getElementById("sidebar").classList.add("hidden-mobile"); document.querySelector(".back-btn")?.classList.remove("hidden"); }
  update(ref(db, `user_chats/${currentUser.uid}/${chatId}`), { unread: 0 });
  loadMessages(chatId, type);
};

window.toggleAnonymous = function() {
  isAnonymousMode = !isAnonymousMode;
  document.getElementById("anonymous-btn").classList.toggle("active", isAnonymousMode);
  if (isAnonymousMode) {
    showToast("🤫 Secret Mode ON! Tera asli naam kisi ko nahi dikhega.");
  } else {
    showToast("Secret Mode OFF.");
  }
};

// ─────────────────────────────────────────────────────────
//  🎙️ VOICE MESSAGES (Base64 — No Storage needed)
// ─────────────────────────────────────────────────────────
window.startVoiceRecording = async function(e) {
  if (e) e.preventDefault();
  if (isRecording || !currentChat) return;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    isRecording    = true;
    voiceCancelled = false;
    audioChunks    = [];
    voiceRecSeconds = 0;

    // UI switch
    document.getElementById("message-input-wrapper").classList.add("hidden");
    document.getElementById("mic-btn").classList.add("hidden");
    document.getElementById("voice-recording-ui").classList.remove("hidden");
    document.getElementById("voice-rec-timer").textContent = "0:00";

    // Timer — pehle clear karo taaki double na ho
    if (voiceRecTimer) { clearInterval(voiceRecTimer); voiceRecTimer = null; }
    voiceRecTimer = setInterval(() => {
      voiceRecSeconds++;
      const m = Math.floor(voiceRecSeconds / 60);
      const s = voiceRecSeconds % 60;
      const timerEl = document.getElementById("voice-rec-timer");
      if (timerEl) timerEl.textContent = `${m}:${String(s).padStart(2,"0")}`;

      // 60 sec max — auto stop
      if (voiceRecSeconds >= 60) {
        showToast("Max 60 second! Auto-send ho raha hai 🎙️");
        stopVoiceRecording();
      }
    }, 1000);

    // MediaRecorder setup
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/ogg";

    mediaRecorder = new MediaRecorder(stream, { mimeType });
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      if (voiceCancelled) return; // user ne cancel kiya
      const blob = new Blob(audioChunks, { type: mimeType });
      await sendVoiceMessage(blob, voiceRecSeconds);
    };
    mediaRecorder.start(250); // 250ms chunks

    // Recording chalta rahega jab tak Send ya Cancel na dabao

  } catch (err) {
    isRecording = false;
    resetVoiceUI();
    if (err.name === "NotAllowedError") {
      showToast("Mic permission do bhai! Browser settings check karo 🎙️");
    } else {
      showToast("Mic nahi mila: " + err.message);
    }
  }
};

window.stopVoiceRecording = function stopVoiceRecording() {
  if (!isRecording || !mediaRecorder) return;
  clearInterval(voiceRecTimer);
  if (voiceRecSeconds < 1) {
    showToast("Thoda zyada bol bhai! 😅");
    cancelVoiceRecording();
    return;
  }
  voiceCancelled = false; // send karna hai
  isRecording = false;
  mediaRecorder.stop(); // onstop fire hoga → sendVoiceMessage
  resetVoiceUI();
}

window.cancelVoiceRecording = function() {
  clearInterval(voiceRecTimer);
  voiceCancelled = true; // send mat karna
  isRecording = false;
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stream?.getTracks().forEach(t => t.stop());
    mediaRecorder.stop();
  }
  audioChunks = [];
  resetVoiceUI();
  showToast("Recording cancel kar di 🚫");
};

function resetVoiceUI() {
  document.getElementById("voice-recording-ui").classList.add("hidden");
  document.getElementById("message-input-wrapper").classList.remove("hidden");
  document.getElementById("mic-btn").classList.remove("hidden");
  document.getElementById("mic-btn").style.display = "flex";
  document.getElementById("send-btn").style.display = "none";
}

async function sendVoiceMessage(blob, durationSec) {
  if (!currentChat) return;
  showToast("🎙️ Voice bhej raha hoon...");

  // Blob → Base64
  const base64 = await new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onloadend = () => res(reader.result); // full data URL incl. mime
    reader.onerror = rej;
    reader.readAsDataURL(blob);
  });

  // Size check — ~1.5MB limit (Firebase node size)
  if (base64.length > 1_500_000) {
    showToast("Voice note bahut lamba hai! 60 sec se chhota rakho 😅");
    return;
  }

  const chatId = currentChat.id;
  const uid    = currentUser.uid;
  const msgKey = push(ref(db, `messages/${chatId}`)).key;
  const ts     = Date.now();

  await set(ref(db, `messages/${chatId}/${msgKey}`), {
    type:       "voice",
    audioData:  base64,
    duration:   durationSec,
    senderId:   uid,
    senderName: currentUser.name,
    timestamp:  ts,
    status:     "sent",
    isAnonymous: false
  });

  // Update chat preview
  const membersSnap = await get(ref(db, currentChat.type === "group"
    ? `groups/${chatId}/members`
    : `chats/${chatId}/members`));
  const members = membersSnap.val() || [];
  const preview = `🎙️ Voice message (${durationSec}s)`;

  for (const mId of members) {
    const isMe = mId === uid;
    const updateData = {
      lastMessage: preview, lastMessageTime: ts,
      type: currentChat.type,
      name:   isMe ? currentChat.name   : currentUser.name,
      avatar: isMe ? currentChat.avatar : currentUser.avatar
    };
    if (!isMe) {
      const uSnap = await get(ref(db, `user_chats/${mId}/${chatId}/unread`));
      updateData.unread = (uSnap.val() || 0) + 1;
      if (currentChat.type === "group") { updateData.name = currentChat.name; updateData.avatar = currentChat.avatar; }
    }
    await update(ref(db, `user_chats/${mId}/${chatId}`), updateData);
  }
  setTimeout(() => update(ref(db, `messages/${chatId}/${msgKey}`), { status: "delivered" }), 800);
  showToast("🎙️ Voice message bhej diya! 🔥");
}
window.toggleTimerPicker = function() {
  document.getElementById("timer-picker").classList.toggle("hidden");
  document.getElementById("emoji-keyboard").classList.add("hidden");
};

window.setDestructTimer = function(ms) {
  destructTimer = ms;
  const btn = document.getElementById("timer-btn");
  const labels = { 0: "⏳", 30000: "⏳30s", 60000: "⏳1m", 300000: "⏳5m", 3600000: "⏳1h", 86400000: "⏳1d" };

  // Highlight selected option
  document.querySelectorAll(".timer-opt").forEach(b => b.classList.remove("active"));
  const allOpts = document.querySelectorAll(".timer-opt");
  const msValues = [0, 30000, 60000, 300000, 3600000, 86400000];
  const idx = msValues.indexOf(ms);
  if (idx >= 0 && allOpts[idx]) allOpts[idx].classList.add("active");

  btn.textContent = labels[ms] || "⏳";
  btn.classList.toggle("active", ms > 0);

  document.getElementById("timer-picker").classList.add("hidden");
  if (ms === 0) {
    showToast("⏳ Timer OFF — messages normal rahenge.");
  } else {
    const readableLabels = { 30000: "30 seconds", 60000: "1 minute", 300000: "5 minutes", 3600000: "1 hour", 86400000: "1 din" };
    showToast(`⏳ Timer ON! Message ${readableLabels[ms]} baad delete ho jaayega 💥`);
  }
};

// Actual delete karo after timer expires
function scheduleMessageDelete(chatId, msgKey, delayMs) {
  setTimeout(async () => {
    try {
      // Firebase se delete
      await set(ref(db, `messages/${chatId}/${msgKey}`), null);
      // Update chat preview if this was last message
      const previewUpdate = { lastMessage: "💥 Message delete ho gaya", lastMessageTime: Date.now() };
      const membersSnap = await get(ref(db, currentChat?.type === "group" ? `groups/${chatId}/members` : `chats/${chatId}/members`));
      const members = membersSnap.val() || [];
      for (const mId of members) {
        await update(ref(db, `user_chats/${mId}/${chatId}`), previewUpdate);
      }
    } catch(e) { console.log("Delete failed:", e); }
  }, delayMs);
}


function updateChatHeader(name, avatar, status, online) {
  document.getElementById("chat-name").textContent = name;
  document.getElementById("chat-status").textContent = status;
  document.getElementById("chat-status").style.color = online ? "var(--accent)" : "var(--text-secondary)";
  document.getElementById("chat-avatar").textContent = avatar;
}

window.backToList = function() {
  document.getElementById("sidebar").classList.remove("hidden-mobile");
  document.getElementById("chat-view").classList.add("hidden"); 
  document.getElementById("welcome-screen").style.display = "";
  currentChat = null;
};

// ─────────────────────────────────────────────────────────
//  MESSAGES
// ─────────────────────────────────────────────────────────

function loadMessages(chatId, type) {
  const container = document.getElementById("messages-list");
  container.innerHTML = "";

  // Typing indicator (only for private chats)
  const typingIndicatorEl = document.getElementById("typing-indicator");
  if (type === "private" && currentChat.peerId) {
    onValue(ref(db, `typing/${chatId}/${currentChat.peerId}`), s => {
      if (typingIndicatorEl) typingIndicatorEl.classList.toggle("hidden", !s.val());
    });
  } else {
    if (typingIndicatorEl) typingIndicatorEl.classList.add("hidden");
  }

  const msgsRef = ref(db, `messages/${chatId}`);
  chatListeners.messages = { ref: msgsRef };
  onValue(msgsRef, snap => {
    const msgs = snap.val() || {};
    container.innerHTML = "";
    let lastDate = null;
    Object.entries(msgs).sort((a, b) => a[1].timestamp - b[1].timestamp).forEach(([key, msg]) => {
      // ⏳ Already expired? Delete silently and skip render
      if (msg.destructAt && msg.destructAt <= Date.now()) {
        set(ref(db, `messages/${chatId}/${key}`), null);
        return;
      }
      // ⏳ Not yet expired but timer running — reschedule delete
      if (msg.destructAt && msg.destructAt > Date.now()) {
        scheduleMessageDelete(chatId, key, msg.destructAt - Date.now());
      }
      // Date divider
      const msgDate = new Date(msg.timestamp).toDateString();
      if (msgDate !== lastDate) {
        lastDate = msgDate;
        const divider = document.createElement("div");
        divider.className = "msg-date-divider";
        const today = new Date().toDateString();
        const yesterday = new Date(Date.now() - 86400000).toDateString();
        divider.innerHTML = `<span>${msgDate === today ? "Aaj" : msgDate === yesterday ? "Kal" : new Date(msg.timestamp).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>`;
        container.appendChild(divider);
      }
      container.appendChild(buildMessageEl(msg, type));
    });
    // Scroll to bottom
    const area = document.getElementById("messages-area");
    area.scrollTop = area.scrollHeight;

    // Mark as seen if this chat is open
    if (currentChat && currentChat.id === chatId && type === "private" && currentChat.peerId) {
      Object.entries(msgs).forEach(([key, msg]) => {
        if (msg.senderId !== currentUser.uid && msg.status !== "seen") {
          update(ref(db, `messages/${chatId}/${key}`), { status: "seen" });
        }
      });
    }
  });
}

// ─────────────────────────────────────────────────────────
//  GROUP MEMBER SEARCH & GROUP CREATION
// ─────────────────────────────────────────────────────────
let groupSearchDebounce = null;
window.searchGroupMember = function() {
  const phone = document.getElementById("group-search-phone").value.trim();
  const result = document.getElementById("group-search-result");
  clearTimeout(groupSearchDebounce);
  if (phone.length < 10) { result.innerHTML = ""; return; }
  result.innerHTML = '<div class="spinner" style="margin:12px auto"></div>';
  groupSearchDebounce = setTimeout(async () => {
    const uidSnap = await get(ref(db, `phone_index/${phone}`));
    if (!uidSnap.exists()) { result.innerHTML = `<p style="color:var(--text-muted);font-size:0.85rem;text-align:center">Koi nahi mila 😕</p>`; return; }
    const uid = uidSnap.val();
    if (uid === currentUser.uid) { result.innerHTML = `<p style="color:var(--text-muted);font-size:0.85rem;text-align:center">Ye toh tu khud hai 😂</p>`; return; }
    if (groupPendingMembers.find(m => m.uid === uid)) { result.innerHTML = `<p style="color:var(--text-muted);font-size:0.85rem;text-align:center">Pehle se add hai yeh bhai ✅</p>`; return; }
    const user = (await get(ref(db, `users/${uid}`))).val() || {};
    result.innerHTML = `<div class="user-found-card"><div class="avatar-sm">${user.avatar || "?"}</div><div class="user-found-info"><strong>${esc(user.name)}</strong><span>${user.status || ""}</span></div><button class="start-chat-btn" onclick="addGroupMember('${uid}','${esc(user.name)}','${user.avatar||'?'}')">Add Karo</button></div>`;
  }, 500);
};

window.addGroupMember = function(uid, name, avatar) {
  if (groupPendingMembers.find(m => m.uid === uid)) return;
  groupPendingMembers.push({ uid, name, avatar });
  document.getElementById("group-search-phone").value = "";
  document.getElementById("group-search-result").innerHTML = "";
  renderGroupMembersList();
  // Suggestion card mein bhi reflect karo
  const card = document.getElementById("sugg-" + uid);
  if (card) card.querySelector("button").outerHTML = '<span style="font-size:0.8rem;color:var(--accent);font-weight:600">✅ Added</span>';
};

window.addGroupMemberFromSuggest = function(uid, name, avatar) {
  if (groupPendingMembers.find(m => m.uid === uid)) return;
  groupPendingMembers.push({ uid, name, avatar });
  renderGroupMembersList();
  const card = document.getElementById("sugg-" + uid);
  if (card) card.querySelector("button").outerHTML = '<span style="font-size:0.8rem;color:var(--accent);font-weight:600">✅ Added</span>';
};

function renderGroupMembersList() {
  const container = document.getElementById("group-members-list");
  container.innerHTML = groupPendingMembers.map((m, i) =>
    `<div class="member-chip">${m.avatar} ${esc(m.name)} <button onclick="removeGroupMember(${i})">✕</button></div>`
  ).join("");
}

window.removeGroupMember = function(i) {
  groupPendingMembers.splice(i, 1);
  renderGroupMembersList();
};

window.createGroup = async function() {
  const name = document.getElementById("group-name-input").value.trim();
  if (!name) { showToast("Group ka naam toh dalo bhai!"); return; }
  if (groupPendingMembers.length < 1) { showToast("Kam se kam ek member toh add karo!"); return; }
  const members = [currentUser.uid, ...groupPendingMembers.map(m => m.uid)];
  const groupRef = push(ref(db, "groups"));
  const groupId = groupRef.key;
  await set(groupRef, { name, avatar: "👥", members, createdBy: currentUser.uid, createdAt: Date.now() });
  const chatMeta = { type: "group", name, avatar: "👥", lastMessageTime: Date.now() };
  for (const mId of members) {
    await update(ref(db, `user_chats/${mId}/${groupId}`), chatMeta);
  }
  closeModal("new-group-modal");
  showToast(`Group "${name}" ban gaya! 🎉`);
  openChat(groupId, "group");
};

function buildMessageEl(msg, type) {
  const isOut = msg.senderId === currentUser.uid;
  const div = document.createElement("div"); div.className = `message ${isOut ? "outgoing" : "incoming"}`;
  const ticks = isOut ? (msg.status==="seen" ? `<span class="msg-ticks seen">✓✓</span>` : msg.status==="delivered" ? `<span class="msg-ticks delivered">✓✓</span>` : `<span class="msg-ticks">✓</span>`) : "";
  
  // 🎭 ANONYMOUS LOGIC
  let senderNameHtml = "";
  let bubbleClass = "msg-bubble";
  if (msg.isAnonymous) bubbleClass += " anonymous";

  if (!isOut && type === "group" && msg.senderName) {
    senderNameHtml = `<div class="msg-sender-name" style="${msg.isAnonymous ? 'color: var(--danger)' : ''}">${esc(msg.senderName)}</div>`;
  } else if (isOut && msg.isAnonymous) {
    senderNameHtml = `<div class="msg-sender-name" style="color: var(--danger); text-align: right; opacity: 0.8; font-size: 0.7rem;">🤫 Tune secret bheja</div>`;
  }

  // 🎙️ VOICE MESSAGE
  if (msg.type === "voice") {
    const audioId = `audio-${msg.timestamp}-${(msg.senderId||"x").slice(-4)}`;
    const dur = msg.duration ? `${msg.duration}s` : "";
    div.innerHTML = `<div class="${bubbleClass} voice-bubble">
      ${senderNameHtml}
      <div class="voice-player" id="${audioId}-player">
        <button class="voice-play-btn" onclick="toggleVoicePlay('${audioId}')" id="${audioId}-playbtn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
        </button>
        <div class="voice-waveform">
          <div class="voice-progress-bar"><div class="voice-progress-fill" id="${audioId}-fill" style="width:0%"></div></div>
        </div>
        <span class="voice-dur" id="${audioId}-dur">${dur}</span>
        <audio id="${audioId}" src="${msg.audioData}" preload="none"
          ontimeupdate="updateVoiceProgress('${audioId}')"
          onended="voiceEnded('${audioId}')">
        </audio>
      </div>
      <div class="msg-meta"><span class="msg-time">${formatTime(msg.timestamp)}</span>${ticks}</div>
    </div>`;
    return div;
  }
  let destructHtml = "";
  if (msg.destructAt) {
    bubbleClass += " self-destruct";
    const remaining = Math.max(0, msg.destructAt - Date.now());
    const countdownId = `cd-${msg.timestamp}-${msg.senderId?.slice(-4) || "x"}`;
    destructHtml = `<div class="destruct-badge" id="${countdownId}">💥 <span class="cd-time">${formatCountdown(remaining)}</span></div>`;
    // Start live countdown after render
    setTimeout(() => startCountdown(countdownId, msg.destructAt), 0);
  }

  div.innerHTML = `<div class="${bubbleClass}">${senderNameHtml}<div class="msg-text">${esc(msg.text).replace(/\n/g, "<br>")}</div>${destructHtml}<div class="msg-meta"><span class="msg-time">${formatTime(msg.timestamp)}</span>${ticks}</div></div>`;
  return div;
}

window.sendMessage = async function() {
  const input = document.getElementById("message-input");
  const text = input.value.trim();
  if (!text || !currentChat) return;
  input.value = ""; autoResize(input); clearTyping();
  
  const chatId = currentChat.id;
  const uid = currentUser.uid;
  const msgKey = push(ref(db, `messages/${chatId}`)).key;
  const ts = Date.now();
  
  // 🎭 Message object mein isAnonymous flag add kiya
  const msgData = { 
    text, 
    senderId: uid, 
    senderName: isAnonymousMode ? "Secret Bhai 🎭" : currentUser.name, 
    timestamp: ts, 
    status: "sent",
    isAnonymous: isAnonymousMode
  };

  // ⏳ Self-destruct support
  if (destructTimer > 0) {
    msgData.destructAt = ts + destructTimer;
  }

  await set(ref(db, `messages/${chatId}/${msgKey}`), msgData);

  const membersSnap = await get(ref(db, currentChat.type === "group" ? `groups/${chatId}/members` : `chats/${chatId}/members`));
  const members = membersSnap.val() || [];
  const preview = text.length > 40 ? text.slice(0,40)+"…" : text;

  for (const mId of members) {
    const isMe = mId === uid;
    const updateData = { lastMessage: preview, lastMessageTime: ts, type: currentChat.type, name: isMe ? currentChat.name : currentUser.name, avatar: isMe ? currentChat.avatar : currentUser.avatar };
    if (!isMe) {
      const uSnap = await get(ref(db, `user_chats/${mId}/${chatId}/unread`));
      updateData.unread = (uSnap.val() || 0) + 1;
      if (currentChat.type === "group") { updateData.name = currentChat.name; updateData.avatar = currentChat.avatar; }
    }
    await update(ref(db, `user_chats/${mId}/${chatId}`), updateData);
  }
  setTimeout(() => update(ref(db, `messages/${chatId}/${msgKey}`), { status: "delivered" }), 800);
  
  // ⏳ Schedule delete if timer was set
  if (destructTimer > 0) {
    scheduleMessageDelete(chatId, msgKey, destructTimer);
    // Reset timer after send
    window.setDestructTimer(0);
  }

  // Message bhejte hi secret mode wapas normal kar do (Optional, par safe rehta hai)
  if(isAnonymousMode) window.toggleAnonymous(); 
};

// ─────────────────────────────────────────────────────────
//  TYPING, SEARCH & MODALS
// ─────────────────────────────────────────────────────────
window.handleTyping = function() {
  if (!currentChat || currentChat.type !== "private") return;
  set(ref(db, `typing/${currentChat.id}/${currentUser.uid}`), true);
  clearTimeout(typingTimer);
  typingTimer = setTimeout(clearTyping, 2500);
};
function clearTyping() { if(currentChat) set(ref(db, `typing/${currentChat.id}/${currentUser.uid}`), false); }

window.openNewChat = function() { document.getElementById("search-phone").value = ""; document.getElementById("user-search-result").innerHTML = ""; document.getElementById("new-chat-modal").classList.remove("hidden"); };
window.openNewGroup = async function() {
  groupPendingMembers = [];
  document.getElementById("group-name-input").value = "";
  document.getElementById("group-search-phone").value = "";
  document.getElementById("group-search-result").innerHTML = "";
  renderGroupMembersList();
  document.getElementById("new-group-modal").classList.remove("hidden");

  // Chat list ke private contacts seedha dikhao
  const suggBox = document.getElementById("group-contacts-suggest");
  if (!suggBox) return;
  suggBox.innerHTML = '<div class="spinner" style="margin:8px auto"></div>';
  try {
    const chatsSnap = await get(ref(db, `user_chats/${currentUser.uid}`));
    const chats = chatsSnap.val() || {};
    const privateContacts = [];
    for (const [, meta] of Object.entries(chats)) {
      if (meta.type !== "private" || !meta.peerId) continue;
      const uSnap = await get(ref(db, `users/${meta.peerId}`));
      if (uSnap.exists()) {
        privateContacts.push({ uid: meta.peerId, ...uSnap.val() });
      }
    }
    if (!privateContacts.length) {
      suggBox.innerHTML = '<p style="font-size:0.8rem;color:var(--text-muted);text-align:center;padding:8px 0">Abhi koi contact nahi — phone se search karo ऊपर 🔍</p>';
      return;
    }
    suggBox.innerHTML = privateContacts.map(u =>
      `<div class="member-suggest-card" id="sugg-${u.uid}">
        <div class="avatar-sm">${u.avatar || "?"}</div>
        <div class="user-found-info"><strong>${esc(u.name)}</strong><span>${u.status || ""}</span></div>
        <button class="start-chat-btn" onclick="addGroupMemberFromSuggest('${u.uid}','${esc(u.name)}','${u.avatar||"?"}')">+ Add</button>
      </div>`
    ).join("");
  } catch(e) {
    suggBox.innerHTML = "";
  }
};

// (Search & Group creation logic skipped for brevity, keeping all your exact logic)
let searchDebounce = null;
window.searchUserByPhone = function() {
  const phone = document.getElementById("search-phone").value.trim();
  const result = document.getElementById("user-search-result");
  clearTimeout(searchDebounce); if (phone.length < 10) { result.innerHTML = ""; return; }
  result.innerHTML = '<div class="spinner" style="margin:12px auto"></div>';
  searchDebounce = setTimeout(async () => {
    const uidSnap = await get(ref(db, `phone_index/${phone}`));
    if (!uidSnap.exists()) { result.innerHTML = `<p style="color:var(--text-muted);font-size:0.85rem;text-align:center">Koi nahi mila is number pe 😕</p>`; return; }
    const uid = uidSnap.val();
    if (uid === currentUser.uid) { result.innerHTML = `<p style="color:var(--text-muted);font-size:0.85rem;text-align:center">Ye toh tera hi number hai 😂</p>`; return; }
    const user = (await get(ref(db, `users/${uid}`))).val() || {};
    result.innerHTML = `<div class="user-found-card"><div class="avatar-sm">${user.avatar || "?"}</div><div class="user-found-info"><strong>${esc(user.name)}</strong><span>${user.status || ""}</span></div><button class="start-chat-btn" onclick="startPrivateChat('${uid}')">Chat Karo</button></div>`;
  }, 500);
};
window.startPrivateChat = async function(peerId) {
  closeModal("new-chat-modal");
  const chatId = [currentUser.uid, peerId].sort().join("_");
  const peer = (await get(ref(db, `users/${peerId}`))).val() || {};
  await update(ref(db, `chats/${chatId}`), { members: [currentUser.uid, peerId], type: "private", createdAt: Date.now() });
  await update(ref(db, `user_chats/${currentUser.uid}/${chatId}`), { type: "private", name: peer.name, avatar: peer.avatar || "?", lastMessageTime: Date.now() });
  await update(ref(db, `user_chats/${peerId}/${chatId}`), { type: "private", name: currentUser.name, avatar: currentUser.avatar || "?", lastMessageTime: Date.now() });
  openChat(chatId, "private");
};

// ─────────────────────────────────────────────────────────
//  PROFILE, SETTINGS, CLEAR CHAT & LOGOUT
// ─────────────────────────────────────────────────────────
function updateSidebarAvatar() { document.getElementById("sidebar-avatar").textContent = currentUser?.avatar || "?"; }

window.openProfile = function() {
  const u = currentUser;
  document.getElementById("profile-avatar-big").textContent = u.avatar || "?";
  document.getElementById("profile-name-display").textContent = u.name || "—";
  document.getElementById("profile-phone-display").textContent = u.phone || "—";
  document.getElementById("profile-email-display").textContent = u.email || "—";
  document.getElementById("profile-status-display").textContent = u.status || "—";
  document.getElementById("profile-modal").classList.remove("hidden");
};

window.openSettings = function() {
  const u = currentUser;
  document.getElementById("setting-name-input").value = u.name || "";
  document.getElementById("setting-status-input").value = u.status || "";
  document.getElementById("setting-phone-display").textContent = u.phone || "Number nahi hai";
  document.getElementById("setting-email-display").textContent = u.email || "Email nahi hai";
  document.getElementById("settings-modal").classList.remove("hidden");
};

window.saveSettings = async function() {
  const newName = document.getElementById("setting-name-input").value.trim();
  const newStatus = document.getElementById("setting-status-input").value.trim();
  if (!newName) { showToast("Naam khali nahi chhod sakte bhai!"); return; }
  try {
    await update(ref(db, `users/${currentUser.uid}`), { name: newName, status: newStatus });
    currentUser.name = newName; currentUser.status = newStatus;
    showToast("Settings save ho gayi! 🔥");
    closeModal("settings-modal");
  } catch (error) { showToast("Error aaya yaar: " + error.message); }
};

window.renameGroup = async function() {
  if (!currentChat || currentChat.type !== "group") return;
  const newName = document.getElementById("info-group-name-input").value.trim();
  if (!newName) { showToast("Group ka naam khali nahi chhod sakte!"); return; }
  const chatId = currentChat.id;
  try {
    // DB mein update karo
    await update(ref(db, `groups/${chatId}`), { name: newName });
    // Sab members ke user_chats mein bhi naam update karo
    const snap = await get(ref(db, `groups/${chatId}/members`));
    const members = snap.val() || [];
    const updates = {};
    for (const uid of members) {
      updates[`user_chats/${uid}/${chatId}/name`] = newName;
    }
    await update(ref(db), updates);
    // Local state bhi update karo
    currentChat.name = newName;
    document.getElementById("info-name-display").textContent = newName;
    // Chat header bhi update karo agar wahi group open hai
    const headerName = document.getElementById("chat-header-name");
    if (headerName) headerName.textContent = newName;
    showToast("Group ka naam badal diya! ✏️");
  } catch (err) { showToast("Error: " + err.message); }
};

window.openChatInfo = async function() {
  if (!currentChat) return;
  const modal = document.getElementById("chat-info-modal");
  document.getElementById("info-name-display").textContent = currentChat.name;
  document.getElementById("info-avatar-big").textContent = currentChat.avatar;
  const extraDisp   = document.getElementById("info-extra-display");
  const statusDisp  = document.getElementById("info-status-display");
  const groupMemSection = document.getElementById("info-group-members");

  extraDisp.textContent = "Loading..."; statusDisp.textContent = ""; groupMemSection.classList.add("hidden");

  if (currentChat.type === "private" && currentChat.peerId) {
    const peer = (await get(ref(db, `users/${currentChat.peerId}`))).val() || {};
    extraDisp.textContent = peer.phone || "Number hidden";
    statusDisp.textContent = peer.status ? `"${peer.status}"` : "Hey, BhaiChara pe hoon!";
    document.getElementById("info-group-rename-section").style.display = "none";
  } else if (currentChat.type === "group") {
    const group = (await get(ref(db, `groups/${currentChat.id}`))).val() || {};
    const memberIds = group.members || [];
    extraDisp.textContent = `${memberIds.length} Members`;
    statusDisp.textContent = "👥 Group Chat";
    groupMemSection.classList.remove("hidden");
    await renderGroupInfoMembers(memberIds, group.createdBy);
    // Rename section sirf admin ke liye
    const renameSection = document.getElementById("info-group-rename-section");
    if (group.createdBy === currentUser.uid) {
      renameSection.style.display = "block";
      document.getElementById("info-group-name-input").value = currentChat.name || "";
    } else {
      renameSection.style.display = "none";
    }
  }
  modal.classList.remove("hidden");
};

async function renderGroupInfoMembers(memberIds, createdBy) {
  const container = document.getElementById("info-members-list-container");
  const addSection = document.getElementById("info-group-add-section");
  container.innerHTML = '<div class="spinner" style="margin:8px auto"></div>';

  const isAdmin = createdBy === currentUser.uid;
  const members = [];
  for (const uid of memberIds) {
    const u = (await get(ref(db, `users/${uid}`))).val() || {};
    members.push({ uid, ...u });
  }

  container.innerHTML = members.map(m => {
    const isMe = m.uid === currentUser.uid;
    const isCreator = m.uid === createdBy;
    const removeBtn = isAdmin && !isMe
      ? `<button onclick="removeGroupMemberLive('${m.uid}')" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.8rem;padding:2px 6px;border-radius:4px;">✕ Hata do</button>`
      : "";
    const badge = isCreator ? `<span style="font-size:0.7rem;color:var(--accent);margin-left:4px;">👑 Admin</span>` : "";
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid var(--border-light);">
      <div style="font-size:1.4rem;">${m.avatar || "?"}</div>
      <div style="flex:1;">
        <div style="font-size:0.9rem;font-weight:600;">${esc(m.name || "Bhai")}${badge}${isMe ? " <span style='font-size:0.7rem;color:var(--text-muted)'>(Tu)</span>" : ""}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);">${m.phone || ""}</div>
      </div>
      ${removeBtn}
    </div>`;
  }).join("");

  // Add member section (sirf admin ke liye)
  if (addSection) {
    addSection.style.display = isAdmin ? "block" : "none";
  }
}

window.removeGroupMemberLive = async function(uid) {
  if (!currentChat || currentChat.type !== "group") return;
  if (!window.confirm("Sach mein is bhai ko group se hatana hai?")) return;
  const chatId = currentChat.id;
  try {
    const snap = await get(ref(db, `groups/${chatId}/members`));
    const members = (snap.val() || []).filter(m => m !== uid);
    await set(ref(db, `groups/${chatId}/members`), members);
    // Us bande ke user_chats se bhi hata do
    await set(ref(db, `user_chats/${uid}/${chatId}`), null);
    showToast("Bhai ko group se hata diya 👋");
    // Refresh
    const group = (await get(ref(db, `groups/${chatId}`))).val() || {};
    await renderGroupInfoMembers(group.members || [], group.createdBy);
    document.getElementById("info-extra-display").textContent = `${(group.members||[]).length} Members`;
  } catch(e) { showToast("Error: " + e.message); }
};

window.addMemberToGroupLive = async function() {
  const phone = document.getElementById("info-add-phone").value.trim();
  if (!phone || phone.length !== 10) { showToast("10 digit ka number dalo bhai!"); return; }
  if (!currentChat || currentChat.type !== "group") return;
  const chatId = currentChat.id;
  try {
    const uidSnap = await get(ref(db, `phone_index/${phone}`));
    if (!uidSnap.exists()) { showToast("Is number pe koi nahi mila 😕"); return; }
    const newUid = uidSnap.val();
    const snap = await get(ref(db, `groups/${chatId}/members`));
    const members = snap.val() || [];
    if (members.includes(newUid)) { showToast("Ye bhai pehle se group mein hai! 😄"); return; }
    const updatedMembers = [...members, newUid];
    await set(ref(db, `groups/${chatId}/members`), updatedMembers);
    const groupSnap = await get(ref(db, `groups/${chatId}`));
    const group = groupSnap.val() || {};
    await update(ref(db, `user_chats/${newUid}/${chatId}`), {
      type: "group", name: group.name, avatar: group.avatar || "👥", lastMessageTime: Date.now()
    });
    document.getElementById("info-add-phone").value = "";
    showToast("Naya bhai group mein aa gaya! 🎉");
    await renderGroupInfoMembers(updatedMembers, group.createdBy);
    document.getElementById("info-extra-display").textContent = `${updatedMembers.length} Members`;
  } catch(e) { showToast("Error: " + e.message); }
};

window.openChatQuickSettings = function() { if (currentChat) document.getElementById("chat-quick-settings-modal").classList.remove("hidden"); };
window.clearChat = async function() {
  if (!currentChat) return;
  if (!window.confirm("Sach mein saare messages clear karne hain?")) return;
  const chatId = currentChat.id;
  try {
    await set(ref(db, `messages/${chatId}`), null);
    const clearPreview = { lastMessage: "🚫 Chat cleared", lastMessageTime: Date.now() };
    if (currentChat.type === "private" && currentChat.peerId) {
       await update(ref(db, `user_chats/${currentUser.uid}/${chatId}`), clearPreview);
       await update(ref(db, `user_chats/${currentChat.peerId}/${chatId}`), clearPreview);
    } else {
       const members = (await get(ref(db, `groups/${chatId}/members`))).val() || [];
       for(let mId of members) await update(ref(db, `user_chats/${mId}/${chatId}`), clearPreview);
    }
    closeModal('chat-quick-settings-modal'); showToast("Chat saaf kar di gayi! 🧹");
  } catch (e) { showToast("Error: " + e.message); }
};

window.logout = async function() {
  if (presenceRef) set(presenceRef, false);
  await signOut(auth);
  closeModal("profile-modal"); closeModal("settings-modal"); 
  currentUser = null; currentChat = null;
  showToast("Phir milenge bhai! 👋");
};

// ─────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────
window.toggleEmojiKeyboard = function() { document.getElementById("emoji-keyboard").classList.toggle("hidden"); };
function insertEmoji(emoji) { const i = document.getElementById("message-input"); i.value = i.value.slice(0, i.selectionStart) + emoji + i.value.slice(i.selectionEnd); i.focus(); }
function populateEmojiGrid(id, list, onPick) { const c = document.getElementById(id); if (c) list.forEach(e => { const s = document.createElement("span"); s.textContent = e; s.onclick = () => onPick(e); c.appendChild(s); }); }
window.autoResize = function(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 120) + "px";
  // Toggle mic vs send button
  const hasTxt = el.value.trim().length > 0;
  const micBtn  = document.getElementById("mic-btn");
  const sendBtn = document.getElementById("send-btn");
  if (micBtn)  micBtn.style.display  = hasTxt ? "none"  : "flex";
  if (sendBtn) sendBtn.style.display = hasTxt ? "flex"  : "none";
};
window.handleKeyDown = function(e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } };
window.closeModal = function(id) { document.getElementById(id).classList.add("hidden"); };
function showToast(msg, d = 3000) { const t = document.getElementById("toast"); t.textContent = msg; t.classList.remove("hidden"); clearTimeout(t._timer); t._timer = setTimeout(() => t.classList.add("hidden"), d); }
function formatTime(ts) { if (!ts) return ""; const d = new Date(ts), now = new Date(); return (d.toDateString() === now.toDateString()) ? d.toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit", hour12:true }) : d.toLocaleDateString("en-IN", { day:"numeric", month:"short" }); }
function formatLastSeen(ts) { return ts ? "Last seen " + formatTime(ts) : "Offline"; }
function esc(str) { return str ? String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;") : ""; }

// 🎙️ Voice player helpers
let currentPlayingAudioId = null;
window.toggleVoicePlay = function(audioId) {
  const audio = document.getElementById(audioId);
  if (!audio) return;

  // Dusra jo chal raha ho usse rok do
  if (currentPlayingAudioId && currentPlayingAudioId !== audioId) {
    const prev = document.getElementById(currentPlayingAudioId);
    if (prev) { prev.pause(); prev.currentTime = 0; }
    voiceEnded(currentPlayingAudioId);
  }

  if (audio.paused) {
    audio.play();
    currentPlayingAudioId = audioId;
    const btn = document.getElementById(`${audioId}-playbtn`);
    if (btn) btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
  } else {
    audio.pause();
    const btn = document.getElementById(`${audioId}-playbtn`);
    if (btn) btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>`;
  }
};
window.updateVoiceProgress = function(audioId) {
  const audio = document.getElementById(audioId);
  const fill  = document.getElementById(`${audioId}-fill`);
  const dur   = document.getElementById(`${audioId}-dur`);
  if (!audio || !fill) return;
  const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
  fill.style.width = pct + "%";
  if (dur) {
    const rem = Math.max(0, Math.ceil(audio.duration - audio.currentTime));
    dur.textContent = `${rem}s`;
  }
};
window.voiceEnded = function(audioId) {
  currentPlayingAudioId = null;
  const btn  = document.getElementById(`${audioId}-playbtn`);
  const fill = document.getElementById(`${audioId}-fill`);
  const audio = document.getElementById(audioId);
  if (btn)  btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>`;
  if (fill) fill.style.width = "0%";
  if (audio) audio.currentTime = 0;
};

// ⏳ Countdown helpers
function formatCountdown(ms) {
  if (ms <= 0) return "ab delete hoga 💥";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h/24)}d ${h % 24}h`;
}

const activeCountdowns = {};
function startCountdown(id, destructAt) {
  if (activeCountdowns[id]) clearInterval(activeCountdowns[id]);
  activeCountdowns[id] = setInterval(() => {
    const el = document.getElementById(id);
    if (!el) { clearInterval(activeCountdowns[id]); delete activeCountdowns[id]; return; }
    const remaining = Math.max(0, destructAt - Date.now());
    const cdSpan = el.querySelector(".cd-time");
    if (cdSpan) cdSpan.textContent = formatCountdown(remaining);
    // Visual urgency — last 10 seconds mein red pulse
    if (remaining <= 10000 && remaining > 0) el.classList.add("urgent");
    if (remaining <= 0) {
      clearInterval(activeCountdowns[id]);
      delete activeCountdowns[id];
      const msgEl = el.closest(".message");
      if (msgEl) {
        msgEl.style.transition = "all 0.5s ease";
        msgEl.style.opacity = "0";
        msgEl.style.transform = "scale(0.8)";
        setTimeout(() => msgEl.remove(), 500);
      }
    }
  }, 1000);
}

// Global exports 
window.sendMagicLink = window.sendMagicLink; window.backToEmail = window.backToEmail; window.saveProfile = window.saveProfile; window.pickAvatar = window.pickAvatar;
window.sendPhoneOtp = window.sendPhoneOtp; window.verifyPhoneOtp = window.verifyPhoneOtp; window.backToPhoneStep = window.backToPhoneStep; window.backToEmailFromPhone = window.backToEmailFromPhone;
window.switchToPhoneLogin = window.switchToPhoneLogin; window.proceedAsNewUser = window.proceedAsNewUser; window.retryPhoneEmail = window.retryPhoneEmail;
window.openNewChat = window.openNewChat; window.openNewGroup = window.openNewGroup; window.openProfile = window.openProfile; window.logout = window.logout;
window.filterChats = window.filterChats; window.switchTab = window.switchTab; window.sendMessage = window.sendMessage; window.handleTyping = window.handleTyping;
window.autoResize = window.autoResize; window.handleKeyDown = window.handleKeyDown; window.toggleEmojiKeyboard = window.toggleEmojiKeyboard; window.closeModal = window.closeModal;
window.openChat = window.openChat; window.backToList = window.backToList; window.startPrivateChat = window.startPrivateChat; window.searchUserByPhone = window.searchUserByPhone;
window.openChatInfo = window.openChatInfo; window.openSettings = window.openSettings; window.saveSettings = window.saveSettings; window.renameGroup = window.renameGroup;
window.openChatQuickSettings = window.openChatQuickSettings; window.clearChat = window.clearChat; window.askNotificationPermission = window.askNotificationPermission;
window.triggerBhaiNotification = window.triggerBhaiNotification;
window.toggleAnonymous = window.toggleAnonymous;
window.searchGroupMember = window.searchGroupMember; window.addGroupMember = window.addGroupMember; window.addGroupMemberFromSuggest = window.addGroupMemberFromSuggest;
window.removeGroupMember = window.removeGroupMember; window.createGroup = window.createGroup; window.removeGroupMemberLive = window.removeGroupMemberLive; window.addMemberToGroupLive = window.addMemberToGroupLive;
window.toggleTimerPicker = window.toggleTimerPicker; window.setDestructTimer = window.setDestructTimer;
window.startVoiceRecording = window.startVoiceRecording; window.cancelVoiceRecording = window.cancelVoiceRecording; window.stopVoiceRecording = window.stopVoiceRecording;
window.toggleVoicePlay = window.toggleVoicePlay; window.updateVoiceProgress = window.updateVoiceProgress; window.voiceEnded = window.voiceEnded;
