/* ============================================================
   notifications.js
   WorkTrack PWA — Notification System
   Handles: FCM token, VAPID, shift alerts, broadcast,
            work pressure, leave updates, 2-min repeat alerts
   ============================================================ */

import { getMessaging, getToken, onMessage }  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js';
import { getDatabase, ref, set, get, onValue, push } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// ── VAPID Key ──
const VAPID_KEY = 'BKAMT5HXxTKMaiEH1PPd9W5vfqVpRo1wvXuM5PFkhWUIwzx--7kDgU4lg8IK693LYyggdcmchrv1ziTSHX4K3Gk';

// ── Repeat alert interval (ms) ──
const REPEAT_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

// ── Internal state ──
let _messaging   = null;
let _database    = null;
let _currentUser = null;
let _repeatTimers = {};   // { shiftKey: intervalId }
let _scheduledAlarms = []; // setTimeout IDs for shift alerts

// ════════════════════════════════════════════
//  INIT — Call this once after Firebase init
// ════════════════════════════════════════════
export async function initNotifications(firebaseApp, user) {
  _database    = getDatabase(firebaseApp);
  _currentUser = user;

  // Browser support check
  if (!('Notification' in window)) {
    console.warn('[Notif] Notifications not supported');
    return false;
  }

  // Request permission
  const granted = await requestPermission();
  if (!granted) return false;

  // Init messaging + get FCM token
  try {
    _messaging = getMessaging(firebaseApp);
    await registerFCMToken();
    listenForegroundMessages();
  } catch (err) {
    console.warn('[Notif] FCM init failed:', err.message);
  }

  // Schedule today's shift alerts
  scheduleShiftAlerts();

  // Listen for broadcast messages from owner
  listenBroadcasts();

  // Listen for work pressure mode changes
  listenWorkPressureMode();

  console.log('[Notif] Notification system ready ✓');
  return true;
}

// ════════════════════════════════════════════
//  PERMISSION REQUEST
// ════════════════════════════════════════════
export async function requestPermission() {
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied')  return false;

  const result = await Notification.requestPermission();
  return result === 'granted';
}

// ════════════════════════════════════════════
//  FCM TOKEN — get & save to RTDB
// ════════════════════════════════════════════
async function registerFCMToken() {
  if (!_messaging || !_currentUser) return;

  try {
    const swReg = await navigator.serviceWorker.ready;
    const token = await getToken(_messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swReg
    });

    if (token) {
      // Save token to RTDB under user
      await set(
        ref(_database, `users/${_currentUser.uid}/fcmToken`),
        token
      );
      console.log('[Notif] FCM token saved ✓');
    }
  } catch (err) {
    console.warn('[Notif] FCM token error:', err.message);
  }
}

// ════════════════════════════════════════════
//  FOREGROUND MESSAGE LISTENER
//  (when app is open)
// ════════════════════════════════════════════
function listenForegroundMessages() {
  if (!_messaging) return;

  onMessage(_messaging, (payload) => {
    console.log('[Notif] Foreground message:', payload);

    const data  = payload.data || {};
    const notif = payload.notification || {};
    const type  = data.type || 'default';

    // Show in-app toast instead of system notif (app is open)
    showInAppAlert({
      title : notif.title || data.title || 'WorkTrack',
      body  : notif.body  || data.body  || '',
      type,
    });

    // Handle specific types
    if (type === 'work_pressure') handleWorkPressureAlert(data);
    if (type === 'broadcast')     handleBroadcastAlert(data);
    if (type === 'leave_update')  handleLeaveUpdateAlert(data);
  });
}

// ════════════════════════════════════════════
//  SHIFT ALERTS — scheduled for today
// ════════════════════════════════════════════
export async function scheduleShiftAlerts() {
  // Clear existing
  _scheduledAlarms.forEach(id => clearTimeout(id));
  _scheduledAlarms = [];

  // Fetch shift settings from RTDB
  let shiftWindows = {
    shift1: { start: '08:00', end: '08:20', checkout: '13:00' },
    shift2: { start: '16:00', end: '16:20', checkout: '20:00' }
  };

  try {
    const snap = await get(ref(_database, 'settings/shiftWindows'));
    if (snap.exists()) shiftWindows = snap.val();
  } catch (e) { /* use defaults */ }

  // Check if today is a working day for each shift
  const today      = getTodayKey();
  const dayName    = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const isFriday   = dayName === 'Friday';

  // Check holiday
  let holidayType = null;
  try {
    const hSnap = await get(ref(_database, `holidays/${today}`));
    if (hSnap.exists()) holidayType = hSnap.val().type; // 'full'|'shift1'|'shift2'
  } catch (e) {}

  // Check work pressure (overrides holidays/friday)
  let workPressure = false;
  try {
    const pSnap = await get(ref(_database, 'settings/workPressure'));
    workPressure = pSnap.val() === true;
  } catch (e) {}

  // Schedule per shift
  ['shift1', 'shift2'].forEach(shiftKey => {
    const shift = shiftWindows[shiftKey];

    // Holiday/Friday override logic
    const isHolidayForShift =
      !workPressure && (
        holidayType === 'full' ||
        holidayType === shiftKey ||
        isFriday
      );

    if (isHolidayForShift) {
      console.log(`[Notif] ${shiftKey} is holiday today, skipping alerts`);
      return;
    }

    // Schedule start alert
    scheduleAlert(shift.start, 0, () => {
      fireShiftStartAlert(shiftKey, shift);
    });

    // Schedule 5-min warning (start time + window - 5 min)
    const warningTime = addMinutesToTime(shift.end, -5);
    scheduleAlert(warningTime, 0, () => {
      showLocalNotification({
        title : `⚠️ 5 Minutes Left!`,
        body  : `Check-in window closes at ${formatTime12(shift.end)}. Mark attendance now!`,
        type  : 'late_warning',
        url   : '/staff.html?action=checkin'
      });
    });

    // Schedule window-close alert
    scheduleAlert(shift.end, 0, () => {
      showLocalNotification({
        title : `🕐 Check-in Window Closed`,
        body  : `You are now late for ${shiftKey === 'shift1' ? 'Morning' : 'Evening'} shift. You can still check in as late.`,
        type  : 'late_warning',
        url   : '/staff.html?action=checkin'
      });
    });
  });
}

// Fire start alert + start repeat reminders
function fireShiftStartAlert(shiftKey, shift) {
  const shiftName = shiftKey === 'shift1' ? 'Morning Shift ☀️' : 'Evening Shift 🌆';

  showLocalNotification({
    title : `⏰ ${shiftName} Starting!`,
    body  : `Check-in window open: ${formatTime12(shift.start)} – ${formatTime12(shift.end)}. Mark your attendance!`,
    type  : 'checkin_reminder',
    url   : '/staff.html?action=checkin'
  });

  // Start 2-min repeat until check-in
  startRepeatReminder(shiftKey, shift);
}

// ── 2-minute repeat reminder until user checks in ──
export function startRepeatReminder(shiftKey, shift) {
  stopRepeatReminder(shiftKey); // Clear existing

  _repeatTimers[shiftKey] = setInterval(async () => {
    // Check if user already checked in for this shift today
    if (!_currentUser) return;
    const today = getTodayKey();

    try {
      const snap = await get(ref(_database, `attendance/${today}/${_currentUser.uid}`));
      const data = snap.val();

      // Support both old flat format and new multi-shift format
      const checkedIn = data
        ? (data[shiftKey]?.checkIn || // new format: shift1/shift2 nested
           (!data.shift1 && !data.shift2 && data.checkIn)) // old flat format
        : false;

      if (checkedIn) {
        // Already checked in — stop reminders
        stopRepeatReminder(shiftKey);
        return;
      }

      // Still not checked in — remind again
      const shiftName = shiftKey === 'shift1' ? 'Morning' : 'Evening';
      showLocalNotification({
        title : `🔔 Attendance Reminder`,
        body  : `You haven't checked in for ${shiftName} shift yet! Don't miss it.`,
        type  : 'checkin_reminder',
        url   : '/staff.html?action=checkin'
      });
    } catch (e) {
      console.warn('[Notif] Repeat reminder check failed:', e);
    }
  }, REPEAT_INTERVAL_MS);
}

export function stopRepeatReminder(shiftKey) {
  if (_repeatTimers[shiftKey]) {
    clearInterval(_repeatTimers[shiftKey]);
    delete _repeatTimers[shiftKey];
  }
}

export function stopAllReminders() {
  Object.keys(_repeatTimers).forEach(stopRepeatReminder);
}

// ════════════════════════════════════════════
//  BROADCAST LISTENER (owner → all staff)
// ════════════════════════════════════════════
function listenBroadcasts() {
  if (!_database) return;

  const broadcastRef = ref(_database, 'broadcasts');
  let isFirst = true;

  onValue(broadcastRef, (snap) => {
    if (isFirst) { isFirst = false; return; } // Skip initial load
    if (!snap.exists()) return;

    // Get latest broadcast
    const broadcasts = snap.val();
    const keys = Object.keys(broadcasts).sort();
    const latest = broadcasts[keys[keys.length - 1]];

    if (!latest) return;

    // Show only if recent (within last 30s)
    const age = Date.now() - (latest.sentAt || 0);
    if (age > 30000) return;

    showLocalNotification({
      title : `📢 Message from Admin`,
      body  : latest.message,
      type  : latest.type === 'work_pressure' ? 'work_pressure' : 'broadcast',
      url   : '/staff.html'
    });

    handleBroadcastAlert(latest);
  });
}

// ════════════════════════════════════════════
//  WORK PRESSURE MODE LISTENER
// ════════════════════════════════════════════
function listenWorkPressureMode() {
  if (!_database) return;

  let prevState = null;

  onValue(ref(_database, 'settings/workPressure'), (snap) => {
    const isActive = snap.val() === true;

    if (prevState === null) { prevState = isActive; return; } // Skip init
    if (isActive === prevState) return;

    prevState = isActive;

    if (isActive) {
      showLocalNotification({
        title : '🚨 Work Pressure Alert!',
        body  : 'Admin has activated Work Mode. Extra work today — attendance required.',
        type  : 'work_pressure',
        url   : '/staff.html'
      });

      // Re-schedule alerts (Friday now unlocked)
      scheduleShiftAlerts();

      // Dispatch event for UI to update (red banner)
      window.dispatchEvent(new CustomEvent('workPressureChanged', { detail: { active: true } }));

    } else {
      showInAppAlert({ title: '✅ Work Pressure Mode OFF', body: 'Normal schedule resumed.', type: 'info' });
      window.dispatchEvent(new CustomEvent('workPressureChanged', { detail: { active: false } }));
    }
  });
}

// ════════════════════════════════════════════
//  OWNER: SEND BROADCAST
// ════════════════════════════════════════════
export async function sendBroadcast(message, type = 'urgent') {
  if (!_database || !_currentUser) return false;

  try {
    const msgRef = ref(_database, 'broadcasts');
    await push(msgRef, {
      message,
      type,
      sentBy  : _currentUser.uid,
      sentAt  : Date.now(),
    });

    console.log('[Notif] Broadcast sent ✓');
    return true;
  } catch (err) {
    console.error('[Notif] Broadcast failed:', err);
    return false;
  }
}

// ════════════════════════════════════════════
//  OWNER: SEND WORK PRESSURE TOGGLE BROADCAST
// ════════════════════════════════════════════
export async function sendWorkPressureBroadcast(isActive, customMsg = '') {
  const defaultMsg = isActive
    ? '🚨 Work Pressure Mode ON — Extra work today. All staff required.'
    : '✅ Work Pressure Mode OFF — Normal schedule resumed.';

  return sendBroadcast(customMsg || defaultMsg, 'work_pressure');
}

// ════════════════════════════════════════════
//  NOTIFY: Holiday declared
// ════════════════════════════════════════════
export async function notifyHoliday(date, type, note = '') {
  const typeLabel = type === 'full' ? 'Full Day' : type === 'shift1' ? 'Morning Shift' : 'Evening Shift';
  const msg = `🏖️ Holiday on ${formatDateDisplay(date)} — ${typeLabel} off.${note ? ' ' + note : ''}`;
  return sendBroadcast(msg, 'holiday');
}

// ════════════════════════════════════════════
//  NOTIFY: Leave request status
// ════════════════════════════════════════════
export async function notifyLeaveStatus(staffUid, status, fromDate, toDate) {
  if (!_database) return;

  const msg = status === 'approved'
    ? `✅ Your leave request (${formatDateDisplay(fromDate)} – ${formatDateDisplay(toDate)}) has been approved.`
    : `❌ Your leave request (${formatDateDisplay(fromDate)} – ${formatDateDisplay(toDate)}) was rejected.`;

  // Save as personal notification for that staff member
  try {
    await push(ref(_database, `notifications/${staffUid}`), {
      message : msg,
      type    : 'leave_update',
      status,
      sentAt  : Date.now(),
      read    : false,
    });
  } catch (e) {
    console.warn('[Notif] Leave notify error:', e);
  }
}

// Listen to personal notifications for current user
export function listenPersonalNotifications(callback) {
  if (!_database || !_currentUser) return;

  let isFirst = true;
  onValue(ref(_database, `notifications/${_currentUser.uid}`), (snap) => {
    if (isFirst) { isFirst = false; return; }
    if (!snap.exists()) return;

    const notifs = snap.val();
    const keys   = Object.keys(notifs).sort();
    const latest = notifs[keys[keys.length - 1]];

    if (!latest || latest.read) return;

    const age = Date.now() - (latest.sentAt || 0);
    if (age > 30000) return; // Only show recent

    showLocalNotification({
      title : '📬 WorkTrack',
      body  : latest.message,
      type  : latest.type || 'default',
      url   : '/staff.html'
    });

    if (callback) callback(latest);
  });
}

// ════════════════════════════════════════════
//  LOCAL NOTIFICATION (via Service Worker)
// ════════════════════════════════════════════
export async function showLocalNotification({ title, body, type = 'default', url = '/staff.html' }) {
  if (Notification.permission !== 'granted') return;

  try {
    const swReg = await navigator.serviceWorker.ready;
    swReg.active?.postMessage({
      type   : 'LOCAL_NOTIFICATION',
      payload: { title, body, type, url }
    });
  } catch (e) {
    // SW not available — fallback to direct Notification API
    try {
      new Notification(title, {
        body,
        icon : '/icons/icon-192x192.png',
        badge: '/icons/icon-72x72.png',
        tag  : `worktrack-${type}`,
        data : { url }
      });
    } catch (e2) {
      console.warn('[Notif] Direct notification failed:', e2);
    }
  }
}

// ════════════════════════════════════════════
//  IN-APP ALERT TOAST (when app is open)
// ════════════════════════════════════════════
export function showInAppAlert({ title, body, type = 'info', duration = 4000 }) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toastTypeMap = {
    checkin_reminder : 'info',
    late_warning     : 'warning',
    work_pressure    : 'error',
    broadcast        : 'warning',
    holiday          : 'info',
    leave_update     : 'success',
    default          : 'info',
    info             : 'info',
    success          : 'success',
    error            : 'error',
    warning          : 'warning',
  };

  const toastType = toastTypeMap[type] || 'info';

  const toast = document.createElement('div');
  toast.className = `toast toast-${toastType}`;
  toast.innerHTML = `
    <div style="flex:1">
      <div style="font-weight:700;font-size:13px;">${title}</div>
      ${body ? `<div style="font-size:12px;margin-top:3px;opacity:0.85;">${body}</div>` : ''}
    </div>
    <button onclick="this.parentElement.remove()" style="background:none;border:none;color:inherit;cursor:pointer;font-size:16px;padding:0 0 0 8px;">✕</button>
  `;

  container.appendChild(toast);

  if (duration > 0) {
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-8px) scale(0.95)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
}

// ════════════════════════════════════════════
//  ALERT HANDLER HOOKS (called from listeners)
// ════════════════════════════════════════════
function handleWorkPressureAlert(data) {
  // Dispatch event for UI to show red banner
  window.dispatchEvent(new CustomEvent('workPressureAlert', { detail: data }));
}

function handleBroadcastAlert(data) {
  window.dispatchEvent(new CustomEvent('broadcastReceived', { detail: data }));
}

function handleLeaveUpdateAlert(data) {
  window.dispatchEvent(new CustomEvent('leaveStatusUpdated', { detail: data }));
}

// ════════════════════════════════════════════
//  SCHEDULE HELPER — set timeout for a specific time today
// ════════════════════════════════════════════
function scheduleAlert(timeStr, offsetMs = 0, callback) {
  const ms = msUntilTime(timeStr) + offsetMs;
  if (ms < 0) return; // Time already passed today

  const id = setTimeout(callback, ms);
  _scheduledAlarms.push(id);
  console.log(`[Notif] Alert scheduled at ${timeStr} (in ${Math.round(ms/60000)} min)`);
}

// ════════════════════════════════════════════
//  UTILITY FUNCTIONS
// ════════════════════════════════════════════

// Today's date key "YYYY-MM-DD"
export function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Milliseconds until a "HH:MM" time today
function msUntilTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const now    = new Date();
  const target = new Date(now);
  target.setHours(h, m, 0, 0);
  return target - now;
}

// Add minutes to "HH:MM" string → returns "HH:MM"
function addMinutesToTime(timeStr, minutes) {
  const [h, m] = timeStr.split(':').map(Number);
  const total  = h * 60 + m + minutes;
  const nh     = Math.floor(total / 60) % 24;
  const nm     = ((total % 60) + 60) % 60;
  return `${String(nh).padStart(2,'0')}:${String(nm).padStart(2,'0')}`;
}

// "08:00" → "8:00 AM"
export function formatTime12(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12    = h % 12 || 12;
  return `${h12}:${String(m).padStart(2,'0')} ${suffix}`;
}

// "YYYY-MM-DD" → "Mon, 8 May"
function formatDateDisplay(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    weekday: 'short', day: 'numeric', month: 'short'
  });
}

// ════════════════════════════════════════════
//  OWNER: LISTEN FOR STAFF CHECK-IN / CHECK-OUT
//  Call this from owner.html after init
// ════════════════════════════════════════════
export function listenOwnerNotifications(onNotif) {
  if (!_database) return;

  const notifRef = ref(_database, 'owner_notifications');
  let isFirst = true;

  onValue(notifRef, (snap) => {
    if (isFirst) { isFirst = false; return; } // skip initial load
    if (!snap.exists()) return;

    const all  = snap.val();
    const keys = Object.keys(all).sort();
    const latest = all[keys[keys.length - 1]];
    if (!latest) return;

    // Only show if within last 15 seconds (fresh event)
    const age = Date.now() - (latest.createdAt || 0);
    if (age > 15000) return;

    // Push notification (background)
    showLocalNotification({
      title : latest.type === 'checkin'
        ? `🟢 Check-In — ${latest.staffName}`
        : `🔴 Check-Out — ${latest.staffName}`,
      body  : latest.message,
      type  : 'broadcast',
      url   : '/owner.html'
    });

    // Callback for in-app toast
    if (onNotif) onNotif(latest);
  });
}

// ════════════════════════════════════════════
//  EXPORT notification permission status
// ════════════════════════════════════════════
export function getPermissionStatus() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission; // 'granted' | 'denied' | 'default'
}
