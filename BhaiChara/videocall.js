// ╔══════════════════════════════════════════════════════╗
// ║  BhaiChara — videocall.js                            ║
// ║  WebRTC Peer-to-Peer Video Call (1v1 only)           ║
// ║  Firebase = Signaling server (no backend needed)     ║
// ╚══════════════════════════════════════════════════════╝

import { getDatabase, ref, set, get, onValue, off, update, remove, push } from
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// ── State ──────────────────────────────────────────────
let _db           = null;
let _currentUser  = null;
let _getCurrentChat = null;

let peerConn      = null;   // RTCPeerConnection
let localStream   = null;   // camera + mic
let remoteStream  = null;
let callRef       = null;   // Firebase ref for this call
let callListener  = null;
let incomingCallId = null;

let isMuted       = false;
let isCamOff      = false;
let callTimer     = null;
let callSeconds   = 0;

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ]
};

// ── Init ───────────────────────────────────────────────
export function initVideoCall(db, currentUser, getCurrentChat) {
  _db             = db;
  _currentUser    = currentUser;
  _getCurrentChat = getCurrentChat;

  // Incoming call listener — apne uid pe sunna
  listenIncomingCalls();
}

// ─────────────────────────────────────────────────────────
//  INCOMING CALL LISTENER (always on jab app open ho)
// ─────────────────────────────────────────────────────────
function listenIncomingCalls() {
  const uid = _currentUser.uid;
  const incomingRef = ref(_db, `calls/incoming/${uid}`);

  onValue(incomingRef, async snap => {
    if (!snap.exists()) return;
    const data = snap.val();
    if (!data || data.status !== "ringing") return;

    // Apna hi call ignore karo
    if (data.callerId === uid) return;

    incomingCallId = data.callId;
    showIncomingCallUI(data);
  });
}

// ─────────────────────────────────────────────────────────
//  START CALL (caller side)
// ─────────────────────────────────────────────────────────
window.startVideoCall = async function() {
  const chat = _getCurrentChat();
  if (!chat || chat.type !== "private") {
    showCallToast("Video call sirf 1v1 private chat mein hoti hai bhai!");
    return;
  }

  const peerId = chat.peerId;
  if (!peerId) { showCallToast("Peer nahi mila!"); return; }

  // Camera + mic lao
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch(e) {
    showCallToast("Camera/mic permission do bhai! 📸🎙️");
    return;
  }

  const callId = push(ref(_db, "calls/sessions")).key;
  callRef = ref(_db, `calls/sessions/${callId}`);

  // Setup peer connection
  setupPeerConnection(callId, true, peerId);

  // Local video dikhao
  openCallUI(true, chat.name, chat.avatar);
  document.getElementById("vc-local-video").srcObject = localStream;

  // Create SDP offer
  const offer = await peerConn.createOffer();
  await peerConn.setLocalDescription(offer);

  // Firebase pe call data store karo
  await set(callRef, {
    callId,
    callerId:    _currentUser.uid,
    callerName:  _currentUser.name,
    callerAvatar: _currentUser.avatar || "?",
    receiverId:  peerId,
    status:      "ringing",
    offer:       { type: offer.type, sdp: offer.sdp },
    createdAt:   Date.now(),
  });

  // Receiver ke incoming node pe bhi likhao
  await set(ref(_db, `calls/incoming/${peerId}`), {
    callId,
    callerId:    _currentUser.uid,
    callerName:  _currentUser.name,
    callerAvatar: _currentUser.avatar || "?",
    status:      "ringing",
  });

  // Listen for answer / ice candidates
  listenCallUpdates(callId, true, peerId);

  showCallToast("📞 Ring ho rahi hai...");
  startRingSound();
};

// ─────────────────────────────────────────────────────────
//  ACCEPT CALL (receiver side)
// ─────────────────────────────────────────────────────────
window.acceptVideoCall = async function() {
  if (!incomingCallId) return;
  hideIncomingCallUI();
  stopRingSound();

  const callId = incomingCallId;
  callRef = ref(_db, `calls/sessions/${callId}`);
  const snap = await get(callRef);
  if (!snap.exists()) { showCallToast("Call expire ho gayi!"); return; }
  const callData = snap.val();

  // Camera + mic lao
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch(e) {
    showCallToast("Camera/mic permission do bhai! 📸🎙️");
    await update(callRef, { status: "ended" });
    return;
  }

  // Setup peer connection
  setupPeerConnection(callId, false, callData.callerId);

  // Open call UI
  openCallUI(false, callData.callerName, callData.callerAvatar);
  document.getElementById("vc-local-video").srcObject = localStream;

  // Set remote offer
  await peerConn.setRemoteDescription(new RTCSessionDescription(callData.offer));

  // Create answer
  const answer = await peerConn.createAnswer();
  await peerConn.setLocalDescription(answer);

  // Firebase pe answer store karo
  await update(callRef, {
    status: "active",
    answer: { type: answer.type, sdp: answer.sdp },
  });

  // Caller ke incoming node pe status update
  await update(ref(_db, `calls/incoming/${callData.callerId}`), { status: "accepted" });

  listenCallUpdates(callId, false, callData.callerId);
  startCallTimer();
};

// ─────────────────────────────────────────────────────────
//  DECLINE CALL
// ─────────────────────────────────────────────────────────
window.declineVideoCall = async function() {
  stopRingSound();
  hideIncomingCallUI();
  if (!incomingCallId) return;

  const callId = incomingCallId;
  incomingCallId = null;

  const snap = await get(ref(_db, `calls/sessions/${callId}`));
  if (!snap.exists()) return;
  const callData = snap.val();

  await update(ref(_db, `calls/sessions/${callId}`), { status: "declined" });
  await remove(ref(_db, `calls/incoming/${_currentUser.uid}`));
  await update(ref(_db, `calls/incoming/${callData.callerId}`), { status: "declined" });
};

// ─────────────────────────────────────────────────────────
//  END CALL (both sides)
// ─────────────────────────────────────────────────────────
window.endVideoCall = async function() {
  stopCallTimer();
  stopRingSound();
  closeCallUI();
  cleanupPeer();

  if (callRef) {
    const snap = await get(callRef);
    if (snap.exists()) {
      const d = snap.val();
      await update(callRef, { status: "ended", endedAt: Date.now() });
      // Dono ke incoming nodes clean karo
      await remove(ref(_db, `calls/incoming/${_currentUser.uid}`));
      if (d.callerId && d.receiverId) {
        const otherId = d.callerId === _currentUser.uid ? d.receiverId : d.callerId;
        await remove(ref(_db, `calls/incoming/${otherId}`));
        await update(ref(_db, `calls/incoming/${otherId}`), { status: "ended" });
      }
    }
    callRef = null;
  }
};

// ─────────────────────────────────────────────────────────
//  WEBRTC SETUP
// ─────────────────────────────────────────────────────────
function setupPeerConnection(callId, isCaller, peerId) {
  peerConn = new RTCPeerConnection(ICE_SERVERS);

  // Local tracks add karo
  localStream.getTracks().forEach(track => peerConn.addTrack(track, localStream));

  // Remote stream setup
  remoteStream = new MediaStream();
  document.getElementById("vc-remote-video").srcObject = remoteStream;

  peerConn.ontrack = e => {
    e.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
    // Remote video aa gaya — loading hide karo
    document.getElementById("vc-connecting").classList.add("hidden");
    document.getElementById("vc-remote-video").classList.remove("hidden");
  };

  // ICE candidates Firebase pe bhejo
  peerConn.onicecandidate = async e => {
    if (!e.candidate) return;
    const candRef = push(ref(_db, `calls/sessions/${callId}/candidates/${_currentUser.uid}`));
    await set(candRef, e.candidate.toJSON());
  };

  peerConn.onconnectionstatechange = () => {
    const state = peerConn?.connectionState;
    if (state === "disconnected" || state === "failed" || state === "closed") {
      endVideoCall();
    }
  };
}

function listenCallUpdates(callId, isCaller, peerId) {
  const sessionRef = ref(_db, `calls/sessions/${callId}`);

  if (callListener) off(callListener);
  callListener = sessionRef;

  onValue(sessionRef, async snap => {
    if (!snap.exists()) return;
    const data = snap.val();

    // Caller: answer aaya toh set karo
    if (isCaller && data.answer && peerConn && !peerConn.remoteDescription) {
      await peerConn.setRemoteDescription(new RTCSessionDescription(data.answer));
      startCallTimer();
    }

    // Call ended / declined by other side
    if (data.status === "ended" || data.status === "declined") {
      if (data.status === "declined") showCallToast("📵 Call decline kar di!");
      endVideoCall();
    }

    // ICE candidates dono sides ke liye process karo
    const candidates = data.candidates?.[peerId];
    if (candidates && peerConn && peerConn.remoteDescription) {
      Object.values(candidates).forEach(async cand => {
        try {
          await peerConn.addIceCandidate(new RTCIceCandidate(cand));
        } catch(e) {}
      });
    }
  });
}

function cleanupPeer() {
  if (localStream)  { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (peerConn)     { peerConn.close(); peerConn = null; }
  if (callListener) { off(callListener); callListener = null; }
  incomingCallId = null;
  isMuted  = false;
  isCamOff = false;
}

// ─────────────────────────────────────────────────────────
//  CALL CONTROLS
// ─────────────────────────────────────────────────────────
window.toggleMute = function() {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
  const btn = document.getElementById("vc-mute-btn");
  btn.innerHTML = isMuted
    ? `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6"/><path d="M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>`
    : `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 1a3 3 0 013 3v8a3 3 0 01-6 0V4a3 3 0 013-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>`;
  btn.classList.toggle("vc-ctrl-off", isMuted);
  showCallToast(isMuted ? "🔇 Muted" : "🎙️ Unmuted");
};

window.toggleCamera = function() {
  if (!localStream) return;
  isCamOff = !isCamOff;
  localStream.getVideoTracks().forEach(t => t.enabled = !isCamOff);
  const btn = document.getElementById("vc-cam-btn");
  btn.innerHTML = isCamOff
    ? `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="1" y1="1" x2="23" y2="23"/><path d="M21 21H3a2 2 0 01-2-2V8a2 2 0 012-2h3m3-3h6l2 3h4a2 2 0 012 2v9.34"/><path d="M15 13a3 3 0 11-6 0"/></svg>`
    : `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`;
  btn.classList.toggle("vc-ctrl-off", isCamOff);
  showCallToast(isCamOff ? "📷 Camera off" : "📸 Camera on");
};

window.switchCamera = async function() {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  if (!videoTrack) return;

  const currentFacing = videoTrack.getSettings().facingMode;
  const newFacing = currentFacing === "user" ? "environment" : "user";

  try {
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: newFacing },
      audio: false
    });
    const newVideoTrack = newStream.getVideoTracks()[0];

    // Replace in peer connection
    if (peerConn) {
      const sender = peerConn.getSenders().find(s => s.track?.kind === "video");
      if (sender) await sender.replaceTrack(newVideoTrack);
    }

    // Replace in local stream
    localStream.removeTrack(videoTrack);
    videoTrack.stop();
    localStream.addTrack(newVideoTrack);
    document.getElementById("vc-local-video").srcObject = localStream;
    showCallToast("📷 Camera switched!");
  } catch(e) {
    showCallToast("Camera switch nahi hua: " + e.message);
  }
};

// ─────────────────────────────────────────────────────────
//  UI FUNCTIONS
// ─────────────────────────────────────────────────────────
function openCallUI(isCaller, peerName, peerAvatar) {
  const modal = document.getElementById("vc-modal");
  modal.classList.remove("hidden");
  document.getElementById("vc-peer-name").textContent   = peerName   || "Bhai";
  document.getElementById("vc-peer-avatar").textContent = peerAvatar || "?";
  document.getElementById("vc-connecting").classList.remove("hidden");
  document.getElementById("vc-remote-video").classList.add("hidden");
  document.getElementById("vc-status-text").textContent = isCaller ? "Ring ho rahi hai... 📞" : "Connecting...";
  document.getElementById("vc-timer").textContent = "0:00";
}

function closeCallUI() {
  const modal = document.getElementById("vc-modal");
  modal.classList.add("hidden");
  const localVid  = document.getElementById("vc-local-video");
  const remoteVid = document.getElementById("vc-remote-video");
  if (localVid)  localVid.srcObject  = null;
  if (remoteVid) remoteVid.srcObject = null;
}

function showIncomingCallUI(data) {
  const el = document.getElementById("vc-incoming");
  el.classList.remove("hidden");
  document.getElementById("vc-incoming-name").textContent   = data.callerName   || "Koi Bhai";
  document.getElementById("vc-incoming-avatar").textContent = data.callerAvatar || "?";
  startRingSound();
}

function hideIncomingCallUI() {
  document.getElementById("vc-incoming").classList.add("hidden");
}

// ─────────────────────────────────────────────────────────
//  CALL TIMER
// ─────────────────────────────────────────────────────────
function startCallTimer() {
  callSeconds = 0;
  if (callTimer) clearInterval(callTimer);
  const timerEl = document.getElementById("vc-timer");
  const statusEl = document.getElementById("vc-status-text");
  if (statusEl) statusEl.textContent = "Connected 🟢";
  callTimer = setInterval(() => {
    callSeconds++;
    const m = Math.floor(callSeconds / 60);
    const s = callSeconds % 60;
    if (timerEl) timerEl.textContent = `${m}:${String(s).padStart(2,"0")}`;
  }, 1000);
}

function stopCallTimer() {
  if (callTimer) { clearInterval(callTimer); callTimer = null; }
  callSeconds = 0;
}

// ─────────────────────────────────────────────────────────
//  RING SOUND (Web Audio API)
// ─────────────────────────────────────────────────────────
let _ringCtx = null, _ringInterval = null;

function startRingSound() {
  stopRingSound();
  function playRing() {
    try {
      if (!_ringCtx) _ringCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = _ringCtx;
      if (ctx.state === "suspended") ctx.resume();
      const now = ctx.currentTime;
      // Two-tone ring
      [880, 1100].forEach((freq, i) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, now + i * 0.18);
        gain.gain.linearRampToValueAtTime(0.18, now + i * 0.18 + 0.02);
        gain.gain.linearRampToValueAtTime(0, now + i * 0.18 + 0.15);
        osc.start(now + i * 0.18);
        osc.stop(now + i * 0.18 + 0.18);
      });
    } catch(e) {}
  }
  playRing();
  _ringInterval = setInterval(playRing, 2000);
}

function stopRingSound() {
  if (_ringInterval) { clearInterval(_ringInterval); _ringInterval = null; }
}

// ─────────────────────────────────────────────────────────
//  TOAST
// ─────────────────────────────────────────────────────────
function showCallToast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(t._vctimer);
  t._vctimer = setTimeout(() => t.classList.add("hidden"), 3000);
}
