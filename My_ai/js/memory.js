// ═══════════════════════════════════════════════════════════════════════
// js/memory.js — "Permanent Memory (Facts)" panel + the mem-modal umbrella
// opener. Ported from the original pre-rebuild single-file app (where
// this lived inline) — this file itself never got created during the v2
// split, which is why openMemModal/addMem/delMem/clearAllMemory were
// referenced (main.js, instructions.js comments) but didn't exist
// anywhere, silently crashing the header-icon click-wiring loop in
// main.js on every page load (Memory was first in that loop, so it also
// took Settings + New Chat + everything wired after it down with it).
//
// cfg.permMemory itself was never lost — js/config.js defaults it,
// js/systemPrompt.js already reads it into the prompt, js/settings.js
// (onboarding) and js/chat-core.js ([ASK_USER] flow) already push to it.
// Only the UI layer (render/add/delete + the modal-open umbrella) was
// missing. This file is that UI layer.
// ═══════════════════════════════════════════════════════════════════════

function renderPermMem() {
  const list = document.getElementById('perm-mem-list');
  if (!list) return;
  cfg.permMemory = cfg.permMemory || [];
  if (!cfg.permMemory.length) {
    list.innerHTML = '<div style="font-size:0.8rem;color:var(--text-ghost);padding:4px 0">(koi memory nahi)</div>';
    return;
  }
  list.innerHTML = cfg.permMemory.map((m, i) =>
    `<div class="mem-item"><span>${m}</span><button class="mem-del" onclick="delMem(${i})">✕</button></div>`
  ).join('');
}

function addMem() {
  const inp = document.getElementById('mem-inp');
  const v = (inp?.value || '').trim();
  if (!v) return;
  cfg.permMemory = cfg.permMemory || [];
  cfg.permMemory.push(v);
  LS.set('chaman_cfg', cfg);
  inp.value = '';
  renderPermMem();
  toast('💾 Memory add ho gaya!');
}

function delMem(i) {
  cfg.permMemory.splice(i, 1);
  LS.set('chaman_cfg', cfg);
  renderPermMem();
}

/**
 * clearAllMemory() — matches the original's scope (facts + local session
 * cache + rolling old-summary). For a logged-in (Google) user this only
 * clears the LOCAL metadata cache (cfg.sessions) per js/sessions.js's own
 * storage split — the authoritative copies in Firestore are untouched by
 * this button; deleting those is what the per-session 🗑️ delete action
 * (js/sessions.js onSessListClick) is for. Guests, whose sessions live
 * only in cfg.sessions to begin with, get a true full wipe.
 */
function clearAllMemory() {
  if (!confirm('Sab memory aur sessions (is device se) delete karne ho?')) return;
  cfg.permMemory = [];
  cfg.sessions = [];
  cfg.oldSummary = '';
  LS.set('chaman_cfg', cfg);
  renderPermMem();
  renderSessions();
  const oldSumEl = document.getElementById('old-summary');
  if (oldSumEl) oldSumEl.textContent = '(koi summary nahi abhi)';
  toast('🗑️ Sab clear ho gaya');
}

/**
 * openMemModal() — umbrella opener for the shared "🧠 Memory & Chats"
 * modal, which by this point in the build hosts THREE panels contributed
 * by three different phases: permanent-memory facts (this file),
 * sessions list (js/sessions.js, Phase 3), and instructions list
 * (js/instructions.js, Phase 4). Each panel's own render function is
 * responsible for its own container/empty-state — this just triggers all
 * three and reveals the modal.
 */
function openMemModal() {
  renderPermMem();
  if (typeof refreshSessionList === 'function') refreshSessionList().then(renderSessions).catch(() => renderSessions());
  else if (typeof renderSessions === 'function') renderSessions();
  if (typeof refreshInstructionList === 'function') refreshInstructionList().then(renderInstructions).catch(() => renderInstructions());
  else if (typeof renderInstructions === 'function') renderInstructions();
  const oldSumEl = document.getElementById('old-summary');
  if (oldSumEl) oldSumEl.textContent = cfg.oldSummary || '(koi summary nahi abhi)';
  document.getElementById('mem-modal').classList.remove('hidden');
}
