// ═══════════════════════════════════════════════════════════════════════
// settings.js — onboarding wizard, first-run setup screen, Settings modal
// (tabs, save-settings, tool-key saving, show/hide password toggle).
// ═══════════════════════════════════════════════════════════════════════

// ════════════════════════════════════
// SETTINGS
// ════════════════════════════════════

function renderSetupFbList() {
  const list = document.getElementById('setup-fb-list');
  if (!list) return;
  if (!cfg.fallbacks || !cfg.fallbacks.length) {
    list.innerHTML = '<div style="font-size:0.8rem;color:var(--text-ghost);padding:4px 0">(abhi tak koi provider add nahi hua)</div>';
    return;
  }
  list.innerHTML = cfg.fallbacks.map((f, i) =>
    `<div class="mem-item"><span>${i + 1}. ${f.label} — ${f.model}</span><button class="mem-del" onclick="delFallback(${i}); renderSetupFbList();">✕</button></div>`
  ).join('');
}

function onSetupFbPresetChange() {
  const presetKey = document.getElementById('setup-fb-preset').value;
  const preset = PROVIDER_PRESETS[presetKey];
  document.getElementById('setup-model').placeholder = preset?.model ? `e.g. ${preset.model}` : 'Model ID';
  document.getElementById('setup-fb-base-group').style.display = presetKey === 'custom' ? 'block' : 'none';
  document.getElementById('setup-fb-groq-fetch-wrap').style.display = presetKey === 'groq' ? 'flex' : 'none';
}

function addSetupFallback() {
  // FLAG(key-storage): see providers.js — reads API key from a form input and
  // stores it client-side (cfg.fallbacks / localStorage).
  const presetKey = document.getElementById('setup-fb-preset').value;
  const preset = PROVIDER_PRESETS[presetKey];
  const key = document.getElementById('setup-key').value.trim();
  let model = document.getElementById('setup-model').value.trim();
  if (!key) { toast('Pehle API key dalo'); return; }
  if (!model) model = preset.model;
  if (!model) { toast('Model ID dalo'); return; }
  let base = preset.base;
  if (presetKey === 'custom') {
    base = document.getElementById('setup-fb-base').value.trim();
    if (!base) { toast('Custom provider ke liye Base URL dalo'); return; }
  }
  cfg.fallbacks = cfg.fallbacks || [];
  cfg.fallbacks.push({ label: preset.label, base, key, model });
  LS.set('chaman_cfg', cfg);
  document.getElementById('setup-key').value = '';
  document.getElementById('setup-model').value = '';
  document.getElementById('setup-fb-base').value = '';
  renderSetupFbList();
  toast('✓ Provider chain mein add ho gaya!');
}

function saveSetup() {
  document.getElementById('setup-screen').classList.add('hidden');
  toast('✓ Sab set ho gaya!');
}

function setModelS(m) {
  document.getElementById('fb-model').value = m;
}

// ════════════════════════════════════
// ONBOARDING (basic profile: naam, age, etc)
// ════════════════════════════════════

// PHASE 1 NOTE: onboarding used to open with a "add your own AI provider
// key" step here (type: 'fallback') — a leftover from before the server
// got its own key pool (lib/keyManager.js). Removed: it contradicted the
// whole point of that migration and made the (optional, rarely-needed)
// "use my own key" override feel like a mandatory first-run gate. That
// override still exists — Settings → AI Providers — for anyone who
// actually wants it, it just doesn't belong in onboarding anymore.
const OB_STEPS = [
  { key: 'name', emoji: '👋', q: 'Tera naam kya hai?', sub: 'Taaki main tujhe sahi se bulau', type: 'text', placeholder: 'Jaise: Chaman', required: true },
  { key: 'age', emoji: '🎂', q: 'Age kitni hai?', sub: 'Optional hai, skip bhi kar sakta hai', type: 'number', placeholder: 'Jaise: 20', required: false },
  { key: 'work', emoji: '💼', q: 'Tu kya karta hai?', sub: 'Kaam, padhai, ya interest — jo bhi ho', type: 'text', placeholder: 'Jaise: Developer, Student...', required: false },
  { key: 'lang', emoji: '💬', q: 'Kis language mein baat karu?', sub: 'Baad mein Settings se bhi badal sakte ho', type: 'chips', options: ['Hinglish', 'Pure Hindi', 'English'], required: false },
  { key: 'extra', emoji: '📝', q: 'Kuch aur jo mujhe pata hona chahiye?', sub: 'Koi project, pasand, habit — kuch bhi (optional)', type: 'textarea', placeholder: 'Yahan likho...', required: false }
];

let obIndex = 0;

let obAnswers = {};


function startOnboarding() {
  obIndex = 0;
  obAnswers = {};
  document.getElementById('onboard-screen').classList.remove('hidden');
  renderObProgress();
  renderObStep();
}

function renderObProgress() {
  const wrap = document.getElementById('ob-progress');
  wrap.innerHTML = '';
  OB_STEPS.forEach((s, i) => {
    const d = document.createElement('div');
    d.className = 'ob-dot' + (i === obIndex ? ' on' : '') + (i < obIndex ? ' done' : '');
    wrap.appendChild(d);
  });
}

function renderObStep() {
  const step = OB_STEPS[obIndex];
  const holder = document.getElementById('ob-step-holder');
  let inputHtml = '';
  if (step.type === 'text') {
    inputHtml = `<input class="form-inp" id="ob-input" type="text" placeholder="${step.placeholder || ''}" value="${obAnswers[step.key] || ''}"/>`;
  } else if (step.type === 'number') {
    inputHtml = `<input class="form-inp" id="ob-input" type="number" placeholder="${step.placeholder || ''}" value="${obAnswers[step.key] || ''}"/>`;
  } else if (step.type === 'textarea') {
    inputHtml = `<textarea class="form-ta" id="ob-input" rows="3" placeholder="${step.placeholder || ''}">${obAnswers[step.key] || ''}</textarea>`;
  } else if (step.type === 'chips') {
    inputHtml = `<div class="ob-chips" id="ob-chips">` + step.options.map(o => `<button type="button" class="ob-chip${obAnswers[step.key] === o ? ' picked' : ''}" data-v="${o}">${o}</button>`).join('') + `</div>`;
  } else if (step.type === 'password') {
    inputHtml = `<div class="key-wrap"><input class="form-inp" id="ob-input" type="password" placeholder="${step.placeholder || ''}" value="${obAnswers[step.key] || ''}"/><button type="button" class="key-eye" id="ob-eye"><svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button></div>`;
  } else if (step.type === 'fallback') {
    inputHtml = `<div class="mem-list" id="ob-fb-list" style="max-height:150px;margin-bottom:10px"></div>
      <select class="form-sel" id="ob-fb-preset" style="margin-bottom:8px">
        <option value="openrouter">OpenRouter</option>
        <option value="groq">Groq</option>
        <option value="mistral">Mistral AI</option>
        <option value="together">Together AI</option>
        <option value="cerebras">Cerebras</option>
        <option value="custom">Custom (koi aur free provider)</option>
      </select>
      <input class="form-inp" id="ob-fb-key" type="password" placeholder="API key" style="margin-bottom:8px"/>
      <input class="form-inp" id="ob-fb-model" type="text" placeholder="Model ID" style="margin-bottom:8px"/>
      <div id="ob-fb-groq-fetch-wrap" style="display:none;align-items:center;gap:8px;margin-bottom:8px">
        <select class="form-sel" id="ob-fb-groq-models-sel" style="flex:1">
          <option value="">-- Free models load karo --</option>
        </select>
        <button class="btn-ghost" id="ob-fb-fetch-models-btn" type="button" style="white-space:nowrap;padding:8px 14px">🔄 Fetch</button>
      </div>
      <input class="form-inp" id="ob-fb-base" type="text" placeholder="Base URL (sirf Custom ke liye): https://.../v1/chat/completions" style="margin-bottom:8px;display:none"/>
      <button class="btn-ghost" id="ob-fb-add" type="button" style="width:100%">➕ Provider Chain mein Add karo</button>`;
  }
  holder.innerHTML = `
    <div class="ob-step">
      <div class="ob-emoji">${step.emoji}</div>
      <div class="ob-q">${step.q}</div>
      <div class="ob-sub">${step.sub}</div>
      <div class="form-group">${inputHtml}</div>
      <div class="ob-nav">
        ${obIndex > 0 ? '<button class="btn-ghost" id="ob-back" type="button" style="flex:1">← Peeche</button>' : ''}
        <button class="btn-prim" id="ob-next" type="button" style="flex:2">${obIndex === OB_STEPS.length - 1 ? 'Ho gaya ✓' : 'Aage →'}</button>
      </div>
      ${step.required ? '' : '<button class="ob-skip" id="ob-skip" type="button">Skip karo</button>'}
    </div>`;
  if (step.type === 'chips') {
    holder.querySelectorAll('.ob-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        obAnswers[step.key] = chip.getAttribute('data-v');
        holder.querySelectorAll('.ob-chip').forEach(c => c.classList.toggle('picked', c === chip));
      });
    });
  }
  if (step.type === 'password') {
    const eyeBtn = document.getElementById('ob-eye');
    if (eyeBtn) eyeBtn.addEventListener('click', () => {
      const inp = document.getElementById('ob-input');
      inp.type = inp.type === 'password' ? 'text' : 'password';
    });
  }
  if (step.type === 'fallback') {
    renderObFbList();
    document.getElementById('ob-fb-preset').addEventListener('change', onObFbPresetChange);
    document.getElementById('ob-fb-add').addEventListener('click', addObFallback);
    document.getElementById('ob-fb-fetch-models-btn').addEventListener('click', () => fetchGroqModels('ob-fb-key', 'ob-fb-groq-models-sel', 'ob-fb-model'));
    document.getElementById('ob-fb-groq-models-sel').addEventListener('change', (e) => { if (e.target.value) document.getElementById('ob-fb-model').value = e.target.value; });
    onObFbPresetChange();
  }
  document.getElementById('ob-next').addEventListener('click', onObNext);
  if (obIndex > 0) document.getElementById('ob-back').addEventListener('click', onObBack);
  const skipBtn = document.getElementById('ob-skip');
  if (skipBtn) skipBtn.addEventListener('click', onObSkip);
  const inputEl = document.getElementById('ob-input');
  if (inputEl && step.type !== 'chips' && step.type !== 'fallback') {
    inputEl.focus();
    inputEl.addEventListener('keydown', e => { if (e.key === 'Enter' && step.type !== 'textarea') onObNext(); });
  }
}

function onObNext() {
  const step = OB_STEPS[obIndex];
  if (step.type !== 'chips' && step.type !== 'fallback') {
    const v = document.getElementById('ob-input').value.trim();
    if (step.required && !v) { toast('Ye field zaroori hai'); return; }
    if (v) obAnswers[step.key] = v; else delete obAnswers[step.key];
  }
  advanceOb();
}

function onObSkip() { advanceOb(); }

function onObBack() { obIndex--; renderObProgress(); renderObStep(); }

// Onboarding's own mini fallback-add UI (writes straight into cfg.fallbacks)

function renderObFbList() {
  const list = document.getElementById('ob-fb-list');
  if (!list) return;
  if (!cfg.fallbacks || !cfg.fallbacks.length) {
    list.innerHTML = '<div style="font-size:0.8rem;color:var(--text-ghost);padding:4px 0">(koi provider add nahi kiya — AI kaam nahi karega jab tak ek bhi provider add na ho)</div>';
    return;
  }
  list.innerHTML = cfg.fallbacks.map((f, i) =>
    `<div class="mem-item"><span>${i + 1}. ${f.label} — ${f.model}</span><button class="mem-del" onclick="delFallback(${i})">✕</button></div>`
  ).join('');
}

function onObFbPresetChange() {
  const presetKey = document.getElementById('ob-fb-preset').value;
  const preset = PROVIDER_PRESETS[presetKey];
  document.getElementById('ob-fb-model').placeholder = preset?.model ? `e.g. ${preset.model}` : 'Model ID';
  document.getElementById('ob-fb-base').style.display = presetKey === 'custom' ? 'block' : 'none';
  document.getElementById('ob-fb-groq-fetch-wrap').style.display = presetKey === 'groq' ? 'flex' : 'none';
}

function addObFallback() {
  // FLAG(key-storage): see providers.js — same client-side key storage pattern
  // (onboarding wizard version of addFallback()).
  const presetKey = document.getElementById('ob-fb-preset').value;
  const preset = PROVIDER_PRESETS[presetKey];
  const key = document.getElementById('ob-fb-key').value.trim();
  let model = document.getElementById('ob-fb-model').value.trim();
  if (!key) { toast('Pehle API key dalo'); return; }
  if (!model) model = preset.model;
  if (!model) { toast('Model ID dalo'); return; }
  let base = preset.base;
  if (presetKey === 'custom') {
    base = document.getElementById('ob-fb-base').value.trim();
    if (!base) { toast('Custom provider ke liye Base URL dalo'); return; }
  }
  cfg.fallbacks = cfg.fallbacks || [];
  cfg.fallbacks.push({ label: preset.label, base, key, model });
  LS.set('chaman_cfg', cfg);
  document.getElementById('ob-fb-key').value = '';
  document.getElementById('ob-fb-model').value = '';
  document.getElementById('ob-fb-base').value = '';
  renderObFbList();
  toast('✓ Provider chain mein add ho gaya!');
}

function advanceOb() {
  if (obIndex < OB_STEPS.length - 1) {
    obIndex++;
    renderObProgress();
    renderObStep();
  } else {
    finishOnboarding();
  }
}

function finishOnboarding() {
  cfg.permMemory = cfg.permMemory || [];
  const prefixes = ['Naam →', 'Age →', 'Kaam/Interest →', 'Extra info →'];
  cfg.permMemory = cfg.permMemory.filter(m => !prefixes.some(p => m.startsWith(p)));
  if (obAnswers.name) cfg.permMemory.push(`Naam → ${obAnswers.name}`);
  if (obAnswers.age) cfg.permMemory.push(`Age → ${obAnswers.age}`);
  if (obAnswers.work) cfg.permMemory.push(`Kaam/Interest → ${obAnswers.work}`);
  if (obAnswers.extra) cfg.permMemory.push(`Extra info → ${obAnswers.extra}`);
  if (obAnswers.lang) {
    const map = { 'Hinglish': 'hinglish', 'Pure Hindi': 'hindi', 'English': 'english' };
    cfg.lang = map[obAnswers.lang] || cfg.lang;
  }
  cfg.onboarded = true;
  LS.set('chaman_cfg', cfg);
  document.getElementById('onboard-screen').classList.add('hidden');
  toast(obAnswers.name ? `Welcome, ${obAnswers.name}! 🎉` : 'Sab set ho gaya! 🎉');
}

// ════════════════════════════════════
// APP LOCK (PIN)
// ════════════════════════════════════

function openSettings() {
  document.getElementById("sys-prompt").value = cfg.sysPrompt;
  document.getElementById("lang-sel").value = cfg.lang;
  document.getElementById("show-model-tag-inp").checked = cfg.showModelTag !== false;
  document.getElementById("show-followups-inp").checked = cfg.showFollowUps !== false;
  document.getElementById("settings-modal").classList.remove("hidden");
  document.getElementById('tool-key-tmdb').value = cfg.toolKeys?.tmdb || '';
  document.getElementById('tool-key-giphy').value = cfg.toolKeys?.giphy || '';
  document.getElementById('tool-key-nasa').value = cfg.toolKeys?.nasa || '';
  renderFallbacks();
  onFbPresetChange();
  document.getElementById('lock-enable-inp').checked = !!(cfg.lockEnabled && cfg.lockPinHash);
  updateLockUI();
  document.querySelectorAll('.settings-tab-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === 'general'));
  document.querySelectorAll('.settings-tab-pane').forEach(p => p.classList.toggle('active', p.getAttribute('data-pane') === 'general'));
}

function saveSettings() {
  cfg.sysPrompt = document.getElementById('sys-prompt').value.trim();
  cfg.lang = document.getElementById('lang-sel').value;
  cfg.showModelTag = document.getElementById('show-model-tag-inp').checked;
  cfg.showFollowUps = document.getElementById('show-followups-inp').checked;
  LS.set('chaman_cfg', cfg);
  closeModal('settings-modal');
  toast('✓ Settings save ho gaye!');
}


function saveToolKeys() {
  // FLAG(key-storage): persists tool API keys (TMDB/Giphy) to cfg -> localStorage.
  cfg.toolKeys = {
    tmdb: document.getElementById('tool-key-tmdb').value.trim(),
    giphy: document.getElementById('tool-key-giphy').value.trim(),
    nasa: document.getElementById('tool-key-nasa').value.trim(),
  };
  LS.set('chaman_cfg', cfg);
  toast('✓ Tool keys save ho gaye!');
}

// ════════════════════════════════════
// FALLBACK ENDPOINTS
// ════════════════════════════════════

function toggleEye(inputId, btn) {
  const inp = document.getElementById(inputId);
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  btn.innerHTML = show
    ? '<svg viewBox="0 0 24 24" style="width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
    : '<svg viewBox="0 0 24 24" style="width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    }
