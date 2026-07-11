/* ===================== SeekhCode — App Logic ===================== */

const app = document.getElementById('app');
const backBtn = document.getElementById('backBtn');

let CARDS = [];
let LANG_CACHE = {}; // id -> {language, course_title, lessons:[]}
let state = { view: 'home', langId: null, lessonIdx: 0, stepIdx: 0, history: [] };

/* ---------- Storage helpers ---------- */
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  },
  set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
};

function getUser() { return store.get('sc_user', null); }
function setUser(u) { store.set('sc_user', u); }

/* ---------- Per-lesson quiz score (resets each time a lesson opens) ---------- */
let quizScore = { correct: 0, total: 0 };
function resetQuizScore() { quizScore = { correct: 0, total: 0 }; }
function recordQuizAnswer(isRight) {
  quizScore.total++;
  if (isRight) quizScore.correct++;
}

function getProgress() { return store.get('sc_progress', {}); }
function setProgress(p) { store.set('sc_progress', p); }
function isDone(langId, num) { return (getProgress()[langId] || []).includes(num); }
function markDone(langId, num) {
  const p = getProgress();
  p[langId] = p[langId] || [];
  if (!p[langId].includes(num)) p[langId].push(num);
  setProgress(p);
  bumpStreak();
}

function bumpStreak() {
  const s = store.get('sc_streak', { count: 0, last: null });
  const today = new Date().toDateString();
  if (s.last === today) { renderStreak(s); return; }
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  s.count = (s.last === yesterday) ? s.count + 1 : 1;
  s.last = today;
  store.set('sc_streak', s);
  renderStreak(s);
}
function renderStreak(s) {
  s = s || store.get('sc_streak', { count: 0, last: null });
  document.getElementById('streakCount').textContent = s.count;
}

/* ---------- Draft code (per lesson, so edits persist) ---------- */
function draftKey(langId, num) { return `sc_draft_${langId}_${num}`; }
function getDraft(langId, num, fallback) { return store.get(draftKey(langId, num), fallback); }
function setDraft(langId, num, val) { store.set(draftKey(langId, num), val); }

/* ---------- Navigation ---------- */
function navigate(view, extra = {}) {
  state.history.push({ view: state.view, langId: state.langId, lessonIdx: state.lessonIdx });
  state = { ...state, view, ...extra };
  backBtn.classList.toggle('hidden', state.history.length === 0);
  render();
  window.scrollTo(0, 0);
}
function goBack() {
  if (state.view === 'lesson' && state.stepIdx > 0) {
    state.stepIdx--;
    render();
    window.scrollTo(0, 0);
    return;
  }
  const prev = state.history.pop();
  if (!prev) return;
  state = { ...state, ...prev };
  backBtn.classList.toggle('hidden', state.history.length === 0);
  render();
  window.scrollTo(0, 0);
}

/* ---------- Data loading ---------- */
async function loadCards() {
  if (CARDS.length) return CARDS;
  const res = await fetch('data/cards.json');
  CARDS = await res.json();
  return CARDS;
}
async function loadLang(langId) {
  if (LANG_CACHE[langId]) return LANG_CACHE[langId];
  const card = CARDS.find(c => c.id === langId);
  const res = await fetch(card.file);
  const data = await res.json();
  LANG_CACHE[langId] = data;
  return data;
}

/* ===================== Onboarding (name + age) ===================== */
function renderOnboarding() {
  app.innerHTML = `
    <div class="onboard-screen">
      <div class="onboard-emoji">👋</div>
      <h1 class="onboard-title">Namaste! Chalo shuru karte hain</h1>
      <p class="onboard-sub">Bas do cheezein batao — taaki tumhara naam aur progress personalize kar sakein.</p>
      <div class="onboard-field">
        <label>Tumhara Naam</label>
        <input type="text" id="obName" placeholder="Jaise: Rahul" maxlength="24" autocomplete="off">
      </div>
      <div class="onboard-field">
        <label>Age</label>
        <input type="number" id="obAge" placeholder="Jaise: 19" min="5" max="99" autocomplete="off">
      </div>
      <div id="obError" class="onboard-error hidden"></div>
      <button class="btn btn-primary btn-block" onclick="submitOnboarding()">Shuru Karo →</button>
    </div>`;
}
function submitOnboarding() {
  const name = document.getElementById('obName').value.trim();
  const age = document.getElementById('obAge').value.trim();
  const errEl = document.getElementById('obError');
  if (!name) { errEl.textContent = 'Naam to batao yaar 🙂'; errEl.classList.remove('hidden'); return; }
  if (!age || Number(age) <= 0) { errEl.textContent = 'Age bhi daal do'; errEl.classList.remove('hidden'); return; }
  setUser({ name, age: Number(age) });
  render();
  window.scrollTo(0, 0);
}

/* ===================== Render router ===================== */
function render() {
  if (state.view === 'home') return renderHome();
  if (state.view === 'lessons') return renderLessonList(state.langId);
  if (state.view === 'lesson') return renderLesson(state.langId, state.lessonIdx);
}

/* ===================== Home / language select ===================== */
async function renderHome() {
  app.innerHTML = `<div class="screen"><div class="center-note">Load ho raha hai...</div></div>`;
  await loadCards();
  const progress = getProgress();
  const user = getUser();

  const cardsHtml = CARDS.map(c => {
    const done = (progress[c.id] || []).length;
    const pct = Math.round((done / c.lessons) * 100);
    return `
      <div class="panel lang-card" onclick="openLanguage('${c.id}')">
        <div class="row1">
          <div class="icon">${c.icon}</div>
          <div class="titles">
            <h3>${c.title}</h3>
            <div class="sub">${c.subtitle}</div>
          </div>
          <div class="meta"><div class="diff">${c.difficulty}</div>${c.learning_time}</div>
        </div>
        <p class="desc">${c.what_is_it}</p>
        <div class="code-preview">${escapeHtml(c.example_code)}</div>
        <div class="progress-bar"><div class="fill" style="width:${pct}%"></div></div>
      </div>`;
  }).join('');

  app.innerHTML = `
    <div class="screen">
      <div class="eyebrow">// Kya seekhna hai${user ? `, ${escapeHtml(user.name)}` : ''}</div>
      <h1 class="page-title">Coding, Hinglish mein</h1>
      <p class="page-sub">${user ? `Wapas swagat hai, ${escapeHtml(user.name)}! ` : ''}Video nahi, seedha padho aur khud code likho. Har lesson chhota, har cheez mobile pe ready.</p>
      <div class="lang-grid">${cardsHtml}</div>
    </div>`;
}

async function openLanguage(langId) {
  navigate('lessons', { langId, lessonIdx: 0 });
}

/* ===================== Lesson list ===================== */
async function renderLessonList(langId) {
  app.innerHTML = `<div class="screen"><div class="center-note">Load ho raha hai...</div></div>`;
  await loadCards();
  const card = CARDS.find(c => c.id === langId);
  const data = await loadLang(langId);
  const done = getProgress()[langId] || [];
  const nextUndone = data.lessons.findIndex(l => !done.includes(l.lesson_number));

  const rows = data.lessons.map((l, idx) => {
    const isDoneRow = done.includes(l.lesson_number);
    const isCurrent = !isDoneRow && idx === (nextUndone === -1 ? 0 : nextUndone);
    const cls = isDoneRow ? 'done' : (isCurrent ? 'current' : '');
    const mark = isDoneRow ? '✓' : String(l.lesson_number).padStart(2, '0');
    return `
      <div class="panel lesson-row ${cls}" onclick="openLesson('${langId}', ${idx})">
        <div class="num">${mark}</div>
        <div class="title">${stripEmoji(l.title)}</div>
        <div class="chev">›</div>
      </div>`;
  }).join('');

  app.innerHTML = `
    <div class="screen">
      <div class="eyebrow">${card.icon} ${card.title} · ${data.lessons.length} lessons</div>
      <h1 class="page-title">${card.subtitle}</h1>
      <p class="page-sub">${done.length}/${data.lessons.length} complete</p>
      <div class="lesson-list">${rows}</div>
    </div>`;
}

function openLesson(langId, idx) { resetQuizScore(); navigate('lesson', { langId, lessonIdx: idx, stepIdx: 0 }); }
function stripEmoji(str){ return str.replace(/^[^\w\d]+\s*/,'').trim() || str; }

/* ===================== Lesson view ===================== */
async function renderLesson(langId, idx) {
  app.innerHTML = `<div class="screen"><div class="center-note">Load ho raha hai...</div></div>`;
  await loadCards();
  const card = CARDS.find(c => c.id === langId);
  const data = await loadLang(langId);
  const lesson = data.lessons[idx];
  const isMix = langId === 'mix';
  const isStepped = lesson.concept !== undefined;

  if (isStepped) return renderSteppedLesson(langId, lesson, idx, data, card);

  let bodyHtml = '';
  if (isMix) {
    bodyHtml = renderMixLesson(langId, lesson);
  } else {
    bodyHtml = `
      <div class="panel lesson-block">
        <h4>Samjho</h4>
        <div class="explanation">${lesson.explanation}</div>
      </div>
      <div class="panel lesson-block">
        <h4>Example Code</h4>
        <div class="code-block">${escapeHtml(lesson.example_code)}</div>
      </div>
      ${renderEditor(langId, lesson)}
      <div class="panel lesson-block task-box" style="margin-top:14px;">
        <span class="lbl">Mini Task</span>${lesson.mini_task}
      </div>
      <div class="panel why-box" style="margin-top:14px;">${lesson.why_it_matters}</div>
      ${renderAiPanel(langId, lesson)}
    `;
  }

  app.innerHTML = `
    <div class="screen">
      <div class="lesson-tag">${card.icon} ${card.title} · ${String(lesson.lesson_number).padStart(2,'0')}/${data.lessons.length}</div>
      <h1 class="page-title">${lesson.title}</h1>
      <div style="height:14px"></div>
      ${bodyHtml}
      <div class="lesson-nav">
        <button class="btn btn-ghost" style="flex:1" onclick="stepLesson(-1)" ${idx===0?'disabled':''}>← Pichla</button>
        <button class="btn btn-primary" style="flex:1" onclick="completeAndNext('${langId}', ${lesson.lesson_number}, ${idx}, ${data.lessons.length})">
          ${isDone(langId, lesson.lesson_number) ? 'Agla →' : 'Complete kiya, Agla →'}
        </button>
      </div>
    </div>`;

  if (!isMix) setupRunButton(langId, lesson);
}

/* ---------- Stepped lesson flow (concept -> breakdown -> practice(s) -> task -> summary) ---------- */
function buildSteps(lesson) {
  const steps = [{ type: 'concept' }, { type: 'breakdown' }];
  if (lesson.quiz_after_breakdown?.length) steps.push({ type: 'quiz', quizKey: 'quiz_after_breakdown' });
  (lesson.practice_reps || []).forEach((rep, i) => steps.push({ type: 'practice', repIdx: i }));
  if (lesson.quiz_after_practice?.length) steps.push({ type: 'quiz', quizKey: 'quiz_after_practice' });
  steps.push({ type: 'task' });
  steps.push({ type: 'summary' });
  return steps;
}
const STEP_LABELS = { concept: 'Samjho', breakdown: 'Code Breakdown', quiz: 'Quick Quiz', practice: 'Practice', task: 'Task', summary: 'Done' };

function renderSteppedLesson(langId, lesson, idx, data, card) {
  const steps = buildSteps(lesson);
  if (state.stepIdx >= steps.length) state.stepIdx = steps.length - 1;
  const stepIdx = state.stepIdx;
  const step = steps[stepIdx];
  const isLast = stepIdx === steps.length - 1;

  const dots = steps.map((s, i) => `<div class="step-dot ${i < stepIdx ? 'done' : ''} ${i === stepIdx ? 'active' : ''}"></div>`).join('');

  app.innerHTML = `
    <div class="screen">
      <div class="lesson-tag">${card.icon} ${card.title} · ${String(lesson.lesson_number).padStart(2,'0')}/${data.lessons.length}</div>
      <h1 class="page-title">${lesson.title}</h1>
      <div class="step-nav-row">
        <button class="step-arrow" id="stepArrowPrev" ${stepIdx===0?'disabled':''}>‹</button>
        <div class="step-dots">${dots}</div>
        <button class="step-arrow" id="stepArrowNext">›</button>
      </div>
      <div class="step-label">${STEP_LABELS[step.type]}${step.type==='practice' ? ` ${step.repIdx+1}/${lesson.practice_reps.length}` : ''} · Step ${stepIdx+1}/${steps.length}</div>
      <div id="stepBody"></div>
      <div class="lesson-nav">
        <button class="btn btn-ghost" style="flex:1" onclick="prevStep()" ${stepIdx===0?'disabled':''}>← Pichla</button>
        <button class="btn btn-primary" style="flex:1" id="stepNextBtn">
          ${isLast ? (isDone(langId, lesson.lesson_number) ? 'Agla Lesson →' : 'Complete kiya →') : 'Aage →'}
        </button>
      </div>
    </div>`;

  document.getElementById('stepBody').innerHTML = renderStepBody(langId, lesson, step);
  if (['practice', 'task'].includes(step.type)) setupRunButton(langId, lesson);

  const advanceStep = () => {
    if (!isLast) { state.stepIdx++; render(); window.scrollTo(0,0); return; }
    markDone(langId, lesson.lesson_number);
    renderLessonComplete(langId, lesson, idx, data.lessons.length);
  };
  document.getElementById('stepNextBtn').onclick = advanceStep;
  document.getElementById('stepArrowNext').onclick = advanceStep;
  document.getElementById('stepArrowPrev').onclick = prevStep;
}

function prevStep() { if (state.stepIdx > 0) { state.stepIdx--; render(); window.scrollTo(0,0); } }

function renderStepBody(langId, lesson, step) {
  if (step.type === 'concept') {
    return `<div class="panel lesson-block"><h4>Samjho</h4><div class="explanation">${lesson.concept}</div></div>`;
  }
  if (step.type === 'breakdown') {
    const rows = lesson.code_breakdown.map(b => `
      <div class="breakdown-row">
        <div class="breakdown-part">${escapeHtml(b.part)}</div>
        <div class="explanation" style="font-size:13px;">${b.explain}</div>
      </div>`).join('');
    return `
      <div class="panel lesson-block">
        <h4>Example Code</h4>
        <div class="code-block">${escapeHtml(lesson.example_code)}</div>
      </div>
      <div class="panel lesson-block" style="margin-top:14px;">
        <h4>Line by Line</h4>
        ${rows}
      </div>`;
  }
  if (step.type === 'quiz') {
    const questions = lesson[step.quizKey] || [];
    const rows = questions.map((q, i) => renderQuizQuestion(q, `${step.quizKey}_${i}`)).join('');
    return `<div class="panel lesson-block"><h4>Zara Check Karo</h4>${rows}</div>`;
  }
  if (step.type === 'practice') {
    const rep = lesson.practice_reps[step.repIdx];
    const draftId = `${lesson.lesson_number}_practice_${step.repIdx}`;
    const draft = getDraft(langId, draftId, rep.starter_code);
    return `
      <div class="panel lesson-block task-box">
        <span class="lbl">Practice ${step.repIdx + 1}</span>${rep.instruction}
      </div>
      <div class="panel lesson-block" style="margin-top:14px;">
        <h4>Khud Likho</h4>
        ${renderToolbar(langId)}
        <textarea class="code-editor" id="editorBox" spellcheck="false" onfocus="trackFocus('editorBox')" oninput="setDraft('${langId}', '${draftId}', this.value)">${escapeHtml(draft)}</textarea>
        <div class="editor-actions">
          <button class="btn btn-primary" id="runBtn">▶ Run</button>
        </div>
        <div class="preview-wrap" id="previewWrap"></div>
      </div>`;
  }
  if (step.type === 'task') {
    const draftId = `${lesson.lesson_number}_task`;
    const draft = getDraft(langId, draftId, '');
    return `
      <div class="panel lesson-block task-box">
        <span class="lbl">Mini Task</span>${lesson.mini_task}
      </div>
      <div class="panel lesson-block" style="margin-top:14px;">
        <h4>Ab Khud Se Likho</h4>
        ${renderToolbar(langId)}
        <textarea class="code-editor" id="editorBox" spellcheck="false" placeholder="Yahan khud code likho..." onfocus="trackFocus('editorBox')" oninput="setDraft('${langId}', '${draftId}', this.value)">${escapeHtml(draft)}</textarea>
        <div class="editor-actions">
          <button class="btn btn-primary" id="runBtn">▶ Run</button>
        </div>
        <div class="preview-wrap" id="previewWrap"></div>
      </div>`;
  }
  if (step.type === 'summary') {
    return `
      ${lesson.common_mistake ? `<div class="panel lesson-block" style="border-color:rgba(255,107,107,0.3);"><h4 style="color:var(--danger);">⚠ Common Mistake</h4><div class="explanation">${lesson.common_mistake}</div></div>` : ''}
      <div class="panel why-box" style="margin-top:14px;">${lesson.why_it_matters}</div>
      ${renderAiPanel(langId, lesson)}
    `;
  }
  return '';
}

/* ---------- Quiz (MCQ + fill-in-blank) ---------- */
function renderQuizQuestion(q, uid) {
  if (q.type === 'mcq') {
    const opts = q.options.map(opt => `<button class="quiz-opt" data-uid="${uid}" data-value="${escapeHtml(opt)}" onclick="checkMcq(this)">${escapeHtml(opt)}</button>`).join('');
    return `
      <div class="quiz-q" data-correct="${escapeHtml(q.answer)}">
        <div class="quiz-question">${q.question}</div>
        <div class="quiz-options">${opts}</div>
        <div class="quiz-feedback" id="fb-${uid}"></div>
      </div>`;
  }
  if (q.type === 'fill_blank') {
    return `
      <div class="quiz-q" data-correct="${escapeHtml(q.answer)}">
        <div class="quiz-question">${q.question}</div>
        <div class="quiz-fill-row">
          <input type="text" class="code-editor" id="fill-${uid}" style="min-height:auto; padding:10px 12px;" placeholder="Jawab likho...">
          <button class="btn btn-ghost" data-uid="${uid}" onclick="checkFillBlank(this)">✓</button>
        </div>
        <div class="quiz-feedback" id="fb-${uid}"></div>
      </div>`;
  }
  return '';
}
function checkMcq(btn) {
  const uid = btn.dataset.uid;
  const correctAnswer = btn.closest('.quiz-q').dataset.correct;
  const chosen = btn.dataset.value;
  const group = document.querySelectorAll(`.quiz-opt[data-uid="${uid}"]`);
  const isRight = chosen === correctAnswer;
  group.forEach(b => { b.disabled = true; if (b.dataset.value === correctAnswer) b.classList.add('correct'); });
  if (!isRight) btn.classList.add('wrong');
  document.getElementById(`fb-${uid}`).innerHTML = isRight
    ? `<span style="color:var(--success)">✓ Sahi!</span>`
    : `<span style="color:var(--danger)">✗ Galat, sahi jawab highlight hai</span>`;
  recordQuizAnswer(isRight);
}
function checkFillBlank(btn) {
  const uid = btn.dataset.uid;
  const correctAnswer = btn.closest('.quiz-q').dataset.correct;
  const input = document.getElementById(`fill-${uid}`);
  const val = (input.value || '').trim().toLowerCase();
  const correct = String(correctAnswer).trim().toLowerCase();
  const fb = document.getElementById(`fb-${uid}`);
  input.disabled = true;
  const isRight = (val === correct);
  fb.innerHTML = isRight
    ? `<span style="color:var(--success)">✓ Sahi!</span>`
    : `<span style="color:var(--danger)">✗ Sahi jawab: ${escapeHtml(correctAnswer)}</span>`;
  recordQuizAnswer(isRight);
}

/* ---------- Keyboard toolbar (quick symbol/tag insert) ---------- */
const KBD_SETS = {
  html: ['<', '>', '/', '=', '"', "'", '{{', '}}'],
  css: ['{', '}', ':', ';', '#', '.', '%', '"'],
  javascript: ['{', '}', '(', ')', ';', '"', "'", '=>'],
  python: [':', '(', ')', '"', "'", '#', '[', ']'],
  mix: ['<', '>', '/', '{', '}', ';', ':', '"']
};
let lastFocusedEditorId = 'editorBox';
function trackFocus(id) { lastFocusedEditorId = id; }
function renderToolbar(langId) {
  const keys = KBD_SETS[langId] || KBD_SETS.mix;
  const btns = keys.map(k => `<div class="kbd-key" data-sym="${escapeHtml(k)}" onmousedown="event.preventDefault()" onclick="insertSymbol(this.dataset.sym)">${escapeHtml(k)}</div>`).join('');
  return `<div class="kbd-toolbar">${btns}</div>`;
}
function insertSymbol(sym) {
  const el = document.getElementById(lastFocusedEditorId);
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  el.value = el.value.slice(0, start) + sym + el.value.slice(end);
  el.selectionStart = el.selectionEnd = start + sym.length;
  el.focus();
  el.dispatchEvent(new Event('input'));
}

function completeAndNext(langId, lessonNum, idx, total) {
  markDone(langId, lessonNum);
  const lesson = LANG_CACHE[langId]?.lessons?.[idx];
  renderLessonComplete(langId, lesson, idx, total);
}
function stepLesson(delta) {
  state.lessonIdx += delta;
  render();
  window.scrollTo(0,0);
}

/* ---------- Lesson complete: congrats + score + next/home ---------- */
function renderLessonComplete(langId, lesson, idx, total) {
  const user = getUser();
  const name = user?.name || 'Coder';
  const streak = store.get('sc_streak', { count: 0 });
  const hasQuiz = quizScore.total > 0;
  const pct = hasQuiz ? Math.round((quizScore.correct / quizScore.total) * 100) : null;
  const hasNext = idx + 1 < total;

  app.innerHTML = `
    <div class="screen">
      <div class="congrats-wrap">
        <div class="congrats-emoji">🎉</div>
        <h1 class="congrats-title">Shabaash, ${escapeHtml(name)}!</h1>
        <p class="congrats-sub">Tumne "${escapeHtml(stripEmoji(lesson.title))}" complete kar liya</p>
        <div class="panel score-card">
          ${hasQuiz ? `<div class="score-row"><span>Quiz Score</span><b style="color:var(--cyan)">${quizScore.correct}/${quizScore.total} · ${pct}%</b></div>` : ''}
          <div class="score-row"><span>🔥 Streak</span><b>${streak.count} din</b></div>
          <div class="score-row"><span>Lesson</span><b>${idx + 1}/${total}</b></div>
        </div>
      </div>
      <div class="lesson-nav">
        <button class="btn btn-ghost" style="flex:1" onclick="navigate('home')">⌂ Home</button>
        <button class="btn btn-primary" style="flex:1" id="lcNextBtn">${hasNext ? 'Next Lesson →' : 'Sab Done →'}</button>
      </div>
    </div>`;

  document.getElementById('lcNextBtn').onclick = () => {
    if (hasNext) { goToNextLesson(langId, idx, total); }
    else { navigate('lessons', { langId }); }
  };
  window.scrollTo(0, 0);
}
function goToNextLesson(langId, idx, total) {
  if (idx + 1 >= total) return;
  resetQuizScore();
  state.langId = langId;
  state.lessonIdx = idx + 1;
  state.stepIdx = 0;
  state.view = 'lesson';
  render();
  window.scrollTo(0, 0);
}

/* ---------- Editor (HTML/CSS/JS/Python) ---------- */
function renderEditor(langId, lesson) {
  const draft = getDraft(langId, lesson.lesson_number, lesson.example_code);
  return `
    <div class="panel lesson-block" style="margin-top:14px;">
      <h4>Khud Likho aur Chalao</h4>
      ${renderToolbar(langId)}
      <textarea class="code-editor" id="editorBox" spellcheck="false" onfocus="trackFocus('editorBox')" oninput="setDraft('${langId}', ${lesson.lesson_number}, this.value)">${escapeHtml(draft)}</textarea>
      <div class="editor-actions">
        <button class="btn btn-primary" id="runBtn">▶ Run</button>
        <button class="btn btn-ghost" onclick="resetDraft('${langId}', ${lesson.lesson_number}, this)">↺ Reset</button>
      </div>
      <div class="preview-wrap" id="previewWrap"></div>
    </div>`;
}

function resetDraft(langId, num, btn) {
  const box = document.getElementById('editorBox');
  const original = LANG_CACHE[langId].lessons.find(l => l.lesson_number === num).example_code;
  box.value = original;
  setDraft(langId, num, original);
}

function setupRunButton(langId, lesson) {
  lastFocusedEditorId = 'editorBox';
  const runBtn = document.getElementById('runBtn');
  if (!runBtn) return;
  runBtn.onclick = () => runCode(langId, lesson);
}

async function runCode(langId, lesson) {
  const code = document.getElementById('editorBox').value;
  const wrap = document.getElementById('previewWrap');

  if (langId === 'html' || langId === 'mix') {
    wrap.innerHTML = `<iframe class="preview-frame" sandbox="allow-scripts allow-same-origin"></iframe>`;
    writeIframe(wrap.querySelector('iframe'), code);
  } else if (langId === 'css') {
    const demo = `
      <div style="font-family:sans-serif; padding:16px;">
        <h1>Heading</h1>
        <p>Ye ek paragraph hai jisme kuch text likha hai.</p>
        <div class="card" style="padding:16px; margin-top:10px; background:#eee;">Ye ek card hai</div>
        <button style="margin-top:10px;">Click Me</button>
      </div>
      <style>${code}</style>`;
    wrap.innerHTML = `<iframe class="preview-frame" sandbox="allow-scripts allow-same-origin"></iframe>`;
    writeIframe(wrap.querySelector('iframe'), demo);
  } else if (langId === 'javascript') {
    wrap.innerHTML = `<iframe class="preview-frame" sandbox="allow-scripts allow-same-origin"></iframe><div class="console-out" id="consoleOut"></div>`;
    const runner = `
      <div id="output" style="font-family:sans-serif; padding:14px;"></div>
      <script>
        const send = (type, args) => parent.postMessage({__sc_console:type, args: args.map(a=>{
          try{ return typeof a === 'object' ? JSON.stringify(a) : String(a); } catch(e){ return String(a); }
        })}, '*');
        console.log = (...a) => send('log', a);
        console.error = (...a) => send('error', a);
        window.onerror = (msg) => send('error', [msg]);
        try { ${code} } catch(e) { send('error', [e.message]); }
      </script>`;
    writeIframe(wrap.querySelector('iframe'), runner);
  } else if (langId === 'python') {
    wrap.innerHTML = `<div class="console-out" id="consoleOut">Python engine load ho raha hai...</div>`;
    runPython(code);
  }
}

function writeIframe(iframe, html) {
  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
}

window.addEventListener('message', (e) => {
  if (!e.data || !e.data.__sc_console) return;
  const out = document.getElementById('consoleOut');
  if (!out) return;
  out.classList.toggle('error', e.data.__sc_console === 'error');
  out.textContent += e.data.args.join(' ') + '\n';
});

/* ---------- Python via Pyodide (loaded lazily) ---------- */
let pyodideReady = null;
async function loadPyodideOnce() {
  if (pyodideReady) return pyodideReady;
  pyodideReady = (async () => {
    if (!window.loadPyodide) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/pyodide/v0.26.1/full/pyodide.js';
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    return await window.loadPyodide();
  })();
  return pyodideReady;
}
async function runPython(code) {
  const out = document.getElementById('consoleOut');
  try {
    const pyodide = await loadPyodideOnce();
    let buffer = '';
    pyodide.setStdout({ batched: (s) => buffer += s + '\n' });
    pyodide.setStderr({ batched: (s) => buffer += s + '\n' });
    await pyodide.runPythonAsync(code);
    out.textContent = buffer || '(koi output nahi)';
    out.classList.remove('error');
  } catch (err) {
    out.textContent = err.message;
    out.classList.add('error');
  }
}

/* ---------- Mixed project lessons (HTML+CSS+JS tabs) ---------- */
function renderMixLesson(langId, lesson) {
  const key = (t) => `mix_${lesson.lesson_number}_${t}`;
  const h = getDraft(langId, key('html'), lesson.html_code || '');
  const c = getDraft(langId, key('css'), lesson.css_code || '');
  const j = getDraft(langId, key('js'), lesson.javascript_code || '');

  setTimeout(() => {
    lastFocusedEditorId = 'mixHtml';
    document.getElementById('mixRun').onclick = () => {
      const htmlVal = document.getElementById('mixHtml').value;
      const cssVal = document.getElementById('mixCss').value;
      const jsVal = document.getElementById('mixJs').value;
      setDraft(langId, key('html'), htmlVal);
      setDraft(langId, key('css'), cssVal);
      setDraft(langId, key('js'), jsVal);
      const full = `${htmlVal}<style>${cssVal}</style><script>try{${jsVal}}catch(e){console.error(e);}</script>`;
      const frame = document.getElementById('mixFrame');
      writeIframe(frame, full);
    };
    ['mixHtml','mixCss','mixJs'].forEach((id,i) => {
      const tabs = document.querySelectorAll('.mix-tab');
      const boxes = [document.getElementById('mixHtml'), document.getElementById('mixCss'), document.getElementById('mixJs')];
      tabs[i].onclick = () => {
        tabs.forEach(t=>t.classList.remove('active'));
        boxes.forEach(b=>b.classList.add('hidden'));
        tabs[i].classList.add('active');
        boxes[i].classList.remove('hidden');
        lastFocusedEditorId = id;
      };
    });
  }, 0);

  return `
    <div class="panel lesson-block">
      <h4>Kya Banayenge</h4>
      <div class="explanation">${lesson.explanation || ''}</div>
      ${lesson.what_you_will_build ? `<div class="task-box" style="margin-top:12px;"><span class="lbl">Goal</span>${lesson.what_you_will_build}</div>` : ''}
    </div>
    <div class="panel lesson-block">
      <h4>Code Likho</h4>
      <div class="editor-tabs">
        <div class="editor-tab mix-tab active">HTML</div>
        <div class="editor-tab mix-tab">CSS</div>
        <div class="editor-tab mix-tab">JS</div>
      </div>
      ${renderToolbar('mix')}
      <textarea class="code-editor" id="mixHtml" onfocus="trackFocus('mixHtml')">${escapeHtml(h)}</textarea>
      <textarea class="code-editor hidden" id="mixCss" onfocus="trackFocus('mixCss')">${escapeHtml(c)}</textarea>
      <textarea class="code-editor hidden" id="mixJs" onfocus="trackFocus('mixJs')">${escapeHtml(j)}</textarea>
      <div class="editor-actions">
        <button class="btn btn-primary" id="mixRun">▶ Run</button>
      </div>
      <div class="preview-wrap"><iframe class="preview-frame" id="mixFrame" sandbox="allow-scripts allow-same-origin"></iframe></div>
    </div>
    ${lesson.challenge ? `<div class="panel lesson-block task-box"><span class="lbl">Challenge</span>${lesson.challenge}</div>` : ''}
    ${lesson.real_world_use ? `<div class="panel why-box" style="margin-top:14px;">${lesson.real_world_use}</div>` : ''}
    ${renderAiPanel(langId, lesson)}
  `;
}

/* ===================== AI doubt-solver ===================== */
function renderAiPanel(langId, lesson) {
  return `
    <div class="panel ai-panel">
      <div class="ai-head">🤖 Doubt hai? AI se pucho</div>
      <textarea class="code-editor" id="aiQuestion" style="min-height:60px;" placeholder="Apna doubt Hinglish mein likho..."></textarea>
      <div class="editor-actions">
        <button class="btn btn-ai btn-block" onclick="askAi('${langId}', ${lesson.lesson_number})">Pucho</button>
      </div>
      <div id="aiResult"></div>
    </div>`;
}

const PROVIDERS = {
  groq: {
    label: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    keyPlaceholder: 'gsk_...',
    keyHint: 'Free key milta hai console.groq.com se.',
    // suggestions only — always editable, never forced
    modelSuggestions: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it', 'deepseek-r1-distill-llama-70b']
  },
  openrouter: {
    label: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    keyPlaceholder: 'sk-or-...',
    keyHint: 'Free key milta hai openrouter.ai se (kai free models available hain).',
    modelSuggestions: ['meta-llama/llama-3.3-70b-instruct:free', 'google/gemini-2.0-flash-exp:free', 'deepseek/deepseek-chat:free', 'anthropic/claude-3.5-sonnet']
  }
};

function buildHeaders(provider, key) {
  const h = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` };
  if (provider === 'openrouter') {
    h['HTTP-Referer'] = location.origin;
    h['X-Title'] = 'SeekhCode';
  }
  return h;
}

async function callProvider(provider, key, model, lesson, q) {
  const res = await fetch(PROVIDERS[provider].endpoint, {
    method: 'POST',
    headers: buildHeaders(provider, key),
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'Tum ek coding tutor ho jo Hinglish (Hindi-English mix, Roman script) mein short, clear jawab dete ho. Student mobile pe seekh raha hai, isliye jawab chhota rakho (max 4-5 lines) jab tak zaroori na ho.' },
        { role: 'user', content: `Lesson: ${lesson.title}\nExplanation: ${lesson.explanation || lesson.what_you_will_build || ''}\n\nMera doubt: ${q}` }
      ],
      max_tokens: 400
    })
  });
  if (!res.ok) {
    const err = new Error(`API error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || null;
}

function friendlyError(err, provider) {
  if (err.status === 429) return `${PROVIDERS[provider].label} abhi busy hai (rate limit). Thodi der baad try karo, ya dusra provider/model set karo.`;
  if (err.status === 401 || err.status === 403) return `${PROVIDERS[provider].label} ka API key galat lag raha hai. ⚙️ se check karo.`;
  if (err.status === 404) return `${PROVIDERS[provider].label} pe ye model nahi mila. ⚙️ mein model naam check/badlo.`;
  return `${PROVIDERS[provider].label} se error aaya (${err.message}).`;
}

async function askAi(langId, lessonNum) {
  const q = document.getElementById('aiQuestion').value.trim();
  const resultBox = document.getElementById('aiResult');
  if (!q) { resultBox.innerHTML = `<div class="ai-response" style="color:var(--danger)">Pehle apna doubt likho.</div>`; return; }

  // Build ordered list of configured providers: preferred one first, other as fallback
  const preferred = store.get('sc_provider', null);
  const configured = Object.keys(PROVIDERS).filter(p => store.get(`sc_key_${p}`, null) && store.get(`sc_model_${p}`, null));
  if (!configured.length) { openAiSetup(langId, lessonNum); return; }
  const order = preferred && configured.includes(preferred)
    ? [preferred, ...configured.filter(p => p !== preferred)]
    : configured;

  resultBox.innerHTML = `<div class="ai-loading"><span></span><span></span><span></span></div>`;
  const lesson = LANG_CACHE[langId].lessons.find(l => l.lesson_number === lessonNum);

  let lastErr = null, lastProvider = null;
  for (const provider of order) {
    const key = store.get(`sc_key_${provider}`, null);
    const model = store.get(`sc_model_${provider}`, null);
    try {
      const answer = await callProvider(provider, key, model, lesson, q);
      if (answer) {
        const usedFallback = provider !== order[0];
        resultBox.innerHTML = `
          ${usedFallback ? `<div class="hint" style="margin-bottom:8px;">(${PROVIDERS[order[0]].label} kaam nahi kiya, ${PROVIDERS[provider].label} se jawab mila)</div>` : ''}
          <div class="ai-response">${answer.replace(/\n/g,'<br>')}</div>`;
        return;
      }
    } catch (err) {
      lastErr = err; lastProvider = provider;
    }
  }

  resultBox.innerHTML = `<div class="ai-response" style="color:var(--danger)">${friendlyError(lastErr, lastProvider)}</div>
    <button class="btn btn-ghost btn-block" style="margin-top:8px" onclick="openAiSetup('${langId}', ${lessonNum})">AI Setup Check Karo</button>`;
}

function openAiSetup() {
  const activeProvider = store.get('sc_provider', 'groq');
  const overlay = document.createElement('div');
  overlay.className = 'setup-overlay';
  overlay.innerHTML = `
    <div class="setup-sheet">
      <h3 style="margin:0 0 6px;">AI Setup</h3>
      <div class="editor-tabs" id="providerTabs">
        ${Object.keys(PROVIDERS).map(p => `<div class="editor-tab provider-tab ${p===activeProvider?'active':''}" data-provider="${p}">${PROVIDERS[p].label}</div>`).join('')}
      </div>
      <div id="providerFields"></div>
      <div class="editor-actions">
        <button class="btn btn-primary" style="flex:1" onclick="saveAiSetup()">Save</button>
        <button class="btn btn-ghost" onclick="this.closest('.setup-overlay').remove()">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  function renderFields(provider) {
    const p = PROVIDERS[provider];
    const savedKey = store.get(`sc_key_${provider}`, '');
    const savedModel = store.get(`sc_model_${provider}`, '');
    const fields = document.getElementById('providerFields');
    fields.innerHTML = `
      <p class="hint">${p.keyHint}</p>
      <input type="password" id="setupKey" placeholder="${p.keyPlaceholder}" value="${savedKey}">
      <p class="hint" style="margin-top:10px;">Model chuno ya apna khud ka naam likho:</p>
      <select id="modelSelect" style="width:100%; background:#07080d; color:#e9eaf5; border:1px solid var(--border); border-radius:12px; padding:12px 14px; font-family:'Space Mono',monospace; font-size:13px; margin:10px 0;">
        ${p.modelSuggestions.map(m => `<option value="${m}" ${m===savedModel?'selected':''}>${m}</option>`).join('')}
        <option value="__custom__" ${!p.modelSuggestions.includes(savedModel) && savedModel ? 'selected' : ''}>Custom (khud likho)</option>
      </select>
      <input type="text" id="setupModelCustom" placeholder="model-name-yaha-likho" value="${!p.modelSuggestions.includes(savedModel) ? savedModel : ''}" class="${!p.modelSuggestions.includes(savedModel) && savedModel ? '' : 'hidden'}">
    `;
    document.getElementById('modelSelect').onchange = (e) => {
      document.getElementById('setupModelCustom').classList.toggle('hidden', e.target.value !== '__custom__');
    };
  }
  renderFields(activeProvider);
  document.querySelectorAll('.provider-tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.provider-tab').forEach(t=>t.classList.remove('active'));
      tab.classList.add('active');
      renderFields(tab.dataset.provider);
    };
  });
}

function saveAiSetup() {
  const provider = document.querySelector('.provider-tab.active').dataset.provider;
  const key = document.getElementById('setupKey').value.trim();
  const select = document.getElementById('modelSelect').value;
  const custom = document.getElementById('setupModelCustom').value.trim();
  const model = select === '__custom__' ? custom : select;
  if (key) store.set(`sc_key_${provider}`, key);
  if (model) store.set(`sc_model_${provider}`, model);
  store.set('sc_provider', provider);
  document.querySelector('.setup-overlay')?.remove();
}

/* ---------- Utils ---------- */
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

/* ---------- PWA Install prompt ---------- */
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  showInstallBanner();
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  document.getElementById('installBanner')?.remove();
});
function showInstallBanner() {
  if (document.getElementById('installBanner')) return;
  if (window.matchMedia('(display-mode: standalone)').matches) return; // already installed
  const banner = document.createElement('div');
  banner.id = 'installBanner';
  banner.className = 'install-banner';
  banner.innerHTML = `
    <div class="install-text"><b>SeekhCode</b> install karo — phone pe app jaisa khulega</div>
    <button class="btn btn-primary" style="padding:9px 16px; font-size:12px;" onclick="triggerInstall()">Install</button>
    <div class="install-close" onclick="document.getElementById('installBanner').remove()">✕</div>
  `;
  document.body.appendChild(banner);
}
async function triggerInstall() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  document.getElementById('installBanner')?.remove();
}
// iOS Safari has no beforeinstallprompt — show manual instructions instead
function isIos() { return /iphone|ipad|ipod/i.test(navigator.userAgent); }
function isInStandaloneMode() { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone; }
if (isIos() && !isInStandaloneMode()) {
  setTimeout(() => {
    if (document.getElementById('installBanner')) return;
    const banner = document.createElement('div');
    banner.id = 'installBanner';
    banner.className = 'install-banner';
    banner.innerHTML = `
      <div class="install-text"><b>SeekhCode</b> install karo — Share ▵ dabao, phir "Add to Home Screen"</div>
      <div class="install-close" onclick="document.getElementById('installBanner').remove()">✕</div>
    `;
    document.body.appendChild(banner);
  }, 1500);
}

/* ---------- Init ---------- */
renderStreak();
if (!getUser()) { renderOnboarding(); } else { render(); }

/* ---------- PWA: service worker ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  });
}
