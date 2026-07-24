// ═══════════════════════════════════════════════════════════════════════
// lib/keyManager.js — server-side key pool + per-session rotation +
// basic health tracking.
//
// PHASE-1 SCOPE (per main plan, Section 2 + Suggested Build Order item 1):
// "single provider first, then scale to full pool". Started with just
// Groq; now scaled to 4 providers (Groq, Cerebras, Mistral, OpenRouter) —
// add more the same way: an entry in PROVIDER_CONFIG (same shape) + its
// name in PROVIDER_ORDER, once more key pools are gathered.
//
// PHASE-2 TODO (per plan Section 2 — "Health tracking: stored in
// Firestore"): the `health` object below is in-memory only. On Vercel this
// resets on every cold start and is NOT shared across concurrent serverless
// instances — good enough to survive a single dead key mid-session, but
// not a durable "which key is cooling down" record. Swap the read/write in
// ensureHealthBucket/markKeyFailed/markKeyOk for Firestore calls when that
// phase starts; the buildAttemptChain() call signature can stay the same.
// ═══════════════════════════════════════════════════════════════════════

// PHASE 7 (plan Section 9, "Model routing: simple queries → fast/cheap
// model; complex/coding queries → bigger model"): each provider now
// carries TWO models instead of one. `models.big` is the same capable
// model this provider always used; `models.fast` is a smaller/quicker
// model for simple queries AND every BARE MODE call (follow-up chips,
// session summaries — see api/chat.js classifyTier()). Same key works for
// both models within a provider, so this doesn't change key rotation/
// health tracking at all — only WHICH model string gets sent upstream.
const PROVIDER_CONFIG = {
  groq: {
    label: 'Groq',
    base: 'https://api.groq.com/openai/v1/chat/completions',
    models: {
      big: 'llama-3.3-70b-versatile',      // complex/coding queries — best available on Groq free tier
      fast: 'llama-3.1-8b-instant',    // simple queries + bare-mode utility calls (follow-ups, summaries)
    },
    keysEnv: 'GROQ_KEYS', // Vercel env var, comma-separated: "key1,key2,key3"
  },
  // 4-provider pool (33 keys gathered: 9 Groq, 8 Cerebras, 8 Mistral, 8
  // OpenRouter). NVIDIA/Together deliberately skipped — their free tiers
  // are credit-capped, not daily-reset, so not worth wiring in as core
  // rotation providers right now (can be added later as extra fallback
  // entries, same shape, if ever needed).
  cerebras: {
    label: 'Cerebras',
    base: 'https://api.cerebras.ai/v1/chat/completions',
    models: {
      big: 'gpt-oss-120b',   // 1M tokens/day free tier, 30 RPM
      fast: 'qwen-3-32b',
    },
    keysEnv: 'CEREBRAS_KEYS',
  },
  mistral: {
    label: 'Mistral AI',
    base: 'https://api.mistral.ai/v1/chat/completions',
    models: {
      big: 'mistral-small-latest',   // Experiment tier: free, ~1B tokens/month
      fast: 'ministral-8b-latest',
    },
    keysEnv: 'MISTRAL_KEYS',
  },
  openrouter: {
    label: 'OpenRouter',
    base: 'https://openrouter.ai/api/v1/chat/completions',
    models: {
      big: 'meta-llama/llama-3.3-70b-instruct:free',
      fast: 'openrouter/free',   // auto-router — picks whatever free model is healthy right now, good safety net since OpenRouter's free lineup rotates often
    },
    keysEnv: 'OPENROUTER_KEYS',
  },
};

// Provider-level try-order (only matters once >1 provider is configured —
// a whole provider is only skipped if ALL its keys are dead/cooling).
// Groq first (fastest + most reliable free tier), then Cerebras (huge
// daily token volume), then Mistral, then OpenRouter last (free lineup
// there is the most volatile of the four, so it's the fallback-of-
// fallbacks rather than a primary).
const PROVIDER_ORDER = ['groq', 'cerebras', 'mistral', 'openrouter']; // Groq is primary as requested

// In-memory health state: { [provider]: { [keyIndex]: { deadUntil: ms, failCount: n } } }
const health = {};

function getKeysForProvider(provider) {
  const cfg = PROVIDER_CONFIG[provider];
  if (!cfg) return [];
  const raw = process.env[cfg.keysEnv] || '';
  return raw.split(',').map(k => k.trim()).filter(Boolean);
}

function ensureHealthBucket(provider, count) {
  if (!health[provider]) health[provider] = {};
  for (let i = 0; i < count; i++) {
    if (!health[provider][i]) health[provider][i] = { deadUntil: 0, failCount: 0 };
  }
}

// Deterministic hash so the SAME session tends to land on the SAME key
// across messages (per-session rotation, not per-message — plan Section 2:
// "smooth experience, no jarring mid-convo switches").
function hashToIndex(sessionId, mod) {
  if (!mod) return 0;
  let h = 0;
  const str = String(sessionId || 'anon');
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h % mod;
}

// Cooldown grows with repeated failures (1min, 2min, 3min... capped at
// 10min) instead of a flat window, so a genuinely dead key backs off
// further each time instead of getting retried every single minute.
const COOLDOWN_STEP_MS = 60 * 1000;
const MAX_COOLDOWN_STEPS = 10;

function markKeyFailed(provider, index) {
  ensureHealthBucket(provider, index + 1);
  const bucket = health[provider][index];
  bucket.failCount += 1;
  bucket.deadUntil = Date.now() + COOLDOWN_STEP_MS * Math.min(bucket.failCount, MAX_COOLDOWN_STEPS);
}

function markKeyOk(provider, index) {
  ensureHealthBucket(provider, index + 1);
  health[provider][index] = { deadUntil: 0, failCount: 0 };
}

/**
 * buildAttemptChain(sessionId, tier) — returns an ordered array of
 * attempts to try for this request:
 *   [{ provider, index, key, label, base, model }, ...]
 *
 * `tier` is 'fast' or 'big' (defaults to 'big' if omitted/unrecognized —
 * matches pre-Phase-7 behavior of always using the capable model, so any
 * caller that hasn't been updated to pass a tier still works unchanged).
 * Resolves to PROVIDER_CONFIG[provider].models[tier], falling back to
 * models.big if that specific tier isn't configured for a provider (e.g.
 * a future provider that only has one model listed).
 *
 * Within each provider: starts at the session's hashed key index, wraps
 * around through all keys for that provider, with keys NOT in cooldown
 * tried before keys that ARE in cooldown (better than a hard failure if
 * literally everything is cooling down).
 */
function buildAttemptChain(sessionId, tier) {
  const resolvedTier = tier === 'fast' ? 'fast' : 'big';
  const chain = [];
  for (const provider of PROVIDER_ORDER) {
    const keys = getKeysForProvider(provider);
    if (!keys.length) continue; // provider not configured (no env var set) — skip silently
    ensureHealthBucket(provider, keys.length);

    const startIdx = hashToIndex(sessionId, keys.length);
    const now = Date.now();
    const ordered = [];
    for (let step = 0; step < keys.length; step++) {
      ordered.push((startIdx + step) % keys.length);
    }
    const fresh = ordered.filter(i => health[provider][i].deadUntil <= now);
    const cooling = ordered.filter(i => health[provider][i].deadUntil > now);

    const cfg = PROVIDER_CONFIG[provider];
    const model = (cfg.models && (cfg.models[resolvedTier] || cfg.models.big)) || cfg.model; // cfg.model kept as a last-resort fallback for any provider entry not yet migrated to `models`
    for (const idx of [...fresh, ...cooling]) {
      chain.push({ provider, index: idx, key: keys[idx], label: cfg.label, base: cfg.base, model, tier: resolvedTier });
    }
  }
  return chain;
}

/**
 * getHealthSnapshot() — Phase 5 (Admin Mode, plan Section 7: "Which keys
 * are getting used the most / which are down?"). Read-only view of the
 * in-memory health map for api/admin/stats.js. Same caveat as the
 * PHASE-2 TODO note above applies here too: this is per-serverless-
 * instance, not a global durable count — good enough for "is anything
 * currently cooling down right now", not a historical usage log.
 */
function getHealthSnapshot() {
  const now = Date.now();
  const out = {};
  for (const provider of PROVIDER_ORDER) {
    const keyCount = getKeysForProvider(provider).length;
    ensureHealthBucket(provider, keyCount);
    out[provider] = {
      totalKeys: keyCount,
      keys: Array.from({ length: keyCount }, (_, i) => {
        const b = health[provider][i];
        return {
          index: i,
          status: b.deadUntil > now ? 'cooling_down' : 'ok',
          failCount: b.failCount,
          coolingDownForMs: Math.max(0, b.deadUntil - now),
        };
      }),
    };
  }
  return out;
}

module.exports = { buildAttemptChain, markKeyFailed, markKeyOk, getHealthSnapshot, PROVIDER_CONFIG, PROVIDER_ORDER };
