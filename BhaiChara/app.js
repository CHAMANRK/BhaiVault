// ╔══════════════════════════════════════════════════════╗
// ║  BhaiChara — app.js                                  ║
// ║  Firebase: Auth (Email Magic Link) + Realtime DB     ║
// ╚══════════════════════════════════════════════════════╝

import { initializeApp }                         from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getDatabase, ref, set, get, push,
         onValue, off, update, serverTimestamp,
         onDisconnect, query, orderByChild,
         limitToLast }                            from "https://www.gstatic.com/firebasejs/12.12.1/firebase-database.js";
import { getAuth, sendSignInLinkToEmail,
         isSignInWithEmailLink, signInWithEmailLink,
         onAuthStateChanged,
         signOut }                                from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";

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
let currentChat         = null;   // { id, type:'private'|'group', name, avatar }
let groupPendingMembers = [];
let selectedEmoji       = "😎";
let activeTab           = "chats";
let typingTimer         = null;
let chatListeners       = {};
let presenceRef         = null;
let previousChatsState = {}; // Naye messages track karne ke liye

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

  // ── Handle Magic Link redirect ───────────────────────────
  if (isSignInWithEmailLink(auth, window.location.href)) {
    let email = localStorage.getItem("emailForSignIn");
    if (!email) {
      email = window.prompt("Confirm karo — kaun sa email use kiya tha?");
    }
    if (email) {
      try {
        await signInWithEmailLink(auth, email, window.location.href);
        localStorage.removeItem("emailForSignIn");
        // Clean URL (remove Firebase query params)
        window.history.replaceState({}, document.title, window.location.pathname);
        showToast("Login ho gaya! 🎉");
      } catch (e) {
        showToast("Link invalid ya expire ho gaya yaar 😕");
      }
    }
  }

  // Auth state observer
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      const snap = await get(ref(db, `users/${user.uid}`));
      if (snap.exists()) {
        currentUser = { uid: user.uid, ...snap.val() };
        showApp();
      } else {
        currentUser = { uid: user.uid, email: user.email };
        showScreen("profile");
      }
    } else {
      currentUser = null;
      showScreen("auth");
    }
  });

  // Hide splash after 2.4s
  setTimeout(() => {
    document.getElementById("splash").style.display = "none";
  }, 2400);
});

// ─────────────────────────────────────────────────────────
//  SCREEN NAVIGATION
// ─────────────────────────────────────────────────────────
function showScreen(name) {
  document.getElementById("auth-screen").classList.toggle("hidden", name !== "auth");
  document.getElementById("app-screen").classList.toggle("hidden", name !== "app");
  if (name === "profile") {
    document.getElementById("auth-screen").classList.remove("hidden");
    document.getElementById("profile-step").classList.remove("hidden");
    document.getElementById("email-step").classList.add("hidden");
    document.getElementById("waiting-step").classList.add("hidden");
  }
  if (name === "auth") {
    document.getElementById("email-step").classList.remove("hidden");
    document.getElementById("waiting-step").classList.add("hidden");
    document.getElementById("profile-step").classList.add("hidden");
  }
}

function showApp() {
  showScreen("app");
  updateSidebarAvatar();
  setupPresence();
  loadChatList();
  askNotificationPermission();
}

// ─────────────────────────────────────────────────────────
//  EMAIL MAGIC LINK AUTH
// ─────────────────────────────────────────────────────────
window.sendMagicLink = async function() {
  const email = document.getElementById("email-input").value.trim();
  if (!email || !email.includes("@")) {
    showToast("Sahi email dalo bhai"); return;
  }

  const btn = document.getElementById("send-link-btn");
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div>';

  try {
    const actionCodeSettings = {
      // ⚠️  IMPORTANT: Apna deployed URL yahan daalo, e.g. https://bhaichara.vercel.app
      url: window.location.href,
      handleCodeInApp: true,
    };

    await sendSignInLinkToEmail(auth, email, actionCodeSettings);
    localStorage.setItem("emailForSignIn", email);

    document.getElementById("email-step").classList.add("hidden");
    document.getElementById("waiting-step").classList.remove("hidden");
    showToast("Magic link bhej diya! Email check karo ✅");
  } catch (e) {
    showToast("Error: " + (e.message || e.code));
    btn.disabled = false;
    btn.innerHTML = '<span>Magic Link Bhejo</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
  }
};

window.backToEmail = function() {
  document.getElementById("waiting-step").classList.add("hidden");
  document.getElementById("email-step").classList.remove("hidden");
  document.getElementById("email-input").value = "";
};

// ─────────────────────────────────────────────────────────
//  PROFILE SETUP
// ─────────────────────────────────────────────────────────
window.pickAvatar = function() {
  document.getElementById("emoji-picker").classList.toggle("hidden");
};

window.saveProfile = async function() {
  const name   = document.getElementById("name-input").value.trim();
  const phone  = document.getElementById("phone-number-input").value.trim();
  const status = document.getElementById("status-input").value.trim() || "Hey, BhaiChara pe hoon!";

  if (!name)  { showToast("Naam toh daal yaar"); return; }
  if (!phone || phone.length !== 10 || !/^\d+$/.test(phone)) {
    showToast("10 digit ka phone number daal"); return;
  }

  const profile = {
    name,
    status,
    avatar:    selectedEmoji,
    phone:     "+91" + phone,
    email:     currentUser.email || auth.currentUser?.email || "",
    createdAt: Date.now()
  };

  await set(ref(db, `users/${currentUser.uid}`), profile);
  // Phone index — same as before, phone se dhundo chalti rahegi
  await set(ref(db, `phone_index/${phone}`), currentUser.uid);

  currentUser = { ...currentUser, ...profile };
  showToast("Profile set ho gaya! 🔥");
  showApp();
};

// ─────────────────────────────────────────────────────────
//  PRESENCE (Online / Offline)
// ─────────────────────────────────────────────────────────
function setupPresence() {
  const uid    = currentUser.uid;
  presenceRef  = ref(db, `users/${uid}/online`);
  const lastRef = ref(db, `users/${uid}/lastSeen`);

  set(presenceRef, true);
  set(lastRef, serverTimestamp());

  onDisconnect(presenceRef).set(false);
  onDisconnect(lastRef).set(serverTimestamp());
}

// ─────────────────────────────────────────────────────────
//  CHAT LIST
// ─────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────
//  CHAT LIST
// ─────────────────────────────────────────────────────────

// Naye messages track karne ke liye (Agar upar add nahi kiya tha toh yahan sahi rahega)
let previousChatsState = {}; 

function loadChatList() {
  const uid = currentUser.uid;

  onValue(ref(db, `user_chats/${uid}`), async (snap) => {
    const chats = snap.val() || {};
    const items = [];

    for (const [chatId, meta] of Object.entries(chats)) {
      
      // 🚨 NEW NOTIFICATION LOGIC START 🚨
      const prev = previousChatsState[chatId];
      const isChatOpen = (currentChat && currentChat.id === chatId);
      
      // Agar purana state tha, time change hua, unread count badha, aur chat open nahi hai
      if (prev && meta.lastMessageTime > prev.lastMessageTime && meta.unread > (prev.unread || 0) && !isChatOpen) {
          triggerBhaiNotification(meta.name || "Bhai", meta.lastMessage);
      }
      previousChatsState[chatId] = meta;
      // 🚨 NEW NOTIFICATION LOGIC END 🚨

      if (meta.type === "group"   && activeTab !== "groups") continue;
      if (meta.type === "private" && activeTab !== "chats")  continue;
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
    const isActive  = currentChat?.id === item.chatId;
    const lastMsg   = item.lastMessage || "";
    const time      = item.lastMessageTime ? formatTime(item.lastMessageTime) : "";
    const unread    = item.unread || 0;
    const onlineDot = item.type === "private" && item.peerOnline ? '<div class="online-dot"></div>' : "";
    return `
      <div class="chat-item${isActive?" active":""}" onclick="openChat('${item.chatId}','${item.type}')">
        <div class="ci-avatar">${item.avatar || "?"}${onlineDot}</div>
        <div class="ci-info">
          <div class="ci-row1">
            <span class="ci-name">${esc(item.name)}</span>
            <span class="ci-time">${time}</span>
          </div>
          <div class="ci-row2">
            <span class="ci-preview">${esc(lastMsg)}</span>
            ${unread ? `<span class="unread-badge">${unread}</span>` : ""}
          </div>
        </div>
      </div>`;
  }).join("");
}

window.filterChats = function() {
  const q = document.getElementById("search-input").value.toLowerCase();
  document.querySelectorAll(".chat-item").forEach(el => {
    el.style.display = el.querySelector(".ci-name").textContent.toLowerCase().includes(q) ? "" : "none";
  });
};

window.switchTab = function(tab, el) {
  activeTab = tab;
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  el.classList.add("active");
  loadChatList();
};



// ─────────────────────────────────────────────────────────
//  OPEN CHAT
// ─────────────────────────────────────────────────────────
window.openChat = async function(chatId, type) {
  if (chatListeners.messages) { off(chatListeners.messages.ref); }

  currentChat = { id: chatId, type };

  // Instant header from user_chats metadata (no waiting)
  const metaSnap = await get(ref(db, `user_chats/${currentUser.uid}/${chatId}`));
  const meta = metaSnap.val() || {};
  currentChat.name   = meta.name   || "Chat";
  currentChat.avatar = meta.avatar || "?";
  updateChatHeader(currentChat.name, currentChat.avatar, "...", false);

  if (type === "private") {
    const snap   = await get(ref(db, `chats/${chatId}`));
    const data   = snap.val() || {};
    const members = Array.isArray(data.members) ? data.members : Object.values(data.members || {});
    const peerId = members.find(m => m !== currentUser.uid);
    if (peerId) {
      const peerSnap = await get(ref(db, `users/${peerId}`));
      const peer     = peerSnap.val() || {};
      currentChat.name   = peer.name   || meta.name || "Unknown";
      currentChat.avatar = peer.avatar || meta.avatar || "?";
      currentChat.peerId = peerId;
      updateChatHeader(currentChat.name, currentChat.avatar, peer.online ? "Online" : formatLastSeen(peer.lastSeen), peer.online);

      onValue(ref(db, `users/${peerId}/online`), s => {
        const online = s.val();
        document.getElementById("chat-status").textContent = online ? "Online" : "Last seen recently";
        document.getElementById("chat-status").style.color = online ? "var(--accent)" : "var(--text-secondary)";
      });
    }
  } else {
    const snap = await get(ref(db, `groups/${chatId}`));
    const g    = snap.val() || {};
    currentChat.name   = g.name   || meta.name || "Group";
    currentChat.avatar = g.avatar || meta.avatar || "👥";
    updateChatHeader(currentChat.name, currentChat.avatar, `${(g.members||[]).length} members`, false);
  }

  // 👇 BUG FIXED HERE 👇
  document.getElementById("welcome-screen").style.display = "none";
  document.getElementById("chat-view").classList.remove("hidden");

  if (window.innerWidth <= 700) {
    document.getElementById("sidebar").classList.add("hidden-mobile");
    document.querySelector(".back-btn")?.classList.remove("hidden");
  }

  update(ref(db, `user_chats/${currentUser.uid}/${chatId}`), { unread: 0 });
  loadMessages(chatId, type);
};

function updateChatHeader(name, avatar, status, online) {
  document.getElementById("chat-name").textContent   = name;
  document.getElementById("chat-status").textContent = status;
  document.getElementById("chat-status").style.color = online ? "var(--accent)" : "var(--text-secondary)";
  document.getElementById("chat-avatar").textContent = avatar;
}

window.backToList = function() {
  // 👇 BUG FIXED HERE 👇
  document.getElementById("sidebar").classList.remove("hidden-mobile");
  document.getElementById("chat-view").classList.add("hidden"); 
  document.getElementById("welcome-screen").style.display = "";
  currentChat = null;
};

// ─────────────────────────────────────────────────────────
//  MESSAGES
// ─────────────────────────────────────────────────────────
function loadMessages(chatId, type) {
  const msgRef = ref(db, `messages/${chatId}`);
  chatListeners.messages = { ref: msgRef };

  const container = document.getElementById("messages-list");
  container.innerHTML = "";

  onValue(msgRef, (snap) => {
    const msgs = snap.val() || {};
    const arr  = Object.entries(msgs)
      .map(([id, m]) => ({ id, ...m }))
      .sort((a, b) => a.timestamp - b.timestamp);

    const area     = document.getElementById("messages-area");
    const atBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 60;

    container.innerHTML = "";
    let lastDate = "";

    arr.forEach(msg => {
      const msgDate = new Date(msg.timestamp).toLocaleDateString("en-IN", { weekday:"long", day:"numeric", month:"short" });
      if (msgDate !== lastDate) {
        lastDate = msgDate;
        const div = document.createElement("div");
        div.className = "msg-date-divider";
        div.innerHTML = `<span>${msgDate}</span>`;
        container.appendChild(div);
      }

      const el = buildMessageEl(msg, type);
      container.appendChild(el);

      if (msg.senderId !== currentUser.uid && msg.status !== "seen") {
        update(ref(db, `messages/${chatId}/${msg.id}`), { status: "seen" });
      }
    });

    if (atBottom || arr.length <= 20) {
      setTimeout(() => area.scrollTop = area.scrollHeight, 50);
    }
  });

  if (type === "private" && currentChat.peerId) {
    onValue(ref(db, `typing/${chatId}/${currentChat.peerId}`), (s) => {
      const isTyping = s.val();
      document.getElementById("typing-indicator").classList.toggle("hidden", !isTyping);
    });
  }
}

function buildMessageEl(msg, type) {
  const isOut = msg.senderId === currentUser.uid;
  const div   = document.createElement("div");
  div.className = `message ${isOut ? "outgoing" : "incoming"}`;

  const ticks      = isOut ? getTickHTML(msg.status) : "";
  const time       = formatTime(msg.timestamp);
  const senderName = (!isOut && type === "group" && msg.senderName)
    ? `<div class="msg-sender-name">${esc(msg.senderName)}</div>` : "";

  div.innerHTML = `
    <div class="msg-bubble">
      ${senderName}
      <div class="msg-text">${formatMsgText(msg.text)}</div>
      <div class="msg-meta">
        <span class="msg-time">${time}</span>
        ${ticks}
      </div>
    </div>`;
  return div;
}

function getTickHTML(status) {
  if (status === "seen")      return `<span class="msg-ticks seen">✓✓</span>`;
  if (status === "delivered") return `<span class="msg-ticks delivered">✓✓</span>`;
  return `<span class="msg-ticks">✓</span>`;
}

function formatMsgText(text) {
  return esc(text).replace(/\n/g, "<br>");
}

// ─────────────────────────────────────────────────────────
//  SEND MESSAGE
// ─────────────────────────────────────────────────────────
window.sendMessage = async function() {
  const input = document.getElementById("message-input");
  const text  = input.value.trim();
  if (!text || !currentChat) return;

  input.value = "";
  autoResize(input);
  clearTyping();

  const chatId = currentChat.id;
  const uid    = currentUser.uid;
  const msgKey = push(ref(db, `messages/${chatId}`)).key;
  const ts     = Date.now();

  const msg = {
    text,
    senderId:   uid,
    senderName: currentUser.name,
    timestamp:  ts,
    status:     "sent"
  };

  await set(ref(db, `messages/${chatId}/${msgKey}`), msg);

  const members = await getChatMembers(chatId, currentChat.type);
  const preview = text.length > 40 ? text.slice(0,40)+"…" : text;

  for (const memberId of members) {
    const isMe       = memberId === uid;
    const updateData = {
      lastMessage:     preview,
      lastMessageTime: ts,
      type:            currentChat.type,
      name:            isMe ? currentChat.name : currentUser.name,
      avatar:          isMe ? currentChat.avatar : currentUser.avatar,
    };
    if (!isMe) {
      const uSnap = await get(ref(db, `user_chats/${memberId}/${chatId}/unread`));
      updateData.unread = (uSnap.val() || 0) + 1;
      if (currentChat.type === "private") {
        updateData.name   = currentUser.name;
        updateData.avatar = currentUser.avatar;
      } else {
        updateData.name   = currentChat.name;
        updateData.avatar = currentChat.avatar;
      }
    }
    await update(ref(db, `user_chats/${memberId}/${chatId}`), updateData);
  }

  setTimeout(() => {
    update(ref(db, `messages/${chatId}/${msgKey}`), { status: "delivered" });
  }, 800);
};

async function getChatMembers(chatId, type) {
  const path = type === "group" ? `groups/${chatId}/members` : `chats/${chatId}/members`;
  const snap  = await get(ref(db, path));
  return snap.val() || [];
}

// ─────────────────────────────────────────────────────────
//  TYPING INDICATOR
// ─────────────────────────────────────────────────────────
window.handleTyping = function() {
  if (!currentChat || currentChat.type !== "private") return;
  const chatId = currentChat.id;
  const uid    = currentUser.uid;
  set(ref(db, `typing/${chatId}/${uid}`), true);
  clearTimeout(typingTimer);
  typingTimer = setTimeout(clearTyping, 2500);
};

function clearTyping() {
  if (!currentChat) return;
  clearTimeout(typingTimer);
  set(ref(db, `typing/${currentChat.id}/${currentUser.uid}`), false);
}

// ─────────────────────────────────────────────────────────
//  NEW CHAT (by phone number) — same as before
// ─────────────────────────────────────────────────────────
window.openNewChat = function() {
  document.getElementById("search-phone").value = "";
  document.getElementById("user-search-result").innerHTML = "";
  document.getElementById("new-chat-modal").classList.remove("hidden");
};

let searchDebounce = null;
window.searchUserByPhone = function() {
  const phone  = document.getElementById("search-phone").value.trim();
  const result = document.getElementById("user-search-result");

  clearTimeout(searchDebounce);
  if (phone.length < 10) { result.innerHTML = ""; return; }

  result.innerHTML = '<div class="spinner" style="margin:12px auto"></div>';
  searchDebounce = setTimeout(async () => {
    const uidSnap = await get(ref(db, `phone_index/${phone}`));
    if (!uidSnap.exists()) {
      result.innerHTML = `<p style="color:var(--text-muted);font-size:0.85rem;text-align:center;margin-top:12px">Koi nahi mila is number pe 😕</p>`;
      return;
    }
    const uid = uidSnap.val();
    if (uid === currentUser.uid) {
      result.innerHTML = `<p style="color:var(--text-muted);font-size:0.85rem;text-align:center;margin-top:12px">Ye toh tera hi number hai 😂</p>`;
      return;
    }
    const userSnap = await get(ref(db, `users/${uid}`));
    const user     = userSnap.val() || {};
    result.innerHTML = `
      <div class="user-found-card">
        <div class="avatar-sm">${user.avatar || "?"}</div>
        <div class="user-found-info">
          <strong>${esc(user.name)}</strong>
          <span>${user.status || ""}</span>
        </div>
        <button class="start-chat-btn" onclick="startPrivateChat('${uid}')">Chat Karo</button>
      </div>`;
  }, 500);
};

window.startPrivateChat = async function(peerId) {
  closeModal("new-chat-modal");
  const chatId   = [currentUser.uid, peerId].sort().join("_");
  const peerSnap = await get(ref(db, `users/${peerId}`));
  const peer     = peerSnap.val() || {};

  await update(ref(db, `chats/${chatId}`), {
    members:   [currentUser.uid, peerId],
    type:      "private",
    createdAt: Date.now()
  });
  await update(ref(db, `user_chats/${currentUser.uid}/${chatId}`), {
    type: "private", name: peer.name, avatar: peer.avatar || "?",
    lastMessageTime: Date.now()
  });
  await update(ref(db, `user_chats/${peerId}/${chatId}`), {
    type: "private", name: currentUser.name, avatar: currentUser.avatar || "?",
    lastMessageTime: Date.now()
  });

  openChat(chatId, "private");
};

// ─────────────────────────────────────────────────────────
//  NEW GROUP
// ─────────────────────────────────────────────────────────
window.openNewGroup = function() {
  groupPendingMembers = [];
  document.getElementById("group-name-input").value    = "";
  document.getElementById("group-search-phone").value  = "";
  document.getElementById("group-search-result").innerHTML = "";
  document.getElementById("group-members-list").innerHTML  = "";
  document.getElementById("new-group-modal").classList.remove("hidden");
};

let groupSearchDebounce = null;
window.searchGroupMember = function() {
  const phone  = document.getElementById("group-search-phone").value.trim();
  const result = document.getElementById("group-search-result");
  clearTimeout(groupSearchDebounce);
  if (phone.length < 10) { result.innerHTML = ""; return; }

  result.innerHTML = '<div class="spinner" style="margin:12px auto"></div>';
  groupSearchDebounce = setTimeout(async () => {
    const uidSnap = await get(ref(db, `phone_index/${phone}`));
    if (!uidSnap.exists()) { result.innerHTML = `<p style="color:var(--text-muted);font-size:0.85rem">Nahi mila</p>`; return; }
    const uid = uidSnap.val();
    if (uid === currentUser.uid || groupPendingMembers.find(m => m.uid === uid)) {
      result.innerHTML = `<p style="color:var(--text-muted);font-size:0.85rem">Pehle se add hai</p>`; return;
    }
    const userSnap = await get(ref(db, `users/${uid}`));
    const user     = userSnap.val() || {};
    result.innerHTML = `
      <div class="user-found-card">
        <div class="avatar-sm">${user.avatar || "?"}</div>
        <div class="user-found-info"><strong>${esc(user.name)}</strong></div>
        <button class="start-chat-btn" onclick="addGroupMember('${uid}','${esc(user.name)}','${user.avatar||"?"}')">Add Karo</button>
      </div>`;
  }, 500);
};

window.addGroupMember = function(uid, name, avatar) {
  groupPendingMembers.push({ uid, name, avatar });
  renderGroupMembers();
  document.getElementById("group-search-phone").value      = "";
  document.getElementById("group-search-result").innerHTML = "";
};

function renderGroupMembers() {
  const list = document.getElementById("group-members-list");
  list.innerHTML = groupPendingMembers.map((m, i) => `
    <div class="member-chip">
      <span>${m.avatar}</span>
      <span>${esc(m.name)}</span>
      <button onclick="removeGroupMember(${i})">✕</button>
    </div>`).join("");
}

window.removeGroupMember = function(i) {
  groupPendingMembers.splice(i, 1);
  renderGroupMembers();
};

window.createGroup = async function() {
  const name = document.getElementById("group-name-input").value.trim();
  if (!name)                        { showToast("Group ka naam daal");      return; }
  if (!groupPendingMembers.length)  { showToast("Koi member add karo pehle"); return; }

  const members = [currentUser.uid, ...groupPendingMembers.map(m => m.uid)];
  const groupRef = push(ref(db, "groups"));
  const groupId  = groupRef.key;
  const ts       = Date.now();

  await set(groupRef, { name, avatar: "👥", members, createdBy: currentUser.uid, createdAt: ts });

  for (const uid of members) {
    await update(ref(db, `user_chats/${uid}/${groupId}`), {
      type: "group", name, avatar: "👥", lastMessageTime: ts
    });
  }

  closeModal("new-group-modal");
  showToast(`Group "${name}" ban gaya! 🎉`);
  openChat(groupId, "group");
};

// ─────────────────────────────────────────────────────────
//  PROFILE
// ─────────────────────────────────────────────────────────
window.openProfile = function() {
  const u = currentUser;
  document.getElementById("profile-avatar-big").textContent    = u.avatar || "?";
  document.getElementById("profile-name-display").textContent  = u.name   || "—";
  document.getElementById("profile-phone-display").textContent = u.phone  || "—";
  document.getElementById("profile-email-display").textContent = u.email  || "—";
  document.getElementById("profile-status-display").textContent = u.status || "—";
  document.getElementById("profile-modal").classList.remove("hidden");
};

function updateSidebarAvatar() {
  document.getElementById("sidebar-avatar").textContent = currentUser?.avatar || "?";
}

window.openChatInfo = async function() {
  if (!currentChat) return;
  
  const modal           = document.getElementById("chat-info-modal");
  const nameDisp        = document.getElementById("info-name-display");
  const avatarDisp      = document.getElementById("info-avatar-big");
  const extraDisp       = document.getElementById("info-extra-display");
  const statusDisp      = document.getElementById("info-status-display");
  const groupMemSection = document.getElementById("info-group-members");
  const groupMemList    = document.getElementById("info-members-list-container");

  // Basic Info set karo
  nameDisp.textContent   = currentChat.name;
  avatarDisp.textContent = currentChat.avatar;
  
  // Reset purana data
  extraDisp.textContent  = "Loading...";
  statusDisp.textContent = "";
  groupMemSection.classList.add("hidden");
  groupMemList.innerHTML = "";

  if (currentChat.type === "private" && currentChat.peerId) {
    // PRIVATE CHAT LOGIC
    const peerSnap = await get(ref(db, `users/${currentChat.peerId}`));
    const peer     = peerSnap.val() || {};
    
    extraDisp.textContent  = peer.phone || "Number hidden";
    statusDisp.textContent = peer.status ? `"${peer.status}"` : "Hey, BhaiChara pe hoon!";
    
  } else if (currentChat.type === "group") {
    // GROUP CHAT LOGIC
    const groupSnap = await get(ref(db, `groups/${currentChat.id}`));
    const group     = groupSnap.val() || {};
    const members   = group.members || [];
    
    extraDisp.textContent  = `${members.length} Members`;
    statusDisp.textContent = "👥 Group Chat";
    
    groupMemSection.classList.remove("hidden");
    
    let membersHtml = "";
    for (const uid of members) {
      const userSnap = await get(ref(db, `users/${uid}`));
      const user     = userSnap.val() || { name: "Unknown", avatar: "👤" };
      const role     = (uid === group.createdBy) ? `<span style="font-size:0.7rem; background:rgba(0,229,160,0.15); color:var(--accent); padding:2px 6px; border-radius:10px; margin-left:6px;">Admin</span>` : "";
      const isMe     = (uid === currentUser.uid) ? " (You)" : "";
      
      membersHtml += `
        <div class="user-found-card" style="margin-bottom:8px; padding:10px; background: var(--bg-elevated); border: none;">
          <div class="avatar-sm" style="width:36px; height:36px; font-size:1rem;">${user.avatar}</div>
          <div class="user-found-info">
            <strong style="font-size:0.9rem; color: var(--text-primary);">${esc(user.name)}${isMe}</strong>
            ${role}
          </div>
        </div>`;
    }
    groupMemList.innerHTML = membersHtml;
  }
  
  modal.classList.remove("hidden");
};

// ────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────
//  LOGOUT
// ─────────────────────────────────────────────────────────
window.logout = async function() {
  if (presenceRef) set(presenceRef, false); // User ko turant offline dikhao
  await signOut(auth); // Firebase se logout
  
  // Dono modal band kar do (chahe jahan se bhi logout dabaya ho)
  closeModal("profile-modal");
  closeModal("settings-modal"); 
  
  currentUser = null; 
  currentChat = null;
  
  showToast("Phir milenge bhai! 👋");
  // Note: onAuthStateChanged automatically 'auth' screen (email wala) dikha dega
};


// ─────────────────────────────────────────────────────────
//  EMOJI
// ─────────────────────────────────────────────────────────
function populateEmojiGrid(containerId, list, onPick) {
  const container = document.getElementById(containerId);
  if (!container) return;
  list.forEach(e => {
    const span    = document.createElement("span");
    span.textContent = e;
    span.onclick  = () => onPick(e);
    container.appendChild(span);
  });
}

window.toggleEmojiKeyboard = function() {
  document.getElementById("emoji-keyboard").classList.toggle("hidden");
};

function insertEmoji(emoji) {
  const input = document.getElementById("message-input");
  const start = input.selectionStart;
  const end   = input.selectionEnd;
  input.value = input.value.slice(0, start) + emoji + input.value.slice(end);
  input.selectionStart = input.selectionEnd = start + emoji.length;
  input.focus();
}


// ─────────────────────────────────────────────────────────
//  QUICK SETTINGS (CLEAR CHAT)
// ─────────────────────────────────────────────────────────
window.openChatQuickSettings = function() {
  if (!currentChat) return;
  document.getElementById("chat-quick-settings-modal").classList.remove("hidden");
};

window.clearChat = async function() {
  if (!currentChat) return;
  
  // Browser ka default confirm dialog use karenge
  const confirmClear = window.confirm("Sach mein saare messages clear karne hain? (Dono ki taraf se chat saaf ho jayegi)");
  
  if (!confirmClear) return;

  const chatId = currentChat.id;
  
  try {
    // 1. Firebase se messages node delete karo
    await set(ref(db, `messages/${chatId}`), null);
    
    // 2. Chat list preview mein "Chat cleared" update karo (Taki empty na lage)
    const clearPreview = {
      lastMessage: "🚫 Chat cleared",
      lastMessageTime: Date.now()
    };

    if (currentChat.type === "private" && currentChat.peerId) {
       await update(ref(db, `user_chats/${currentUser.uid}/${chatId}`), clearPreview);
       await update(ref(db, `user_chats/${currentChat.peerId}/${chatId}`), clearPreview);
    } else if (currentChat.type === "group") {
       const membersSnap = await get(ref(db, `groups/${chatId}/members`));
       const members = membersSnap.val() || [];
       for(let mId of members) {
          await update(ref(db, `user_chats/${mId}/${chatId}`), clearPreview);
       }
    }

    closeModal('chat-quick-settings-modal');
    showToast("Chat saaf kar di gayi! 🧹");
  } catch (e) {
    showToast("Error: " + e.message);
  }
};

// ─────────────────────────────────────────────────────────
//  SETTINGS MODAL LOGIC
// ─────────────────────────────────────────────────────────
window.openSettings = function() {
  const u = currentUser;
  
  // Pehle se set values ko inputs mein daalo
  document.getElementById("setting-name-input").value   = u.name || "";
  document.getElementById("setting-status-input").value = u.status || "";
  
  // Read-only info update karo
  document.getElementById("setting-phone-display").textContent = u.phone || "Number nahi hai";
  document.getElementById("setting-email-display").textContent = u.email || "Email nahi hai";
  
  // Modal open karo
  document.getElementById("settings-modal").classList.remove("hidden");
};

window.saveSettings = async function() {
  const newName   = document.getElementById("setting-name-input").value.trim();
  const newStatus = document.getElementById("setting-status-input").value.trim();

  if (!newName) { 
    showToast("Naam khali nahi chhod sakte bhai!"); 
    return; 
  }

  try {
    // Firebase mein update
    await update(ref(db, `users/${currentUser.uid}`), {
      name: newName,
      status: newStatus
    });

    // Local state update
    currentUser.name   = newName;
    currentUser.status = newStatus;

    showToast("Settings save ho gayi! 🔥");
    closeModal("settings-modal");
  } catch (error) {
    showToast("Error aaya yaar: " + error.message);
  }
};


// ─────────────────────────────────────────────────────────
//  UI HELPERS
// ─────────────────────────────────────────────────────────
window.autoResize = function(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 120) + "px";
};

window.handleKeyDown = function(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
};

window.closeModal = function(id) {
  document.getElementById(id).classList.add("hidden");
};

function showToast(msg, duration = 3000) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add("hidden"), duration);
}

function formatTime(ts) {
  if (!ts) return "";
  const d   = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit", hour12:true });
  return d.toLocaleDateString("en-IN", { day:"numeric", month:"short" });
}

function formatLastSeen(ts) {
  if (!ts) return "Offline";
  return "Last seen " + formatTime(ts);
}

function esc(str) {
  if (!str) return "";
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ─────────────────────────────────────────────────────────
//  BHAI NOTIFICATIONS (SOUND + PUSH)
// ─────────────────────────────────────────────────────────
window.askNotificationPermission = function() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
};

window.triggerBhaiNotification = function(title, body) {
  // 1. Futuristic Blip Sound (Bina kisi .mp3 file ke) 🎵
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, ctx.currentTime); // Base pitch
    osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1); // Slide up
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1); // Fade out
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  } catch (e) {
    console.log("Sound bajne me issue: ", e);
  }

  // 2. Browser Push Notification with Random Emoji 🤙
  if ("Notification" in window && Notification.permission === "granted") {
    const emojis = ["🤙", "🔥", "😎", "💪", "⚡", "🚀", "🎯"];
    const randEmoji = emojis[Math.floor(Math.random() * emojis.length)];
    
    new Notification(`${randEmoji} ${title} bola:`, {
      body: body,
      vibrate: [200, 100, 200] // Phone vibrate hoga
    });
  }
};

// Global exports 
window.sendMagicLink   = window.sendMagicLink;
window.backToEmail     = window.backToEmail;
window.saveProfile     = window.saveProfile;
window.pickAvatar      = window.pickAvatar;
window.openNewChat     = window.openNewChat;
window.openNewGroup    = window.openNewGroup;
window.openProfile     = window.openProfile;
window.logout          = window.logout;
window.filterChats     = window.filterChats;
window.switchTab       = window.switchTab;
window.sendMessage     = window.sendMessage;
window.handleTyping    = window.handleTyping;
window.autoResize      = window.autoResize;
window.handleKeyDown   = window.handleKeyDown;
window.toggleEmojiKeyboard = window.toggleEmojiKeyboard;
window.closeModal      = window.closeModal;
window.openChat        = window.openChat;
window.backToList      = window.backToList;
window.startPrivateChat   = window.startPrivateChat;
window.searchUserByPhone  = window.searchUserByPhone;
window.searchGroupMember  = window.searchGroupMember;
window.addGroupMember     = window.addGroupMember;
window.removeGroupMember  = window.removeGroupMember;
window.createGroup        = window.createGroup;
window.openChatInfo       = window.openChatInfo;
window.openSettings    = window.openSettings;
window.saveSettings    = window.saveSettings;
window.openChatQuickSettings = window.openChatQuickSettings;
window.clearChat             = window.clearChat;
