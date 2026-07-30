// ═══════════════════════════════════════════════════════════════════════
// js/instructions.js — Phase 4: User Instructions ("/instruction <rule>").
//
// GOOGLE USERS ONLY (explicit decision — unlike sessions, guests get NO
// local-only fallback here, the feature simply isn't available to them).
//
// Flow (plan Section 4 — "AI confirms first"):
//   1. User types "/instruction <rule>" (chat-core.js sendMsg() catches it).
//   2. instructionGateCheck(rule) runs FIRST, client-side, before any AI
//      call — guest block, max-10 pre-check, first-use T&C. Cheap checks
//      that save an AI call if they're going to fail anyway.
//   3. If gate passes, chat-core.js sends the proposal to the AI as a
//      normal turn (see proposeInstructionMsg() there). The AI itself does
//      the SCOPE validation (tone/style-only) per lib/systemPrompt.js's
//      [INSTRUCTION PROTOCOL] section, and either declines in its own
//      words (nothing saved) or confirms + emits an [INSTRUCTION_SAVE] tag.
//   4. chat-core.js detects that tag after the stream completes and calls
//      saveConfirmedInstruction() here — THIS is the actual persistence
//      point, mirroring lib/instructionStore.js's max-10 as the real
//      source of truth (client pre-check above is just a fast-path).
//
// Wired into the existing "Memory & History" modal (mem-modal) as a new
// list section, same modal sessions.js/memory.js already use — needs a
// `#instr-list` container in index.html (see settings.js openMemModal()
// call site for the render hookup).
// ═══════════════════════════════════════════════════════════════════════

const MAX_ACTIVE_INSTRUCTIONS = 10; // mirrors lib/instructionStore.js — client-side fast-path only, server is authoritative

// ── server call helper (mirrors js/sessions.js callSessionsApi style) ──

async function callInstructionsApi(action, extra) {
  const idToken = await getAuthToken();
  const res = await fetch('/api/instructions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken, action, ...extra }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || ('Instruction API error ' + res.status));
  return data;
}

// ── gate check — called BEFORE anything is sent to the AI ──

/**
 * instructionGateCheck(rule) — returns true if chat-core.js should go
 * ahead and send this /instruction proposal to the AI, false if it should
 * stop right here (this function already showed the right toast/confirm
 * for why).
 */
async function instructionGateCheck(rule) {
  if (!rule || !rule.trim()) {
    toast('Instruction ke baad kuch rule bhi likho — jaise "/instruction chhote replies de"');
    return false;
  }

  if (typeof isGuestUser === 'function' && isGuestUser()) {
    toast('🔒 Instructions sirf Google login ke saath available hain — guest mein nahi');
    return false;
  }

  if ((cfg.instructions || []).length >= MAX_ACTIVE_INSTRUCTIONS) {
    toast(`Max ${MAX_ACTIVE_INSTRUCTIONS} active instructions already hain — Memory panel se pehle koi hata do`);
    return false;
  }

  if (!cfg.instructionsTCSeen) {
    // First-use-only heads-up (plan Section 4: "T&C checkbox on first use,
    // explaining scope/limits"). PHASE 8: proper checkbox modal (see
    // #instr-tc-modal in index.html + showInstructionTCModal() below) —
    // replaces the old plain confirm() popup this used to be.
    const ok = await showInstructionTCModal();
    if (!ok) return false;
    cfg.instructionsTCSeen = true;
    LS.set('chaman_cfg', cfg);
  }

  return true;
}

/**
 * showInstructionTCModal() — Phase 8. Opens #instr-tc-modal (checkbox +
 * Continue/Cancel) and resolves once the user acts on it: true only if
 * they ticked the box AND pressed Continue; Cancel, the ✕ button, or a
 * backdrop click all resolve false. Falls back to the old confirm() if
 * this build of index.html doesn't have the modal markup yet, so
 * "/instruction" never silently breaks.
 */
function showInstructionTCModal() {
  return new Promise((resolve) => {
    const modal = document.getElementById('instr-tc-modal');
    const checkbox = document.getElementById('instr-tc-checkbox');
    const continueBtn = document.getElementById('instr-tc-continue-btn');
    const cancelBtn = document.getElementById('instr-tc-cancel-btn');
    const closeBtn = document.getElementById('instr-tc-close-btn');

    if (!modal || !checkbox || !continueBtn || !cancelBtn) {
      resolve(confirm(
        'Instructions sirf TONE/STYLE preferences ke liye hain (jaise "chhote replies de", "casual baat kar") — ' +
        'koi system/technical setting badalne ke liye NAHI. Max 10 active rakh sakte ho.\n\nAage badhna hai?'
      ));
      return;
    }

    checkbox.checked = false;
    continueBtn.disabled = true;

    const onCheck = () => { continueBtn.disabled = !checkbox.checked; };
    const onBackdrop = (e) => { if (e.target === modal) onCancel(); };
    const cleanup = () => {
      checkbox.removeEventListener('change', onCheck);
      continueBtn.removeEventListener('click', onContinue);
      cancelBtn.removeEventListener('click', onCancel);
      closeBtn?.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onBackdrop);
      modal.classList.add('hidden');
    };
    function onContinue() { cleanup(); resolve(true); }
    function onCancel() { cleanup(); resolve(false); }

    checkbox.addEventListener('change', onCheck);
    continueBtn.addEventListener('click', onContinue);
    cancelBtn.addEventListener('click', onCancel);
    closeBtn?.addEventListener('click', onCancel);
    modal.addEventListener('click', onBackdrop);

    modal.classList.remove('hidden');
  });
}

// ── persistence — called AFTER the AI emits [INSTRUCTION_SAVE] ──

/**
 * saveConfirmedInstruction(ruleText) — actually writes to Firestore (via
 * api/instructions.js) and updates the local cache + panel. Throws on
 * failure (e.g. server-side max-10 race) — caller (chat-core.js) catches
 * and toasts.
 */
async function saveConfirmedInstruction(ruleText) {
  const result = await callInstructionsApi('add', { text: ruleText });
  cfg.instructions = cfg.instructions || [];
  cfg.instructions.push({ id: result.id, text: result.text });
  LS.set('chaman_cfg', cfg);
  renderInstructions();
  return result;
}

// ── list / render (mem-modal — same panel as memory.js's #perm-mem-list) ──

async function refreshInstructionList() {
  if (typeof isGuestUser === 'function' && isGuestUser()) return; // feature doesn't exist for guests, nothing to fetch
  try {
    const { instructions } = await callInstructionsApi('list', {});
    cfg.instructions = instructions.map(i => ({ id: i.id, text: i.text }));
    LS.set('chaman_cfg', cfg);
  } catch (e) {
    console.warn('[instructions] list refresh failed:', e.message);
  }
}

function renderInstructions() {
  const list = document.getElementById('instr-list');
  if (!list) return; // container not in this build of index.html yet — no-op rather than throw

  if (typeof isGuestUser === 'function' && isGuestUser()) {
    list.innerHTML = '<div style="font-size:0.8rem;color:var(--text-ghost);padding:4px 0">Instructions sirf Google login ke saath available hain</div>';
    return;
  }

  const instructions = cfg.instructions || [];
  if (!instructions.length) {
    list.innerHTML = '<div style="font-size:0.8rem;color:var(--text-ghost);padding:4px 0">(koi instruction nahi abhi — chat mein "/instruction <rule>" type karo)</div>';
    return;
  }
  list.innerHTML = instructions.map(ins =>
    `<div class="mem-item"><span>${ins.text}</span><button class="mem-del" onclick="deleteInstructionUI('${ins.id}')">✕</button></div>`
  ).join('');
}

async function deleteInstructionUI(id) {
  try {
    await callInstructionsApi('delete', { id });
    const idx = (cfg.instructions || []).findIndex(i => i.id === id);
    if (idx !== -1) cfg.instructions.splice(idx, 1);
    LS.set('chaman_cfg', cfg);
    renderInstructions();
    toast('🗑️ Instruction hata di gayi');
  } catch (e) {
    toast('Delete fail ho gaya');
  }
}
