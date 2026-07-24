// ═══════════════════════════════════════════════════════════════════════
// js/systemPrompt.js — PHASE 1 UPDATE: full prompt building has moved
// server-side (see lib/systemPrompt.js in the repo root). This file no
// longer builds prompt TEXT — it only gathers client-side state (memory,
// sessions, language, creator-verify status, local exec-backend snapshot)
// into a plain data object and hands it off; providers.js sends that
// object to /api/chat as `promptInputs`, and the server builds the actual
// prompt text there — including the identity protocol, which no longer
// exists ANYWHERE in this client bundle. Previously that section was
// readable via View Source (see the honest limitation note that used to
// be here); this move is the whole point of Phase 1's "Core Architecture
// Shift".
//
// Kept the same function name + call signature (buildPrompt(forPreview))
// so every existing call site in chat-core.js
// (`streamChat(aiBub, buildPrompt(), messages)`) keeps working unchanged
// — only the SHAPE of what it returns changed: a data object now, not a
// text string.
// ═══════════════════════════════════════════════════════════════════════

function buildPrompt(forPreview) {
  return {
    sysPromptOverride: cfg.sysPrompt || '',
    lang: cfg.lang,
    permMemory: cfg.permMemory || [],
    oldSummary: cfg.oldSummary || '',
    // PHASE 3: cfg.sessions entries now carry full `messages` for guests
    // (see js/sessions.js) — strip that here so promptInputs stays small;
    // the server only ever reads .date/.summary from this anyway (see
    // lib/systemPrompt.js buildPrompt's "[RECENT SESSIONS]" block). The
    // currently OPEN chat's full messages are sent separately as
    // `messages` in the /api/chat request body, not through here.
    sessions: (cfg.sessions || [])
      .filter(s => s.id !== (typeof currentSessionId !== 'undefined' ? currentSessionId : null))
      .map(s => ({ date: s.date, summary: s.summary })),
    tempCreatorSession: typeof tempCreatorSession !== 'undefined' ? !!tempCreatorSession : false,
    isCreatorActive: typeof isCreatorActive === 'function' ? isCreatorActive() : false, // PHASE 5: cfg.isCreator removed — isCreatorActive() (admin.js) is the only source of truth now
    // PHASE 5: Najeef's own project/personal notes (lib/adminMemory.js) —
    // only ever sent when THIS session is creator-active, cached client-
    // side in adminState.creatorMemory (refreshed by admin.js after
    // checkAdminStatus()/tryAdminBackupCode() confirm admin access).
    creatorMemory: (typeof isCreatorActive === 'function' && isCreatorActive() && typeof adminState !== 'undefined') ? (adminState.creatorMemory || []) : [],
    envSnapshot: typeof envSnapshot !== 'undefined' ? envSnapshot : null,
    execBackendUrl: typeof getExecBackend === 'function' ? getExecBackend() : '',
    // PHASE 4: /instruction rules — Google users only. Guests never have
    // anything in cfg.instructions (settings.js only ever populates it
    // after a Google login), but the isGuestUser() check here is a second,
    // explicit belt-and-braces guard so a stale cached array from a
    // previous logged-in session on this same device can never leak into
    // a guest session's prompt.
    activeInstructions: (typeof isGuestUser === 'function' && isGuestUser()) ? [] : (cfg.instructions || []),
    forPreview: !!forPreview,
  };
}
