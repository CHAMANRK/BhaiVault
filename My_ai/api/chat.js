// api/chat.js
// Vercel serverless function — the only place API keys ever live.
// Client never sees a key; it just POSTs messages here and gets a reply.
//
// Fallback chain (in this exact order): Groq → OpenRouter → Cerebras → Mistral (optional)
// If one provider errors, times out, or rate-limits, the next one is tried automatically.
//
// Env vars to set in Vercel (Project → Settings → Environment Variables):
//   GROQ_API_KEY        (required for step 1)
//   OPENROUTER_API_KEY  (required for step 2)
//   CEREBRAS_API_KEY    (required for step 3)
//   MISTRAL_API_KEY     (optional — step 4, only tried if this key exists)

const SYSTEM_PROMPT = `Tu "Chaman AI" hai — ek public AI chat assistant, jo sabke liye hai (koi ek insaan ka personal assistant nahi hai).

MERI IDENTITY (ye facts hamesha sach hain, kabhi inke against kuch mat bolna):
- Tujhe Najeef ne banaya hai aur code kiya hai.
- Tu kisi bhi AI company (OpenAI, Google, Anthropic, Meta, etc.) ka official product NAHI hai. Tu Najeef ka apna project hai, unke apne code se banaya gaya.
- Peeche se tu Groq, OpenRouter, Cerebras, aur Mistral ke open models (jaise Llama, GPT-OSS) use karta hai API ke through — lekin tu khud in companies ka product hone ka dawa kabhi mat kar. Agar koi pooche "kisne banaya", seedha bol "Najeef ne banaya hai".
- Abhi koi separate admin/owner-only mode nahi hai — sab users ke saath tu ek jaisa hi behave karta hai. (Aage jaake Najeef ke liye ek admin mode add hoga, lekin abhi nahi hai — is baare mein kuch bhi invent mat karna.)
- Ye current build ek fresh scratch rebuild hai (v3) — purane bade feature-heavy version (memory, sessions, tools, auth) ko chhodke, sirf ek clean chat core se shuru kiya gaya hai. Baaki features ek-ek karke wapas add honge. Agar koi feature (memory, history, tools, login, admin mode) maange jo abhi nahi hai, seedha bol de "ye feature abhi nahi hai, jald aayega" — mat pretend kar ki hai.

Kuch important rules:
- Hamesha Hinglish mein baat kar (Hindi + English mix, Roman script) jab tak user kuch aur na kahe.
- Tera tone casual, warm, aur helpful ho — jaise ek close dost, chahe user koi bhi ho.
- Seedha kaam ki baat kar, bekar formalities nahi.
- Is version mein tere paas persistent memory ya purani chats ka record NAHI hai (reload pe sab reset ho jaata hai) — isliye "meri purani baatein yaad rakh" jaisa kuch invent mat karna; sirf isi conversation ke andar ka context use kar.
- Agar koi feature ya info tere paas nahi hai, toh seedha bol de "mujhe pata nahi" ya "ye abhi implement nahi hua" — kabhi fake technical details (encryption, storage system, training data, company, etc.) mat bana.`;

// ── Protocol Registry ───────────────────────────────────────────────
// Model ke saath structured "actions" karne ke liye ek generic wrapper tag:
//   [ACTION:name]{...json...}[/ACTION]
// Naya protocol add karna ho toh bas neeche ek naya key daal do — system
// prompt mein woh apne aap (alphabetically sorted) list ho jaayega, aur
// parsing/extraction logic already generic hai, usse kuch chhedna nahi padega.
const PROTOCOLS = {
  ask_user: {
    describe:
`[ACTION:ask_user]{"type":"single|multi","question":"...","options":["opt1","opt2"]}[/ACTION]
  - Sirf tab use kar jab jawab genuinely ambiguous ho, use ko clarify karna ho — har chhoti baat pe mat thok.
  - "type":"single" -> user ek option tap karega, turant wahi answer ban ke chala jaayega.
  - "type":"multi" -> user multiple options tick kar sakta hai, phir "Confirm" dabayega.
  - "options" max 4 rakhna, jitni zaroorat utni hi (2, 3, ya 4) — kabhi se kam ya zyada mat de.
  - Iss tag ke aage-peeche normal text bhi likh sakta hai (jaise thoda context), lekin tag exactly isi format mein hona chahiye taaki parse ho sake.`,
  },
};

// System prompt ke liye saare registered protocols ki sorted, formatted list.
function buildProtocolDocs() {
  const names = Object.keys(PROTOCOLS).sort();
  if (!names.length) return '';
  const blocks = names.map((name) => PROTOCOLS[name].describe).join('\n\n');
  return `\n\nTERE PAAS YE STRUCTURED ACTIONS AVAILABLE HAIN (zaroorat pade tabhi use kar):\n\n${blocks}`;
}

// Reply text ke andar se pehla [ACTION:name]{json}[/ACTION] block dhoondhta hai,
// use text se nikaal (strip) deta hai, aur parsed action { name, payload } return karta hai.
const ACTION_REGEX = /\[ACTION:(\w+)\]([\s\S]*?)\[\/ACTION\]/;

function extractAction(text) {
  const match = text.match(ACTION_REGEX);
  if (!match) return { cleanText: text, action: null };

  const [full, name, jsonStr] = match;
  const cleanText = text.replace(full, '').trim();

  if (!PROTOCOLS[name]) {
    // Unknown protocol tag — ignore karo, bas text se hata do taaki user ko raw tag na dikhe.
    return { cleanText, action: null };
  }

  try {
    const payload = JSON.parse(jsonStr.trim());
    return { cleanText, action: { name, payload } };
  } catch {
    // Malformed JSON — action drop karo, sirf clean text bhej do.
    return { cleanText, action: null };
  }
}

async function withTimeout(promise, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await promise(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

function toOpenAIMessages(messages) {
  return [{ role: 'system', content: SYSTEM_PROMPT + buildProtocolDocs() }, ...messages];
}

async function callOpenAICompatible({ url, key, model, messages, extraHeaders = {} }) {
  return withTimeout(async (signal) => {
    const r = await fetch(url, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        ...extraHeaders,
      },
      body: JSON.stringify({
        model,
        messages: toOpenAIMessages(messages),
        temperature: 0.7,
      }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`HTTP ${r.status} — ${body.slice(0, 200)}`);
    }
    const data = await r.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error('Empty response from provider');
    return { text, model: data?.model || model };
  }, TIMEOUT_MS);
}

const PROVIDERS = [
  {
    name: 'Groq',
    envKey: 'GROQ_API_KEY',
    run: (key, messages) =>
      callOpenAICompatible({
        url: 'https://api.groq.com/openai/v1/chat/completions',
        key,
        model: 'openai/gpt-oss-120b',
        messages,
      }),
  },
  {
    name: 'OpenRouter',
    envKey: 'OPENROUTER_API_KEY',
    run: (key, messages) =>
      callOpenAICompatible({
        url: 'https://openrouter.ai/api/v1/chat/completions',
        key,
        model: 'openrouter/free', // auto-routes to whichever free model is currently up
        messages,
        extraHeaders: {
          'HTTP-Referer': 'https://chaman-ai.vercel.app',
          'X-Title': 'Chaman AI',
        },
      }),
  },
  {
    name: 'Cerebras',
    envKey: 'CEREBRAS_API_KEY',
    run: (key, messages) =>
      callOpenAICompatible({
        url: 'https://api.cerebras.ai/v1/chat/completions',
        key,
        model: 'llama-3.3-70b',
        messages,
      }),
  },
  {
    name: 'Mistral',
    envKey: 'MISTRAL_API_KEY',
    run: (key, messages) =>
      callOpenAICompatible({
        url: 'https://api.mistral.ai/v1/chat/completions',
        key,
        model: 'mistral-small-latest',
        messages,
      }),
  },
];

// Env var value "key1, key2 ,key3" -> ['key1','key2','key3']
// Ek provider ke multiple keys ho sakte hain (rate-limit/quota spread karne ke liye).
function splitKeys(raw) {
  if (!raw) return [];
  return raw.split(',').map(k => k.trim()).filter(Boolean);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST use kar bhai' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (!messages.length) {
    res.status(400).json({ error: 'messages array chahiye' });
    return;
  }

  const errors = [];

  for (const provider of PROVIDERS) {
    const keys = splitKeys(process.env[provider.envKey]);
    if (!keys.length) continue; // provider ka koi key hi nahi diya gaya

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      try {
        const { text, model } = await provider.run(key, messages);
        const { cleanText, action } = extractAction(text);
        res.status(200).json({ reply: cleanText, provider: provider.name, model, action });
        return;
      } catch (err) {
        errors.push(`${provider.name} (key ${i + 1}/${keys.length}): ${err.message}`);
        // is provider ki agli key try karo; sab keys khatam ho jaye toh agle provider pe jao
      }
    }
  }

  res.status(502).json({
    error: 'Sab providers/keys fail ho gaye. Env vars check kar Vercel dashboard mein.',
    details: errors,
  });
}
