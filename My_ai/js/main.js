// ═══════════════════════════════════════════════════════════════════════
// main.js — glue file: top-level event listener wiring, service-worker
// registration, and the init() IIFE that wires up all UI elements once the
// DOM is ready. Kept thin; calls functions defined in the other files.
// ═══════════════════════════════════════════════════════════════════════

// ════════════════════════════════════
// PWA: SERVICE WORKER REGISTRATION
// ════════════════════════════════════

// ════════════════════════════════════
// PHASE 3: SESSION AUTOSAVE SAFETY NET
//
// The main autosave (js/sessions.js autosaveSession()) already fires after
// every completed AI turn (see chat-core.js sendMsg/forceWebSearchMsg/
// image-gen `finally` blocks). These are just a backstop for the deeper
// continuation chains (search/tool/exec continuation) that don't each have
// their own hook, and for the case of the tab being closed mid-turn.
// ════════════════════════════════════

window.addEventListener('visibilitychange', () => {
  if (document.hidden && currentSession.length >= 2) autosaveSession();
});

window.addEventListener('beforeunload', () => {
  if (currentSession.length >= 2) autosaveSession(); // best-effort, fire-and-forget — page may close before it lands
});

// ════════════════════════════════════
// MARKDOWN PARSER
// ════════════════════════════════════

document.getElementById('msg-inp').addEventListener('input', function() { autoResize(this); });
document.getElementById('msg-inp').addEventListener('keydown', e => {
  // On mobile (Android), Enter with no Shift sends message
  // But IME composition (e.g. typing Hinglish suggestions) must not trigger send
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendMsg();
  }
});

// Suggestions

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// ════════════════════════════════════
// INIT (called here so all functions above are defined)
// ════════════════════════════════════

(function init() {
  const saved = LS.get('chaman_cfg');
  if (saved) {
    cfg = { ...cfg, ...saved };
    if (!saved.permMemory) cfg.permMemory = [];
    if (!saved.sessions) cfg.sessions = [];
  }

  // PHASE 2: login-screen (index.html) is visible by default and stays up
  // until Firebase tells us who's signed in (or that no-one is, in which
  // case initAuthListener's onAuthStateChanged callback shows it). The
  // rest of init (onboarding, lock screen, etc) waits on this — there's
  // no meaningful app state before we know which account owns it.
  initAuthListener().then(continueInitAfterAuth);
})();

function continueInitAfterAuth() {
  // PHASE 5: is this account the admin (creator) account? Silent no-op for
  // every normal user — see admin.js checkAdminStatus() header. Fire-and-
  // forget (not awaited) so it never delays normal app startup; the badge
  // just pops in a moment later on the rare admin login.
  checkAdminStatus();

  // PHASE 1 NOTE: the old setup-screen (forcing the user to add their OWN
  // provider key before first chat) is gone from this gate — the server
  // has its own key pool now (lib/keyManager.js), so it's never required.
  // cfg.fallbacks is just an optional "apni key" override (see
  // providers.js getUserKeyOverride).
  if (!cfg.onboarded) {
    startOnboarding();
  }
  if (cfg.lockEnabled && cfg.lockPinHash) {
    showLockScreen();
  }
  document.getElementById('lock-now-btn').style.display = (cfg.lockEnabled && cfg.lockPinHash) ? 'flex' : 'none';

  // Creator-Respect Enforcement — agar app band hote waqt BLOCKED state
  // active thi, use restore/cleanup karo
  if (!isCreatorActive() && cfg.insultBlockUntil > 0) {
    if (cfg.insultBlockUntil > Date.now()) {
      enterBlockedState(); // abhi bhi active hai — timer/UI restore karo
    } else {
      // App band hone ke dauraan hi expire ho gaya tha (chip kabhi tap nahi hui)
      cfg.insultBlockUntil = 0;
      cfg.needsPostBlockReminder = true;
      LS.set('chaman_cfg', cfg);
    }
  }
  renderSuggChips();

  // Har session (app open) pe ek baar local exec backend se environment
  // snapshot le lo — background mein, chat block nahi hoti. Agar backend
  // band hai to fetchEnvSnapshot() chup-chaap envSnapshot ko null rakh
  // dega aur buildExecEnvPrompt() AI ko clearly bata dega.
  fetchEnvSnapshot();

  // Har 30 second mein backend status silently re-check karo, taaki header
  // ka "Connected/Disconnected" live rahe (chahe koi message na bheja ho)
  setInterval(fetchEnvSnapshot, 30000);

  // PHASE 3: periodic autosave safety net — catches long continuation
  // chains (search/tool/exec) that don't each have their own autosave
  // hook. No-op (autosaveSession has its own guards) if nothing changed,
  // if a temp creator session is active, or a save is already in flight.
  setInterval(() => { if (!loading) autosaveSession(); }, 20000);
}

// ════════════════════════════════════
// ALL EVENT LISTENERS (safe for content:// URLs)
// ════════════════════════════════════
(function bindEvents() {
  // Setup screen
  const setupBtn = document.getElementById('setup-btn');
  if (setupBtn) setupBtn.addEventListener('click', saveSetup);
  document.getElementById('setup-add-btn').addEventListener('click', addSetupFallback);
  document.getElementById('setup-fb-preset').addEventListener('change', onSetupFbPresetChange);
  document.getElementById('setup-fb-fetch-models-btn').addEventListener('click', () => fetchGroqModels('setup-key', 'setup-fb-groq-models-sel', 'setup-model'));
  document.getElementById('setup-fb-groq-models-sel').addEventListener('change', function() { if (this.value) document.getElementById('setup-model').value = this.value; });
  document.getElementById('restart-onboarding-btn').addEventListener('click', () => {
    closeModal('settings-modal');
    startOnboarding();
  });

  // Header buttons
  document.getElementById('send-btn').addEventListener('click', sendMsg);

  // + menu (mic / attach / image-gen)
  function closePlusMenu() {
    document.getElementById('plus-menu').classList.add('hidden');
    document.getElementById('plus-btn').classList.remove('open');
  }
  document.getElementById('plus-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = document.getElementById('plus-menu');
    const isOpen = !menu.classList.contains('hidden');
    if (isOpen) closePlusMenu();
    else { menu.classList.remove('hidden'); document.getElementById('plus-btn').classList.add('open'); }
  });
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('plus-menu');
    if (!menu.classList.contains('hidden') && !menu.contains(e.target) && e.target.id !== 'plus-btn') closePlusMenu();
  });
  document.getElementById('mic-btn').addEventListener('click', () => { toggleVoice(); closePlusMenu(); });
  document.getElementById('attach-btn').addEventListener('click', () => { document.getElementById('file-inp').click(); closePlusMenu(); });
  document.getElementById('imggen-btn').addEventListener('click', () => {
    closePlusMenu();
    const inp = document.getElementById('msg-inp');
    const val = inp.value.trim();
    if (val && !/^\/(image|img)\s/i.test(val)) {
      inp.value = '/image ' + val;
      sendMsg();
    } else if (/^\/(image|img)\s+.+/i.test(val)) {
      sendMsg();
    } else {
      inp.value = '/image ';
      inp.focus();
      toast('🎨 Ab image ka description likho aur send karo');
    }
  });
  document.getElementById('search-btn').addEventListener('click', () => {
    closePlusMenu();
    const inp = document.getElementById('msg-inp');
    const val = inp.value.trim();
    if (val && !/^\/search\s/i.test(val)) {
      inp.value = '/search ' + val;
      sendMsg();
    } else if (/^\/search\s+.+/i.test(val)) {
      sendMsg();
    } else {
      inp.value = '/search ';
      inp.focus();
      toast('🔍 Ab search query likho aur send karo');
    }
  });
  document.getElementById('fp-clear').addEventListener('click', clearFile);
  document.getElementById('file-inp').addEventListener('change', handleFile);
  document.getElementById('connect-btn').addEventListener('click', () => {
    closePlusMenu();
    document.getElementById('msg-inp').value = '/connect';
    sendMsg();
  });

  // Image lightbox
  document.getElementById('lb-close').addEventListener('click', closeLightbox);
  document.getElementById('lb-download').addEventListener('click', lbDownload);
  document.getElementById('lb-prev').addEventListener('click', lbPrev);
  document.getElementById('lb-next').addEventListener('click', lbNext);
  document.getElementById('lightbox').addEventListener('click', (e) => {
    if (e.target.id === 'lightbox') closeLightbox();
  });
  document.addEventListener('keydown', (e) => {
    if (document.getElementById('lightbox').classList.contains('hidden')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') lbPrev();
    if (e.key === 'ArrowRight') lbNext();
  });

  // Hamburger + side menu
  const sideMenu = document.getElementById('side-menu');
  const sideMenuOverlay = document.getElementById('side-menu-overlay');
  function openSideMenu() {
    sideMenu.classList.remove('hidden');
    sideMenuOverlay.classList.remove('hidden');
    requestAnimationFrame(() => { sideMenu.classList.add('open'); sideMenuOverlay.classList.add('open'); });
  }
  function closeSideMenu() {
    sideMenu.classList.remove('open');
    sideMenuOverlay.classList.remove('open');
    setTimeout(() => { sideMenu.classList.add('hidden'); sideMenuOverlay.classList.add('hidden'); }, 280);
  }
  document.getElementById('hamburger-btn').addEventListener('click', openSideMenu);
  sideMenuOverlay.addEventListener('click', closeSideMenu);

  // Side menu items (Memory & Chats/Sessions, Settings, New Chat) — close
  // the drawer first so it doesn't sit open behind whichever modal opens.
  document.getElementById('menu-memory-btn').addEventListener('click', () => { closeSideMenu(); openMemModal(); });
  document.getElementById('menu-settings-btn').addEventListener('click', () => { closeSideMenu(); openSettings(); });
  document.getElementById('menu-newchat-btn').addEventListener('click', () => { closeSideMenu(); newChat(); });

  // Modal closes
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', function() {
      this.closest('.modal-ov').classList.add('hidden');
    });
  });
  document.querySelectorAll('.modal-ov').forEach(ov => {
    ov.addEventListener('click', function(e) {
      if (e.target === this) this.classList.add('hidden');
    });
  });

  // Settings save
  document.getElementById('save-settings-btn').addEventListener('click', saveSettings);

  // Memory buttons
  document.getElementById('mem-inp').addEventListener('keydown', e => { if (e.key === 'Enter') addMem(); });

  // PHASE 3 — session list: one delegated listener handles open/rename/
  // delete for every item, however many times renderSessions() re-renders it.
  document.getElementById('sess-list').addEventListener('click', onSessListClick);

  // AI Providers chain
  document.getElementById('fb-add-btn').addEventListener('click', addFallback);
  document.getElementById('tool-keys-save-btn').addEventListener('click', saveToolKeys);
  document.getElementById('fb-preset').addEventListener('change', onFbPresetChange);
  document.getElementById('fb-fetch-models-btn').addEventListener('click', () => fetchGroqModels('fb-key', 'fb-groq-models-sel', 'fb-model'));
  document.getElementById('fb-groq-models-sel').addEventListener('change', function() { if (this.value) document.getElementById('fb-model').value = this.value; });

  // Key eye toggles
  function setupEye(btnId, inpId) {
    const btn = document.getElementById(btnId);
    const inp = document.getElementById(inpId);
    if (!btn || !inp) return;
    btn.addEventListener('click', function() {
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      this.innerHTML = show
        ? '<svg viewBox="0 0 24 24" style="width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
        : '<svg viewBox="0 0 24 24" style="width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    });
  }
  setupEye('eye-setup', 'setup-key');

  // Full system prompt preview (uses whatever is currently typed in the box, even if unsaved)
  document.getElementById('preview-full-prompt-btn').addEventListener('click', () => {
    const liveSysPrompt = document.getElementById('sys-prompt').value.trim() || cfg.sysPrompt;
    const savedSysPrompt = cfg.sysPrompt;
    cfg.sysPrompt = liveSysPrompt; // temp swap so buildPrompt() reflects unsaved edits too
    document.getElementById('prompt-preview-box').value = buildPrompt(true);
    cfg.sysPrompt = savedSysPrompt; // restore — this button never saves anything
    document.getElementById('prompt-preview-modal').classList.remove('hidden');
  });

  // Memory modal buttons
  document.querySelector('#mem-modal .btn-danger').addEventListener('click', clearAllMemory);
  document.getElementById('mem-modal').querySelector('.btn-ghost').addEventListener('click', () => closeModal('mem-modal'));
  document.getElementById('mem-modal').querySelector('.add-btn').addEventListener('click', addMem);

  // PHASE 8 — guest nudge modal (✕/backdrop close already covered by the
  // generic .modal-close / .modal-ov wiring above; these two are the
  // action-specific buttons)
  document.getElementById('guest-nudge-login-btn')?.addEventListener('click', () => {
    document.getElementById('guest-nudge-modal').classList.add('hidden');
    signInWithGoogle();
  });
  document.getElementById('guest-nudge-later-btn')?.addEventListener('click', () => {
    document.getElementById('guest-nudge-modal').classList.add('hidden');
  });

  // App lock
  document.getElementById('lock-now-btn').addEventListener('click', () => { closeSideMenu(); lockNow(); });
  document.getElementById('set-pin-btn').addEventListener('click', setNewPin);
  document.getElementById('fp-enable-btn').addEventListener('click', toggleFingerprint);
  document.getElementById('fp-unlock-btn').addEventListener('click', tryFingerprintUnlock);
  document.getElementById('pin-pad').addEventListener('click', e => {
    const btn = e.target.closest('.pin-key[data-k]');
    if (!btn) return;
    onPinKey(btn.getAttribute('data-k'));
  });
  document.getElementById('lock-enable-inp').addEventListener('change', function() {
    if (this.checked && !cfg.lockPinHash) {
      this.checked = false;
      toast('Pehle neeche PIN set karo');
      return;
    }
    cfg.lockEnabled = this.checked;
    LS.set('chaman_cfg', cfg);
    updateLockUI();
    toast(this.checked ? '🔒 Lock ON' : '🔓 Lock OFF');
  });

  // Settings tabs
  document.querySelectorAll('.settings-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      document.querySelectorAll('.settings-tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.settings-tab-pane').forEach(p => p.classList.toggle('active', p.getAttribute('data-pane') === tab));
    });
  });
})();
