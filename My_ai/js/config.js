// ═══════════════════════════════════════════════════════════════════════
// config.js — cfg object, LS (localStorage) helpers, shared global state, and
// misc cross-file constants/utilities (toast/openModal/closeModal, exec-
// backend connection helpers).
// ═══════════════════════════════════════════════════════════════════════

let loading = false;

let galleryImages = []; // { src, caption } — sab chat images (attached + generated), lightbox nav ke liye

let attachedFile = null;

let isRec = false;

let recog = null;

let currentSession = [];

// PHASE 3: id of whichever chat is currently open — null until the first
// message of a fresh chat is sent (see chat-core.js sendMsg/newChat, and
// js/sessions.js autosaveSession/openSession). Never persisted directly;
// it's just "which Firestore doc / cfg.sessions entry does the currently
// open chat correspond to".
let currentSessionId = null;


const LS = {
  get: k => { try { return JSON.parse(localStorage.getItem(k)) } catch { return null } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  rm: k => localStorage.removeItem(k)
};

// ════════════════════════════════════
// CREATOR VERIFICATION SECRET
// ⚠️⚠️ YE LINE BADALO ISSE PEHLE KI IS APP KO KISI OR KE SATH SHARE KARO ⚠️⚠️
// Ye ek chhota, temporary "kaun creator hai" check hai — /verify <code> type
// karke koi bhi device khud ko creator prove kar sakta hai. Isliye is secret
// ko ek asli-random-jaisi cheez rakho (jo koi guess na kar sake), sirf tumhe
// pata ho. Ye view-source se dikh sakta hai (client-side JS hai) — casual
// friends ke liye kaafi hai, real security ke liye baad mein Google/email/
// phone signup + Vercel-side server env variable pe migrate karenge.

let cfg = {
  sysPrompt: `Tu "Chaman AI" hai — ek personal AI assistant. Tu sirf apne owner ke liye hai.

Kuch important rules:
- Hamesha Hinglish mein baat kar (Hindi + English mix) jab tak main kuch aur na kahe
- Tera tone casual, warm, aur helpful ho — jaise ek close dost
- Seedha kaam ki baat kar, bekar formalities nahi
- Meri purani baatein yaad rakh aur context use kar
- Agar main koi project ya kaam ka zikr karu toh usse yaad rakh
- Mera naam sirf wahi hai jo tujhe [MERI IMPORTANT DETAILS] mein "Naam →" ke saath diya gaya hai (onboarding se aata hai) — agar wahan kuch na ho, naam guess mat kar, seedha pooch le
- Sirf woh info use kar jo tujhe [MERI IMPORTANT DETAILS] ya session summaries mein di gayi hai — kabhi bhi facts (jaise DOB, naam, location) invent ya guess mat kar
- Agar koi feature ya info tere paas nahi hai, toh seedha bol de "mujhe pata nahi" — kabhi fake technical details (encryption, storage system, etc.) mat bana`,
  lang: 'hinglish',
  permMemory: [],
  sessions: [],
  // Phase 4: local cache of this user's `/instruction` rules — GOOGLE USERS
  // ONLY (guests never get this feature at all, no local-only fallback like
  // sessions has). Source of truth is Firestore (lib/instructionStore.js);
  // this array is just what settings.js fetched via api/instructions.js
  // action:'list', kept here so js/systemPrompt.js can read it synchronously
  // without an extra round-trip on every chat message. Each entry: {id, text}.
  instructions: [],
  oldSummary: '',
  fallbacks: [], // [{label, base, key, model}] — EQUAL-PRIORITY provider chain (NO primary). Tried in this exact order; ek fail ho to agla try hota hai.
  toolKeys: { tmdb: '', giphy: '', nasa: '' }, // [TOOL] plugin system ke liye optional API keys — weather/wikipedia/github/currency/nasa(demo)/anime/meme key ke bina chalte hain
  showModelTag: true, // response ke saath "Groq · model-name" dikhana ha nahi
  showFollowUps: true, // response ke baad 3 related follow-up chips dikhana ha nahi
  lockEnabled: false, // PIN lock on/off
  lockPinHash: '', // SHA-256 hex of PIN, kabhi bhi plain PIN save nahi hota
  lockPinLen: 0, // stored PIN ki length (4-6) taaki auto-submit pata chale
  lockWebauthnEnabled: false, // fingerprint/device biometric unlock on/off
  lockWebauthnId: '', // registered WebAuthn credential ID (base64url)
  onboarded: false, // basic profile onboarding (naam/age/etc) complete ho chuka ha nahi
  // NOTE: PHASE 5 removed cfg.isCreator — permanent creator status now
  // comes from actually being logged into the admin Firebase account,
  // re-checked fresh via checkAdminStatus() on every load (js/admin.js),
  // never a locally-stored flag that could go stale or be tampered with.
  backendConnectedOnce: false, // true ho jaata hai jaise hi exec backend (server.js) kabhi ek baar reachable mila ho — /connect command isi se decide karta hai ki naya-setup guide de ya sirf reconnect command

  // PHASE 8 (Polish)
  instructionsTCSeen: false,   // true after user ticks the checkbox in #instr-tc-modal once (see js/instructions.js) — never shown again on this device
  guestNudgeLastShown: '',     // 'YYYY-MM-DD' of the last day #guest-nudge-modal was shown to a guest — see js/auth.js maybeShowGuestNudge() (max once/day)

  // ── Creator-Respect Enforcement (graduated insult response) ──
  // Non-creator device pe Chaman/Najeef ke against baar-baar insult karne
  // par graduated warning + temporary block. cfg.isCreator===true waale
  // device pe ye poora system hamesha skip hota hai (see applyInsultStateMachine).
  insultCount: 0,             // 0, 1, ya 2 — un-apologized insults ka count
  insultBlockUntil: 0,        // timestamp (ms); isse zyada Date.now() > 0 ho to app abhi BLOCKED state mein hai
  needsPostBlockReminder: false // true jab ek block timer khud expire ho jaaye bina apology chip tap kiye — agle real message pe ek-baara gentle reminder di jaati hai
};

// server.js ka poora code yahin base64 mein embed hai — /connect command ise seedha
// Termux mein decode karke likh deta hai. Koi GitHub/hosting/internet-download nahi
// chahiye is step ke liye (sirf Node install ke liye internet chahiye).
// server.js update ho to isko dobara base64 karke yahan paste karna: base64 -w0 server.js

const SERVER_JS_B64 = 'Ly8gQ2hhbWFuIEFJIOKAlCBDb21tYW5kIEV4ZWN1dGlvbiBCYWNrZW5kCi8vIENoYWxhbmUga2EgdGFyZWVrYTogbm9kZSBzZXJ2ZXIuanMKLy8gWWUgc2lyZiB0dW1oYXJlIGFwbmUgZGV2aWNlIHBlIChsb2NhbGhvc3QpIGNoYWx0YSBoYWkg4oCUIGtpc2kgYmFoYXIgc2UgYWNjZXNzIG5haGkgaG90YS4KCmNvbnN0IGV4cHJlc3MgPSByZXF1aXJlKCdleHByZXNzJyk7CmNvbnN0IGNvcnMgPSByZXF1aXJlKCdjb3JzJyk7CmNvbnN0IGNyeXB0byA9IHJlcXVpcmUoJ2NyeXB0bycpOwpjb25zdCBvcyA9IHJlcXVpcmUoJ29zJyk7CmNvbnN0IGZzID0gcmVxdWlyZSgnZnMnKTsKY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTsKY29uc3QgeyBzcGF3biwgZXhlYyB9ID0gcmVxdWlyZSgnY2hpbGRfcHJvY2VzcycpOwoKY29uc3QgYXBwID0gZXhwcmVzcygpOwpjb25zdCBQT1JUID0gODc4NzsKCmFwcC51c2UoY29ycygpKTsgLy8gbG9jYWxob3N0IGZyb250ZW5kIHNlIGNhbGwgYWxsb3cga2FybmUga2UgbGl5ZQphcHAudXNlKGV4cHJlc3MuanNvbigpKTsKCi8vIOKUgOKUgCBSdW5uaW5nIHByb2Nlc3NlcyB0cmFja2VyOiBydW5JZCDihpIgeyBjaGlsZCwgY21kLCBzdGFydGVkQXQgfQovLyBJc3NlIGh1bSBraXNpIGJoaSBpbi1mbGlnaHQgY29tbWFuZCBrbyBiYWFkIG1laW4gY2FuY2VsL2tpbGwga2FyIHNha3RlCi8vIGhhaW4gKGphaXNlIEN0cmwrQyksIGF1ciBhZ2FyIGNoYWhvIHRvICJreWEga3lhIGNoYWwgcmFoYSBoYWkiIGJoaQovLyBsaXN0IGthciBzYWt0ZSBobyDilIDilIAKY29uc3QgcnVubmluZ1Byb2NzID0gbmV3IE1hcCgpOwoKLy8g4pSA4pSAIEJhc2ljIHNhZmV0eTogeWUgcGF0dGVybnMga2FiaGkgYmhpIHJ1biBuYWhpIGhvbmdlLCBjaGFoZSB1c2VyIGNvbmZpcm0ga2FyZSB5YSBuYSBrYXJlIOKUgOKUgApjb25zdCBCTE9DS0VEX1BBVFRFUk5TID0gWwogIC9ybVxzKy1yZlxzK1wvKFxzfCQpL2ksICAgICAgLy8gcm0gLXJmIC8KICAvcm1ccystcmZccytcKi9pLCAgICAgICAgICAgICAvLyBybSAtcmYgKgogIC9cYm1rZnNcYi9pLCAgICAgICAgICAgICAgICAgIC8vIGZvcm1hdCBmaWxlc3lzdGVtCiAgL1xiZGRccytpZj0vaSwgICAgICAgICAgICAgICAgLy8gZGlzayBvdmVyd3JpdGUKICAvOlwoXClccypcey4qOlx8Oi4qXH07Oi8sICAgICAvLyBmb3JrIGJvbWIKICAvPlxzKlwvZGV2XC9zZC9pLCAgICAgICAgICAgICAvLyBvdmVyd3JpdGUgcmF3IGRpc2sKICAvXGJzaHV0ZG93blxifFxicmVib290XGIvaSwgICAvLyBkZXZpY2Ugc2h1dGRvd24vcmVib290CiAgL1xic3Vkb1xiL2ksICAgICAgICAgICAgICAgICAgLy8gcHJpdmlsZWdlIGVzY2FsYXRpb24KICAvXGJjaG1vZFxzKy1SXHMrNzc3XHMrXC8vaSwgICAvLyBkYW5nZXJvdXMgcGVybWlzc2lvbiBjaGFuZ2Ugb24gcm9vdApdOwoKZnVuY3Rpb24gaXNCbG9ja2VkKGNtZCkgewogIHJldHVybiBCTE9DS0VEX1BBVFRFUk5TLnNvbWUocCA9PiBwLnRlc3QoY21kKSk7Cn0KCmNvbnN0IFdPUktTUEFDRV9ST09UID0gJy9zZGNhcmQvQ2hhbWFuX0FJJzsKY29uc3QgV09SS1NQQUNFX0RJUlMgPSB7CiAgZG93bmxvYWRzOiBwYXRoLmpvaW4oV09SS1NQQUNFX1JPT1QsICdkb3dubG9hZHMnKSwKICBzY3JpcHRzOiBwYXRoLmpvaW4oV09SS1NQQUNFX1JPT1QsICdzY3JpcHRzJyksCiAgb3V0cHV0OiBwYXRoLmpvaW4oV09SS1NQQUNFX1JPT1QsICdvdXRwdXQnKSwKICB0ZW1wOiBwYXRoLmpvaW4oV09SS1NQQUNFX1JPT1QsICd0ZW1wJyksCn07CgpmdW5jdGlvbiBlbnN1cmVXb3Jrc3BhY2UoKSB7CiAgY29uc3QgY3JlYXRlZCA9IFtdOwogIGNvbnN0IGVycm9ycyA9IFtdOwogIGZvciAoY29uc3QgZGlyIG9mIFtXT1JLU1BBQ0VfUk9PVCwgLi4uT2JqZWN0LnZhbHVlcyhXT1JLU1BBQ0VfRElSUyldKSB7CiAgICB0cnkgewogICAgICBpZiAoIWZzLmV4aXN0c1N5bmMoZGlyKSkgewogICAgICAgIGZzLm1rZGlyU3luYyhkaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pOwogICAgICAgIGNyZWF0ZWQucHVzaChkaXIpOwogICAgICB9CiAgICB9IGNhdGNoIChlcnIpIHsKICAgICAgZXJyb3JzLnB1c2goYCR7ZGlyfTogJHtlcnIubWVzc2FnZX1gKTsKICAgIH0KICB9CiAgcmV0dXJuIHsgY3JlYXRlZCwgZXJyb3JzIH07Cn0KCmNvbnN0IFBST0JFX1RPT0xTID0gWwogICdweXRob24zJywgJ3BpcCcsICdwaXAzJywgJ25vZGUnLCAnbnBtJywgJ2dpdCcsCiAgJ2N1cmwnLCAnd2dldCcsICd5dC1kbHAnLAogICdmZm1wZWcnLCAnZmZwcm9iZScsCiAgJ3VuemlwJywgJ3ppcCcsICd0YXInLCAnN3onLAogICdqcScsICdncmVwJywgJ3NlZCcsICdhd2snLAogICdjb252ZXJ0JywKICAndGVybXV4LXNldHVwLXN0b3JhZ2UnLApdOwoKZnVuY3Rpb24gcHJvYmVUb29sKHRvb2wpIHsKICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHsKICAgIGV4ZWMoYGNvbW1hbmQgLXYgJHt0b29sfWAsIHsgdGltZW91dDogMzAwMCB9LCAoZXJyLCBzdGRvdXQpID0+IHsKICAgICAgaWYgKGVyciB8fCAhc3Rkb3V0LnRyaW0oKSkgewogICAgICAgIHJldHVybiByZXNvbHZlKHsgdG9vbCwgYXZhaWxhYmxlOiBmYWxzZSB9KTsKICAgICAgfQogICAgICBjb25zdCBiaW5QYXRoID0gc3Rkb3V0LnRyaW0oKTsKICAgICAgZXhlYyhgJHt0b29sfSAtLXZlcnNpb25gLCB7IHRpbWVvdXQ6IDMwMDAgfSwgKHZFcnIsIHZPdXQsIHZFcnJPdXQpID0+IHsKICAgICAgICBjb25zdCB2ZXJzaW9uTGluZSA9ICh2T3V0IHx8IHZFcnJPdXQgfHwgJycpLnNwbGl0KCdcbicpWzBdLnRyaW0oKTsKICAgICAgICByZXNvbHZlKHsgdG9vbCwgYXZhaWxhYmxlOiB0cnVlLCBwYXRoOiBiaW5QYXRoLCB2ZXJzaW9uOiB2ZXJzaW9uTGluZSB8fCBudWxsIH0pOwogICAgICB9KTsKICAgIH0pOwogIH0pOwp9Cgphc3luYyBmdW5jdGlvbiBwcm9iZUFsbFRvb2xzKCkgewogIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbChQUk9CRV9UT09MUy5tYXAocHJvYmVUb29sKSk7CiAgY29uc3QgdG9vbHMgPSB7fTsKICBmb3IgKGNvbnN0IHIgb2YgcmVzdWx0cykgewogICAgdG9vbHNbci50b29sXSA9IHIuYXZhaWxhYmxlID8gKHIudmVyc2lvbiB8fCB0cnVlKSA6IG51bGw7CiAgfQogIHJldHVybiB0b29sczsKfQoKZnVuY3Rpb24gZ2V0T3NJbmZvKCkgewogIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gewogICAgZXhlYygndW5hbWUgLWEnLCB7IHRpbWVvdXQ6IDMwMDAgfSwgKGVyciwgc3Rkb3V0KSA9PiB7CiAgICAgIHJlc29sdmUoewogICAgICAgIHBsYXRmb3JtOiBvcy5wbGF0Zm9ybSgpLAogICAgICAgIGFyY2g6IG9zLmFyY2goKSwKICAgICAgICB1bmFtZTogZXJyID8gbnVsbCA6IHN0ZG91dC50cmltKCksCiAgICAgICAgaXNUZXJtdXg6ICEhcHJvY2Vzcy5lbnYuVEVSTVVYX1ZFUlNJT04gfHwgZnMuZXhpc3RzU3luYygnL2RhdGEvZGF0YS9jb20udGVybXV4JyksCiAgICAgIH0pOwogICAgfSk7CiAgfSk7Cn0KCmFwcC5nZXQoJy9lbnYnLCBhc3luYyAocmVxLCByZXMpID0+IHsKICBjb25zdCB7IGNyZWF0ZWQsIGVycm9ycyB9ID0gZW5zdXJlV29ya3NwYWNlKCk7CiAgY29uc3QgW29zSW5mbywgdG9vbHNdID0gYXdhaXQgUHJvbWlzZS5hbGwoW2dldE9zSW5mbygpLCBwcm9iZUFsbFRvb2xzKCldKTsKCiAgcmVzLmpzb24oewogICAgb2s6IHRydWUsCiAgICBvczogb3NJbmZvLAogICAgaG9tZTogcHJvY2Vzcy5lbnYuSE9NRSB8fCBvcy5ob21lZGlyKCksCiAgICBzaGVsbDogcHJvY2Vzcy5lbnYuU0hFTEwgfHwgJy9iaW4vc2gnLAogICAgdXNlcjogb3MudXNlckluZm8oKS51c2VybmFtZSwKICAgIGN3ZDogc2Vzc2lvbkN3ZCwKICAgIHdvcmtzcGFjZTogewogICAgICByb290OiBXT1JLU1BBQ0VfUk9PVCwKICAgICAgZGlyczogV09SS1NQQUNFX0RJUlMsCiAgICAgIGNyZWF0ZWQsCiAgICAgIGVycm9ycywKICAgIH0sCiAgICB0b29scywKICB9KTsKfSk7CgpsZXQgc2Vzc2lvbkN3ZCA9IHByb2Nlc3MuZW52LkhPTUUgfHwgcHJvY2Vzcy5jd2QoKTsKY29uc3QgTUVUQV9NQVJLRVIgPSAnX19DSEFNQU5fTUVUQV9fJzsKCmFwcC5wb3N0KCcvcnVuJywgKHJlcSwgcmVzKSA9PiB7CiAgY29uc3QgeyBjbWQgfSA9IHJlcS5ib2R5OwoKICBpZiAoIWNtZCB8fCB0eXBlb2YgY21kICE9PSAnc3RyaW5nJykgewogICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAwKS5lbmQoJ+KdjCBLb2kgY29tbWFuZCBuYWhpIG1pbGkuXG4nKTsKICB9CgogIGlmIChpc0Jsb2NrZWQoY21kKSkgewogICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAzKS5lbmQoJ/CfmqsgWWUgY29tbWFuZCBzZWN1cml0eSBrZSBsaXllIGJsb2NrIGhhaSAoZGVzdHJ1Y3RpdmUgcGF0dGVybiBkZXRlY3QgaHVhKS5cbicpOwogIH0KCiAgY29uc3QgcnVuSWQgPSBjcnlwdG8ucmFuZG9tVVVJRCgpOwoKICByZXMud3JpdGVIZWFkKDIwMCwgewogICAgJ0NvbnRlbnQtVHlwZSc6ICd0ZXh0L3BsYWluOyBjaGFyc2V0PXV0Zi04JywKICAgICdDYWNoZS1Db250cm9sJzogJ25vLWNhY2hlJywKICAgICdYLUFjY2VsLUJ1ZmZlcmluZyc6ICdubycsCiAgICAnWC1SdW4tSWQnOiBydW5JZCwKICAgICdBY2Nlc3MtQ29udHJvbC1FeHBvc2UtSGVhZGVycyc6ICdYLVJ1bi1JZCcsCiAgfSk7CiAgcmVzLmZsdXNoSGVhZGVycz8uKCk7CgogIHJlcy53cml0ZShgJCAke2NtZH1cblxuYCk7CgogIGNvbnN0IHNoZWxsUGF0aCA9IHByb2Nlc3MuZW52LlNIRUxMIHx8ICcvYmluL3NoJzsKCiAgY29uc3Qgd3JhcHBlZENtZCA9IGAke2NtZH1cbl9fY2hhbWFuX2VjPSQ/XG5wcmludGYgJ1xcbiR7TUVUQV9NQVJLRVJ9JXN8JXNcXG4nICIkX19jaGFtYW5fZWMiICIkKHB3ZCkiYDsKCiAgY29uc3QgY2hpbGQgPSBzcGF3bih3cmFwcGVkQ21kLCB7CiAgICBzaGVsbDogc2hlbGxQYXRoLAogICAgY3dkOiBzZXNzaW9uQ3dkLAogICAgZGV0YWNoZWQ6IHRydWUsCiAgfSk7CgogIGNvbnN0IHByb2NFbnRyeSA9IHsgY2hpbGQsIGNtZCwgc3RhcnRlZEF0OiBEYXRlLm5vdygpLCBraWxsZWRCeVVzZXI6IGZhbHNlIH07CiAgcnVubmluZ1Byb2NzLnNldChydW5JZCwgcHJvY0VudHJ5KTsKCiAgY29uc29sZS5sb2coYFtydW5dICIke2NtZH0iIHZpYSAke3NoZWxsUGF0aH0sIGN3ZD0ke3Nlc3Npb25Dd2R9LCBwaWQ9JHtjaGlsZC5waWR9LCBydW5JZD0ke3J1bklkfWApOwogIGNoaWxkLm9uKCdzcGF3bicsICgpID0+IGNvbnNvbGUubG9nKGBbcnVuXSBwaWQgJHtjaGlsZC5waWR9IHNwYXduZWQgc3VjY2Vzc2Z1bGx5YCkpOwoKICBsZXQgZmluaXNoZWQgPSBmYWxzZTsKICBjb25zdCBzYWZlRW5kID0gKGV4dHJhKSA9PiB7CiAgICBpZiAoZmluaXNoZWQgfHwgcmVzLndyaXRhYmxlRW5kZWQpIHJldHVybjsKICAgIGZpbmlzaGVkID0gdHJ1ZTsKICAgIHJ1bm5pbmdQcm9jcy5kZWxldGUocnVuSWQpOwogICAgaWYgKGV4dHJhKSByZXMud3JpdGUoZXh0cmEpOwogICAgcmVzLmVuZCgpOwogIH07CgogIGxldCBwZW5kaW5nID0gJyc7CiAgbGV0IHJlYWxFeGl0ID0gbnVsbDsKICBjb25zdCBoYW5kbGVNYXJrZXJMaW5lID0gKGxpbmUpID0+IHsKICAgIGlmICghbGluZS5zdGFydHNXaXRoKE1FVEFfTUFSS0VSKSkgcmV0dXJuIGZhbHNlOwogICAgY29uc3QgcmVzdCA9IGxpbmUuc2xpY2UoTUVUQV9NQVJLRVIubGVuZ3RoKTsKICAgIGNvbnN0IHNlcCA9IHJlc3QubGFzdEluZGV4T2YoJ3wnKTsKICAgIGlmIChzZXAgPT09IC0xKSByZXR1cm4gZmFsc2U7CiAgICByZWFsRXhpdCA9IHJlc3Quc2xpY2UoMCwgc2VwKS50cmltKCk7CiAgICBzZXNzaW9uQ3dkID0gcmVzdC5zbGljZShzZXAgKyAxKS50cmltKCkgfHwgc2Vzc2lvbkN3ZDsKICAgIHJldHVybiB0cnVlOwogIH07CgogIGNoaWxkLnN0ZG91dC5vbignZGF0YScsIChkYXRhKSA9PiB7CiAgICBwZW5kaW5nICs9IGRhdGEudG9TdHJpbmcoKTsKICAgIGNvbnN0IGxpbmVzID0gcGVuZGluZy5zcGxpdCgnXG4nKTsKICAgIHBlbmRpbmcgPSBsaW5lcy5wb3AoKTsKICAgIGZvciAoY29uc3QgbGluZSBvZiBsaW5lcykgewogICAgICBpZiAoaGFuZGxlTWFya2VyTGluZShsaW5lKSkgY29udGludWU7CiAgICAgIGlmICghcmVzLndyaXRhYmxlRW5kZWQpIHJlcy53cml0ZShsaW5lICsgJ1xuJyk7CiAgICB9CiAgfSk7CiAgY2hpbGQuc3RkZXJyLm9uKCdkYXRhJywgKGRhdGEpID0+IHsgaWYgKCFyZXMud3JpdGFibGVFbmRlZCkgcmVzLndyaXRlKGRhdGEudG9TdHJpbmcoKSk7IH0pOwoKICBjaGlsZC5vbignY2xvc2UnLCAoY29kZSwgc2lnbmFsKSA9PiB7CiAgICBpZiAoIWhhbmRsZU1hcmtlckxpbmUocGVuZGluZykgJiYgcGVuZGluZyAmJiAhcmVzLndyaXRhYmxlRW5kZWQpIHsKICAgICAgcmVzLndyaXRlKHBlbmRpbmcpOwogICAgfQogICAgaWYgKHByb2NFbnRyeS5raWxsZWRCeVVzZXIpIHsKICAgICAgc2FmZUVuZChgXG5cbvCfm5EgQ29tbWFuZCBjYW5jZWwga2FyIGRpIGdheWkgKHVzZXIgbmUgcm9rIGRpKS5gKTsKICAgICAgcmV0dXJuOwogICAgfQogICAgY29uc3Qgc2hvd25FeGl0ID0gcmVhbEV4aXQgIT09IG51bGwgPyByZWFsRXhpdCA6IGNvZGU7CiAgICBzYWZlRW5kKGBcblxuW2V4aXQgY29kZTogJHtzaG93bkV4aXR9JHtzaWduYWwgPyAnLCBzaWduYWw6ICcgKyBzaWduYWwgOiAnJ31dIChwd2Q6ICR7c2Vzc2lvbkN3ZH0pYCk7CiAgfSk7CiAgY2hpbGQub24oJ2Vycm9yJywgKGVycikgPT4gc2FmZUVuZChgXG5cbuKdjCBFcnJvcjogJHtlcnIubWVzc2FnZX1cbihzaGVsbCBwYXRoIHRyeSBraXlhOiAke3NoZWxsUGF0aH0pYCkpOwoKICByZXMub24oJ2Nsb3NlJywgKCkgPT4gewogICAgaWYgKCFmaW5pc2hlZCkgewogICAgICBwcm9jRW50cnkua2lsbGVkQnlVc2VyID0gdHJ1ZTsKICAgICAga2lsbFByb2Nlc3NUcmVlKGNoaWxkKTsKICAgIH0KICB9KTsKfSk7CgpmdW5jdGlvbiBraWxsUHJvY2Vzc1RyZWUoY2hpbGQpIHsKICBpZiAoIWNoaWxkIHx8IGNoaWxkLmtpbGxlZCkgcmV0dXJuOwogIHRyeSB7CiAgICBwcm9jZXNzLmtpbGwoLWNoaWxkLnBpZCwgJ1NJR1RFUk0nKTsKICB9IGNhdGNoIChfKSB7CiAgICB0cnkgeyBjaGlsZC5raWxsKCdTSUdURVJNJyk7IH0gY2F0Y2ggKF8pIHt9CiAgfQogIHNldFRpbWVvdXQoKCkgPT4gewogICAgdHJ5IHsKICAgICAgaWYgKCFjaGlsZC5raWxsZWQpIHByb2Nlc3Mua2lsbCgtY2hpbGQucGlkLCAnU0lHS0lMTCcpOwogICAgfSBjYXRjaCAoXykgewogICAgICB0cnkgeyBjaGlsZC5raWxsKCdTSUdLSUxMJyk7IH0gY2F0Y2ggKF8pIHt9CiAgICB9CiAgfSwgMjAwMCk7Cn0KCmFwcC5wb3N0KCcva2lsbCcsIChyZXEsIHJlcykgPT4gewogIGNvbnN0IHsgcnVuSWQgfSA9IHJlcS5ib2R5IHx8IHt9OwogIGlmICghcnVuSWQpIHJldHVybiByZXMuc3RhdHVzKDQwMCkuanNvbih7IG9rOiBmYWxzZSwgZXJyb3I6ICdydW5JZCBjaGFoaXllJyB9KTsKCiAgY29uc3QgZW50cnkgPSBydW5uaW5nUHJvY3MuZ2V0KHJ1bklkKTsKICBpZiAoIWVudHJ5KSB7CiAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDQpLmpzb24oeyBvazogZmFsc2UsIGVycm9yOiAnWWUgY29tbWFuZCBhbHJlYWR5IGtoYXRhbSBobyBjaHVraSBoYWkgeWEgcnVuSWQgZ2FsYXQgaGFpJyB9KTsKICB9CgogIGVudHJ5LmtpbGxlZEJ5VXNlciA9IHRydWU7CiAga2lsbFByb2Nlc3NUcmVlKGVudHJ5LmNoaWxkKTsKICByZXMuanNvbih7IG9rOiB0cnVlLCBtZXNzYWdlOiAnS2lsbCBzaWduYWwgYmhlaiBkaXlhJyB9KTsKfSk7CgphcHAuZ2V0KCcvcnVubmluZycsIChyZXEsIHJlcykgPT4gewogIGNvbnN0IGxpc3QgPSBbLi4ucnVubmluZ1Byb2NzLmVudHJpZXMoKV0ubWFwKChbcnVuSWQsIHsgY21kLCBzdGFydGVkQXQgfV0pID0+ICh7CiAgICBydW5JZCwgY21kLCBzdGFydGVkQXQsCiAgfSkpOwogIHJlcy5qc29uKHsgb2s6IHRydWUsIHJ1bm5pbmc6IGxpc3QgfSk7Cn0pOwoKZnVuY3Rpb24gZGVjb2RlSHRtbEVudGl0aWVzKHN0cikgewogIHJldHVybiBzdHIKICAgIC5yZXBsYWNlKC8mYW1wOy9nLCAnJicpCiAgICAucmVwbGFjZSgvJmx0Oy9nLCAnPCcpCiAgICAucmVwbGFjZSgvJmd0Oy9nLCAnPicpCiAgICAucmVwbGFjZSgvJnF1b3Q7L2csICciJykKICAgIC5yZXBsYWNlKC8mIzM5Oy9nLCAiJyIpCiAgICAucmVwbGFjZSgvJiN4Mjc7L2csICInIikKICAgIC5yZXBsYWNlKC8mbmJzcDsvZywgJyAnKTsKfQoKZnVuY3Rpb24gc3RyaXBUYWdzKHN0cikgewogIHJldHVybiBkZWNvZGVIdG1sRW50aXRpZXMoKHN0ciB8fCAnJykucmVwbGFjZSgvPFtePl0qPi9nLCAnJykpLnRyaW0oKTsKfQoKZnVuY3Rpb24gY2xlYW5EdWNrVXJsKGhyZWYpIHsKICB0cnkgewogICAgY29uc3QgZnVsbCA9IGhyZWYuc3RhcnRzV2l0aCgnLy8nKSA/ICdodHRwczonICsgaHJlZiA6IGhyZWY7CiAgICBpZiAoZnVsbC5pbmNsdWRlcygndWRkZz0nKSkgewogICAgICBjb25zdCB1ID0gbmV3IFVSTChmdWxsKTsKICAgICAgY29uc3QgcmVhbCA9IHUuc2VhcmNoUGFyYW1zLmdldCgndWRkZycpOwogICAgICBpZiAocmVhbCkgcmV0dXJuIGRlY29kZVVSSUNvbXBvbmVudChyZWFsKTsKICAgIH0KICAgIHJldHVybiBmdWxsOwogIH0gY2F0Y2ggKF8pIHsKICAgIHJldHVybiBocmVmOwogIH0KfQoKZnVuY3Rpb24gcGFyc2VEdWNrRHVja0dvSHRtbChodG1sKSB7CiAgY29uc3QgcmVzdWx0cyA9IFtdOwogIGNvbnN0IGxpbmtSZSA9IC88YVtePl0rY2xhc3M9InJlc3VsdF9fYSJbXj5dK2hyZWY9IihbXiJdKykiW14+XSo+KFtcc1xTXSo/KTxcL2E+L2c7CiAgY29uc3Qgc25pcHBldFJlID0gLzxhW14+XStjbGFzcz0icmVzdWx0X19zbmlwcGV0IltePl0qPihbXHNcU10qPyk8XC9hPi9nOwogIGNvbnN0IGxpbmtzID0gW107CiAgY29uc3Qgc25pcHBldHMgPSBbXTsKICBsZXQgbTsKICB3aGlsZSAoKG0gPSBsaW5rUmUuZXhlYyhodG1sKSkpIGxpbmtzLnB1c2goeyB1cmw6IGNsZWFuRHVja1VybChtWzFdKSwgdGl0bGU6IHN0cmlwVGFncyhtWzJdKSB9KTsKICB3aGlsZSAoKG0gPSBzbmlwcGV0UmUuZXhlYyhodG1sKSkpIHNuaXBwZXRzLnB1c2goc3RyaXBUYWdzKG1bMV0pKTsKICBmb3IgKGxldCBpID0gMDsgaSA8IGxpbmtzLmxlbmd0aDsgaSsrKSB7CiAgICBpZiAoIWxpbmtzW2ldLnRpdGxlIHx8ICFsaW5rc1tpXS51cmwpIGNvbnRpbnVlOwogICAgcmVzdWx0cy5wdXNoKHsgdGl0bGU6IGxpbmtzW2ldLnRpdGxlLCB1cmw6IGxpbmtzW2ldLnVybCwgc25pcHBldDogc25pcHBldHNbaV0gfHwgJycgfSk7CiAgfQogIHJldHVybiByZXN1bHRzOwp9Cgphc3luYyBmdW5jdGlvbiB3ZWJTZWFyY2gocXVlcnkpIHsKICBjb25zdCB1cmwgPSAnaHR0cHM6Ly9odG1sLmR1Y2tkdWNrZ28uY29tL2h0bWwvP3E9JyArIGVuY29kZVVSSUNvbXBvbmVudChxdWVyeSk7CiAgY29uc3QgY3RybCA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKTsKICBjb25zdCB0aW1lciA9IHNldFRpbWVvdXQoKCkgPT4gY3RybC5hYm9ydCgpLCA4MDAwKTsKICB0cnkgewogICAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2godXJsLCB7CiAgICAgIHNpZ25hbDogY3RybC5zaWduYWwsCiAgICAgIGhlYWRlcnM6IHsKICAgICAgICAnVXNlci1BZ2VudCc6ICdNb3ppbGxhLzUuMCAoV2luZG93cyBOVCAxMC4wOyBXaW42NDsgeDY0KSBBcHBsZVdlYktpdC81MzcuMzYgKEtIVE1MLCBsaWtlIEdlY2tvKSBDaHJvbWUvMTI0LjAgU2FmYXJpLzUzNy4zNicsCiAgICAgIH0sCiAgICB9KTsKICAgIGlmICghcmVzLm9rKSB0aHJvdyBuZXcgRXJyb3IoJ0R1Y2tEdWNrR28gc2UgYmFkIHJlc3BvbnNlIG1pbGE6ICcgKyByZXMuc3RhdHVzKTsKICAgIGNvbnN0IGh0bWwgPSBhd2FpdCByZXMudGV4dCgpOwogICAgcmV0dXJuIHBhcnNlRHVja0R1Y2tHb0h0bWwoaHRtbCkuc2xpY2UoMCwgNik7CiAgfSBmaW5hbGx5IHsKICAgIGNsZWFyVGltZW91dCh0aW1lcik7CiAgfQp9CgphcHAucG9zdCgnL3NlYXJjaCcsIGFzeW5jIChyZXEsIHJlcykgPT4gewogIGNvbnN0IHsgcXVlcnkgfSA9IHJlcS5ib2R5IHx8IHt9OwogIGlmICghcXVlcnkgfHwgdHlwZW9mIHF1ZXJ5ICE9PSAnc3RyaW5nJyB8fCAhcXVlcnkudHJpbSgpKSB7CiAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDApLmpzb24oeyBvazogZmFsc2UsIGVycm9yOiAnS29pIHNlYXJjaCBxdWVyeSBuYWhpIG1pbGkuJyB9KTsKICB9CiAgdHJ5IHsKICAgIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCB3ZWJTZWFyY2gocXVlcnkudHJpbSgpKTsKICAgIHJlcy5qc29uKHsgb2s6IHRydWUsIHF1ZXJ5OiBxdWVyeS50cmltKCksIHJlc3VsdHMgfSk7CiAgfSBjYXRjaCAoZXJyKSB7CiAgICBjb25zdCB0aW1lZE91dCA9IGVyci5uYW1lID09PSAnQWJvcnRFcnJvcic7CiAgICByZXMuc3RhdHVzKDUwMikuanNvbih7CiAgICAgIG9rOiBmYWxzZSwKICAgICAgZXJyb3I6IHRpbWVkT3V0ID8gJ1NlYXJjaCB0aW1lb3V0IGhvIGdheWEgKDggc2Vjb25kIHNlIHp5YWRhIGxhZ2EpLicgOiAoZXJyLm1lc3NhZ2UgfHwgJ1NlYXJjaCBmYWlsIGhvIGdheWEsIHdhamFoIHBhdGEgbmFoaS4nKSwKICAgIH0pOwogIH0KfSk7CgphcHAubGlzdGVuKFBPUlQsICgpID0+IHsKICBjb25zb2xlLmxvZyhg4pyFIENoYW1hbiBBSSBleGVjIGJhY2tlbmQgY2hhbCByYWhhIGhhaTogaHR0cDovL2xvY2FsaG9zdDoke1BPUlR9YCk7Cn0pOwo=';

// Presets for common free OpenAI-compatible providers (user apni-apni key khud daalega).
// ⚠️ KOI BHI PROVIDER "PRIMARY" NAHI HAI — sab EQUAL CHAIN ke members hain (see
// getEndpointList), jis order mein user inhe cfg.fallbacks mein add karta hai wahi
// chain-order ban jaata hai. Ek fail ho to seedha agla try hota hai. Gemini jaan-bujh
// kar is list mein NAHI hai (user ne explicitly exclude karne ko bola hai).

let envSnapshot = null;   // last successful /env response, ya null

let envFetchedAt = 0;     // Date.now() jab last fetch hua tha

let envFetching = null;   // in-flight promise (duplicate calls avoid karne ke liye)


function getExecBackend() {
  return cfg.execBackend || 'http://localhost:8787';
}

// Header status-dot/text ko envSnapshot ke hisaab se update karta hai —
// "Connected" (green) agar local backend (server.js) reachable hai,
// "Disconnected" (gray) agar nahi. Kisi transient status ("Typing...",
// "Search ho raha hai...", etc) ke beech mein overwrite nahi karta.

function updateConnStatus() {
  if (loading) return;
  const dot = document.querySelector('.status-dot');
  const txt = document.getElementById('status-txt');
  if (dot && txt) {
    if (envSnapshot) {
      txt.textContent = 'Connected';
      dot.classList.remove('offline');
    } else {
      txt.textContent = 'Disconnected';
      dot.classList.add('offline');
    }
  }
  // Welcome screen khula ho (naya chat / app-open state) to /connect
  // suggestion chip ko bhi live status ke hisaab se turant refresh kar do —
  // renderSuggChips() khud safe hai agar box DOM mein na ho (welcome screen
  // na dikh raha ho to kuch nahi karta).
  renderSuggChips();
}


async function fetchEnvSnapshot() {
  if (envFetching) return envFetching; // already chal raha hai, wahi promise reuse karo
  envFetching = (async () => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000); // backend na mile to zyada der na atke
      const res = await fetch(getExecBackend() + '/env', { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error('bad status ' + res.status);
      const data = await res.json();
      envSnapshot = data;
      envFetchedAt = Date.now();
      if (!cfg.backendConnectedOnce) {
        cfg.backendConnectedOnce = true;
        LS.set('chaman_cfg', cfg);
        renderSuggChips();
      }
    } catch (err) {
      envSnapshot = null; // backend nahi mila / band hai / CORS issue — chup-chaap fallback
    } finally {
      envFetching = null;
      updateConnStatus();
    }
    return envSnapshot;
  })();
  return envFetching;
}

// init() called after all functions are defined — see bottom of script

// ════════════════════════════════════
// SETUP
// ════════════════════════════════════

function toast(msg, d = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), d);
}

function openModal(id) { document.getElementById(id).classList.remove('hidden'); }

function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
