/* ============================================================
   app.js  —  Raza Art Attendance PWA  —  Core Application Logic
   Handles: Staff Dashboard + Owner Dashboard + Shared Utils
   Firebase: Auth + Realtime Database + FCM
   ============================================================ */

import { initializeApp }                          from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut }   from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getDatabase, ref, get, set, push,
         update, onValue, serverTimestamp,
         query, orderByChild, equalTo,
         limitToLast, off }                       from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { getMessaging, getToken,
         onMessage }                              from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js';

// ════════════════════════════════════════════
//  FIREBASE CONFIG
// ════════════════════════════════════════════
const firebaseConfig = {
  apiKey:            "AIzaSyDXPi8I8U-kZzHTjyKz6mMVvYXS5iyJiA8",
  authDomain:        "attendance-3f53f.firebaseapp.com",
  databaseURL:       "https://attendance-3f53f-default-rtdb.asia-southeast1.firebasedatabase.app/",
  projectId:         "attendance-3f53f",
  storageBucket:     "attendance-3f53f.firebasestorage.app",
  messagingSenderId: "216445422563",
  appId:             "1:216445422563:web:b7b7aadf09a1b92d16aed6"
};

export const app      = initializeApp(firebaseConfig);
export const auth     = getAuth(app);
export const db       = getDatabase(app);
export let   messaging = null;

// FCM VAPID Key
const VAPID_KEY = 'BKAMT5HXxTKMaiEH1PPd9W5vfqVpRo1wvXuM5PFkhWUIwzx--7kDgU4lg8IK693LYyggdcmchrv1ziTSHX4K3Gk';

// ════════════════════════════════════════════
//  CONSTANTS
// ════════════════════════════════════════════
export const SHIFTS = {
  shift1:     { name: 'Shift 1',   start: '08:00', end: '13:00', label: '8:00 AM – 1:00 PM' },
  shift2:     { name: 'Shift 2',   start: '16:00', end: '20:30', label: '4:00 PM – 8:30 PM' },
  full_time:  { name: 'Full Time', start: '08:00', end: '20:30', label: '8:00 AM – 8:30 PM' }
};

const LATE_GRACE_MINUTES = 15; // minutes after shift start before "Late"

// ════════════════════════════════════════════
//  DATE / TIME UTILITIES
// ════════════════════════════════════════════

/** Returns today's date string: "YYYY-MM-DD" */
export function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/** Returns current HH:MM string (24h) */
export function timeNow() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Returns full timestamp string: "HH:MM:SS" */
export function timestampNow() {
  const d = new Date();
  return d.toLocaleTimeString('en-US', { hour12: false });
}

/** Formats a Date or ms timestamp to "HH:MM AM/PM" */
export function formatTime(ts) {
  if (!ts) return '--:--';
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

/** Formats a Date or ms timestamp to "DD MMM YYYY" */
export function formatDate(ts) {
  if (!ts) return '---';
  return new Date(ts).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Formats duration from ms to "Xh Ym" */
export function formatDuration(ms) {
  if (!ms || ms < 0) return '0h 0m';
  const totalMins = Math.floor(ms / 60000);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return `${h}h ${m}m`;
}

/** Returns day of week short label from YYYY-MM-DD */
export function dayLabel(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short' });
}

/** Compares time strings "HH:MM". Returns minutes difference (b - a). */
export function minutesDiff(a, b) {
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  return (bh * 60 + bm) - (ah * 60 + am);
}

/** Returns whether a time string is "late" compared to shift start */
export function isLate(checkinTime, shiftStart) {
  return minutesDiff(shiftStart, checkinTime) > LATE_GRACE_MINUTES;
}

/** Get array of YYYY-MM-DD strings for the past N days */
export function pastNDays(n) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    return d.toISOString().slice(0, 10);
  }).reverse();
}

// ════════════════════════════════════════════
//  TOAST NOTIFICATIONS
// ════════════════════════════════════════════
const toastContainer = document.getElementById('toastContainer');

export function showToast(msg, type = 'info', duration = 3500) {
  if (!toastContainer) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-8px) scale(0.95)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => toast.remove(), 280);
  }, duration);
}

// ════════════════════════════════════════════
//  LOADING OVERLAY
// ════════════════════════════════════════════
export function hideLoading() {
  const overlay = document.getElementById('loadingOverlay');
  if (!overlay) return;
  overlay.style.opacity = '0';
  overlay.style.transition = 'opacity 0.3s ease';
  setTimeout(() => (overlay.style.display = 'none'), 320);
}

export function showLoading(msg = 'LOADING...') {
  const overlay = document.getElementById('loadingOverlay');
  if (!overlay) return;
  const p = overlay.querySelector('p');
  if (p) p.textContent = msg;
  overlay.style.display = 'flex';
  overlay.style.opacity = '1';
}

// ════════════════════════════════════════════
//  MODAL HELPERS
// ════════════════════════════════════════════
export function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}

export function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

// Close modal on overlay click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
  }
});

// ════════════════════════════════════════════
//  OFFLINE BADGE
// ════════════════════════════════════════════
// Connectivity handled by Firebase .info/connected internally

// ════════════════════════════════════════════
//  SERVICE WORKER REGISTRATION
// ════════════════════════════════════════════
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/Raza_Art/firebase-messaging-sw.js', { scope: '/Raza_Art/' })
    .then(reg => {
      console.log('[App] SW registered:', reg.scope);
      // Listen for new SW updates
      reg.addEventListener('updatefound', () => {
        const newSW = reg.installing;
        newSW.addEventListener('statechange', () => {
          if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
            showToast('🔄 Update available! Refresh to get the latest version.', 'info', 8000);
          }
        });
      });
    })
    .catch(err => console.warn('[App] SW registration failed:', err));

  // Listen for messages from SW
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (!event.data) return;
    switch (event.data.type) {
      case 'NOTIFICATION_CLICK':
        handleNotificationClick(event.data);
        break;
      case 'SYNC_ATTENDANCE':
        flushPendingAttendance();
        break;
    }
  });
}

function handleNotificationClick(data) {
  // Re-navigate or highlight relevant section based on notification type
  console.log('[App] Notification clicked:', data);
}

// ════════════════════════════════════════════
//  FCM — Push Notifications Setup
// ════════════════════════════════════════════
export async function initMessaging(userId) {
  try {
    messaging = getMessaging(app);

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.log('[FCM] Notification permission denied');
      return null;
    }

    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: await navigator.serviceWorker.ready
    });

    if (token) {
      // Save FCM token to user record in DB
      await update(ref(db, `users/${userId}`), { fcmToken: token, lastTokenUpdate: Date.now() });
      console.log('[FCM] Token saved:', token.slice(0, 20) + '...');
    }

    // Foreground message handler
    onMessage(messaging, (payload) => {
      console.log('[FCM] Foreground message:', payload);
      const notif = payload.notification || {};
      const data  = payload.data || {};
      const type  = data.type || 'info';
      showToast(`${notif.title || 'WorkTrack'}: ${notif.body || ''}`, type);

      // Handle special foreground actions
      if (data.type === 'work_pressure') activatePressureBanner(notif.body);
    });

    return token;
  } catch (err) {
    console.warn('[FCM] Messaging init failed:', err);
    return null;
  }
}

// ════════════════════════════════════════════
//  WORK PRESSURE BANNER
// ════════════════════════════════════════════
export function activatePressureBanner(message) {
  const banner = document.getElementById('pressureBanner') || document.querySelector('.pressure-banner');
  if (!banner) return;
  banner.textContent = `⚡ ${message || 'HIGH WORKLOAD — ALL HANDS ON DECK'}`;
  banner.classList.add('active');
}

export function deactivatePressureBanner() {
  const banner = document.getElementById('pressureBanner') || document.querySelector('.pressure-banner');
  if (banner) banner.classList.remove('active');
}

// ════════════════════════════════════════════
//  AVATAR GENERATOR
// ════════════════════════════════════════════
export function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

const AVATAR_COLORS = [
  ['#00d4ff', '#a855f7'],
  ['#00ff88', '#00d4ff'],
  ['#ff8c00', '#ff4466'],
  ['#a855f7', '#ff4466'],
  ['#ffd700', '#ff8c00'],
];

export function getAvatarGradient(name) {
  if (!name) return AVATAR_COLORS[0];
  const idx = name.charCodeAt(0) % AVATAR_COLORS.length;
  return AVATAR_COLORS[idx];
}

export function createAvatar(name) {
  const [c1, c2] = getAvatarGradient(name);
  const el = document.createElement('div');
  el.className = 'att-avatar';
  el.style.background = `linear-gradient(135deg, ${c1}, ${c2})`;
  el.textContent = getInitials(name);
  return el;
}

// ════════════════════════════════════════════
//  STATUS BADGE GENERATOR
// ════════════════════════════════════════════
export function statusBadge(status) {
  const map = {
    present:  ['badge-present',  '✓ Present'],
    late:     ['badge-late',     '⚠ Late'],
    absent:   ['badge-absent',   '✗ Absent'],
    holiday:  ['badge-holiday',  '🏖 Holiday'],
    leave:    ['badge-leave',    '📋 Leave'],
    pending:  ['badge-pending',  '⏳ Pending'],
  };
  const [cls, label] = map[status] || ['badge-pending', status];
  return `<span class="badge ${cls}">${label}</span>`;
}

// ════════════════════════════════════════════
//  LIVE CLOCK
// ════════════════════════════════════════════
let clockInterval = null;

export function startClock(timeEl, dateEl) {
  if (!timeEl) return;
  const tick = () => {
    const now = new Date();
    timeEl.textContent = now.toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
    if (dateEl) {
      dateEl.textContent = now.toLocaleDateString('en-IN', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      });
    }
  };
  tick();
  clockInterval = setInterval(tick, 1000);
}

export function stopClock() {
  if (clockInterval) clearInterval(clockInterval);
}

// ════════════════════════════════════════════
//  SHIFT DETECTION
// ════════════════════════════════════════════
// 2:30 PM (14:30) cutoff:
// 00:00 – 14:29 → Shift 1  (morning side)
// 14:30 – 23:59 → Shift 2  (afternoon/evening side)
export function detectCurrentShift() {
  const t = timeNow();
  const [h, m] = t.split(':').map(Number);
  const mins = h * 60 + m;
  const CUTOFF = 14 * 60 + 30; // 14:30 = 2:30 PM
  return mins < CUTOFF ? 'shift1' : 'shift2';
}

export function getShiftLabel(shiftKey) {
  return SHIFTS[shiftKey]?.label || 'Unknown Shift';
}

// ════════════════════════════════════════════
//  ATTENDANCE — READ
// ════════════════════════════════════════════

/** Get today's attendance record for a specific user (returns merged/flat view) */
export async function getTodayAttendance(userId) {
  const snap = await get(ref(db, `attendance/${todayKey()}/${userId}`));
  if (!snap.exists()) return null;
  const val = snap.val();
  // New multi-shift format
  if (val.shift1 || val.shift2) return val;
  // Old flat format
  if (val.checkIn) return val;
  return null;
}

/** Get attendance for a user over N days */
export async function getAttendanceRange(userId, days = 30) {
  const dates = pastNDays(days);
  const results = {};
  await Promise.all(dates.map(async (date) => {
    const snap = await get(ref(db, `attendance/${date}/${userId}`));
    results[date] = snap.exists() ? snap.val() : null;
  }));
  return results;
}

/** Get all attendance records for today (owner view) */
export function listenTodayAllAttendance(callback) {
  const r = ref(db, `attendance/${todayKey()}`);
  onValue(r, (snap) => {
    callback(snap.exists() ? snap.val() : {});
  });
  return () => off(r); // returns unsubscribe fn
}

// ════════════════════════════════════════════
//  ATTENDANCE — WRITE (Staff)
// ════════════════════════════════════════════

/** Check IN for a staff member — supports multi-shift (shift1/shift2) per day */
export async function checkIn(userId, shiftKey, locationData = null) {
  const now = Date.now();
  const shift = SHIFTS[shiftKey];
  const late  = isLate(timeNow(), shift?.start || '08:00');

  const record = {
    userId,
    shiftKey,
    checkIn:     now,
    checkInTime: timeNow(),
    status:      late ? 'late' : 'present',
    late,
    location:    locationData,
    updatedAt:   serverTimestamp()
  };

  // Store per-shift: attendance/date/userId/shiftKey
  await set(ref(db, `attendance/${todayKey()}/${userId}/${shiftKey}`), record);
  return record;
}

/** Check OUT for a staff member — uses shiftKey to target correct record */
export async function checkOut(userId, shiftKey) {
  const now    = Date.now();
  const snap   = await get(ref(db, `attendance/${todayKey()}/${userId}/${shiftKey}`));
  if (!snap.exists()) throw new Error('No check-in record found for this shift.');

  const existing = snap.val();
  const duration = now - (existing.checkIn || now);

  const updates = {
    checkOut:      now,
    checkOutTime:  timeNow(),
    duration,
    updatedAt:     serverTimestamp()
  };

  await update(ref(db, `attendance/${todayKey()}/${userId}/${shiftKey}`), updates);
  return { ...existing, ...updates };
}

/** Get today's all shift records for a user — returns { shift1: {...}, shift2: {...} } */
export async function getTodayShiftRecords(userId) {
  const snap = await get(ref(db, `attendance/${todayKey()}/${userId}`));
  if (!snap.exists()) return {};
  const val = snap.val();
  // Support both old flat format and new per-shift format
  if (val.shift1 || val.shift2) return val; // new format
  // Old flat format — wrap it under detected shiftKey
  if (val.checkIn) return { [val.shiftKey || 'shift1']: val };
  return {};
}

/** Flush any locally-stored pending attendance (offline sync) */
export async function flushPendingAttendance() {
  const pending = JSON.parse(localStorage.getItem('wt_pending_attendance') || '[]');
  if (!pending.length) return;

  console.log('[App] Flushing', pending.length, 'pending attendance records...');
  for (const item of pending) {
    try {
      const shiftKey = item.record.shiftKey || 'shift1';
      await set(ref(db, `attendance/${item.date}/${item.userId}/${shiftKey}`), item.record);
    } catch (e) {
      console.warn('[App] Could not flush attendance:', e);
    }
  }
  localStorage.removeItem('wt_pending_attendance');
  showToast('✅ Offline attendance synced successfully!', 'success');
}

/** Save attendance locally for offline sync */
export function queueOfflineAttendance(userId, record) {
  const pending = JSON.parse(localStorage.getItem('wt_pending_attendance') || '[]');
  pending.push({ date: todayKey(), userId, record, queuedAt: Date.now() });
  localStorage.setItem('wt_pending_attendance', JSON.stringify(pending));
}

// ════════════════════════════════════════════
//  LEAVE REQUESTS
// ════════════════════════════════════════════

/** Submit a leave request */
export async function submitLeaveRequest(userId, userName, payload) {
  const leaveRef = push(ref(db, 'leave_requests'));
  const record = {
    id:        leaveRef.key,
    userId,
    userName,
    type:      payload.type   || 'casual',
    fromDate:  payload.from,
    toDate:    payload.to,
    reason:    payload.reason || '',
    status:    'pending',
    createdAt: serverTimestamp()
  };
  await set(leaveRef, record);
  return record;
}

/** Get leave requests for a user */
export async function getUserLeaveRequests(userId) {
  const snap = await get(query(
    ref(db, 'leave_requests'),
    orderByChild('userId'),
    equalTo(userId)
  ));
  return snap.exists() ? Object.values(snap.val()) : [];
}

/** Listen to all pending leave requests (owner) */
export function listenPendingLeaves(callback) {
  const r = query(ref(db, 'leave_requests'), orderByChild('status'), equalTo('pending'));
  onValue(r, (snap) => {
    callback(snap.exists() ? Object.values(snap.val()) : []);
  });
  return () => off(r);
}

/** Approve or reject a leave request (owner) */
export async function updateLeaveStatus(leaveId, status, ownerId) {
  await update(ref(db, `leave_requests/${leaveId}`), {
    status,
    reviewedBy: ownerId,
    reviewedAt: serverTimestamp()
  });
}

// ════════════════════════════════════════════
//  USERS
// ════════════════════════════════════════════

/** Get all staff users */
export async function getAllStaff() {
  const snap = await get(query(ref(db, 'users'), orderByChild('role'), equalTo('staff')));
  return snap.exists() ? Object.values(snap.val()) : [];
}

/** Get a single user's profile */
export async function getUserProfile(userId) {
  const snap = await get(ref(db, `users/${userId}`));
  return snap.exists() ? snap.val() : null;
}

/** Update user's FCM token and last-seen */
export async function updateUserPresence(userId) {
  await update(ref(db, `users/${userId}`), {
    lastSeen:  serverTimestamp(),
    isOnline:  true
  });

  // Mark offline on page close (best effort)
  window.addEventListener('beforeunload', () => {
    navigator.sendBeacon && navigator.sendBeacon('/api/offline', JSON.stringify({ userId }));
    update(ref(db, `users/${userId}`), { isOnline: false });
  });
}

// ════════════════════════════════════════════
//  HOLIDAYS & ANNOUNCEMENTS
// ════════════════════════════════════════════

/** Listen to active holidays */
export function listenHolidays(callback) {
  const r = ref(db, 'holidays');
  onValue(r, (snap) => {
    callback(snap.exists() ? Object.values(snap.val()) : []);
  });
  return () => off(r);
}

/** Listen to announcements (latest 10) */
export function listenAnnouncements(callback) {
  const r = query(ref(db, 'announcements'), limitToLast(10));
  onValue(r, (snap) => {
    callback(snap.exists() ? Object.values(snap.val()).reverse() : []);
  });
  return () => off(r);
}

/** Post a new announcement (owner) */
export async function postAnnouncement(ownerId, message, type = 'broadcast') {
  const r = push(ref(db, 'announcements'));
  await set(r, {
    id:        r.key,
    message,
    type,
    postedBy:  ownerId,
    createdAt: serverTimestamp()
  });
}

// ════════════════════════════════════════════
//  WORK PRESSURE MODE (Owner)
// ════════════════════════════════════════════

/** Toggle work pressure mode on/off */
export async function setWorkPressure(active, message = '') {
  await set(ref(db, 'settings/workPressure'), { active, message, updatedAt: serverTimestamp() });
}

/** Listen to work pressure state */
export function listenWorkPressure(callback) {
  const r = ref(db, 'settings/workPressure');
  onValue(r, (snap) => {
    callback(snap.exists() ? snap.val() : { active: false });
  });
  return () => off(r);
}

// ════════════════════════════════════════════
//  STATISTICS HELPERS
// ════════════════════════════════════════════

/** Calculate attendance stats for a user over a date range */
export function calcStats(attendanceMap) {
  // Helper to extract flat info from old or new format
  const flatten = (rec) => {
    if (!rec) return null;
    if (rec.shift1 || rec.shift2) {
      const shifts = [rec.shift1, rec.shift2].filter(Boolean);
      const totalDuration = shifts.reduce((sum, s) => sum + (s.duration || 0), 0);
      const status = shifts.find(s => s.status === 'late') ? 'late' : (shifts.find(s => s.checkIn) ? 'present' : 'absent');
      return { status, duration: totalDuration, checkIn: shifts[0]?.checkIn };
    }
    return rec;
  };

  const records = Object.values(attendanceMap).map(flatten).filter(Boolean);
  const total   = records.length;
  const present = records.filter(r => r?.status === 'present').length;
  const late    = records.filter(r => r?.status === 'late').length;
  const absent  = records.filter(r => !r || r.status === 'absent').length;
  const totalDuration = records.reduce((sum, r) => sum + (r?.duration || 0), 0);

  return {
    total,
    present,
    late,
    absent,
    totalDuration,
    attendanceRate: total > 0 ? Math.round(((present + late) / total) * 100) : 0,
    avgDuration:    total > 0 ? Math.round(totalDuration / total) : 0,
  };
}

/** Get today's summary for all staff (owner dashboard) */
export function calcDailySummary(todayAttendance, allStaff) {
  // todayAttendance[userId] can be:
  //   new format: { shift1: {...}, shift2: {...} }
  //   old format: { checkIn: ..., checkOut: ..., ... }
  const getFirstCheckIn = (rec) => {
    if (!rec) return null;
    if (rec.shift1?.checkIn || rec.shift2?.checkIn) {
      return rec.shift1?.checkIn || rec.shift2?.checkIn;
    }
    return rec.checkIn || null;
  };
  const isLateRecord = (rec) => {
    if (!rec) return false;
    if (rec.shift1 || rec.shift2) return !!(rec.shift1?.late || rec.shift2?.late);
    return !!rec.late;
  };

  const attended  = Object.values(todayAttendance).filter(r => getFirstCheckIn(r)).length;
  const lateCount = Object.values(todayAttendance).filter(r => isLateRecord(r)).length;
  const staffCount = Math.max(allStaff.length, attended);
  const absent     = Math.max(0, staffCount - attended);

  return { staffCount, attended, lateCount, absent };
}

// ════════════════════════════════════════════
//  GEOLOCATION
// ════════════════════════════════════════════

/** Get current position as a Promise */
export function getCurrentPosition(options = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy
      }),
      reject,
      { timeout: 10000, maximumAge: 60000, ...options }
    );
  });
}

/** Calculate distance between two lat/lng in metres */
export function geoDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) *
            Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ════════════════════════════════════════════
//  STORE LOCATION (Geo-fence)
// ════════════════════════════════════════════

/** Save store location to RTDB */
export async function saveStoreLocation(lat, lng, radiusMeters = 200) {
  await set(ref(db, 'settings/storeLocation'), { lat, lng, radius: radiusMeters });
}

/** Get store location from RTDB */
export async function getStoreLocation() {
  const snap = await get(ref(db, 'settings/storeLocation'));
  return snap.exists() ? snap.val() : null;
}

/** Check if staff is within store radius — returns {ok, distance} */
export async function checkStoreProximity(staffLat, staffLng) {
  const store = await getStoreLocation();
  if (!store) return { ok: true, distance: null }; // no location set = skip check
  const distance = Math.round(geoDistance(staffLat, staffLng, store.lat, store.lng));
  return { ok: distance <= (store.radius || 200), distance };
}



/** Update an SVG progress ring (circle element) */
export function updateProgressRing(circleEl, percent, radius = 54) {
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;
  circleEl.style.strokeDasharray  = `${circumference}`;
  circleEl.style.strokeDashoffset = `${offset}`;
}

// ════════════════════════════════════════════
//  LOGOUT
// ════════════════════════════════════════════
export async function logout() {
  try {
    const uid = auth.currentUser?.uid;
    if (uid) await update(ref(db, `users/${uid}`), { isOnline: false });
    await signOut(auth);
    window.location.replace('index.html');
  } catch (err) {
    console.error('[App] Logout error:', err);
    showToast('❌ Logout failed. Please try again.', 'error');
  }
}

// Wire up any logout buttons
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-action="logout"]').forEach(btn => {
    btn.addEventListener('click', () => logout());
  });
});

// ════════════════════════════════════════════
//  BOTTOM NAV — ACTIVE STATE
// ════════════════════════════════════════════
export function initBottomNav() {
  const items = document.querySelectorAll('.nav-item[data-section]');
  if (!items.length) return;

  items.forEach(item => {
    item.addEventListener('click', () => {
      items.forEach(i => i.classList.remove('active'));
      item.classList.add('active');

      // Show/hide sections
      const target = item.dataset.section;
      document.querySelectorAll('[data-tab]').forEach(tab => {
        tab.style.display = tab.dataset.tab === target ? 'block' : 'none';
      });

      // Scroll to top
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  // Set first item active by default
  items[0]?.click();
}

// ════════════════════════════════════════════
//  NOTIFICATION BELL — UNREAD COUNT
// ════════════════════════════════════════════
export function listenNotifCount(userId, bellEl) {
  const r = query(
    ref(db, `notifications/${userId}`),
    orderByChild('read'),
    equalTo(false)
  );
  onValue(r, (snap) => {
    const count = snap.exists() ? Object.keys(snap.val()).length : 0;
    const dot   = bellEl?.querySelector('.notif-dot');
    if (dot) dot.style.display = count > 0 ? 'block' : 'none';
  });
}

// ════════════════════════════════════════════
//  SCHEDULED CHECK-IN REMINDER (local)
//  Called via SW LOCAL_NOTIFICATION message
// ════════════════════════════════════════════
export function scheduleCheckinReminder(shiftKey, minutesBefore = 10) {
  const shift = SHIFTS[shiftKey];
  if (!shift) return;

  const [sh, sm] = shift.start.split(':').map(Number);
  const now      = new Date();
  const shiftMs  = new Date(now.getFullYear(), now.getMonth(), now.getDate(), sh, sm).getTime();
  const reminderMs = shiftMs - minutesBefore * 60000;
  const delay    = reminderMs - Date.now();

  if (delay <= 0) return; // Shift already started/passed

  setTimeout(() => {
    navigator.serviceWorker.ready.then(reg => {
      reg.active?.postMessage({
        type: 'LOCAL_NOTIFICATION',
        payload: {
          type:  'checkin_reminder',
          title: '⏰ Time to Check In!',
          body:  `${shift.name} starts in ${minutesBefore} minutes (${shift.start})`,
          url:   '/staff.html?action=checkin'
        }
      });
    });
  }, delay);
}

// ════════════════════════════════════════════
//  AUTH GUARD — Used by staff.html / owner.html
// ════════════════════════════════════════════

/**
 * Ensures user is authenticated with the expected role.
 * Redirects to index.html if not logged in or wrong role.
 * Resolves with { user, profile } on success.
 *
 * @param {'staff'|'owner'} expectedRole
 * @returns {Promise<{user, profile}>}
 */
export function requireAuth(expectedRole) {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        window.location.replace('index.html');
        return;
      }

      try {
        const profile = await getUserProfile(user.uid);

        if (!profile) {
          showToast('❌ Profile not found. Contact admin.', 'error');
          await signOut(auth);
          window.location.replace('index.html');
          return;
        }

        if (expectedRole && profile.role !== expectedRole) {
          // Wrong role — redirect to correct dashboard
          if (profile.role === 'owner') {
            window.location.replace('owner.html');
          } else {
            window.location.replace('staff.html');
          }
          return;
        }

        // Update presence — non-fatal, don't block auth on failure
        try {
          await updateUserPresence(user.uid);
        } catch (presenceErr) {
          console.warn('[App] Presence update failed (non-fatal):', presenceErr);
        }

        resolve({ user, profile });
      } catch (err) {
        console.error('[App] Auth guard error:', err);
        hideLoading();
        showToast('❌ Error loading profile. Please refresh.', 'error');
      }
    });
  });
}

// ════════════════════════════════════════════
//  INIT — Called on every page load
// ════════════════════════════════════════════
export async function initApp(role) {
  try {
    const { user, profile } = await requireAuth(role);
    hideLoading();

    if (role === 'staff') {
      await initStaffDashboard(user, profile);
    } else if (role === 'owner') {
      await initOwnerDashboard(user, profile);
    }

    // Initialize FCM for push notifications (non-fatal)
    try { initMessaging(user.uid); } catch(e) {}

    // Schedule next shift reminder (non-fatal)
    try {
      const nextShift = detectCurrentShift() || 'shift1';
      scheduleCheckinReminder(nextShift);
    } catch(e) {}

  } catch (err) {
    console.error('[App] Init error:', err);
    hideLoading();
    // Only show error if it's NOT a network issue
    // Network errors are shown via the offline badge already
    if (!err.message?.includes('network') && err.code !== 'unavailable') {
      showToast('❌ Failed to initialize. Please refresh.', 'error');
    }
  }
}

// ════════════════════════════════════════════
//  STAFF DASHBOARD INIT
// ════════════════════════════════════════════
async function initStaffDashboard(user, profile) {
  console.log('[Staff] Dashboard init for:', profile.name);

  // Set display name in navbar
  const nameEls = document.querySelectorAll('[data-user-name]');
  nameEls.forEach(el => (el.textContent = profile.name || profile.email));

  // Avatar
  const avatarEls = document.querySelectorAll('[data-user-avatar]');
  avatarEls.forEach(el => {
    el.textContent = getInitials(profile.name);
    const [c1, c2] = getAvatarGradient(profile.name);
    el.style.background = `linear-gradient(135deg, ${c1}, ${c2})`;
  });

  // Live clock
  startClock(
    document.getElementById('timeClock'),
    document.getElementById('dateClock')
  );

  // Today's attendance (offline safe)
  let todayRecord = {};
  try {
    todayRecord = await getTodayShiftRecords(user.uid);
  } catch(e) {
    console.warn('[Staff] Could not load today attendance (offline?):', e.message);
  }
  renderCheckinButton(todayRecord, user.uid, profile);

  // Attendance stats last 30 days (offline safe)
  try {
    const history = await getAttendanceRange(user.uid, 30);
    renderStaffStats(history);
  } catch(e) {
    console.warn('[Staff] Could not load attendance history (offline?):', e.message);
  }

  // Announcements
  listenAnnouncements((items) => renderAnnouncements(items));

  // Work pressure mode
  listenWorkPressure((wp) => {
    if (wp.active) activatePressureBanner(wp.message);
    else deactivatePressureBanner();
  });

  // Bottom nav
  initBottomNav();

  // Leave request form
  initLeaveForm(user.uid, profile.name);

  // Notification bell
  const bell = document.getElementById('notifBell');
  if (bell) listenNotifCount(user.uid, bell);
}

// ── Check-In Button ──
function renderCheckinButton(record, userId, profile) {
  const btn      = document.getElementById('checkinBtn');
  const statusEl = document.getElementById('checkinStatus');
  const timeEl   = document.getElementById('checkinTime');

  if (!btn) return;

  /**
   * Determine what state the button should be in given all shift records.
   * shiftRecords = { shift1: {...}, shift2: {...} }
   * userShift = 'shift1' | 'shift2' | 'full_time'
   *
   * Logic:
   *  - full_time: treat as shift1 → shift2 in sequence
   *  - shift1/shift2: only show that shift's record
   *  - After checkOut of a shift, if another shift is available today (full_time user),
   *    allow check-in for next shift — never permanently disable
   */
  const update_ = (shiftRecords) => {
    const userShift = profile.shift || 'shift1'; // user's assigned shift from profile

    // Which shifts can this user do today?
    const availableShifts = userShift === 'full_time' ? ['shift1', 'shift2'] : [userShift];

    // Find active shift record (checked-in but not checked-out)
    const activeShiftKey = availableShifts.find(s => shiftRecords[s]?.checkIn && !shiftRecords[s]?.checkOut);
    const activeRec      = activeShiftKey ? shiftRecords[activeShiftKey] : null;

    // Find if there's a pending shift not yet started
    const pendingShiftKey = availableShifts.find(s => !shiftRecords[s]?.checkIn);

    if (activeRec) {
      // Currently checked-in for a shift
      btn.classList.add('checked-in');
      btn.disabled = false;
      btn.querySelector('.btn-icon').textContent = '✓';
      btn.querySelector('.btn-label').textContent = 'CHECK OUT';
      if (statusEl) statusEl.innerHTML = `${statusBadge(activeRec.status)} <small style="color:var(--text-muted);font-size:11px">${SHIFTS[activeShiftKey]?.name || ''}</small>`;
      if (timeEl)   timeEl.textContent = `In: ${formatTime(activeRec.checkIn)}`;
    } else if (pendingShiftKey) {
      // There's a shift left to check-in for
      btn.classList.remove('checked-in');
      btn.disabled = false;
      btn.querySelector('.btn-icon').textContent = '⏱';
      btn.querySelector('.btn-label').textContent = 'CHECK IN';
      // Show previous shift done if any
      const doneShifts = availableShifts.filter(s => shiftRecords[s]?.checkOut);
      if (doneShifts.length > 0 && statusEl) {
        const lastRec = shiftRecords[doneShifts[doneShifts.length - 1]];
        statusEl.innerHTML = `${statusBadge(lastRec.status)} <small style="color:var(--text-muted);font-size:11px">${SHIFTS[doneShifts[doneShifts.length-1]]?.name || ''} done</small>`;
        if (timeEl) timeEl.textContent = `Next: ${SHIFTS[pendingShiftKey]?.label || ''}`;
      } else {
        if (statusEl) statusEl.innerHTML = '';
        if (timeEl)   timeEl.textContent = '';
      }
    } else {
      // All shifts done for today — show summary, button stays active for display
      // (Never hard-disable — just show completed state)
      const lastShiftKey = availableShifts[availableShifts.length - 1];
      const lastRec = shiftRecords[lastShiftKey];
      btn.classList.add('checked-in');
      btn.disabled = false;
      btn.querySelector('.btn-icon').textContent = '🏁';
      btn.querySelector('.btn-label').textContent = 'ALL DONE';
      if (statusEl) statusEl.innerHTML = statusBadge(lastRec?.status || 'present');
      if (timeEl) {
        const parts = availableShifts
          .filter(s => shiftRecords[s]?.checkIn)
          .map(s => {
            const r = shiftRecords[s];
            return `${SHIFTS[s]?.name}: ${formatTime(r.checkIn)}–${formatTime(r.checkOut)}`;
          });
        timeEl.textContent = parts.join(' | ');
      }
    }
  };

  // Normalise record into shiftRecords format
  let shiftRecords = {};
  if (record) {
    if (record.shift1 || record.shift2) {
      shiftRecords = record; // already in new format
    } else if (record.checkIn) {
      shiftRecords = { [record.shiftKey || 'shift1']: record }; // old flat format
    }
  }

  update_(shiftRecords);

  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    btn.disabled = true;

    try {
      // Always fetch fresh shift records from DB
      const fresh = await getTodayShiftRecords(userId);
      const userShift = profile.shift || 'shift1';
      const availableShifts = userShift === 'full_time' ? ['shift1', 'shift2'] : [userShift];

      // Find active shift (checked-in, not checked-out)
      const activeShiftKey = availableShifts.find(s => fresh[s]?.checkIn && !fresh[s]?.checkOut);

      // Find next pending shift
      const pendingShiftKey = availableShifts.find(s => !fresh[s]?.checkIn);

      if (activeShiftKey) {
        // Perform check-out for active shift
        const rec = await checkOut(userId, activeShiftKey);
        const updated = { ...fresh, [activeShiftKey]: rec };
        update_(updated);
        showToast(`🏁 ${SHIFTS[activeShiftKey]?.name} done! Duration: ${formatDuration(rec.duration)}`, 'success');
      } else if (pendingShiftKey) {
        // ── Shift Confirm Modal ──
        // Ask staff to confirm/change auto-detected shift before check-in
        const suggestedShift = detectCurrentShift(); // time-based auto detect
        let chosenShift = pendingShiftKey; // fallback

        if (typeof window._openShiftConfirm === 'function') {
          const confirmed = await window._openShiftConfirm(suggestedShift);
          if (confirmed === null) {
            // User cancelled
            btn.disabled = false;
            return;
          }
          chosenShift = confirmed;
        }

        // Perform check-in for pending shift — with optional geo-fence
        let locationData = null;
        try {
          locationData = await getCurrentPosition();
        } catch {
          // GPS not available — allow check-in anyway if no store location
        }

        // Check geo-fence only if store location is set
        if (locationData) {
          const proximity = await checkStoreProximity(locationData.lat, locationData.lng);
          if (!proximity.ok) {
            showToast(`📍 Too far from store (${proximity.distance}m away). Come closer to check in.`, 'error');
            btn.disabled = false;
            return;
          }
        }

        const shift = chosenShift; // use staff-confirmed shift
        if (!navigator.onLine) {
          const rec = {
            userId, shiftKey: shift,
            checkIn: Date.now(), checkInTime: timeNow(), status: 'present', late: false
          };
          queueOfflineAttendance(userId, rec);
          const updated = { ...fresh, [shift]: rec };
          update_(updated);
          showToast('📡 Offline — check-in queued for sync', 'warning');
        } else {
          const rec = await checkIn(userId, shift, locationData);
          const updated = { ...fresh, [shift]: rec };
          update_(updated);
          showToast(rec.late ? `⚠️ ${SHIFTS[shift]?.name} — checked in late!` : `✅ ${SHIFTS[shift]?.name} check-in done!`, rec.late ? 'warning' : 'success');
        }
      } else {
        // All shifts completed — inform user
        showToast('✅ All shifts for today are completed!', 'info');
      }
    } catch (err) {
      console.error('[Staff] Check-in/out error:', err);
      showToast('❌ ' + (err.message || 'Action failed. Try again.'), 'error');
    } finally {
      btn.disabled = false;
    }
  });
}

// ── Staff Stats ──
function renderStaffStats(history) {
  const stats = calcStats(history);

  const set_ = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  set_('statPresent',      stats.present);
  set_('statLate',         stats.late);
  set_('statAbsent',       stats.absent);
  set_('statRate',         stats.attendanceRate + '%');
  set_('statTotalHours',   formatDuration(stats.totalDuration));

  // Progress ring
  const ring = document.getElementById('attendanceRing');
  if (ring) updateProgressRing(ring, stats.attendanceRate);
  const ringText = document.getElementById('attendanceRingText');
  if (ringText) ringText.textContent = stats.attendanceRate + '%';
}

// ── Announcements ──
function renderAnnouncements(items) {
  const container = document.getElementById('announcementsList');
  if (!container) return;

  if (!items.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📢</div><p>No announcements</p></div>`;
    return;
  }

  container.innerHTML = items.map(item => `
    <div class="card mb-12" style="border-left: 3px solid var(--accent-cyan);">
      <div style="font-size:14px; color:var(--text-primary);">${escapeHtml(item.message)}</div>
      <div style="font-size:11px; color:var(--text-muted); margin-top:6px;">${formatDate(item.createdAt)}</div>
    </div>
  `).join('');
}

// ── Leave Form ──
function initLeaveForm(userId, userName) {
  const form = document.getElementById('leaveForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = {
      type:   fd.get('leaveType'),
      from:   fd.get('fromDate'),
      to:     fd.get('toDate'),
      reason: fd.get('reason')
    };
    if (!payload.from || !payload.to) {
      showToast('❌ Please select dates', 'error'); return;
    }
    try {
      await submitLeaveRequest(userId, userName, payload);
      showToast('✅ Leave request submitted!', 'success');
      form.reset();
      closeModal('leaveModal');
    } catch (err) {
      showToast('❌ ' + (err.message || 'Submission failed'), 'error');
    }
  });
}

// ════════════════════════════════════════════
//  OWNER DASHBOARD INIT
// ════════════════════════════════════════════
async function initOwnerDashboard(user, profile) {
  console.log('[Owner] Dashboard init for:', profile.name);

  // Set name
  const nameEls = document.querySelectorAll('[data-user-name]');
  nameEls.forEach(el => (el.textContent = profile.name || 'Owner'));

  // Set avatar initials
  const avatarEls = document.querySelectorAll('[data-user-avatar]');
  avatarEls.forEach(el => {
    el.textContent = getInitials(profile.name);
    const [c1, c2] = getAvatarGradient(profile.name);
    el.style.background = `linear-gradient(135deg, ${c1}, ${c2})`;
  });

  // Live clock
  startClock(
    document.getElementById('timeClock'),
    document.getElementById('dateClock')
  );

  // Load all staff (offline safe)
  let allStaff = [];
  try {
    allStaff = await getAllStaff();
  } catch (e) {
    console.warn('[Owner] Could not load staff (offline?):', e.message);
    const container = document.getElementById('attendanceList');
    if (container) container.innerHTML = `<div class="empty-state"><div class="empty-icon">📡</div><p>No internet — data will load when online</p></div>`;
  }
  window._allStaff = allStaff;

  // Listen to today's attendance live
  const unsubAtt = listenTodayAllAttendance((todayAtt) => {
    renderOwnerSummary(todayAtt, allStaff);
    // Use owner.html's enhanced renderer if available, else fallback
    if (typeof window._renderOwnerList === 'function') {
      window._renderOwnerList(todayAtt, allStaff);
    } else {
      renderAttendanceList(todayAtt, allStaff);
    }
  });

  // Pending leaves — use owner.html's renderer if available
  const unsubLeaves = listenPendingLeaves((leaves) => {
    if (typeof window._renderOwnerPendingLeaves === 'function') {
      window._renderOwnerPendingLeaves(leaves);
    } else {
      renderPendingLeaves(leaves, user.uid);
    }
    const badge = document.getElementById('pendingLeaveBadge');
    if (badge) {
      badge.textContent = leaves.length || '';
      badge.style.display = leaves.length > 0 ? 'flex' : 'none';
    }
  });

  // Announcements — use owner.html's renderer if available
  listenAnnouncements((items) => {
    if (typeof window._renderOwnerAnnouncements === 'function') {
      window._renderOwnerAnnouncements(items);
    } else {
      renderAnnouncements(items);
    }
  });

  // Work Pressure — listen and update banner
  listenWorkPressure((wp) => {
    if (wp.active) activatePressureBanner(wp.message);
    else deactivatePressureBanner();
    const indicator = document.getElementById('pressureIndicator');
    if (indicator) indicator.style.display = wp.active ? 'flex' : 'none';
  });

  // Bottom nav
  initBottomNav();

  // Store unsubscribers for cleanup
  window._unsubscribers = [unsubAtt, unsubLeaves];
}

// ── Owner Summary Cards ──
function renderOwnerSummary(todayAtt, allStaff) {
  const summary = calcDailySummary(todayAtt, allStaff);

  const set_ = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  set_('summaryTotal',    allStaff.length);
  set_('summaryPresent',  summary.attended);
  set_('summaryLate',     summary.lateCount);
  set_('summaryAbsent',   summary.absent);
  set_('summaryRate',     allStaff.length > 0
    ? Math.round((summary.attended / allStaff.length) * 100) + '%'
    : '0%'
  );

  // Progress ring
  const ring = document.getElementById('dailyAttRing');
  if (ring) {
    const pct = allStaff.length > 0
      ? Math.round((summary.attended / allStaff.length) * 100) : 0;
    updateProgressRing(ring, pct);
    const ringText = document.getElementById('dailyAttRingText');
    if (ringText) ringText.textContent = pct + '%';
  }
}

// ── Owner Attendance List ──
function renderAttendanceList(todayAtt, allStaff) {
  const container = document.getElementById('attendanceList');
  if (!container) return;

  if (!allStaff.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">👥</div><p>No staff found</p></div>`;
    return;
  }

  // Helper: extract display info from either old flat or new multi-shift record
  const getDisplayInfo = (rec) => {
    if (!rec) return { status: 'absent', checkIn: null, checkOut: null, duration: 0 };
    if (rec.shift1 || rec.shift2) {
      // Multi-shift: take earliest checkIn, latest checkOut
      const shifts = [rec.shift1, rec.shift2].filter(Boolean);
      const firstIn  = shifts.reduce((min, s) => s.checkIn  && (!min || s.checkIn < min)  ? s.checkIn  : min, null);
      const lastOut  = shifts.reduce((max, s) => s.checkOut && (!max || s.checkOut > max) ? s.checkOut : max, null);
      const totalDur = shifts.reduce((sum, s) => sum + (s.duration || 0), 0);
      const status   = shifts.find(s => s.status === 'late') ? 'late' : (firstIn ? 'present' : 'absent');
      return { status, checkIn: firstIn, checkOut: lastOut, duration: totalDur };
    }
    // Old flat format
    return { status: rec.status || 'absent', checkIn: rec.checkIn, checkOut: rec.checkOut, duration: rec.duration || 0 };
  };

  container.innerHTML = allStaff.map(staff => {
    const rec      = todayAtt[staff.uid] || null;
    const info     = getDisplayInfo(rec);
    const checkIn  = info.checkIn  ? formatTime(info.checkIn)  : '--:--';
    const checkOut = info.checkOut ? formatTime(info.checkOut) : '--:--';
    const [c1, c2] = getAvatarGradient(staff.name);

    return `
      <div class="att-item">
        <div class="att-avatar" style="background:linear-gradient(135deg,${c1},${c2})">
          ${getInitials(staff.name)}
        </div>
        <div class="att-info">
          <div class="att-name">${escapeHtml(staff.name)}</div>
          <div class="att-time">
            ${checkIn !== '--:--' ? `In: ${checkIn}` : ''}
            ${checkOut !== '--:--' ? ` · Out: ${checkOut}` : ''}
            ${info.duration ? ` · ${formatDuration(info.duration)}` : ''}
          </div>
        </div>
        ${statusBadge(info.status)}
      </div>
    `;
  }).join('');
}

// ── Pending Leave Cards ──
function renderPendingLeaves(leaves, ownerId) {
  const container = document.getElementById('pendingLeavesList');
  if (!container) return;

  if (!leaves.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">✅</div><p>No pending leave requests</p></div>`;
    return;
  }

  container.innerHTML = leaves.map(leave => `
    <div class="leave-card" data-leave-id="${leave.id}">
      <div class="leave-header">
        <div class="leave-name">${escapeHtml(leave.userName)}</div>
        <span class="badge badge-pending">Pending</span>
      </div>
      <div class="leave-dates">📅 ${leave.fromDate} → ${leave.toDate}</div>
      <div class="leave-reason">💬 ${escapeHtml(leave.reason || '—')}</div>
      <div class="leave-actions">
        <button class="btn btn-success btn-sm" onclick="approveLeave('${leave.id}', '${ownerId}')">
          ✓ Approve
        </button>
        <button class="btn btn-danger btn-sm" onclick="rejectLeave('${leave.id}', '${ownerId}')">
          ✗ Reject
        </button>
      </div>
    </div>
  `).join('');
}

// Expose approval handlers globally for inline onclick
window.approveLeave = async (leaveId, ownerId) => {
  try {
    await updateLeaveStatus(leaveId, 'approved', ownerId);
    showToast('✅ Leave approved!', 'success');
  } catch (e) {
    showToast('❌ Failed to approve', 'error');
  }
};

window.rejectLeave = async (leaveId, ownerId) => {
  try {
    await updateLeaveStatus(leaveId, 'rejected', ownerId);
    showToast('🚫 Leave rejected.', 'info');
  } catch (e) {
    showToast('❌ Failed to reject', 'error');
  }
};

// ════════════════════════════════════════════
//  SECURITY — HTML ESCAPER
// ════════════════════════════════════════════
export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ════════════════════════════════════════════
//  PAGE-SPECIFIC AUTO-INIT
// ════════════════════════════════════════════
// NOTE: initApp() is called directly by staff.html and owner.html
// Do NOT auto-init here — would cause double initialization loop

console.log('[App] WorkTrack app.js loaded ✓');
