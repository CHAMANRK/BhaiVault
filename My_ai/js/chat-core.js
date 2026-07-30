// ═══════════════════════════════════════════════════════════════════════
// chat-core.js — sendMsg and the whole message pipeline: rendering, typing
// bubble, streaming continuations (exec/search/tool/widget/ask-user),
// insult/apology state machine, session save, voice input, new-chat.
// ═══════════════════════════════════════════════════════════════════════

// ════════════════════════════════════
// SEND MESSAGE
// ════════════════════════════════════

async function sendMsg() {
  const inp = document.getElementById('msg-inp');
  const text = inp.value.trim();
  if ((!text && !attachedFile) || loading) return;

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 5 — ADMIN MODE ACCESS (plan Section 7). The OLD /verify command
  // (client-side CREATOR_SECRET string compare) is GONE — it shipped a
  // plaintext password to every browser, which was never real security.
  //
  // PRIMARY path now needs no chat command at all: if you're logged in as
  // the admin Firebase account, checkAdminStatus() (js/admin.js, called
  // once from main.js after auth resolves) already sets isCreatorActive()
  // true for this whole session — nothing to type.
  //
  // /verify-t <code> stays as the BACKUP path — for a device that ISN'T
  // logged into the admin account (borrowed phone, emergency access). The
  // code is now checked SERVER-SIDE (api/admin/verify.js) against
  // ADMIN_BACKUP_CODE, and a short-lived signed token comes back (see
  // lib/adminAuth.js) — nothing client-side to leak by reading the JS
  // source anymore. Same temp/isolated-session behavior as before:
  // current chat gets saved normally first, then a fresh isolated session
  // starts that buildPrompt() excludes permanent memory/summaries from.
  // ═══════════════════════════════════════════════════════════════════
  const verifyTempMatch = text.match(/^\/verify-t\s+(.+)/i);
  if (verifyTempMatch) {
    inp.value = '';
    inp.style.height = 'auto';
    const ok = await tryAdminBackupCode(verifyTempMatch[1].trim());
    if (ok) {
      if (currentSession.length >= 2) autosaveSession(); // normal user ki purani chat — normally hi save hoti hai
      document.getElementById('msgs-list').innerHTML = `
        <div id="welcome">
          <div class="wc-icon">🔑</div>
          <h2>Creator Mode</h2>
          <p>Temporary session shuru — ye chat isolated hai aur /remove pe discard ho jayegi</p>
          <div class="sugg-chips" id="sugg-chips"></div>
        </div>
      `;
      currentSession = [];
      currentSessionId = null; // isolated temp chat never gets a saved id — see autosaveSession() tempCreatorSession guard
      _lastSavedMsgCount = 0;
      tempCreatorSession = true;
      document.body.classList.add('creator-temp-mode');
      renderSuggChips();
      toast('🔑 Temporary Creator Mode ON — naya isolated session shuru hua');
      triggerCreatorVerifiedAck();
    } else {
      toast('❌ Galat code');
    }
    return;
  }

  // /remove — active TEMPORARY creator session ko turant clear karne ke
  // liye (kaam ho jaane ke baad, is phone ko wapas normal user jaisa
  // banane ke liye). No code re-entry needed anymore — this only ever
  // clears a RUNTIME flag on THIS device, it can't grant anything to
  // anyone, so there's nothing left to gate. Is temporary session ki
  // poori chat JAAN-BUJH KAR DISCARD (na save, na summarize) hoti hai —
  // taaki is device par koi trace na bache ki ye ek verified/creator
  // session tha.
  if (/^\/remove$/i.test(text)) {
    inp.value = '';
    inp.style.height = 'auto';
    if (tempCreatorSession) {
      tempCreatorSession = false;
      clearAdminBackupToken();
      document.body.classList.remove('creator-temp-mode');
      currentSession = []; // discard — koi summary save nahi hoti
      currentSessionId = null; // back to normal — fresh chat, no id (old normal chat was already saved before entering temp mode)
      _lastSavedMsgCount = 0;
      document.getElementById('msgs-list').innerHTML = `
        <div id="welcome">
          <div class="wc-icon">✨</div>
          <h2>Kya haal hai?</h2>
          <p>Bol kya karna hai — main yaad rakhta hoon sab</p>
          <div class="sugg-chips" id="sugg-chips"></div>
        </div>
      `;
      renderSuggChips();
      toast('🔓 Temporary creator session hata di gayi — ab normal user, koi trace nahi chhoda');
    } else {
      toast('Koi active temporary session nahi hai');
    }
    return;
  }

  if (!isCreatorActive() && cfg.insultBlockUntil > Date.now()) return; // BLOCKED state — input already disabled, ye safety-net hai

  // /image <prompt> ya /img <prompt> — AI image generation (Puter.js, free)
  const imgMatch = text.match(/^\/(image|img)\s+(.+)/i);
  if (imgMatch) {
    inp.value = '';
    inp.style.height = 'auto';
    document.getElementById('welcome')?.remove();
    return generateImageMsg(imgMatch[2].trim(), text);
  }

  // /connect — pehle exec backend (server.js) ko LIVE check karta hai (/env
  // ping), tabhi decide karta hai kya dikhana hai:
  //  - agar already connected nikla → seedha bata deta hai, koi guide nahi
  //  - agar disconnect nikla → setup/reconnect guide (naya-setup ya sirf
  //    reconnect, cfg.backendConnectedOnce se) + ek "check karo" button,
  //    jisse user command run karne ke baad dobara type kiye bina hi
  //    turant confirm kar sake ki connect ho gaya ya nahi.
  if (/^\/connect$/i.test(text)) {
    inp.value = '';
    inp.style.height = 'auto';
    document.getElementById('welcome')?.remove();
    appendMsg('out', text);

    const typingEl = appendTyping();
    await fetchEnvSnapshot(); // fresh live check, cache pe depend nahi karta
    typingEl.remove();

    if (envSnapshot) {
      appendMsg('in', '✅ Connected hai bhai — backend (server.js) already chal raha hai, kuch aur karne ki zaroorat nahi.');
      return;
    }

    let guide;
    if (!cfg.backendConnectedOnce) {
      const setupCmd = `pkg update -y && pkg upgrade -y && pkg install nodejs -y && mkdir -p chaman-ai && echo '${SERVER_JS_B64}' | base64 -d > chaman-ai/server.js && cd chaman-ai && npm install express cors && node server.js`;
      guide = `Backend (server.js) abhi connected nahi mila. Pehle Termux install karo, phir ek command se poora setup ho jayega:\n\n` +
        `**Step 1 — Termux install karo (agar pehle se nahi hai):**\n` +
        `Play Store se **nahi** — Play Store wala Termux purana/broken hai aur \`pkg\` commands usme fail hote hain. F-Droid se lo:\n` +
        `https://f-droid.org/en/packages/com.termux/\n\n` +
        `(F-Droid app pehli baar install nahi hai toh pehle F-Droid ka APK download karo us link se, phir usi ke andar "Termux" search karke install karo.)\n\n` +
        `**Step 2 — Termux khol ke ye ek hi command paste kar do:**\n` +
        '```\n' + setupCmd + '\n```\n\n' +
        `Ye thoda time lega (Node + packages install honge). Jab terminal mein "Running on http://localhost:8787" dikhe, backend connect ho jayega.`;
    } else {
      guide = `Backend abhi disconnect mila. Termux mein wapas connect karne ke liye bas ye paste kar do:\n\n` +
        '```\ncd chaman-ai && node server.js\n```';
    }
    const bub = appendMsg('in', guide);

    const recheckBtn = document.createElement('button');
    recheckBtn.type = 'button';
    recheckBtn.className = 'sugg-chip';
    recheckBtn.style.marginTop = '10px';
    recheckBtn.textContent = '✅ Maine run kar diya, check karo';
    recheckBtn.addEventListener('click', async () => {
      recheckBtn.disabled = true;
      recheckBtn.textContent = 'Check ho raha hai...';
      await fetchEnvSnapshot();
      if (envSnapshot) {
        recheckBtn.remove();
        appendMsg('in', '✅ Connected ho gaya! Backend ab chal raha hai.');
      } else {
        recheckBtn.disabled = false;
        recheckBtn.textContent = '✅ Maine run kar diya, check karo';
        toast('❌ Abhi bhi disconnect hai — command sahi se chali kya check karo');
      }
    });
    bub.appendChild(document.createElement('br'));
    bub.appendChild(recheckBtn);
    return;
  }

  // /search <query> — FORCE web search, AI ke [WEB_SEARCH] decision pe depend nahi karta,
  // seedha backend se search fire kar deta hai (jaise + menu ke 🔍 button se ya manually type karke)
  const searchMatch = text.match(/^\/search\s+(.+)/i);
  if (searchMatch) {
    inp.value = '';
    inp.style.height = 'auto';
    document.getElementById('welcome')?.remove();
    return forceWebSearchMsg(searchMatch[1].trim(), text);
  }

  // /instruction <rule> — PHASE 4, plan Section 4. Google users ONLY. This
  // does NOT save anything itself — instructionGateCheck() (js/instructions.js)
  // does the cheap client-side checks (guest block, max-10 pre-check,
  // first-use T&C) BEFORE we spend an AI call; if it passes, the proposal
  // goes to the AI as a normal turn (proposeInstructionMsg below), and the
  // AI itself validates scope + confirms + emits the save-tag — see
  // lib/systemPrompt.js's [INSTRUCTION PROTOCOL] section.
  const instrMatch = text.match(/^\/instruction\s+(.+)/i);
  if (instrMatch) {
    const rule = instrMatch[1].trim();
    const gateOk = await instructionGateCheck(rule);
    if (!gateOk) { inp.value = ''; inp.style.height = 'auto'; return; }
    inp.value = '';
    inp.style.height = 'auto';
    document.getElementById('welcome')?.remove();
    return proposeInstructionMsg(rule, text);
  }

  inp.value = '';
  inp.style.height = 'auto';

  const file = attachedFile;
  if (file) { attachedFile = null; clearFile(); }

  // Hide welcome
  document.getElementById('welcome')?.remove();

  // Append user message
  appendMsg('out', text, file);

  // Build content
  let userContent;
  if (file?.type === 'image') {
    userContent = [
      { type: 'image_url', image_url: { url: `data:${file.mimeType};base64,${file.data}` } },
      { type: 'text', text: text || 'Is image ke baare mein batao' }
    ];
  } else if (file) {
    userContent = text + '\n\n[File: ' + file.name + ']\n' + file.data.slice(0, 8000);
  } else {
    userContent = text;
  }

  // Add to session history (text only, no base64)
  const histEntry = { role: 'user', content: file?.type === 'image' ? (text || 'image attached') + ' [image]' : (typeof userContent === 'string' ? userContent : text) };
  currentSession.push(histEntry);

  // Show typing
  const typingEl = appendTyping();
  loading = true;
  document.getElementById('send-btn').disabled = true;
  document.getElementById('status-txt').textContent = 'Typing...';

  // Build messages for API
  const messages = [];
  // Add recent session context (last 20 turns)
  const sessSlice = currentSession.slice(-20);
  const histForApi = sessSlice.map((m, idx) => {
    if (idx === sessSlice.length - 1 && file?.type === 'image') {
      return { role: 'user', content: userContent };
    }
    return m;
  });
  messages.push(...histForApi.slice(0, -1));
  // Hidden insult-count/post-block-reminder note — sirf is API call ke liye,
  // currentSession (jo already upar push ho chuka hai) ya display mein kabhi nahi jaata
  const hiddenNote = buildHiddenInsultStateNote();
  let apiUserContent = userContent;
  if (hiddenNote) {
    if (typeof userContent === 'string') {
      apiUserContent = userContent + hiddenNote;
    } else if (Array.isArray(userContent)) {
      apiUserContent = userContent.map(c => c.type === 'text' ? { ...c, text: c.text + hiddenNote } : c);
    }
  }
  messages.push({ role: 'user', content: apiUserContent });

  try {
    const aiBub = appendMsg('in', '', null, true);
    typingEl.remove();

    // Naya AI-turn shuru — agar koi purani message abhi bhi "pending"
    // hai (user ne Run nahi dabaya tha), usse clear kar do
    clearActivePending();

    let { text: full, label, model, stoppedForExec, stoppedForSearch, stoppedForTool } = await streamChat(aiBub, buildPrompt(), messages);
    full = applyInsultStateMachine(full); // insult/apology tags strip + count/block state update (no-op if isCreator)
    aiBub.innerHTML = '';
    const ask = extractAskUser(full);
    const search = stoppedForSearch ? extractWebSearch(full) : null;
    const tool = (!ask && !search && stoppedForTool) ? extractTool(full) : null;
    const widget = (!ask && !search && !tool) ? extractWidget(full) : null;
    if (ask) {
      if (ask.cleanText) aiBub.appendChild(parseMarkdown(ask.cleanText));
      aiBub.appendChild(renderAskCard(ask, { bubbleEl: aiBub, historySnapshot: messages, pendingText: full }));
    } else if (search) {
      if (search.cleanText) aiBub.appendChild(parseMarkdown(search.cleanText));
    } else if (tool) {
      if (tool.cleanText) aiBub.appendChild(parseMarkdown(tool.cleanText));
    } else if (widget) {
      if (widget.cleanText) aiBub.appendChild(parseMarkdown(widget.cleanText));
      aiBub.appendChild(renderWidgetCard(widget));
    } else {
      const parsed = parseMarkdown(full || '...');
      aiBub.appendChild(parsed);
    }

    // Step 5: response ek runnable block pe ruka hai — pending mark karo
    if (stoppedForExec && !ask) {
      const blockInfo = extractLastRunnableBlock(full);
      if (blockInfo) markMessagePending(aiBub, blockInfo.cmd, blockInfo.lang, full);
    }

    // Add timestamp + model tag (label — model)
    const timEl = document.createElement('div');
    timEl.className = 'msg-time';
    if (cfg.showModelTag) {
      const tagEl = document.createElement('span');
      tagEl.className = 'model-tag-inline';
      tagEl.textContent = `${label} · ${model}`;
      timEl.appendChild(tagEl);
      timEl.appendChild(document.createTextNode(' · '));
    }
    timEl.appendChild(document.createTextNode(now()));
    aiBub.parentElement.appendChild(timEl);

    currentSession.push({ role: 'assistant', content: full });
    if (!ask && !search && !tool && !widget && cfg.showFollowUps !== false) renderFollowUps(aiBub.parentElement, text, full);

    // [WEB_SEARCH] block mila — koi button-click ki zaroorat nahi (read-only/safe),
    // automatically backend se search karke result AI ko wapas bhej do
    if (search) {
      triggerSearchContinuation(aiBub, currentSession.slice(0, -1), full, search.query);
    } else if (tool) {
      triggerToolContinuation(aiBub, currentSession.slice(0, -1), full, tool.name, tool.params);
    }
  } catch (e) {
    typingEl?.remove();
    const errMsg = e.message || 'Kuch gadbad ho gaya';
    const isProviderErr = errMsg.toLowerCase().includes('provider') || errMsg.includes('502') || errMsg.includes('503');
    appendMsg('in', '❌ ' + errMsg + (isProviderErr ? '\n\n💡 Tip: Settings mein alag model try karo (jaise llama-3.1-8b-instant)' : ''));
  } finally {
    loading = false;
    document.getElementById('send-btn').disabled = false;
    updateConnStatus();
    scrollBottom();
    autosaveSession(); // PHASE 3 — fire-and-forget, js/sessions.js (no-op for temp creator sessions)
  }
}

// ════════════════════════════════════
// FORCED WEB SEARCH — "/search <query>" command ya + menu ke 🔍 button se
// AI ke [WEB_SEARCH] emit karne ke decision ka wait nahi karte — seedha
// backend se search fire karke result AI ko de dete hain jawab dene ke liye.
// ════════════════════════════════════

async function forceWebSearchMsg(query, rawText) {
  appendMsg('out', rawText);
  currentSession.push({ role: 'user', content: rawText });

  const aiBub = appendMsg('in', '', null, true);
  loading = true;
  document.getElementById('send-btn').disabled = true;
  document.getElementById('status-txt').textContent = 'Search ho raha hai...';
  clearActivePending();

  const statusCard = renderSearchCard(query, '— search ho raha hai...');
  aiBub.appendChild(statusCard);
  scrollBottom();

  try {
    const searchRes = await performWebSearch(query);

    let instructionUser;
    if (!searchRes.ok) {
      statusCard.querySelector('.search-card-txt').textContent = `"${query}" — search fail ho gaya`;
      statusCard.classList.add('search-card-err');
      instructionUser = `[MANUAL WEB SEARCH — user ne "/search" command se ya 🔍 button se force kiya hai]\nQuery: ${query}\nStatus: Search FAIL ho gaya. Error: ${searchRes.error}\n\n[INSTRUCTION] User ko seedha bata de ki real-time info fetch nahi ho payi (backend/network issue), backend (server.js) check karne ko bol. Agar tere paas training-data-based general idea hai jo help kare toh clearly "ye current info nahi hai" keh ke de sakta hai. Koi greeting mat likh, seedha jawab de.`;
    } else if (!searchRes.results.length) {
      statusCard.querySelector('.search-card-txt').textContent = `"${query}" — koi result nahi mila`;
      instructionUser = `[MANUAL WEB SEARCH — user ne "/search" command se ya 🔍 button se force kiya hai]\nQuery: ${query}\nStatus: Search chal gaya lekin koi result nahi mila.\n\n[INSTRUCTION] User ko bata de ki search mein kuch nahi mila, query alag tarah se phrase karke dobara try karne ko bol sakta hai. Koi greeting mat likh, seedha jawab de.`;
    } else {
      statusCard.querySelector('.search-card-txt').textContent = `"${query}" — ${searchRes.results.length} results mile`;
      const resultsText = searchRes.results.map((r, i) => `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet || '(no snippet)'}`).join('\n\n');
      instructionUser = `[MANUAL WEB SEARCH — user ne "/search" command se ya 🔍 button se force kiya hai]\nQuery: ${query}\nResults:\n${resultsText}\n\n[INSTRUCTION] In results se query ka jawab de (apne words mein summarize kar, raw copy-paste mat kar). Relevant ho toh 1-2 source link de de. Agar results relevant nahi lagte, honestly bata de. Koi greeting mat likh, seedha jawab de jaise normal turn ho.`;
    }

    const messages = [...currentSession.slice(0, -1), { role: 'user', content: instructionUser }];

    let { text: full, label, model, stoppedForExec, stoppedForSearch, stoppedForTool } = await streamChat(aiBub, buildPrompt(), messages);
    full = applyInsultStateMachine(full);
    aiBub.innerHTML = '';
    const ask = extractAskUser(full);
    const search2 = stoppedForSearch ? extractWebSearch(full) : null;
    const tool2 = (!ask && !search2 && stoppedForTool) ? extractTool(full) : null;
    const widget = (!ask && !search2 && !tool2) ? extractWidget(full) : null;
    if (ask) {
      if (ask.cleanText) aiBub.appendChild(parseMarkdown(ask.cleanText));
      aiBub.appendChild(renderAskCard(ask, { bubbleEl: aiBub, historySnapshot: messages, pendingText: full }));
    } else if (search2) {
      if (search2.cleanText) aiBub.appendChild(parseMarkdown(search2.cleanText));
    } else if (tool2) {
      if (tool2.cleanText) aiBub.appendChild(parseMarkdown(tool2.cleanText));
    } else if (widget) {
      if (widget.cleanText) aiBub.appendChild(parseMarkdown(widget.cleanText));
      aiBub.appendChild(renderWidgetCard(widget));
    } else {
      aiBub.appendChild(parseMarkdown(full || '...'));
    }

    if (stoppedForExec && !ask) {
      const blockInfo = extractLastRunnableBlock(full);
      if (blockInfo) markMessagePending(aiBub, blockInfo.cmd, blockInfo.lang, full);
    }

    const timEl = document.createElement('div');
    timEl.className = 'msg-time';
    if (cfg.showModelTag) {
      const tagEl = document.createElement('span');
      tagEl.className = 'model-tag-inline';
      tagEl.textContent = `${label} · ${model}`;
      timEl.appendChild(tagEl);
      timEl.appendChild(document.createTextNode(' · '));
    }
    timEl.appendChild(document.createTextNode(now()));
    aiBub.parentElement.appendChild(timEl);

    currentSession.push({ role: 'assistant', content: full });
    if (!ask && !search2 && !tool2 && !widget && cfg.showFollowUps !== false) renderFollowUps(aiBub.parentElement, rawText, full);

    if (search2) {
      triggerSearchContinuation(aiBub, currentSession.slice(0, -1), full, search2.query);
    } else if (tool2) {
      triggerToolContinuation(aiBub, currentSession.slice(0, -1), full, tool2.name, tool2.params);
    }
  } catch (e) {
    const errMsg = e.message || 'Kuch gadbad ho gaya';
    aiBub.innerHTML = '';
    aiBub.appendChild(parseMarkdown('❌ ' + errMsg));
  } finally {
    loading = false;
    document.getElementById('send-btn').disabled = false;
    updateConnStatus();
    scrollBottom();
    autosaveSession(); // PHASE 3
  }
}

// ════════════════════════════════════
// PHASE 4 — "/instruction <rule>" proposal. Structurally identical to
// forceWebSearchMsg above: own dedicated turn, own wrapped message to the
// AI, own post-stream handling — the only new step is applyInstructionSaveTag()
// right after applyInsultStateMachine(), which strips+persists the AI's
// [INSTRUCTION_SAVE] tag if it decided to accept the rule (see
// lib/systemPrompt.js's [INSTRUCTION PROTOCOL] for what the AI was told).
// ════════════════════════════════════

async function proposeInstructionMsg(rule, rawText) {
  appendMsg('out', rawText);
  currentSession.push({ role: 'user', content: rawText });

  const aiBub = appendMsg('in', '', null, true);
  loading = true;
  document.getElementById('send-btn').disabled = true;
  document.getElementById('status-txt').textContent = 'Check ho raha hai...';
  clearActivePending();
  scrollBottom();

  const proposalUser = `[INSTRUCTION PROPOSAL — user ne "/instruction" command se ek NAYA standing rule propose kiya hai, ye uska apna typed message NAHI hai balki app ne wrap kiya hai]\nProposed rule: ${rule}\n\n[INSTRUCTION] Upar system prompt ke [INSTRUCTION PROTOCOL] section mein diye rules follow kar — scope check kar (tone/style/protocol ONLY), phir accept ya decline decide kar. Accept karte waqt apne words mein confirm kar aur EXACT [INSTRUCTION_SAVE] tag emit kar. Decline karte waqt apne words mein wajah bata, koi tag mat de.`;

  try {
    const messages = [...currentSession.slice(0, -1), { role: 'user', content: proposalUser }];

    let { text: full, label, model, stoppedForExec, stoppedForSearch, stoppedForTool } = await streamChat(aiBub, buildPrompt(), messages);
    full = applyInsultStateMachine(full);
    full = await applyInstructionSaveTag(full); // PHASE 4 — strips [INSTRUCTION_SAVE], persists if present
    aiBub.innerHTML = '';
    const ask = extractAskUser(full);
    const search = stoppedForSearch ? extractWebSearch(full) : null;
    const tool = (!ask && !search && stoppedForTool) ? extractTool(full) : null;
    const widget = (!ask && !search && !tool) ? extractWidget(full) : null;
    if (ask) {
      if (ask.cleanText) aiBub.appendChild(parseMarkdown(ask.cleanText));
      aiBub.appendChild(renderAskCard(ask, { bubbleEl: aiBub, historySnapshot: messages, pendingText: full }));
    } else if (search) {
      if (search.cleanText) aiBub.appendChild(parseMarkdown(search.cleanText));
    } else if (tool) {
      if (tool.cleanText) aiBub.appendChild(parseMarkdown(tool.cleanText));
    } else if (widget) {
      if (widget.cleanText) aiBub.appendChild(parseMarkdown(widget.cleanText));
      aiBub.appendChild(renderWidgetCard(widget));
    } else {
      aiBub.appendChild(parseMarkdown(full || '...'));
    }

    if (stoppedForExec && !ask) {
      const blockInfo = extractLastRunnableBlock(full);
      if (blockInfo) markMessagePending(aiBub, blockInfo.cmd, blockInfo.lang, full);
    }

    const timEl = document.createElement('div');
    timEl.className = 'msg-time';
    if (cfg.showModelTag) {
      const tagEl = document.createElement('span');
      tagEl.className = 'model-tag-inline';
      tagEl.textContent = `${label} · ${model}`;
      timEl.appendChild(tagEl);
      timEl.appendChild(document.createTextNode(' · '));
    }
    timEl.appendChild(document.createTextNode(now()));
    aiBub.parentElement.appendChild(timEl);

    currentSession.push({ role: 'assistant', content: full });
    if (!ask && !search && !tool && !widget && cfg.showFollowUps !== false) renderFollowUps(aiBub.parentElement, rawText, full);

    if (search) {
      triggerSearchContinuation(aiBub, currentSession.slice(0, -1), full, search.query);
    } else if (tool) {
      triggerToolContinuation(aiBub, currentSession.slice(0, -1), full, tool.name, tool.params);
    }
  } catch (e) {
    const errMsg = e.message || 'Kuch gadbad ho gaya';
    aiBub.innerHTML = '';
    aiBub.appendChild(parseMarkdown('❌ ' + errMsg));
  } finally {
    loading = false;
    document.getElementById('send-btn').disabled = false;
    updateConnStatus();
    scrollBottom();
    autosaveSession();
  }
}

// ════════════════════════════════════
// IMAGE GENERATION (Puter.js — free, no API key)
// ════════════════════════════════════

async function generateImageMsg(prompt, rawText) {
  appendMsg('out', rawText);
  currentSession.push({ role: 'user', content: '[Image request: ' + prompt + ']' });

  const typingEl = appendTyping();
  loading = true;
  document.getElementById('send-btn').disabled = true;
  document.getElementById('status-txt').textContent = 'Image bana raha hai...';

  try {
    if (!window.puter || !window.puter.ai || !window.puter.ai.txt2img) {
      throw new Error('Image generator load nahi hua, internet check karo');
    }
    const models = ['black-forest-labs/flux-schnell', 'openai/gpt-image-1-mini', 'stabilityai/stable-diffusion-3-medium'];
    let imgEl, lastErr;
    for (const m of models) {
      try {
        imgEl = await puter.ai.txt2img(prompt, { model: m });
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!imgEl) throw lastErr || new Error('Koi model kaam nahi kiya');
    typingEl.remove();

    const wrap = document.createElement('div');
    wrap.className = 'message in';
    const inner = document.createElement('div');
    const bub = document.createElement('div');
    bub.className = 'msg-bubble';
    imgEl.style.cssText = 'max-width:min(72vw,320px);width:100%;border-radius:14px;display:block';
    makeClickableImg(imgEl, prompt);
    bub.appendChild(imgEl);
    const cap = document.createElement('div');
    cap.style.cssText = 'margin-top:6px;font-size:0.8rem;color:var(--text-low)';
    cap.textContent = '🎨 ' + prompt;
    bub.appendChild(cap);
    inner.appendChild(bub);
    const t = document.createElement('div');
    t.className = 'msg-time';
    t.textContent = now();
    inner.appendChild(t);
    wrap.appendChild(inner);
    document.getElementById('msgs-list').appendChild(wrap);
    scrollBottom();

    currentSession.push({ role: 'assistant', content: '[Generated image for: ' + prompt + ']' });
  } catch (e) {
    typingEl?.remove();
    appendMsg('in', '❌ Image nahi ban payi: ' + (e.message || 'kuch gadbad ho gaya'));
  } finally {
    loading = false;
    document.getElementById('send-btn').disabled = false;
    updateConnStatus();
    scrollBottom();
    autosaveSession(); // PHASE 3
  }
}

// ════════════════════════════════════
// FOLLOW-UP SUGGESTIONS (Claude.ai-style related prompts)
// ════════════════════════════════════

async function renderFollowUps(msgWrap, userText, aiText) {
  if (!isCreatorActive() && cfg.insultBlockUntil > Date.now()) return; // BLOCKED state mein follow-up chips bhi mat dikhao
  const langLine = cfg.lang === 'english' ? 'Reply in English.' : cfg.lang === 'hindi' ? 'Pure Hindi mein reply karo.' : 'Hinglish mein reply karo.';
  const sysMsg = `Neeche ek chat ka aakhri exchange diya hai. Isse related 3 chhote follow-up questions/prompts suggest karo jo user aage puch sakta hai. ${langLine} Har suggestion max 6 words ka ho. Sirf 3 lines return karo, kuch aur nahi — no numbering, no bullets, no quotes.`;
  const userMsg = `User: ${String(userText).slice(0, 300)}\nAI: ${String(aiText).slice(0, 500)}`;

  // PHASE 1: routed through server's /api/chat "bare mode" now (see
  // providers.js callServerBare) instead of calling a provider directly
  // with a client-stored key — server's own key pool handles this too.
  let raw = '';
  try {
    raw = await callServerBare(sysMsg, userMsg, 80);
  } catch {}
  if (!raw) return;

  const items = raw.split('\n').map(l => l.replace(/^[\d.\-•*"'\s]+/, '').replace(/["']+$/, '').trim()).filter(Boolean).slice(0, 3);
  if (!items.length) return;

  const box = document.createElement('div');
  box.className = 'sugg-chips';
  box.style.justifyContent = 'flex-start';
  box.style.marginTop = '10px';
  box.innerHTML = items.map(s => `<button class="sugg-chip" type="button">${s.replace(/</g, '&lt;')}</button>`).join('');
  box.querySelectorAll('.sugg-chip').forEach((btn, i) => {
    btn.addEventListener('click', () => {
      box.remove();
      document.getElementById('msg-inp').value = items[i];
      sendMsg();
    });
  });
  msgWrap.appendChild(box);
  scrollBottom();
}

// ════════════════════════════════════
// ASK-USER ELICITATION CARD
// Jab AI ko koi personal fact nahi pata (jaise DOB), toh guess karne ke bajaye
// [ASK_USER] block bhejta hai — hum usse ek interactive card mein render karte hain
// (suggested option buttons + free-text input). Jawab milne par woh permanent
// memory mein auto-save ho jaata hai, taaki dobara na poochna pade.
// ════════════════════════════════════
// ════════════════════════════════════
// CREATOR-RESPECT ENFORCEMENT — [INSULT_FLAG]/[APOLOGY_FLAG] detection +
// deterministic JS state machine (see buildIdentityProtocol for the AI-side
// tag-emission instructions). Poori tarah skip hoti hai jab cfg.isCreator
// true ho. ⚠️ Known limitation: ye LLM reliability pe depend karta hai —
// fallback/weaker model (jaise Mistral) kabhi-kabhi tag emit karna miss
// kar sakta hai. Ye acceptable hai kyunki ye ek social nudge system hai,
// security system nahi.
// ════════════════════════════════════

function extractInsultFlag(text) {
  if (!text) return { detected: false, cleanText: text || '' };
  const m = text.match(/\[INSULT_FLAG\][\s\S]*?\[\/INSULT_FLAG\]/i);
  if (!m) return { detected: false, cleanText: text };
  return { detected: true, cleanText: text.replace(m[0], '').trim() };
}

function extractApologyFlag(text) {
  if (!text) return { detected: false, cleanText: text || '' };
  const m = text.match(/\[APOLOGY_FLAG\][\s\S]*?\[\/APOLOGY_FLAG\]/i);
  if (!m) return { detected: false, cleanText: text };
  return { detected: true, cleanText: text.replace(m[0], '').trim() };
}

// Har raw AI response pe (sendMsg/forceWebSearchMsg/continuation flows mein)
// sabse pehle ye call karo — [ASK_USER]/[WEB_SEARCH] extract karne SE PEHLE.
// Ye tags strip karke count/block state update karta hai (deterministic,
// LLM pe count-tracking ka bharosa nahi) aur clean text wapas deta hai jise
// aage normal parsing pipeline mein use karo.

function applyInsultStateMachine(rawText) {
  if (isCreatorActive()) return rawText;
  const apology = extractApologyFlag(rawText);
  const insult = extractInsultFlag(apology.cleanText);
  let dirty = false;

  // Rule 1: apology, jis count pe bhi ho, hamesha poora reset karta hai
  if (apology.detected && cfg.insultCount !== 0) {
    cfg.insultCount = 0;
    dirty = true;
  }
  // Rule 2: insult detect hua to count badhao; 3rd (cumulative) insult par BLOCK
  if (insult.detected) {
    cfg.insultCount = (cfg.insultCount || 0) + 1;
    dirty = true;
    if (cfg.insultCount >= 3) {
      cfg.insultBlockUntil = Date.now() + 60 * 60 * 1000; // 1 ghanta
      cfg.insultCount = 0; // block khud hi ab consequence hai
      dirty = true;
    }
  }
  if (dirty) LS.set('chaman_cfg', cfg);
  if (cfg.insultBlockUntil > Date.now()) enterBlockedState();
  return insult.cleanText;
}

// sendMsg() mein API ko bhejne se THEEK PEHLE current turn ke user-content
// mein append karne ke liye ek hidden, system-style note — [TERMINAL RESULT]
// jaisa hi pattern (exec-continuation mein use hota hai), currentSession
// history mein kabhi save nahi hoti, sirf is-ek API call ke liye.

function buildHiddenInsultStateNote() {
  if (isCreatorActive()) return '';
  let note = '';
  if (cfg.insultCount > 0) {
    note += `\n\n[CURRENT INSULT COUNT: ${cfg.insultCount}]`;
  }
  if (cfg.needsPostBlockReminder) {
    note += `\n\n[POST-BLOCK REMINDER]`;
    cfg.needsPostBlockReminder = false; // sirf ek baar trigger ho, isliye turant reset
    LS.set('chaman_cfg', cfg);
  }
  return note;
}


function fmtMMSS(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}


let blockTimerInterval = null;

// Input/plus/send disable + live countdown + chips ko single apology-chip se replace

function enterBlockedState() {
  const inp = document.getElementById('msg-inp');
  const sendBtn = document.getElementById('send-btn');
  const plusBtn = document.getElementById('plus-btn');
  if (inp) inp.disabled = true;
  if (sendBtn) sendBtn.disabled = true;
  if (plusBtn) plusBtn.disabled = true;

  renderSuggChips();

  if (blockTimerInterval) clearInterval(blockTimerInterval);
  const tick = () => {
    const remaining = cfg.insultBlockUntil - Date.now();
    const timerEl = document.getElementById('insult-block-timer');
    if (remaining <= 0) {
      clearInterval(blockTimerInterval);
      blockTimerInterval = null;
      cfg.insultBlockUntil = 0;
      cfg.needsPostBlockReminder = true; // timer khud expire hua, chip tap nahi hui — agla real message pe ek gentle reminder
      LS.set('chaman_cfg', cfg);
      exitBlockedState(false);
      return;
    }
    if (timerEl) timerEl.textContent = `⏳ Block: ${fmtMMSS(remaining)}`;
  };
  tick();
  blockTimerInterval = setInterval(tick, 1000);
}

// showApologyToast=true jab user ne chip tap karke khud unblock kiya ho

function exitBlockedState(showApologyToast) {
  const inp = document.getElementById('msg-inp');
  const sendBtn = document.getElementById('send-btn');
  const plusBtn = document.getElementById('plus-btn');
  if (inp) inp.disabled = false;
  if (sendBtn) sendBtn.disabled = false;
  if (plusBtn) plusBtn.disabled = false;
  if (blockTimerInterval) { clearInterval(blockTimerInterval); blockTimerInterval = null; }
  const timerEl = document.getElementById('insult-block-timer');
  if (timerEl) timerEl.textContent = '';
  renderSuggChips();
  if (showApologyToast) toast('Thik hai, dhyan rakhna 🙏');
}

// "Sorry to Creator Najeef" chip tap hone par — turant unblock, koi API call nahi

function tapApologyChip() {
  cfg.insultBlockUntil = 0;
  LS.set('chaman_cfg', cfg);
  exitBlockedState(true);
}


// PHASE 4 — [INSTRUCTION_SAVE] tag detect + strip. Only ever emitted by the
// AI in direct response to a "/instruction" proposal (see proposeInstructionMsg
// below and lib/systemPrompt.js's [INSTRUCTION PROTOCOL]) — the AI already
// decided the rule is in-scope and already confirmed in its own words BEFORE
// this tag appears, so by the time we see it here, saving is just persistence,
// not a second validation pass.
function extractInstructionSave(text) {
  if (!text) return null;
  const m = text.match(/\[INSTRUCTION_SAVE\]([\s\S]*?)\[\/INSTRUCTION_SAVE\]/i);
  if (m) {
    const ruleText = m[1].trim();
    const cleanText = text.replace(m[0], '').trim();
    return { ruleText, cleanText };
  }
  // FALLBACK — same class of issue as extractAskUser above: a weaker/fast-tier
  // model sometimes says "thik hai, ab se..." and opens [INSTRUCTION_SAVE]
  // but never closes it, so the rule silently never gets persisted even
  // though the chat clearly shows it was confirmed. Take just the first line
  // after the opening tag as the rule text (protocol says this should be a
  // short, clean one-liner anyway) instead of dropping it entirely.
  const openIdx = text.search(/\[INSTRUCTION_SAVE\]/i);
  if (openIdx === -1) return null;
  const afterOpen = text.slice(openIdx).replace(/\[INSTRUCTION_SAVE\]/i, '');
  const firstLine = (afterOpen.split('\n')[0] || '').trim();
  if (!firstLine) return null;
  const cleanText = (text.slice(0, openIdx) + afterOpen.slice(afterOpen.indexOf(firstLine) + firstLine.length)).trim();
  return { ruleText: firstLine, cleanText };
}

// Side-effecting wrapper (mirrors applyInsultStateMachine's shape) — strips
// the tag from the displayed text either way, and fires the actual Firestore
// write (js/instructions.js) when there's a non-empty rule to save. Async
// because saveConfirmedInstruction() is a network call; caller awaits it
// right after applyInsultStateMachine(), before any ask/search/tool/widget
// extraction runs on the result.
async function applyInstructionSaveTag(rawText) {
  const found = extractInstructionSave(rawText);
  if (!found) return rawText;
  if (!found.ruleText) return found.cleanText; // AI emitted an empty tag somehow — just strip, nothing to save
  try {
    await saveConfirmedInstruction(found.ruleText);
    toast('📌 Instruction save ho gaya');
  } catch (e) {
    toast('⚠️ Instruction save nahi ho paya: ' + (e.message || 'wajah pata nahi'));
  }
  return found.cleanText;
}

function extractAskUser(text) {
  if (!text) return null;
  const m = text.match(/\[ASK_USER\]([\s\S]*?)\[\/ASK_USER\]/i);
  let preText, block, trailingText = '';
  if (m) {
    preText = text.slice(0, m.index);
    block = m[1];
  } else {
    // FALLBACK — weaker/fast-tier models (e.g. Mistral's ministral-8b-latest)
    // sometimes emit [ASK_USER] but forget the closing [/ASK_USER] tag, so
    // the card silently never renders even though the model clearly meant
    // to ask. Instead of requiring the closing tag, find the opening tag and
    // cut the block right after the LAST recognized field line (SAVE >
    // OPTIONS > Q) — anything after that is kept as trailing text instead
    // of being swallowed/lost.
    const openIdx = text.search(/\[ASK_USER\]/i);
    if (openIdx === -1) return null;
    preText = text.slice(0, openIdx);
    const afterOpen = text.slice(openIdx).replace(/\[ASK_USER\]/i, '');
    const lines = afterOpen.split('\n');
    let cutLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*(SAVE|OPTIONS|Q)\s*:/i.test(lines[i])) cutLine = i;
    }
    if (cutLine === -1) return null; // nothing recognizable — not actually an ASK_USER block
    block = lines.slice(0, cutLine + 1).join('\n');
    trailingText = lines.slice(cutLine + 1).join('\n').trim();
  }
  const qMatch = block.match(/Q:\s*(.+)/i);
  const optMatch = block.match(/OPTIONS:\s*(.+)/i);
  const saveMatch = block.match(/SAVE:\s*(yes|no)/i);
  const question = qMatch ? qMatch[1].trim() : '';
  const options = optMatch ? optMatch[1].split('|').map(s => s.trim()).filter(Boolean) : [];
  // Missing/unclear SAVE field ho to safe default "no" — warna task-specific
  // inputs (jaise links, filenames) galti se permanent memory mein clutter kar dete
  const save = saveMatch ? saveMatch[1].toLowerCase() === 'yes' : false;
  const cleanText = [preText.trim(), trailingText].filter(Boolean).join('\n\n').trim();
  if (!question) return null;
  return { question, options, save, cleanText };
}

// ════════════════════════════════════
// WEB SEARCH — [WEB_SEARCH] block detection
// AI apne response ke aakhir mein [WEB_SEARCH]QUERY: ...[/WEB_SEARCH]
// block deta hai jab usse current/uncertain info chahiye hoti hai. Ye
// exec-block ki tarah hi kaam karta hai (stream cut ho jaata hai jaise
// hi block band hota hai), farak sirf itna hai ki search safe/read-only
// hai isliye user ko "Run" dabane ki zaroorat nahi — automatically
// backend se fetch hoke result AI ko wapas chala jaata hai.
// ════════════════════════════════════

function extractWebSearch(text) {
  if (!text) return null;
  const m = text.match(/\[WEB_SEARCH\]([\s\S]*?)\[\/WEB_SEARCH\]/i);
  if (!m) return null;
  const block = m[1];
  const qMatch = block.match(/QUERY:\s*(.+)/i);
  const query = qMatch ? qMatch[1].trim() : '';
  const cleanText = text.replace(m[0], '').trim();
  if (!query) return null;
  return { query, cleanText };
}

// Streaming ke beech mein [/WEB_SEARCH] band hote hi cut karne ke liye
// (findRunnableFenceEnd jaisa hi pattern, bash-fence ki jagah is block ke liye)

function findWebSearchBlockEnd(text) {
  const m = text.match(/\[WEB_SEARCH\][\s\S]*?\[\/WEB_SEARCH\]/i);
  if (!m) return -1;
  return m.index + m[0].length;
}

// ════════════════════════════════════
// TOOL PLUGIN SYSTEM — [TOOL] block detection + execution. General system:
// NAME field decide karta hai kaunsa plugin (PLUGIN_REGISTRY mein), PARAMS
// comma-separated key=value pairs. Same pattern jaisa [WEB_SEARCH] hai —
// stream cut hoti hai block band hote hi, phir background mein fetch hoke
// result AI ko continuation ke roop mein wapas milta hai.
// ════════════════════════════════════

function extractTool(text) {
  if (!text) return null;
  const m = text.match(/\[TOOL\]([\s\S]*?)\[\/TOOL\]/i);
  if (!m) return null;
  const block = m[1];
  const nameMatch = block.match(/NAME:\s*(.+)/i);
  const name = nameMatch ? nameMatch[1].trim().toLowerCase() : '';
  const paramsMatch = block.match(/PARAMS:\s*(.+)/i);
  const paramsStr = paramsMatch ? paramsMatch[1].trim() : '';
  const params = {};
  paramsStr.split(',').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim().toLowerCase();
    const v = pair.slice(idx + 1).trim();
    if (k) params[k] = v;
  });
  const cleanText = text.replace(m[0], '').trim();
  if (!name || !PLUGIN_REGISTRY[name]) return null;
  return { name, params, cleanText };
}


function findToolBlockEnd(text) {
  const m = text.match(/\[TOOL\][\s\S]*?\[\/TOOL\]/i);
  if (!m) return -1;
  return m.index + m[0].length;
}

// ── PLUGIN REGISTRY — har entry ek free public API ko wrap karta hai.
// `run(params)` object return karta hai (ya throw karta hai error ke saath),
// jo AI ko continuation mein JSON ke roop mein diya jaata hai. `needsKey`
// agar string hai, cfg.toolKeys[needsKey] se key li jaati hai (Settings mein
// user daalta hai) — 'false' matlab koi key nahi chahiye. ──

const PLUGIN_REGISTRY = {
  weather: {
    label: 'Weather', needsKey: false,
    async run(params) {
      const city = params.city || params.location;
      if (!city) throw new Error('city param missing');
      const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`);
      const geo = await geoRes.json();
      if (!geo.results || !geo.results.length) throw new Error(`"${city}" location nahi mila`);
      const { latitude, longitude, name, country } = geo.results[0];
      const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`);
      const w = await wRes.json();
      return { location: `${name}, ${country || ''}`.trim(), ...w.current };
    }
  },
  wikipedia: {
    label: 'Wikipedia', needsKey: false,
    async run(params) {
      const topic = params.topic || params.query;
      if (!topic) throw new Error('topic param missing');
      const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`);
      if (!res.ok) throw new Error(`"${topic}" ke liye Wikipedia page nahi mila`);
      const data = await res.json();
      return { title: data.title, extract: data.extract, url: data.content_urls?.desktop?.page };
    }
  },
  github: {
    label: 'GitHub', needsKey: false,
    async run(params) {
      if (params.repo) {
        const res = await fetch(`https://api.github.com/repos/${params.repo}`);
        if (!res.ok) throw new Error(`repo "${params.repo}" nahi mila`);
        const d = await res.json();
        return { name: d.full_name, description: d.description, stars: d.stargazers_count, forks: d.forks_count, language: d.language, url: d.html_url };
      }
      if (params.user) {
        const res = await fetch(`https://api.github.com/users/${params.user}`);
        if (!res.ok) throw new Error(`user "${params.user}" nahi mila`);
        const d = await res.json();
        return { name: d.name || d.login, bio: d.bio, followers: d.followers, public_repos: d.public_repos, url: d.html_url };
      }
      throw new Error('repo ya user param chahiye');
    }
  },
  currency: {
    label: 'Currency/Crypto', needsKey: false,
    async run(params) {
      if (params.crypto) {
        const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(params.crypto)}&vs_currencies=usd,inr`);
        const d = await res.json();
        const key = Object.keys(d)[0];
        if (!key) throw new Error(`"${params.crypto}" crypto nahi mila`);
        return { coin: key, usd: d[key].usd, inr: d[key].inr };
      }
      if (params.from && params.to) {
        const res = await fetch(`https://api.exchangerate-api.com/v4/latest/${params.from.toUpperCase()}`);
        const d = await res.json();
        const rate = d.rates?.[params.to.toUpperCase()];
        if (!rate) throw new Error(`"${params.to}" rate nahi mila`);
        return { from: params.from.toUpperCase(), to: params.to.toUpperCase(), rate };
      }
      throw new Error('crypto ya from+to params chahiye');
    }
  },
  nasa: {
    label: 'NASA APOD', needsKey: false, // DEMO_KEY fallback (rate-limited but works)
    async run() {
      const key = (cfg.toolKeys && cfg.toolKeys.nasa) || 'DEMO_KEY';
      const res = await fetch(`https://api.nasa.gov/planetary/apod?api_key=${key}`);
      if (!res.ok) throw new Error('NASA API se data nahi mila (DEMO_KEY rate-limit ho sakti hai)');
      const d = await res.json();
      return { title: d.title, date: d.date, explanation: d.explanation, image: d.url };
    }
  },
  tmdb: {
    label: 'Movies/TV (TMDB)', needsKey: 'tmdb',
    async run(params) {
      const key = cfg.toolKeys?.tmdb;
      if (!key) throw new Error('TMDB API key set nahi hai (Settings → Providers → Tool APIs mein daalo, themoviedb.org se free milti hai)');
      const query = params.query || params.title;
      if (!query) throw new Error('query param missing');
      const res = await fetch(`https://api.themoviedb.org/3/search/multi?api_key=${key}&query=${encodeURIComponent(query)}`);
      const d = await res.json();
      const top = (d.results || []).find(r => r.media_type === 'movie' || r.media_type === 'tv') || d.results?.[0];
      if (!top) throw new Error(`"${query}" ke liye kuch nahi mila`);
      return { title: top.title || top.name, overview: top.overview, rating: top.vote_average, release: top.release_date || top.first_air_date, type: top.media_type };
    }
  },
  anime: {
    label: 'Anime (Jikan/MAL)', needsKey: false,
    async run(params) {
      const query = params.query || params.title;
      if (!query) throw new Error('query param missing');
      const res = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=1`);
      const d = await res.json();
      const top = d.data?.[0];
      if (!top) throw new Error(`"${query}" anime nahi mila`);
      return { title: top.title, score: top.score, episodes: top.episodes, status: top.status, synopsis: (top.synopsis || '').slice(0, 400) };
    }
  },
  meme: {
    label: 'Meme', needsKey: false,
    async run(params) {
      const sub = params.subreddit ? `/${params.subreddit}` : '';
      const res = await fetch(`https://meme-api.com/gimme${sub}`);
      const d = await res.json();
      if (!d.url) throw new Error('meme fetch nahi hua');
      return { title: d.title, image: d.url, subreddit: d.subreddit };
    }
  },
  giphy: {
    label: 'GIF (Giphy)', needsKey: 'giphy',
    async run(params) {
      const key = cfg.toolKeys?.giphy;
      if (!key) throw new Error('Giphy API key set nahi hai (Settings → Providers → Tool APIs mein daalo, developers.giphy.com se free milti hai)');
      const query = params.query || params.q;
      if (!query) throw new Error('query param missing');
      const res = await fetch(`https://api.giphy.com/v1/gifs/search?api_key=${key}&q=${encodeURIComponent(query)}&limit=1`);
      const d = await res.json();
      const top = d.data?.[0];
      if (!top) throw new Error(`"${query}" GIF nahi mila`);
      return { title: top.title, image: top.images?.original?.url };
    }
  },
  // ═══════════════════════════════════════════════════════════════════
  // PHASE 5 — ADMIN-ONLY TOOLS. Backed by api/admin/stats.js + api/admin/
  // users.js (server re-verifies isCreatorActive independently via
  // requireAdmin() — this client-side guard is defense-in-depth, not the
  // real gate). systemPrompt.js only tells the AI these tools EXIST when
  // isCreatorActive is true, so a normal user's AI never even knows to
  // ask — but a hard guard here means a stray/malicious [TOOL] block from
  // a non-creator chat still gets flatly rejected instead of hitting the
  // network.
  // ═══════════════════════════════════════════════════════════════════
  adminstats: {
    label: 'Admin Stats', needsKey: false,
    async run() {
      if (!isCreatorActive()) throw new Error('Creator mode active nahi hai — ye tool available nahi hai');
      const data = await callAdminApi('/api/admin/stats', {});
      return {
        totalUsers: data.totalUsers,
        newUsersToday: data.newUsersToday,
        keyHealth: data.keyHealth,
      };
    }
  },
  adminusers: {
    label: 'Admin Users', needsKey: false,
    async run(params) {
      if (!isCreatorActive()) throw new Error('Creator mode active nahi hai — ye tool available nahi hai');
      const action = (params.action || 'list').toLowerCase();
      if (action === 'list') {
        const data = await callAdminApi('/api/admin/users', { action: 'list', limit: params.limit ? Number(params.limit) : 50 });
        return { users: data.users };
      }
      if (action === 'find') {
        if (!params.query) throw new Error('query param missing');
        const data = await callAdminApi('/api/admin/users', { action: 'find', query: params.query });
        return { matches: data.matches };
      }
      if (action === 'rawsessions') {
        if (!params.uid) throw new Error('uid param missing — raw chat sirf explicit uid ke saath milta hai');
        const data = await callAdminApi('/api/admin/users', { action: 'rawSessions', uid: params.uid, limit: params.limit ? Number(params.limit) : 20 });
        return { uid: data.uid, sessions: data.sessions };
      }
      throw new Error(`Unknown adminusers action: ${action}`);
    }
  },
  creatormemory: {
    label: 'Creator Memory', needsKey: false,
    async run(params) {
      if (!isCreatorActive()) throw new Error('Creator mode active nahi hai — ye tool available nahi hai');
      const action = (params.action || 'list').toLowerCase();
      if (action === 'add') {
        if (!params.text) throw new Error('text param missing');
        const data = await callAdminApi('/api/admin/memory', { action: 'add', text: params.text });
        if (typeof refreshCreatorMemory === 'function') await refreshCreatorMemory(); // cache turant refresh — agle prompt mein turant dikhe
        return { saved: data.note };
      }
      if (action === 'delete') {
        if (!params.id) throw new Error('id param missing');
        await callAdminApi('/api/admin/memory', { action: 'delete', id: params.id });
        if (typeof refreshCreatorMemory === 'function') await refreshCreatorMemory();
        return { deleted: params.id };
      }
      // 'list' — mostly redundant (creator memory already auto-injected into every
      // prompt, see js/systemPrompt.js) but harmless to support explicitly too.
      const data = await callAdminApi('/api/admin/memory', { action: 'list' });
      return { notes: data.notes };
    }
  }
};


async function runTool(name, params) {
  const plugin = PLUGIN_REGISTRY[name];
  if (!plugin) return { ok: false, error: `Unknown tool: ${name}` };
  try {
    const data = await plugin.run(params || {});
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message || 'Tool call fail ho gaya' };
  }
}


function renderToolCard(name, status) {
  const card = document.createElement('div');
  card.className = 'search-card';
  const label = PLUGIN_REGISTRY[name]?.label || name;
  card.innerHTML = `<span class="search-card-icon">🔌</span><span class="search-card-txt">${label} ${status}</span>`;
  return card;
}

// bubbleEl/historySnapshot/pendingText = triggerSearchContinuation jaisa hi
// context, toolName/toolParams = AI ne [TOOL] block mein jo maanga tha

async function triggerToolContinuation(bubbleEl, historySnapshot, pendingText, toolName, toolParams) {
  if (!bubbleEl || !bubbleEl.isConnected) return;

  const statusCard = renderToolCard(toolName, '— fetch ho raha hai...');
  bubbleEl.appendChild(statusCard);
  scrollBottom();

  const toolRes = await runTool(toolName, toolParams);
  const label = PLUGIN_REGISTRY[toolName]?.label || toolName;

  let instructionUser;
  if (!toolRes.ok) {
    statusCard.querySelector('.search-card-txt').textContent = `${label} — fail ho gaya`;
    statusCard.classList.add('search-card-err');
    instructionUser = `[TOOL RESULT — TU (AI) YE DEKH RAHA HAI, USER NE YE NAHI LIKHA]\nTool: ${toolName}\nParams: ${JSON.stringify(toolParams)}\nStatus: FAIL. Error: ${toolRes.error}\n\n[INSTRUCTION] Apna pichla response yahin se continue kar — user ko honestly bata de ki ye tool call fail ho gaya (chhoti si wajah bata), aur agar tere paas is topic ka koi general idea hai jo help kare toh de sakta hai. NAYA greeting mat likh, jaise apna hi sentence continue kar raha hai.`;
  } else {
    statusCard.querySelector('.search-card-txt').textContent = `${label} — data mil gaya`;
    instructionUser = `[TOOL RESULT — TU (AI) YE DEKH RAHA HAI, USER NE YE NAHI LIKHA]\nTool: ${toolName}\nParams: ${JSON.stringify(toolParams)}\nData:\n${JSON.stringify(toolRes.data, null, 2)}\n\n[INSTRUCTION] Apna pichla response yahin se continue kar — is data ko apne natural words mein present kar (raw JSON kabhi copy-paste mat kar). Agar data mein 'image' field ek URL hai, toh Markdown image syntax ![alt](url) use kar taaki wo render ho jaye. NAYA greeting mat likh, jaise apna hi sentence continue kar raha hai.`;
  }

  const continuationMessages = [
    ...historySnapshot,
    { role: 'assistant', content: pendingText },
    { role: 'user', content: instructionUser },
  ];

  const divider = document.createElement('div');
  divider.className = 'exec-continuation-sep';
  bubbleEl.appendChild(divider);
  const contEl = document.createElement('div');
  contEl.className = 'exec-continuation';
  bubbleEl.appendChild(contEl);
  scrollBottom();

  try {
    const res = await streamChat(contEl, buildPrompt(), continuationMessages);
    res.text = applyInsultStateMachine(res.text);
    const contFull = res.text;

    contEl.innerHTML = '';
    const contAsk = extractAskUser(contFull);
    const contSearch = !contAsk && res.stoppedForSearch ? extractWebSearch(contFull) : null;
    const contTool = (!contAsk && !contSearch && res.stoppedForTool) ? extractTool(contFull) : null;
    const contWidget = (!contAsk && !contSearch && !contTool) ? extractWidget(contFull) : null;
    if (contAsk) {
      if (contAsk.cleanText) contEl.appendChild(parseMarkdown(contAsk.cleanText));
      contEl.appendChild(renderAskCard(contAsk, { bubbleEl, historySnapshot: continuationMessages, pendingText: contFull }));
    } else if (contSearch) {
      if (contSearch.cleanText) contEl.appendChild(parseMarkdown(contSearch.cleanText));
    } else if (contTool) {
      if (contTool.cleanText) contEl.appendChild(parseMarkdown(contTool.cleanText));
    } else if (contWidget) {
      if (contWidget.cleanText) contEl.appendChild(parseMarkdown(contWidget.cleanText));
      contEl.appendChild(renderWidgetCard(contWidget));
    } else {
      contEl.appendChild(parseMarkdown(contFull || '...'));
    }

    currentSession.push({ role: 'user', content: instructionUser });
    currentSession.push({ role: 'assistant', content: contFull });

    if (res.stoppedForExec && !contAsk && !contSearch && !contTool && !contWidget) {
      const blockInfo = extractLastRunnableBlock(contFull);
      if (blockInfo) markMessagePending(bubbleEl, blockInfo.cmd, blockInfo.lang, contFull, continuationMessages);
    } else if (contSearch) {
      triggerSearchContinuation(bubbleEl, continuationMessages, contFull, contSearch.query);
    } else if (contTool) {
      triggerToolContinuation(bubbleEl, continuationMessages, contFull, contTool.name, contTool.params);
    }
    scrollBottom();
  } catch (err) {
    contEl.textContent = '⚠️ AI se tool-result discuss nahi ho paya (connection issue).';
    contEl.classList.add('exec-continuation-note');
    scrollBottom();
  }
}

// ════════════════════════════════════
// LIVE WIDGETS — [WIDGET] block detection + rendering. General system:
// TYPE field decide karta hai kaunsa widget hai. Abhi sirf "timer"
// implemented hai — future mein aur types (progress, poll, wagera) isi
// pattern se add ho sakte hain. Pure FRONTEND/client-side hai, koi
// backend/exec dependency nahi (isliye backend down hone par bhi kaam
// karta hai — countdown.html + xdg-open wale purane broken approach ki
// jagah ye use karo).
// ════════════════════════════════════

function extractWidget(text) {
  if (!text) return null;
  const m = text.match(/\[WIDGET\]([\s\S]*?)\[\/WIDGET\]/i);
  if (!m) return null;
  const block = m[1];
  const typeMatch = block.match(/TYPE:\s*(\w+)/i);
  const type = typeMatch ? typeMatch[1].trim().toLowerCase() : '';
  const cleanText = text.replace(m[0], '').trim();
  const labelMatch = block.match(/LABEL:\s*(.+)/i);
  const label = labelMatch ? labelMatch[1].trim() : 'Widget';

  if (type === 'timer') {
    const durMatch = block.match(/DURATION:\s*(\d+)/i);
    let duration = durMatch ? parseInt(durMatch[1], 10) : 0;
    if (!duration || duration < 1) return null; // invalid/missing duration — silently ignore, no fake widget
    if (duration > 86400) duration = 86400; // sanity cap — 24 ghante se zyada ka timer allow nahi
    return { type, duration, label, cleanText };
  }
  if (type === 'checklist') {
    const itemsMatch = block.match(/ITEMS:\s*(.+)/i);
    const items = itemsMatch ? itemsMatch[1].split('|').map(s => s.trim()).filter(Boolean) : [];
    if (items.length < 1) return null;
    if (items.length > 15) items.length = 15; // sanity cap
    return { type, items, label, cleanText };
  }
  if (type === 'progress') {
    const valMatch = block.match(/VALUE:\s*(-?\d+(?:\.\d+)?)/i);
    const maxMatch = block.match(/MAX:\s*(-?\d+(?:\.\d+)?)/i);
    let value = valMatch ? parseFloat(valMatch[1]) : 0;
    let max = maxMatch ? parseFloat(maxMatch[1]) : 0;
    if (!max || max <= 0) return null; // MAX zaroori hai, warna progress ka koi matlab nahi
    if (value < 0) value = 0;
    if (value > max) value = max;
    return { type, value, max, label, cleanText };
  }
  if (type === 'poll') {
    const optMatch = block.match(/OPTIONS:\s*(.+)/i);
    const options = optMatch ? optMatch[1].split('|').map(s => s.trim()).filter(Boolean) : [];
    if (options.length < 2) return null; // kam se kam 2 options chahiye
    if (options.length > 6) options.length = 6; // sanity cap
    return { type, options, label, cleanText };
  }
  return null; // unknown TYPE — silently ignore (normal text jaisa hi treat hoga)
}


const TIMER_RING_R = 28;

const TIMER_RING_CIRC = 2 * Math.PI * TIMER_RING_R;


function renderWidgetCard(widget) {
  if (widget.type === 'timer') return renderTimerWidget(widget);
  if (widget.type === 'checklist') return renderChecklistWidget(widget);
  if (widget.type === 'progress') return renderProgressWidget(widget);
  if (widget.type === 'poll') return renderPollWidget(widget);
  const empty = document.createElement('span');
  return empty; // unknown type ke liye kabhi yahan tak nahi aana chahiye (extractWidget pehle hi null deta)
}


function renderTimerWidget(widget) {
  const card = document.createElement('div');
  card.className = 'widget-card timer-widget';
  card.innerHTML = `
    <div class="timer-ring-wrap">
      <svg class="timer-ring" viewBox="0 0 64 64">
        <circle class="timer-ring-bg" cx="32" cy="32" r="${TIMER_RING_R}"/>
        <circle class="timer-ring-fg" cx="32" cy="32" r="${TIMER_RING_R}" stroke-dasharray="${TIMER_RING_CIRC}" stroke-dashoffset="0"/>
      </svg>
      <div class="timer-time">${fmtMMSS(widget.duration * 1000)}</div>
    </div>
    <div class="widget-label">⏳ ${widget.label}</div>
  `;

  const fg = card.querySelector('.timer-ring-fg');
  const timeEl = card.querySelector('.timer-time');
  const labelEl = card.querySelector('.widget-label');
  const total = widget.duration;
  let remaining = widget.duration;

  const iv = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(iv);
      timeEl.textContent = '✅';
      fg.style.strokeDashoffset = String(TIMER_RING_CIRC);
      card.classList.add('widget-done');
      labelEl.textContent = '✅ ' + widget.label + ' — poora hua!';
      triggerWidgetCompletion(widget);
      return;
    }
    timeEl.textContent = fmtMMSS(remaining * 1000);
    fg.style.strokeDashoffset = String(TIMER_RING_CIRC * (1 - remaining / total));
  }, 1000);
  card._widgetInterval = iv; // future cleanup ref (jaise newChat() pe clear karna ho)

  return card;
}

// Checklist — sab items tick hone par khud complete ho jaata hai

function renderChecklistWidget(widget) {
  const card = document.createElement('div');
  card.className = 'widget-card checklist-widget';

  const title = document.createElement('div');
  title.className = 'widget-title';
  title.textContent = '📋 ' + widget.label;
  card.appendChild(title);

  const list = document.createElement('div');
  list.className = 'checklist-items';
  const total = widget.items.length;
  let doneCount = 0;

  const stat = document.createElement('div');
  stat.className = 'widget-subtext';
  const updateStat = () => { stat.textContent = `${doneCount}/${total} complete`; };
  updateStat();

  widget.items.forEach(item => {
    const row = document.createElement('label');
    row.className = 'checklist-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'checklist-cb';
    const txt = document.createElement('span');
    txt.textContent = item;
    row.appendChild(cb);
    row.appendChild(txt);
    list.appendChild(row);

    cb.addEventListener('change', () => {
      row.classList.toggle('checked', cb.checked);
      doneCount += cb.checked ? 1 : -1;
      updateStat();
      if (doneCount === total) {
        card.classList.add('widget-done');
        list.querySelectorAll('.checklist-cb').forEach(c => c.disabled = true);
        triggerWidgetCompletion(widget);
      }
    });
  });

  card.appendChild(list);
  card.appendChild(stat);
  return card;
}

// Progress bar — user +1 button se manually aage badhata hai (jaise pages
// padhna, reps count karna), MAX tak pahunchte hi auto-complete

function renderProgressWidget(widget) {
  const card = document.createElement('div');
  card.className = 'widget-card progress-widget';

  const title = document.createElement('div');
  title.className = 'widget-title';
  title.textContent = '📈 ' + widget.label;
  card.appendChild(title);

  const barWrap = document.createElement('div');
  barWrap.className = 'progress-bar-wrap';
  const barFill = document.createElement('div');
  barFill.className = 'progress-bar-fill';
  barWrap.appendChild(barFill);
  card.appendChild(barWrap);

  const stat = document.createElement('div');
  stat.className = 'widget-subtext';
  card.appendChild(stat);

  let value = widget.value;
  const max = widget.max;
  const render = () => {
    const pct = Math.min(100, Math.round((value / max) * 100));
    barFill.style.width = pct + '%';
    stat.textContent = `${value}/${max} (${pct}%)`;
  };
  render();

  if (value < max) {
    const btnRow = document.createElement('div');
    btnRow.className = 'progress-btn-row';
    const incBtn = document.createElement('button');
    incBtn.type = 'button';
    incBtn.className = 'progress-btn';
    incBtn.textContent = '+1';
    incBtn.addEventListener('click', () => {
      value = Math.min(max, value + 1);
      widget.value = value;
      render();
      if (value >= max) {
        card.classList.add('widget-done');
        incBtn.disabled = true;
        triggerWidgetCompletion(widget);
      }
    });
    btnRow.appendChild(incBtn);
    card.appendChild(btnRow);
  } else {
    card.classList.add('widget-done');
  }

  return card;
}

// Poll — user ek option tap karte hi choose ho jaata hai (single-shot,
// dobara badla nahi ja sakta — chhota decision-aid widget hai)

function renderPollWidget(widget) {
  const card = document.createElement('div');
  card.className = 'widget-card poll-widget';

  const title = document.createElement('div');
  title.className = 'widget-title';
  title.textContent = '🗳️ ' + widget.label;
  card.appendChild(title);

  const optsWrap = document.createElement('div');
  optsWrap.className = 'poll-opts';
  widget.options.forEach(opt => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'poll-opt-btn';
    b.textContent = opt;
    b.addEventListener('click', () => {
      optsWrap.querySelectorAll('.poll-opt-btn').forEach(x => x.disabled = true);
      b.classList.add('poll-opt-selected');
      card.classList.add('widget-done');
      widget.selected = opt;
      triggerWidgetCompletion(widget);
    });
    optsWrap.appendChild(b);
  });
  card.appendChild(optsWrap);
  return card;
}

// Timer khatam hone par app khud (bina kisi user-action ke) ek naya AI-turn
// trigger karta hai — pattern forceWebSearchMsg() jaisa hi hai (synthetic
// instruction currentSession mein feed karo, naya bubble render karo).
// NOTE (v1 limitation): agar page reload ho jaye timer/checklist/progress
// chalte hue, ye sab memory mein hi hain isliye reset ho jaayenge —
// persistence future scope hai.

async function triggerWidgetCompletion(widget) {
  let detailLine;
  if (widget.type === 'timer') {
    detailLine = `Ek "timer" widget jo tune khud "${widget.label}" ke liye lagaya tha (${widget.duration} seconds ka), wo ab poora ho chuka hai.`;
  } else if (widget.type === 'checklist') {
    detailLine = `Ek "checklist" widget ("${widget.label}") jo tune khud banaya tha, uske SAARE items (${widget.items.join(', ')}) ab user ne tick kar diye hain — checklist poori complete ho chuki hai.`;
  } else if (widget.type === 'progress') {
    detailLine = `Ek "progress" widget ("${widget.label}") apne target (${widget.max}) tak pahunch gaya hai — task poora ho gaya hai.`;
  } else if (widget.type === 'poll') {
    detailLine = `Ek "poll" widget ("${widget.label}") mein user ne "${widget.selected}" option choose kiya hai.`;
  } else {
    detailLine = `Ek widget complete ho gaya hai.`;
  }

  const instructionUser = `[WIDGET COMPLETE — SYSTEM AUTO-TRIGGER, USER NE ABHI KUCH TYPE NAHI KIYA HAI]
${detailLine}

[INSTRUCTION] Ek chhota, natural follow-up message bhej jo isse acknowledge kare — agar pichle context se pata chalta hai ki ye kis cheez ke liye tha, wahi baat continue kar. Lamba mat likh, chhota aur seedha rakh. Koi naya [WIDGET] block yahan mat de (jab tak genuinely naya widget zaroori na ho).`;

  const aiBub = appendMsg('in', '', null, true);
  scrollBottom();

  try {
    const messages = [...currentSession, { role: 'user', content: instructionUser }];
    let { text: full, label, model } = await streamChat(aiBub, buildPrompt(), messages);
    full = applyInsultStateMachine(full);
    aiBub.innerHTML = '';
    aiBub.appendChild(parseMarkdown(full || '...'));

    const timEl = document.createElement('div');
    timEl.className = 'msg-time';
    if (cfg.showModelTag) {
      const tagEl = document.createElement('span');
      tagEl.className = 'model-tag-inline';
      tagEl.textContent = `${label} · ${model}`;
      timEl.appendChild(tagEl);
      timEl.appendChild(document.createTextNode(' · '));
    }
    timEl.appendChild(document.createTextNode(now()));
    aiBub.parentElement.appendChild(timEl);

    currentSession.push({ role: 'user', content: instructionUser });
    currentSession.push({ role: 'assistant', content: full });
  } catch (e) {
    aiBub.innerHTML = '';
    aiBub.appendChild(parseMarkdown('✅ Widget poora ho gaya! (auto-message bhejne mein error: ' + (e.message || 'connection issue') + ')'));
  } finally {
    scrollBottom();
  }
}

// `ctx` = { bubbleEl, historySnapshot, pendingText } — jahan se ye card
// trigger hua tha (top-level sendMsg response, ya kisi exec/search
// continuation ke andar). Answer submit hone par isi ctx ka use karke
// SAME bubble mein continuation chalta hai, naya alag message-turn nahi.

function renderAskCard(ask, ctx) {
  const card = document.createElement('div');
  card.className = 'ask-card';

  const q = document.createElement('div');
  q.className = 'ask-q';
  q.textContent = '❓ ' + ask.question;
  card.appendChild(q);

  if (ask.options.length) {
    const optsWrap = document.createElement('div');
    optsWrap.className = 'ask-opts';
    ask.options.forEach(opt => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ask-opt-btn';
      b.textContent = opt;
      b.addEventListener('click', () => submitAskAnswer(ask, opt, card, ctx));
      optsWrap.appendChild(b);
    });
    card.appendChild(optsWrap);
  }

  const customRow = document.createElement('div');
  customRow.className = 'ask-custom-row';
  const inp = document.createElement('input');
  inp.className = 'ask-custom-inp';
  inp.type = 'text';
  inp.placeholder = 'Apna jawab type karo...';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ask-custom-btn';
  btn.textContent = '➤';
  const submit = () => { const v = inp.value.trim(); if (v) submitAskAnswer(ask, v, card, ctx); };
  btn.addEventListener('click', submit);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  customRow.appendChild(inp);
  customRow.appendChild(btn);
  card.appendChild(customRow);

  // Save-to-facts toggle — AI ka suggested default (ask.save) pehle se set
  // hota hai, lekin user chahe to submit karne se pehle badal sakta hai
  const saveRow = document.createElement('label');
  saveRow.className = 'ask-save-row';
  const saveToggle = document.createElement('input');
  saveToggle.type = 'checkbox';
  saveToggle.className = 'ask-save-toggle';
  saveToggle.checked = !!ask.save;
  const saveTxt = document.createElement('span');
  saveTxt.textContent = '💾 Facts mein yaad rakhu (agli baar dobara na poochu)';
  saveRow.appendChild(saveToggle);
  saveRow.appendChild(saveTxt);
  card.appendChild(saveRow);
  card._saveToggle = saveToggle; // submitAskAnswer isse read karega

  return card;
}


function submitAskAnswer(ask, answerText, card, ctx) {
  card.querySelectorAll('button, input').forEach(el => el.disabled = true);
  const chosen = document.createElement('div');
  chosen.className = 'ask-chosen';
  chosen.textContent = '✓ ' + answerText;
  card.appendChild(chosen);

  // Toggle jo abhi card mein set hai (user ne badla ho toh wahi final maana jayega)
  const shouldSave = card._saveToggle ? card._saveToggle.checked : !!ask.save;
  if (shouldSave) {
    cfg.permMemory = cfg.permMemory || [];
    cfg.permMemory.push(`${ask.question} → ${answerText}`);
    LS.set('chaman_cfg', cfg);
    toast('💾 Yaad rakh liya: ' + answerText);
  }

  // Same-bubble continuation — naya "out" message ya naya AI-turn nahi
  // banta, seedha jahan ye card trigger hua tha wahin continue hota hai
  // (bilkul exec/search continuation jaisa hi flow)
  if (ctx && ctx.bubbleEl) {
    continueAfterAskAnswer(ctx.bubbleEl, ctx.historySnapshot, ctx.pendingText, ask, answerText);
  } else {
    // Fallback (context na mila kabhi) — purana behavior, normal message bhej do
    document.getElementById('msg-inp').value = answerText;
    sendMsg();
  }
}

// ════════════════════════════════════
// ASK-USER ANSWER → SAME-BUBBLE CONTINUATION
// triggerContinuation/triggerSearchContinuation jaisa hi pattern: user
// ke jawab ko ek instruction-message ki tarah AI ko wapas bhejte hain,
// aur response usi AI bubble ke andar continue hota hai.
// ════════════════════════════════════

async function continueAfterAskAnswer(bubbleEl, historySnapshot, pendingText, ask, answerText) {
  if (!bubbleEl || !bubbleEl.isConnected) return;

  const instructionUser = `[USER ANSWER — TU (AI) YE DEKH RAHA HAI, ISE NAYA ALAG MESSAGE MAT SAMAJH]
Tune ye poocha tha: ${ask.question}
User ka jawab: ${answerText}

[INSTRUCTION] Apna pichla response yahin se continue kar us jawab ko use karke. Agar is jawab se turant koi command/action ban sakta hai (jaise ek bash code-block), agle hi step mein wahi de. NAYA greeting ya intro mat likh — jaise apna hi pichla sentence complete kar raha hai.`;

  const continuationMessages = [
    ...historySnapshot,
    { role: 'assistant', content: pendingText },
    { role: 'user', content: instructionUser },
  ];

  const divider = document.createElement('div');
  divider.className = 'exec-continuation-sep';
  bubbleEl.appendChild(divider);
  const contEl = document.createElement('div');
  contEl.className = 'exec-continuation';
  bubbleEl.appendChild(contEl);
  scrollBottom();

  try {
    const res = await streamChat(contEl, buildPrompt(), continuationMessages);
    res.text = applyInsultStateMachine(res.text);
    const contFull = res.text;

    contEl.innerHTML = '';
    const contAsk = extractAskUser(contFull);
    const contSearch = !contAsk && res.stoppedForSearch ? extractWebSearch(contFull) : null;
    const contTool = (!contAsk && !contSearch && res.stoppedForTool) ? extractTool(contFull) : null;
    const contWidget = (!contAsk && !contSearch && !contTool) ? extractWidget(contFull) : null;
    const nextCtx = { bubbleEl, historySnapshot: continuationMessages, pendingText: contFull };
    if (contAsk) {
      if (contAsk.cleanText) contEl.appendChild(parseMarkdown(contAsk.cleanText));
      contEl.appendChild(renderAskCard(contAsk, nextCtx));
    } else if (contSearch) {
      if (contSearch.cleanText) contEl.appendChild(parseMarkdown(contSearch.cleanText));
    } else if (contTool) {
      if (contTool.cleanText) contEl.appendChild(parseMarkdown(contTool.cleanText));
    } else if (contWidget) {
      if (contWidget.cleanText) contEl.appendChild(parseMarkdown(contWidget.cleanText));
      contEl.appendChild(renderWidgetCard(contWidget));
    } else {
      contEl.appendChild(parseMarkdown(contFull || '...'));
    }

    currentSession.push({ role: 'user', content: instructionUser });
    currentSession.push({ role: 'assistant', content: contFull });

    // Chaining: ya to naya runnable command block pending mark ho,
    // ya naya web-search/tool auto-trigger ho — same bubble ke andar hi
    if (res.stoppedForExec && !contAsk && !contSearch && !contTool && !contWidget) {
      const blockInfo = extractLastRunnableBlock(contFull);
      if (blockInfo) markMessagePending(bubbleEl, blockInfo.cmd, blockInfo.lang, contFull, continuationMessages);
    } else if (contSearch) {
      triggerSearchContinuation(bubbleEl, continuationMessages, contFull, contSearch.query);
    } else if (contTool) {
      triggerToolContinuation(bubbleEl, continuationMessages, contFull, contTool.name, contTool.params);
    }
    scrollBottom();
  } catch (err) {
    contEl.textContent = '⚠️ AI se jawab discuss nahi ho paya (connection issue).';
    contEl.classList.add('exec-continuation-note');
    scrollBottom();
  }
}

// ════════════════════════════════════
// STREAMING (with automatic fallback across providers)
// ════════════════════════════════════

const RUNNABLE_LANG_RE = '(?:bash|sh|shell|zsh|console|terminal)';

function findRunnableFenceEnd(text) {
  const openRe = new RegExp('```\\s*' + RUNNABLE_LANG_RE + '\\s*\\r?\\n', 'gi');
  let m;
  while ((m = openRe.exec(text))) {
    const contentStart = m.index + m[0].length;
    const closeIdx = text.indexOf('\n```', contentStart);
    if (closeIdx !== -1) {
      return closeIdx + 4; // '\n```'.length — cut turant baad usi ke
    }
    // fence khula hai lekin abhi tak close nahi hua stream mein — wait karo
  }
  return -1;
}

// ── Ek runnable fence ke andar ka lang+code nikalta hai (last wale ko,
// kyunki stop-cut ke baad max ek hi runnable block hona chahiye, lekin
// safety ke liye "last match" le lete hain) ──

function extractLastRunnableBlock(text) {
  if (!text) return null;
  const re = new RegExp('```\\s*(' + RUNNABLE_LANG_RE + ')\\s*\\r?\\n([\\s\\S]*?)\\n```', 'gi');
  let m, last = null;
  while ((m = re.exec(text))) last = { lang: m[1], cmd: m[2] };
  return last;
}

// ════════════════════════════════════
// STEP 5 — PENDING-EXEC MESSAGE STATE
// Jab AI response ek runnable bash/sh block pe ruk jata hai (stop-fence
// cut), us message ko "pending" mark karte hain jab tak user "▶ Run"
// na dabaye. Practically ek time pe ek hi pending hota hai (naya
// AI-turn shuru hote hi purani wali clear ho jaati hai), lekin
// id-based map rakha hai taaki Step 6/7 mein (nudge timer, runId,
// continuation) isi structure pe build ho sake bina restructure kiye.
// ════════════════════════════════════

const pendingMessages = new Map(); // id → { wrapEl, bubbleEl, blockEl, cmd, lang, indicatorEl, nudgeEl, timeoutId }

let activePendingId = null;

// Pending state hata do — CSS class, indicator, nudge, timeout sab
// cleanup ho jate hain. `reason` sirf debugging/future-hooks ke liye.

function clearPendingState(id, reason) {
  const entry = pendingMessages.get(id);
  if (!entry) return;
  if (entry.timeoutId) clearTimeout(entry.timeoutId);
  entry.wrapEl?.classList.remove('pending-exec');
  entry.indicatorEl?.remove();
  entry.nudgeEl?.remove();
  if (entry.blockEl) delete entry.blockEl.dataset.pendingId;
  pendingMessages.delete(id);
  if (activePendingId === id) activePendingId = null;
}

// Naya AI-turn shuru hote hi purani pending state ko clear karo —
// "assume user ne ignore kar diya / topic badal diya", permanently
// stuck state na bane.

function clearActivePending() {
  if (activePendingId) clearPendingState(activePendingId, 'new-turn');
}

// AI response ek runnable block pe ruka — is bubble ko pending mark
// karo: wrapper pe CSS class, code-block ke end mein "wait" indicator.
// `fullText` = AI ka poora (cut-hua) response text, aur `historySnapshot`
// = conversation history jis par ye response based tha — dono Step 7
// ke continuation call ke liye store ho rahe hain. `historySnapshot`
// na diya jaye to currentSession se le lete hain (top-level, pehli
// baar ruka hua response); nested continuation apna khud ka snapshot
// pass karega (chained context ke liye).

function markMessagePending(aiBub, cmd, lang, fullText, historySnapshot) {
  const wrapEl = aiBub.closest('.message.in');
  if (!wrapEl) return null;

  const blocks = aiBub.querySelectorAll('.code-block');
  const blockEl = blocks[blocks.length - 1] || null;
  if (!blockEl) return null; // koi runnable block DOM mein mila hi nahi, kuch mismatch — pending mat banao

  wrapEl.classList.add('pending-exec');

  const indicatorEl = document.createElement('div');
  indicatorEl.className = 'exec-wait-indicator';
  indicatorEl.textContent = '⏳ Result ka wait ho raha hai';
  blockEl.appendChild(indicatorEl);

  const id = 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  blockEl.dataset.pendingId = id;

  pendingMessages.set(id, {
    wrapEl, bubbleEl: aiBub, blockEl, cmd, lang,
    pendingText: fullText,
    historySnapshot: historySnapshot || currentSession.slice(-20),
    indicatorEl, nudgeEl: null, timeoutId: null
  });
  activePendingId = id;

  // Step 6 — 5 second baad, agar abhi bhi pending hai (user ne Run
  // nahi dabaya), ek chhota static nudge dikhao. Koi API call nahi,
  // sirf UI-level text. Run dabane pe ya naya AI-turn aane pe
  // clearPendingState() ye timeout khud clear kar dega.
  const entry = pendingMessages.get(id);
  entry.timeoutId = setTimeout(() => {
    if (!pendingMessages.has(id)) return; // already clear ho chuki (safety)
    const nudgeEl = document.createElement('div');
    nudgeEl.className = 'exec-nudge';
    nudgeEl.textContent = "⏳ Upar 'Run' dabao command chalane ke liye, taaki main aage bata sakoon kya hua";
    entry.blockEl.appendChild(nudgeEl);
    entry.nudgeEl = nudgeEl;
  }, 5000);

  return id;
}

// ════════════════════════════════════
// STEP 7 — RUN → CONTINUATION FLOW
// Command khatam hone ke baad uska result (exit code, cwd, output)
// bina user ke kuch type kiye AI ko wapas bheja jata hai, aur AI ka
// response usi message-bubble mein "continue" hota hai (naya bubble
// nahi banta).
// ════════════════════════════════════

// server.js jo "[exit code: X] (pwd: Y)" marker line bhejta hai, usse
// parse karta hai. Backend hi na chala ho to match nahi milega — us
// case mein exitCode/cwd null rahenge, aur raw error text hi stdout
// ki tarah AI ko chala jayega (context ke liye kaafi hai).

function parseRunResult(fullOutput) {
  const text = fullOutput || '';
  const match = text.match(/\[exit code: (\S+)(?:, signal: (\S+))?\]\s*\(pwd: (.+)\)\s*$/);
  return {
    exitCode: match ? match[1] : null,
    signal: match ? (match[2] || null) : null,
    cwd: match ? match[3].trim() : null,
    stdout: text,
  };
}

// Token-safety: bahut lamba output (jaise pip install verbose log)
// pura AI ko mat bhejo — sirf last 1500 chars + truncation note.

function truncateForAI(text) {
  if (!text || text.length <= 2000) return text || '';
  return '[...output truncated, showing last portion...]\n' + text.slice(-1500);
}

// Command khatam hone ke baad ye call hota hai (fire-and-forget,
// runCommand() ke await ka wait nahi karta — background mein complete
// hota hai chahe user aage badh gaya ho conversation mein).

async function triggerContinuation(entry, cmdRun, { rawOutput, cancelled }) {
  const { bubbleEl, historySnapshot, pendingText } = entry;
  if (!bubbleEl || !bubbleEl.isConnected) return; // bubble hi hata di gayi ho to kuch mat karo

  let instructionUser;
  if (cancelled) {
    instructionUser = `[TERMINAL RESULT — TU (AI) IS COMMAND KA RESULT DEKH RAHA HAI, USER NE YE NAHI LIKHA]
Command: ${cmdRun}
Status: User ne command ko beech mein CANCEL kar diya (Stop button dabaya).

[INSTRUCTION] Apna pichla response yahin se continue kar — chhota sa acknowledge kar ki command cancel ho gayi, aur agar zaroori ho to dobara try karne ka suggestion de. NAYA greeting ya intro mat likh — jaise tu apna hi pichla sentence complete kar raha hai.`;
  } else {
    const parsed = parseRunResult(rawOutput);
    const stdoutForAI = truncateForAI(parsed.stdout);
    instructionUser = `[TERMINAL RESULT — TU (AI) IS COMMAND KA RESULT DEKH RAHA HAI, USER NE YE NAHI LIKHA]
Command: ${cmdRun}
Exit code: ${parsed.exitCode ?? 'unknown'}${parsed.signal ? ' (signal: ' + parsed.signal + ')' : ''}
Working directory ab: ${parsed.cwd ?? 'unknown'}
Output:
${stdoutForAI}

[INSTRUCTION] Apna pichla response yahin se continue kar — 2-4 chhote bullet points mein result summarize kar (kya hua, error hai ya nahi). Agar error hai, wajah bata aur agla suggestion de (naya code-block agar zaroori ho, alag block mein). Agar success hai aur task poora ho gaya, seedha confirm kar de. NAYA greeting ya intro mat likh — jaise tu apna hi pichla sentence complete kar raha hai.`;
  }

  const continuationMessages = [
    ...historySnapshot,
    { role: 'assistant', content: pendingText },
    { role: 'user', content: instructionUser }
  ];

  // Visual separator + naya content area, lekin SAME bubble ke andar —
  // koi naya chat-bubble/div.message nahi banta
  const divider = document.createElement('div');
  divider.className = 'exec-continuation-sep';
  bubbleEl.appendChild(divider);
  const contEl = document.createElement('div');
  contEl.className = 'exec-continuation';
  bubbleEl.appendChild(contEl);
  scrollBottom();

  let contFull = '';
  let contStopped = false;
  try {
    const res = await streamChat(contEl, buildPrompt(), continuationMessages);
    res.text = applyInsultStateMachine(res.text);
    contFull = res.text;
    contStopped = res.stoppedForExec;

    contEl.innerHTML = '';
    const contAsk = extractAskUser(contFull);
    const contSearch = !contAsk && res.stoppedForSearch ? extractWebSearch(contFull) : null;
    const contTool = (!contAsk && !contSearch && res.stoppedForTool) ? extractTool(contFull) : null;
    const contWidget = (!contAsk && !contSearch && !contTool) ? extractWidget(contFull) : null;
    if (contAsk) {
      if (contAsk.cleanText) contEl.appendChild(parseMarkdown(contAsk.cleanText));
      contEl.appendChild(renderAskCard(contAsk, { bubbleEl, historySnapshot: continuationMessages, pendingText: contFull }));
    } else if (contSearch) {
      if (contSearch.cleanText) contEl.appendChild(parseMarkdown(contSearch.cleanText));
    } else if (contTool) {
      if (contTool.cleanText) contEl.appendChild(parseMarkdown(contTool.cleanText));
    } else if (contWidget) {
      if (contWidget.cleanText) contEl.appendChild(parseMarkdown(contWidget.cleanText));
      contEl.appendChild(renderWidgetCard(contWidget));
    } else {
      contEl.appendChild(parseMarkdown(contFull || '...'));
    }

    // Command khud fail hui thi (exit code != 0) — thoda visual treatment
    if (!cancelled) {
      const ec = parseRunResult(rawOutput).exitCode;
      if (ec && ec !== '0') contEl.classList.add('exec-continuation-err');
    }

    // History mein record rakho taaki aage ki normal turns ko context mile
    currentSession.push({ role: 'user', content: instructionUser });
    currentSession.push({ role: 'assistant', content: contFull });

    // Agar continuation khud bhi ek runnable block pe ruk gaya (Step 8
    // chaining) — usi bubble ke andar dobara pending-cycle trigger karo
    if (contStopped && !contAsk && !contSearch && !contTool && !contWidget) {
      const blockInfo = extractLastRunnableBlock(contFull);
      if (blockInfo) markMessagePending(bubbleEl, blockInfo.cmd, blockInfo.lang, contFull, continuationMessages);
    } else if (contSearch) {
      // Command result dekhne ke baad AI ko web search bhi chahiye — chain kar do
      triggerSearchContinuation(bubbleEl, continuationMessages, contFull, contSearch.query);
    } else if (contTool) {
      triggerToolContinuation(bubbleEl, continuationMessages, contFull, contTool.name, contTool.params);
    }
    scrollBottom();
  } catch (err) {
    contEl.textContent = '⚠️ AI se result discuss nahi ho paya (connection issue). Command chal chuki hai, upar output dekh sakte ho.';
    contEl.classList.add('exec-continuation-note');
    scrollBottom();
  }
}

// ════════════════════════════════════
// WEB SEARCH — backend call + auto-continuation
// Exec-flow se farak: yahan user ko "Run" dabane ki zaroorat nahi
// (search read-only/safe hai), isliye [WEB_SEARCH] block detect hote
// hi automatically backend ko call karte hain aur result AI ko wapas
// bhej dete hain — bilkul triggerContinuation() jaisa hi, bas trigger
// khud-ba-khud hota hai.
// ════════════════════════════════════

async function performWebSearch(query) {
  const backendBase = getExecBackend();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(backendBase + '/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `Search backend error ${res.status}`);
    return { ok: true, results: data.results || [] };
  } catch (err) {
    const timedOut = err.name === 'AbortError';
    return { ok: false, error: timedOut ? 'Search timeout ho gaya.' : (err.message || 'Backend se connect nahi ho paya.') };
  } finally {
    clearTimeout(timer);
  }
}


function renderSearchCard(query, status) {
  const card = document.createElement('div');
  card.className = 'search-card';
  card.innerHTML = `<span class="search-card-icon">🔍</span><span class="search-card-txt">"${query.replace(/</g, '&lt;')}" ${status}</span>`;
  return card;
}

// bubbleEl = jis AI message-bubble mein continuation dikhana hai,
// historySnapshot/pendingText = triggerContinuation jaisa hi context,
// query = AI ne [WEB_SEARCH] block mein jo maanga tha

async function triggerSearchContinuation(bubbleEl, historySnapshot, pendingText, query) {
  if (!bubbleEl || !bubbleEl.isConnected) return;

  const statusCard = renderSearchCard(query, '— search ho raha hai...');
  bubbleEl.appendChild(statusCard);
  scrollBottom();

  const searchRes = await performWebSearch(query);

  let instructionUser;
  if (!searchRes.ok) {
    statusCard.querySelector('.search-card-txt').textContent = `"${query}" — search fail ho gaya`;
    statusCard.classList.add('search-card-err');
    instructionUser = `[WEB SEARCH RESULT — TU (AI) YE DEKH RAHA HAI, USER NE YE NAHI LIKHA]
Query: ${query}
Status: Search FAIL ho gaya. Error: ${searchRes.error}

[INSTRUCTION] Apna pichla response yahin se continue kar — user ko bata de ki real-time info fetch nahi ho payi (backend/network issue), aur agar tere paas is topic ka koi general/training-data-based idea hai jo help kar sake toh clearly "ye current info nahi hai" keh ke de sakta hai. NAYA greeting mat likh, jaise apna hi sentence continue kar raha hai.`;
  } else if (!searchRes.results.length) {
    statusCard.querySelector('.search-card-txt').textContent = `"${query}" — koi result nahi mila`;
    instructionUser = `[WEB SEARCH RESULT — TU (AI) YE DEKH RAHA HAI, USER NE YE NAHI LIKHA]
Query: ${query}
Status: Search chal gaya lekin koi result nahi mila.

[INSTRUCTION] Apna pichla response yahin se continue kar — user ko bata de ki search mein kuch nahi mila, query alag tarah se phrase karke dobara try karna hai to bata sakta hai. NAYA greeting mat likh.`;
  } else {
    statusCard.querySelector('.search-card-txt').textContent = `"${query}" — ${searchRes.results.length} results mile`;
    const resultsText = searchRes.results.map((r, i) => `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet || '(no snippet)'}`).join('\n\n');
    instructionUser = `[WEB SEARCH RESULT — TU (AI) YE DEKH RAHA HAI, USER NE YE NAHI LIKHA]
Query: ${query}
Results:
${resultsText}

[INSTRUCTION] Apna pichla response yahin se continue kar — in results se query ka jawab de (apne words mein summarize kar, results ko raw copy-paste mat kar). Agar relevant ho toh 1-2 source links de de. Agar results question se relevant nahi lagte, wo bhi honestly bata de. Agar aur specific info chahiye toh naya [WEB_SEARCH] block bhi de sakta hai. NAYA greeting mat likh, jaise apna hi sentence continue kar raha hai.`;
  }

  const continuationMessages = [
    ...historySnapshot,
    { role: 'assistant', content: pendingText },
    { role: 'user', content: instructionUser },
  ];

  const divider = document.createElement('div');
  divider.className = 'exec-continuation-sep';
  bubbleEl.appendChild(divider);
  const contEl = document.createElement('div');
  contEl.className = 'exec-continuation';
  bubbleEl.appendChild(contEl);
  scrollBottom();

  try {
    const res = await streamChat(contEl, buildPrompt(), continuationMessages);
    res.text = applyInsultStateMachine(res.text);
    const contFull = res.text;

    contEl.innerHTML = '';
    const contAsk = extractAskUser(contFull);
    const contSearch = extractWebSearch(contFull);
    const contTool = (!contAsk && !contSearch && res.stoppedForTool) ? extractTool(contFull) : null;
    const contWidget = (!contAsk && !contSearch && !contTool) ? extractWidget(contFull) : null;
    if (contAsk) {
      if (contAsk.cleanText) contEl.appendChild(parseMarkdown(contAsk.cleanText));
      contEl.appendChild(renderAskCard(contAsk, { bubbleEl, historySnapshot: continuationMessages, pendingText: contFull }));
    } else if (contSearch) {
      if (contSearch.cleanText) contEl.appendChild(parseMarkdown(contSearch.cleanText));
    } else if (contTool) {
      if (contTool.cleanText) contEl.appendChild(parseMarkdown(contTool.cleanText));
    } else if (contWidget) {
      if (contWidget.cleanText) contEl.appendChild(parseMarkdown(contWidget.cleanText));
      contEl.appendChild(renderWidgetCard(contWidget));
    } else {
      contEl.appendChild(parseMarkdown(contFull || '...'));
    }

    currentSession.push({ role: 'user', content: instructionUser });
    currentSession.push({ role: 'assistant', content: contFull });

    // Chaining: agar continuation khud bhi ek runnable bash block, naya
    // [WEB_SEARCH], ya naya [TOOL] block maange, usi bubble ke andar cycle continue karo
    if (res.stoppedForExec && !contAsk && !contSearch && !contTool && !contWidget) {
      const blockInfo = extractLastRunnableBlock(contFull);
      if (blockInfo) markMessagePending(bubbleEl, blockInfo.cmd, blockInfo.lang, contFull, continuationMessages);
    } else if (contSearch) {
      triggerSearchContinuation(bubbleEl, continuationMessages, contFull, contSearch.query);
    } else if (contTool) {
      triggerToolContinuation(bubbleEl, continuationMessages, contFull, contTool.name, contTool.params);
    }
    scrollBottom();
  } catch (err) {
    contEl.textContent = '⚠️ AI se search-result discuss nahi ho paya (connection issue).';
    contEl.classList.add('exec-continuation-note');
    scrollBottom();
  }
}


// ════════════════════════════════════
// SESSION SAVE — PHASE 3: moved to js/sessions.js (autosaveSession()),
// which saves full raw messages (not just a summary) and supports
// resuming/switching between multiple saved chats. The old
// summary-only saveCurrentSession() that lived here is gone; every call
// site now calls autosaveSession() instead (see sendMsg/forceWebSearchMsg/
// image-gen `finally` blocks above, and main.js's visibilitychange/
// beforeunload/periodic safety-net calls).
// ════════════════════════════════════


function parseMarkdown(text) {
  const div = document.createElement('div');
  // Code blocks
  const parts = text.split(/(```[\s\S]*?```)/g);
  parts.forEach(part => {
    if (part.startsWith('```')) {
      const lines = part.slice(3, -3).split('\n');
      const lang = lines[0].trim();
      const code = lines.slice(1).join('\n');
      const block = document.createElement('div');
      block.className = 'code-block';
      const isRunnable = /^(bash|sh|shell|zsh|console|terminal)$/i.test(lang.trim());
      const hdr = document.createElement('div');
      hdr.className = 'code-hdr';
      hdr.innerHTML = `<span class="code-lang">${lang || 'code'}</span>` +
        `<span>${isRunnable ? '<button class="code-run" onclick="runCommand(this)">▶ Run</button>' : ''}<button class="code-cp" onclick="copyCode(this)">Copy</button></span>`;
      const body = document.createElement('div');
      body.className = 'code-body';
      body.textContent = code;
      block.appendChild(hdr);
      block.appendChild(body);
      if (isRunnable) {
        const term = document.createElement('div');
        term.className = 'term-box';
        block.appendChild(term);
      }
      div.appendChild(block);
    } else {
      // Inline markdown
      let html = part
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/(?<!\d)([.!?])[ \t]+(?=\S)/g,'$1\n')
        .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
        .replace(/\*(.+?)\*/g,'<em>$1</em>')
        .replace(/`([^`]+)`/g,'<code>$1</code>')
        .replace(/^### (.+)$/gm,'<h3>$1</h3>')
        .replace(/^## (.+)$/gm,'<h2>$1</h2>')
        .replace(/^# (.+)$/gm,'<h1>$1</h1>')
        .replace(/^\- (.+)$/gm,'<li>$1</li>')
        .replace(/^\d+\. (.+)$/gm,'<li>$1</li>')
        .replace(/(<li>.*<\/li>\n?)+/g, m => '<ul>' + m + '</ul>')
        .replace(/!\[(.*?)\]\((.+?)\)/g,'<img src="$2" alt="$1" loading="lazy" class="chat-img" onclick="window.open(this.src,\'_blank\')"/>')
        .replace(/\[(.+?)\]\((.+?)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>')
        .replace(/\n\n/g,'</p><p>')
        .replace(/\n/g,'<br>');
      const p = document.createElement('p');
      p.innerHTML = html;
      div.appendChild(p);
    }
  });
  return div;
}

// ════════════════════════════════════
// COMMAND EXECUTION (local backend — server.js)
// ════════════════════════════════════

async function runCommand(btn) {
  const block = btn.closest('.code-block');
  const cmd = block.querySelector('.code-body').textContent;
  const term = block.querySelector('.term-box');

  // Step 5/7: user ne Run dabaya — is block ki pending-exec state (CSS
  // class, wait-indicator, nudge-timer) clear kar do, lekin entry ko
  // pehle nikaal lo (Step 7 continuation ke liye cmd/lang/history/
  // pendingText chahiye hoga command khatam hone ke baad)
  const pendingId = block.dataset.pendingId || null;
  const pendingEntry = pendingId ? pendingMessages.get(pendingId) : null;
  if (pendingId) clearPendingState(pendingId, 'run-clicked');

  // Live "command running" marker — jab tak ye command backend par chal
  // rahi hai, currentSession mein isko daal do. Isse agar user isi beech
  // (command khatam hone se pehle) koi naya message bhej de, AI ko pata
  // hoga ki ek command abhi bhi pending/running hai — "amnesia" wala bug
  // (jahan AI ko lagta tha kuch install ho hi nahi raha) yahi se fix hota
  // hai. Command khatam hote hi is marker ko history se hata dete hain
  // (finally block mein) — asli result uski jagah normal flow se aa
  // jaata hai (triggerContinuation ke through, agar pending block tha).
  const runningMarker = {
    role: 'user',
    content: `[SYSTEM NOTE — TU (AI) KO YE PATA HONA CHAHIYE, USER NE YE NAHI LIKHA] Command "${cmd}" abhi backend par RUN ho rahi hai, result aana baaki hai (lambi command ho sakti hai, jaise install). Agar user isi beech koi related sawaal poochta hai, to bata do ki command abhi chal rahi hai aur result ka wait karo — confused ya "kya install kar rahe ho" jaisa jawab mat do.`
  };
  currentSession.push(runningMarker);

  const backendBase = getExecBackend();
  const backend = backendBase + '/run';

  term.classList.add('show');
  term.textContent = '';
  const cursor = document.createElement('span');
  cursor.className = 'term-cursor';

  // Run button ko Stop button mein badal do jab tak command chal rahi hai
  const originalLabel = btn.textContent;
  let runId = null;
  let cancelled = false;
  let full = ''; // poora terminal output — Step 7 continuation ko chahiye
  const stopBtn = document.createElement('button');
  stopBtn.className = 'code-stop';
  stopBtn.textContent = '■ Stop';
  stopBtn.onclick = async () => {
    if (!runId) return;
    cancelled = true;
    stopBtn.disabled = true;
    stopBtn.textContent = '⏳ Ruk rahe hai...';
    try {
      await fetch(backendBase + '/kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId })
      });
    } catch (_) { /* backend already down ho sakta hai, ignore */ }
  };
  btn.insertAdjacentElement('afterend', stopBtn);
  btn.disabled = true;
  btn.textContent = '⏳ Running...';

  try {
    const res = await fetch(backend, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd })
    });

    runId = res.headers.get('X-Run-Id'); // ab Stop button isse kill call kar sakta hai

    if (!res.body) {
      // Fallback agar streaming supported nahi (rare)
      full = await res.text();
      term.textContent = full;
    } else {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += dec.decode(value, { stream: true });
        term.textContent = full;
        term.appendChild(cursor);
        term.scrollTop = term.scrollHeight;
      }
      cursor.remove();
    }
  } catch (e) {
    if (!cancelled) {
      const errNote = `\n\n❌ Backend se connect nahi ho paya. Check karo 'node server.js' chal raha hai kya (${backendBase}).\n(${e.message})`;
      term.textContent += errNote;
      full += errNote;
    }
  } finally {
    // Command khatam ho gayi (success/fail/cancel/error — sab cases) —
    // "abhi chal rahi hai" wala marker ab stale hai, history se hata do.
    // Asli result (agar ye pending block tha) triggerContinuation() apne
    // aap currentSession mein add kar dega niche.
    const markerIdx = currentSession.indexOf(runningMarker);
    if (markerIdx !== -1) currentSession.splice(markerIdx, 1);

    stopBtn.remove();
    // Command poori tarah successfully complete hui (exit code 0, cancel
    // nahi hua, backend-connect error bhi nahi) — Run button ko permanent
    // "✓ Success" state mein disable kar do (dobara Run ki zaroorat nahi,
    // result terminal box mein already dikh raha hai)
    const exitMatch = full.match(/\[exit code:\s*(\d+)/);
    const succeeded = !cancelled && exitMatch && exitMatch[1] === '0';
    if (succeeded) {
      btn.textContent = '✓ Success';
      btn.disabled = true;
      btn.classList.add('success');
    } else {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
    scrollBottom();
    // Agar command install/setup jaisi lagti hai (naya tool aaya ho sakta
    // hai), to environment snapshot chup-chaap refresh kar do — taaki
    // agle response mein AI ko pata ho ki tool ab available hai.
    if (!cancelled && /\b(pip3?\s+install|npm\s+install|apt(-get)?\s+install|pkg\s+install)\b/i.test(cmd)) {
      fetchEnvSnapshot();
    }

    // Step 7: agar ye block AI ke pending response ka hissa tha, uska
    // result background mein AI ko wapas bhej do (fire-and-forget —
    // runCommand yahin khatam ho sakta hai, continuation apne aap
    // chalti rahegi aur isi bubble mein append hogi)
    if (pendingEntry) {
      triggerContinuation(pendingEntry, cmd, { rawOutput: full, cancelled });
    }
  }
}


function copyCode(btn) {
  const code = btn.closest('.code-block').querySelector('.code-body').textContent;
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = '✓ Copied';
    btn.classList.add('done');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('done'); }, 2000);
  });
}

// ════════════════════════════════════
// DOM HELPERS
// ════════════════════════════════════
// ════════════════════════════════════
// IMAGE LIGHTBOX
// ════════════════════════════════════

function appendMsg(dir, text, file = null, streaming = false) {
  const list = document.getElementById('msgs-list');
  const wrap = document.createElement('div');
  wrap.className = `message ${dir}`;

  const inner = document.createElement('div');
  if (dir === 'in') inner.style.width = '100%';
  const bub = document.createElement('div');
  bub.className = 'msg-bubble';

  if (streaming) {
    // bubble returned for streaming
  } else if (file?.type === 'image') {
    const img = document.createElement('img');
    img.src = `data:${file.mimeType};base64,${file.data}`;
    img.style.cssText = 'max-width:180px;border-radius:8px;display:block;margin-bottom:6px';
    makeClickableImg(img, file.name || '');
    bub.appendChild(img);
    if (text) { const t = document.createElement('div'); t.textContent = text; bub.appendChild(t); }
  } else if (text) {
    if (dir === 'out') {
      bub.textContent = text;
    } else {
      bub.appendChild(parseMarkdown(text));
    }
  }

  inner.appendChild(bub);

  if (!streaming && dir !== 'in') {
    const t = document.createElement('div');
    t.className = 'msg-time';
    t.textContent = now();
    inner.appendChild(t);
  }

  wrap.appendChild(inner);
  list.appendChild(wrap);
  scrollBottom();
  return bub;
}


function appendTyping() {
  const list = document.getElementById('msgs-list');
  const wrap = document.createElement('div');
  wrap.className = 'message in';
  const bub = document.createElement('div');
  bub.className = 'typing-bubble';
  bub.innerHTML = '<span></span><span></span><span></span>';
  wrap.appendChild(bub);
  list.appendChild(wrap);
  scrollBottom();
  return wrap;
}


function scrollBottom() {
  const a = document.getElementById('msgs-area');
  a.scrollTop = a.scrollHeight;
}


function now() {
  return new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

// ════════════════════════════════════
// FILE UPLOAD
// ════════════════════════════════════

// ════════════════════════════════════
// VOICE
// ════════════════════════════════════

function toggleVoice() {
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    toast('Voice supported nahi hai is browser mein'); return;
  }
  const btn = document.getElementById('mic-btn');
  if (isRec) { recog?.stop(); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recog = new SR();
  recog.lang = 'hi-IN';
  recog.interimResults = true;
  recog.continuous = false;
  btn.classList.add('active');
  isRec = true;
  toast('🎙️ Sun raha hai...', 4000);
  const inp = document.getElementById('msg-inp');
  recog.onresult = e => {
    inp.value = Array.from(e.results).map(r => r[0].transcript).join('');
    autoResize(inp);
  };
  recog.onend = () => { btn.classList.remove('active'); isRec = false; if (inp.value.trim()) sendMsg(); };
  recog.onerror = () => { btn.classList.remove('active'); isRec = false; toast('Voice error!'); };
  recog.start();
  toast('🎙️ Bol...');
}

// ════════════════════════════════════
// UTILS
// ════════════════════════════════════

function newChat() {
  // Purani chat destructive delete nahi hai — har turn ke baad already
  // autosave ho chuka hota hai (autosaveSession(), js/sessions.js), isliye
  // confirm popup ki zaroorat nahi, ChatGPT/Claude jaisa "New Chat" turant
  // fresh start deta hai. Ye call yahan sirf ek final safety-net hai (agar
  // koi autosave abhi in-flight/pending tha).
  if (currentSession.length >= 2) autosaveSession();
  document.getElementById('msgs-list').innerHTML = `
    <div id="welcome">
      <div class="wc-icon">✨</div>
      <h2>Kya haal hai?</h2>
      <p>Bol kya karna hai — main yaad rakhta hoon sab</p>
      <div class="sugg-chips" id="sugg-chips"></div>
    </div>
  `;
  renderSuggChips();
  currentSession = [];
  currentSessionId = null; // PHASE 3 — next message starts a fresh saved chat
  _lastSavedMsgCount = 0;
cfg.oldSummary = '';
  LS.set('chaman_cfg', cfg);
  toast('✨ Naya chat shuru');
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// Input auto resize + Enter to send

const SUGGS = [
  'Aaj kya karein?',
  'Koi idea do',
  'Motivate karo',
  'Code mein help chahiye',
  '🎨 /image ek sunset wala pahad',
  'Kuch interesting batao'
];

function renderSuggChips() {
  const box = document.getElementById('sugg-chips');
  if (!box) return;
  // BLOCKED state — normal chips ki jagah sirf ek apology chip dikhao
  if (!isCreatorActive() && cfg.insultBlockUntil > Date.now()) {
    box.innerHTML = `<button class="sugg-chip sugg-chip-alert" onclick="tapApologyChip()">Sorry to Creator Najeef</button>`;
    return;
  }
  let html = '';
  if (!envSnapshot) {
    // Jab bhi backend ABHI disconnected hai (chahe pehle kabhi connect ho
    // chuka ho, jaise Termux band ho gaya ho), /connect hi sabse pehla aur
    // highlighted (pulsing) chip rahega — bina isके kai features (exec
    // commands, real env awareness) kaam nahi karte, isliye ye priority pe hai.
    html += `<button class="sugg-chip sugg-chip-alert" data-cmd="/connect" onclick="useSugg(this)">⚡ Pehle backend connect karo (/connect)</button>`;
  }
  html += SUGGS.map(s => `<button class="sugg-chip" onclick="useSugg(this)">${s}</button>`).join('');
  box.innerHTML = html;
}

function useSugg(btn) {
  document.getElementById('msg-inp').value = btn.dataset.cmd || btn.textContent;
  sendMsg();
}
