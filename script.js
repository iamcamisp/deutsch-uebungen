// Deutsch Übungen — app logic
// Lessons = exercises grouped by theme; scroll within a lesson, Weiter → next theme
(function () {
'use strict';

const STORE_KEY = 'deutsch-uebungen-state-v1';
const TODAY = new Date().toISOString().slice(0, 10);

// ────────────────────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────────────────────
let DATA = null;           // exercises.json
let THEORY = null;         // theory.json
let MODE = 'exercises';    // 'exercises' | 'theory'
let LESSONS = [];          // (in exercises mode) [{theme, topic, exercises:[…]}]
let THEORY_PAGES = [];     // (in theory mode) filtered list of theory lessons
let idx = 0;               // current page index
let activeTopic = 'all';

const state = loadState();

function loadState() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || defaultState(); }
  catch { return defaultState(); }
}
function saveState() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
function defaultState() {
  return {
    answers: {},            // {exerciseId: {correct, attempts, lastAt}}
    vocabStatus: {},        // {exerciseId: 'learned' | 'review'}
    streak: 0,
    lastActiveDate: null
  };
}

function bumpStreak() {
  if (state.lastActiveDate === TODAY) return;
  const y = new Date(TODAY); y.setDate(y.getDate() - 1);
  state.streak = (state.lastActiveDate === y.toISOString().slice(0, 10))
    ? state.streak + 1 : 1;
  state.lastActiveDate = TODAY;
  saveState(); renderStats();
}
function recordAnswer(id, correct) {
  const a = state.answers[id] || { attempts: 0, correct: false };
  a.attempts += 1; a.correct = correct;
  a.lastAt = new Date().toISOString();
  state.answers[id] = a;
  bumpStreak(); saveState(); renderStats();
}
function recordVocab(id, status) {
  state.vocabStatus[id] = status;
  bumpStreak(); saveState(); renderStats();
}
function scorePct() {
  const e = Object.values(state.answers).filter(a => a.attempts > 0);
  if (!e.length) return null;
  return Math.round(e.filter(a => a.correct).length / e.length * 100);
}

// ────────────────────────────────────────────────────────────────
// Boot
// ────────────────────────────────────────────────────────────────
async function init() {
  try {
    const [eRes, tRes] = await Promise.all([
      fetch('exercises.json?_t=' + Date.now()),
      fetch('theory.json?_t=' + Date.now()).catch(() => null)
    ]);
    DATA = await eRes.json();
    if (tRes && tRes.ok) THEORY = await tRes.json();
  } catch (e) {
    document.getElementById('card-root').innerHTML =
      '<div class="empty">Konnte Daten nicht laden. Lokal? <code>python3 -m http.server 8765</code></div>';
    return;
  }
  wireTabs();
  setMode('exercises');
  renderStats();
  wireNav();
}

function wireTabs() {
  document.querySelectorAll('.mode-tab').forEach(btn => {
    btn.onclick = () => setMode(btn.dataset.mode);
  });
}

function setMode(m) {
  MODE = m;
  document.querySelectorAll('.mode-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === m));
  idx = 0;
  renderTopics();
  applyFilter(activeTopic);
}

function wireNav() {
  document.getElementById('btn-back').onclick = () => goto(idx - 1);
  document.getElementById('btn-next').onclick = () => goto(idx + 1);
  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;
    if (e.key === 'ArrowLeft') goto(idx - 1);
    if (e.key === 'ArrowRight') goto(idx + 1);
  });
}

function applyFilter(slug) {
  activeTopic = slug;
  if (MODE === 'exercises') {
    const exercises = (slug === 'all')
      ? DATA.exercises.slice()
      : DATA.exercises.filter(e => e.topic === slug);
    const groups = new Map();
    for (const ex of exercises) {
      const key = ex.theme || ex.topic || 'Sonstiges';
      if (!groups.has(key)) {
        groups.set(key, { theme: key, topic: ex.topic, exercises: [] });
      }
      groups.get(key).exercises.push(ex);
    }
    LESSONS = Array.from(groups.values());
  } else {
    const all = (THEORY && THEORY.lessons) ? THEORY.lessons : [];
    THEORY_PAGES = (slug === 'all') ? all.slice() : all.filter(l => l.topic === slug);
  }
  idx = 0;
  renderTopics();
  renderCurrentPage();
}

function goto(n) {
  const total = (MODE === 'exercises') ? LESSONS.length : THEORY_PAGES.length;
  if (n < 0 || n >= total) return;
  idx = n;
  renderCurrentPage();
  document.getElementById('card-root').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderCurrentPage() {
  if (MODE === 'exercises') renderLesson();
  else renderTheoryPage();
}

// ────────────────────────────────────────────────────────────────
// Render: topics + stats + progress
// ────────────────────────────────────────────────────────────────
function renderTopics() {
  const root = document.getElementById('topics');
  const counts = {};
  const total = (MODE === 'exercises')
    ? (DATA.exercises.forEach(e => counts[e.topic] = (counts[e.topic] || 0) + 1), DATA.exercises.length)
    : (() => {
        const all = (THEORY && THEORY.lessons) ? THEORY.lessons : [];
        all.forEach(l => counts[l.topic] = (counts[l.topic] || 0) + 1);
        return all.length;
      })();

  const items = [{ slug: 'all', name: 'Alle', count: total }]
    .concat(DATA.topics.map(t => ({ slug: t.slug, name: t.name, count: counts[t.slug] || 0 })));

  root.innerHTML = items.map(t =>
    `<button class="topic ${t.slug === activeTopic ? 'active' : ''}" data-slug="${t.slug}">${t.name} <span class="count">${t.count}</span></button>`
  ).join('');

  root.querySelectorAll('.topic').forEach(btn => {
    btn.onclick = () => applyFilter(btn.dataset.slug);
  });
}

function renderStats() {
  const s = state.streak || 0;
  document.getElementById('streak').textContent = s;
  document.getElementById('streak-s').textContent = s === 1 ? '' : 'e';
  const pct = scorePct();
  const scoreEl = document.getElementById('score');
  const wrap = document.getElementById('score-stat');
  if (pct === null) { scoreEl.textContent = '—'; wrap.classList.remove('low'); }
  else { scoreEl.textContent = pct + ' %'; wrap.classList.toggle('low', pct < 60); }
}

function renderProgress() {
  const total = (MODE === 'exercises') ? LESSONS.length : THEORY_PAGES.length;
  const label = (MODE === 'exercises') ? 'Thema' : 'Lektion';
  const pct = total === 0 ? 0 : Math.round(((idx + 1) / total) * 100);
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('pos-text').textContent = `${label} ${idx + 1} von ${total}`;
  document.getElementById('pct-text').textContent = pct + ' %';
  document.getElementById('nav-pos').textContent = `${label} ${idx + 1} von ${total}`;
  document.getElementById('btn-back').disabled = idx === 0;
  document.getElementById('btn-next').disabled = idx === total - 1;
}

// ────────────────────────────────────────────────────────────────
// Render lesson = all exercises with the same theme, stacked
// ────────────────────────────────────────────────────────────────
function renderLesson() {
  const root = document.getElementById('card-root');
  const nav = document.getElementById('nav');

  if (LESSONS.length === 0) {
    root.innerHTML = '<div class="empty">Keine Übungen für dieses Thema.</div>';
    nav.style.display = 'none';
    renderProgress();
    return;
  }
  nav.style.display = 'flex';

  const lesson = LESSONS[idx];
  const header = `
    <div class="lesson-header">
      <div class="lesson-label">Thema ${idx + 1} / ${LESSONS.length}</div>
      <h2 class="lesson-theme">${lesson.theme}</h2>
      <div class="lesson-count">${lesson.exercises.length} Übungen</div>
    </div>`;

  const cards = lesson.exercises.map((ex, i) => {
    const renderer = RENDERERS[ex.type] || renderUnknown;
    return renderer(ex, i, lesson.exercises.length);
  }).join('');

  root.innerHTML = header + cards;

  lesson.exercises.forEach(ex => attachExerciseHandlers(ex));
  renderProgress();
}

// ────────────────────────────────────────────────────────────────
// Render: theory lesson (block-based)
// ────────────────────────────────────────────────────────────────
function renderTheoryPage() {
  const root = document.getElementById('card-root');
  const nav = document.getElementById('nav');

  if (THEORY_PAGES.length === 0) {
    root.innerHTML = '<div class="empty">Keine Theorie für dieses Thema. Aus den nächsten Klassen wird der Inhalt generiert.</div>';
    nav.style.display = 'none';
    renderProgress();
    return;
  }
  nav.style.display = 'flex';

  const lesson = THEORY_PAGES[idx];
  const blocks = (lesson.body || []).map(renderBlock).join('');

  // Cross-link to exercises if theme matches
  let cross = '';
  if (lesson.exercise_theme) {
    const hasMatchingEx = DATA.exercises.some(e => e.theme === lesson.exercise_theme);
    if (hasMatchingEx) {
      cross = `
        <div class="theory-cross">
          <button class="cross-link" data-action="jump-exercises" data-theme="${escapeAttr(lesson.exercise_theme)}">Zu den Übungen →</button>
          <span style="color: var(--muted); font-size: 13px;">${countEx(lesson.exercise_theme)} Übungen zu diesem Thema</span>
        </div>`;
    }
  }

  root.innerHTML = `
    <div class="theory-card">
      <h2 class="theory-title">${lesson.title}</h2>
      ${lesson.intro ? `<div class="theory-intro">${lesson.intro}</div>` : ''}
      ${blocks}
      ${cross}
    </div>`;

  const btn = root.querySelector('[data-action="jump-exercises"]');
  if (btn) btn.onclick = () => {
    setMode('exercises');
    const target = LESSONS.findIndex(L => L.theme === btn.dataset.theme);
    if (target >= 0) { idx = target; renderCurrentPage(); }
  };

  renderProgress();
}

function countEx(theme) {
  return DATA.exercises.filter(e => e.theme === theme).length;
}

function renderBlock(b) {
  switch (b.type) {
    case 'heading':
      return `<h3 class="th-h">${b.text}</h3>`;
    case 'paragraph':
      return `<p class="th-p">${b.text}</p>`;
    case 'table':
      return `<table class="th-table">
        <thead><tr>${(b.headers || []).map(h => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${(b.rows || []).map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>`;
    case 'examples':
      return `<div class="th-examples">${(b.items || []).map(e => `<div class="ex">${e}</div>`).join('')}</div>`;
    case 'callout':
      return `<div class="th-callout ${b.kind || 'info'}">
        ${b.title ? `<span class="title">${b.title}</span>` : ''}
        ${b.text}
      </div>`;
    case 'list':
      return `<ul class="th-list">${(b.items || []).map(i => `<li>${i}</li>`).join('')}</ul>`;
    default:
      return '';
  }
}

// ────────────────────────────────────────────────────────────────
// Renderers per exercise type
// ────────────────────────────────────────────────────────────────
const RENDERERS = {};

RENDERERS.mcq = (ex, i, total) => cardWrap(ex, i, total, `
  <div class="ex-prompt">${ex.prompt}</div>
  ${ex.context ? `<div class="ex-context">${ex.context}</div>` : ''}
  <div class="ex-sentence">${ex.sentence_pre}<span class="blank"></span>${ex.sentence_post}</div>
  <div class="options" data-correct="${ex.correct_index}">
    ${ex.options.map((opt, ix) => `
      <button class="opt" data-ex="${ex.id}" data-idx="${ix}">
        <span class="letter">${String.fromCharCode(65 + ix)}</span> ${opt}
      </button>`).join('')}
  </div>
  <div id="fb-${ex.id}"></div>
`);

RENDERERS.transform = (ex, i, total) => cardWrap(ex, i, total, `
  <div class="ex-prompt">${ex.prompt}</div>
  ${ex.context ? `<div class="ex-context">${ex.context}</div>` : ''}
  <div class="ex-sentence">${ex.source}</div>
  <input type="text" class="text-input" id="answer-${ex.id}" placeholder="…">
  <div class="actions">
    <button class="btn" data-action="check" data-ex="${ex.id}">Prüfen</button>
    <button class="btn secondary" data-action="hint" data-ex="${ex.id}">Tipp anzeigen</button>
  </div>
  <div id="fb-${ex.id}"></div>
`);

RENDERERS.wortstellung = (ex, i, total) => cardWrap(ex, i, total, `
  <div class="ex-prompt">${ex.prompt}</div>
  ${ex.context ? `<div class="ex-context">${ex.context}</div>` : ''}
  <div class="word-bank" id="bank-${ex.id}">
    ${ex.words.map((w, ix) => `<button class="word-chip" data-ex="${ex.id}" data-word="${escapeAttr(w)}" data-ix="${ix}">${w}</button>`).join('')}
  </div>
  <div class="word-target" id="target-${ex.id}">${ex.prefix || ''}<span class="cursor">|</span></div>
  <div class="actions">
    <button class="btn" data-action="check" data-ex="${ex.id}">Prüfen</button>
    <button class="btn secondary" data-action="reset" data-ex="${ex.id}">Zurücksetzen</button>
  </div>
  <div id="fb-${ex.id}"></div>
`);

RENDERERS.lueckentext = (ex, i, total) => {
  let html = '';
  let blankIx = 0;
  ex.segments.forEach(seg => {
    if (seg.blank) {
      html += `<input type="text" class="text-input inline-input" data-ex="${ex.id}" data-bix="${blankIx++}" data-answer="${escapeAttr(seg.answer)}" maxlength="10">`;
    } else {
      html += seg.text;
    }
  });
  return cardWrap(ex, i, total, `
    <div class="ex-prompt">${ex.prompt}</div>
    ${ex.context ? `<div class="ex-context">${ex.context}</div>` : ''}
    <div class="ex-sentence">${html}</div>
    <div class="actions">
      <button class="btn" data-action="check" data-ex="${ex.id}">Prüfen</button>
    </div>
    <div id="fb-${ex.id}"></div>
  `);
};

RENDERERS.vocab = (ex, i, total) => {
  const status = state.vocabStatus[ex.id] || 'unseen';
  return cardWrap(ex, i, total, `
    <div class="vocab-word">${ex.word}</div>
    <div class="vocab-pos">${ex.pos}${ex.morphology ? ' · ' + ex.morphology : ''}</div>
    <div id="vocab-back-${ex.id}" style="display: ${status === 'unseen' ? 'none' : 'block'}">
      <div class="vocab-back">
        <div class="def">${ex.definition}</div>
        ${(ex.examples || []).map(e => `<div class="ex">${e}</div>`).join('')}
      </div>
    </div>
    <div id="vocab-controls-${ex.id}">
      ${status === 'unseen'
        ? `<button class="btn" data-action="reveal" data-ex="${ex.id}">Definition anzeigen</button>
           <div class="vocab-reveal">Versuche zuerst, das Wort selbst zu definieren.</div>`
        : `<div class="vocab-buttons">
             <button class="btn warn" data-action="review" data-ex="${ex.id}">Nochmal üben</button>
             <button class="btn success" data-action="learned" data-ex="${ex.id}">Schon gelernt</button>
           </div>`}
    </div>
    <div id="fb-${ex.id}"></div>
  `);
};

RENDERERS.writing = (ex, i, total) => {
  const min = ex.min_words || 100;
  return cardWrap(ex, i, total, `
    <div class="ex-prompt">${ex.prompt}</div>
    <div class="write-context">
      <div class="label">Aufgabe</div>
      ${ex.task}
    </div>
    <textarea class="text-input" id="answer-${ex.id}" placeholder="Schreib hier auf Deutsch …"></textarea>
    <div class="write-meta">
      <span>Mindestens ${min} Wörter</span>
      <span>·</span>
      <span>Aktuell: <span id="wc-${ex.id}">0</span> Wörter</span>
    </div>
    <div class="actions">
      <button class="btn" data-action="submit-text" data-ex="${ex.id}">Zur Korrektur senden</button>
      <span style="color: var(--muted); font-size: 13px;">öffnet WhatsApp / Chat</span>
    </div>
    <div id="fb-${ex.id}"></div>
  `);
};

function renderUnknown(ex, i, total) {
  return cardWrap(ex, i, total, `<div class="empty">Unbekannter Übungstyp: ${ex.type}</div>`);
}

function cardWrap(ex, i, total, inner) {
  return `
    <div class="card" data-id="${ex.id}" data-type="${ex.type}">
      <div class="ex-type">${LABELS[ex.type] || ex.type}</div>
      ${inner}
      <div class="ex-meta">
        <span></span>
        <span>${i + 1} / ${total}</span>
      </div>
    </div>`;
}

const LABELS = {
  mcq: 'Multiple Choice',
  transform: 'Umformung',
  wortstellung: 'Wortstellung',
  lueckentext: 'Lückentext',
  vocab: 'Wortschatzkarte',
  writing: 'Schreibübung'
};

// ────────────────────────────────────────────────────────────────
// Handlers — bind per-exercise
// ────────────────────────────────────────────────────────────────
function attachExerciseHandlers(ex) {
  if (ex.type === 'mcq') {
    document.querySelectorAll(`.opt[data-ex="${cssEsc(ex.id)}"]`).forEach(btn => {
      btn.onclick = () => checkMCQ(ex, parseInt(btn.dataset.idx));
    });
  } else if (ex.type === 'transform') {
    bindActions(ex.id, {
      check: () => checkTransform(ex),
      hint: () => showHint(ex)
    });
  } else if (ex.type === 'wortstellung') {
    setupWortstellung(ex);
  } else if (ex.type === 'lueckentext') {
    bindActions(ex.id, { check: () => checkLueckentext(ex) });
  } else if (ex.type === 'vocab') {
    bindActions(ex.id, {
      reveal: () => revealVocab(ex),
      review: () => { recordVocab(ex.id, 'review'); flash(ex.id, 'Nochmal üben — markiert.', 'wrong'); },
      learned: () => { recordVocab(ex.id, 'learned'); flash(ex.id, 'Schon gelernt — markiert.', 'correct'); }
    });
  } else if (ex.type === 'writing') {
    setupWriting(ex);
  }
}

function bindActions(exId, map) {
  document.querySelectorAll(`[data-action][data-ex="${cssEsc(exId)}"]`).forEach(b => {
    const fn = map[b.dataset.action];
    if (fn) b.onclick = fn;
  });
}

function flash(id, msg, kind) {
  const el = document.getElementById('fb-' + id);
  if (el) el.innerHTML = `<div class="feedback ${kind}"><strong>${msg}</strong></div>`;
}

// ── Checkers ──────────────────────────────────────────────────
function checkMCQ(ex, picked) {
  const card = document.querySelector(`.card[data-id="${cssEsc(ex.id)}"]`);
  const opts = card.querySelectorAll('.opt');
  opts.forEach(o => { o.classList.add('disabled'); o.onclick = null; });
  const ok = picked === ex.correct_index;
  opts[ex.correct_index].classList.add('correct');
  if (!ok) opts[picked].classList.add('wrong');
  const kind = ok ? 'correct' : 'wrong';
  const head = ok ? 'Richtig!' : 'Leider falsch.';
  document.getElementById('fb-' + ex.id).innerHTML =
    `<div class="feedback ${kind}"><strong>${head}</strong> ${ex.explanation}</div>`;
  recordAnswer(ex.id, ok);
}

function checkTransform(ex) {
  const v = (document.getElementById('answer-' + ex.id).value || '').trim();
  const norm = s => s.toLowerCase().replace(/[„""]/g, '"').replace(/\s+/g, ' ').replace(/\.$/, '');
  const ok = norm(v) === norm(ex.answer) ||
             (ex.accepted_alternatives || []).map(norm).includes(norm(v));
  const kind = ok ? 'correct' : 'wrong';
  const head = ok ? 'Sehr gut!' : 'Noch nicht ganz.';
  let expl = `Musterlösung: <em>${ex.answer}</em>`;
  if (ex.hint && !ok) expl += `<div class="explanation">${ex.hint}</div>`;
  document.getElementById('fb-' + ex.id).innerHTML =
    `<div class="feedback ${kind}"><strong>${head}</strong> ${expl}</div>`;
  recordAnswer(ex.id, ok);
}

function showHint(ex) {
  document.getElementById('fb-' + ex.id).innerHTML =
    `<div class="feedback correct"><strong>Tipp:</strong> ${ex.hint || 'Kein Tipp verfügbar.'}</div>`;
}

function setupWortstellung(ex) {
  const tgt = document.getElementById('target-' + ex.id);
  const bank = document.getElementById('bank-' + ex.id);
  const chosen = [];

  function repaintTarget() {
    const parts = chosen.map((w, ix) => `<span class="chosen" data-ex="${ex.id}" data-cix="${ix}">${w}</span>`);
    tgt.innerHTML = (ex.prefix || '') + parts.join(' ') + ' <span class="cursor">|</span>';
    tgt.querySelectorAll('.chosen').forEach(s => {
      s.onclick = () => {
        const cix = parseInt(s.dataset.cix);
        const w = chosen.splice(cix, 1)[0];
        const chip = Array.from(bank.querySelectorAll('.word-chip.used')).find(c => c.dataset.word === w);
        if (chip) chip.classList.remove('used');
        repaintTarget();
      };
    });
  }

  bank.querySelectorAll('.word-chip').forEach(b => {
    b.onclick = () => {
      if (b.classList.contains('used')) return;
      b.classList.add('used');
      chosen.push(b.dataset.word);
      repaintTarget();
    };
  });

  bindActions(ex.id, {
    check: () => {
      const ok = chosen.length === ex.answer.length &&
        chosen.every((w, i) => w === ex.answer[i]);
      const kind = ok ? 'correct' : 'wrong';
      const head = ok ? 'Richtig!' : 'Reihenfolge stimmt nicht.';
      const expl = ok ? '' : `<div class="explanation">Musterlösung: <em>${(ex.prefix || '') + ex.answer.join(' ')}</em></div>`;
      document.getElementById('fb-' + ex.id).innerHTML =
        `<div class="feedback ${kind}"><strong>${head}</strong>${expl}</div>`;
      recordAnswer(ex.id, ok);
    },
    reset: () => {
      chosen.length = 0;
      bank.querySelectorAll('.word-chip').forEach(c => c.classList.remove('used'));
      repaintTarget();
      document.getElementById('fb-' + ex.id).innerHTML = '';
    }
  });
}

function checkLueckentext(ex) {
  const inputs = document.querySelectorAll(`.card[data-id="${cssEsc(ex.id)}"] .inline-input`);
  let ok = true;
  inputs.forEach(inp => {
    const want = (inp.dataset.answer || '').toLowerCase().trim();
    const got = (inp.value || '').toLowerCase().trim();
    const right = got === want;
    inp.classList.remove('correct', 'wrong');
    inp.classList.add(right ? 'correct' : 'wrong');
    if (!right) ok = false;
  });
  const kind = ok ? 'correct' : 'wrong';
  const head = ok ? 'Alle richtig!' : 'Einige Endungen stimmen nicht.';
  document.getElementById('fb-' + ex.id).innerHTML =
    `<div class="feedback ${kind}"><strong>${head}</strong></div>`;
  recordAnswer(ex.id, ok);
}

function revealVocab(ex) {
  document.getElementById('vocab-back-' + ex.id).style.display = 'block';
  document.getElementById('vocab-controls-' + ex.id).innerHTML = `
    <div class="vocab-buttons">
      <button class="btn warn" data-action="review" data-ex="${ex.id}">Nochmal üben</button>
      <button class="btn success" data-action="learned" data-ex="${ex.id}">Schon gelernt</button>
    </div>`;
  bindActions(ex.id, {
    review: () => { recordVocab(ex.id, 'review'); flash(ex.id, 'Nochmal üben — markiert.', 'wrong'); },
    learned: () => { recordVocab(ex.id, 'learned'); flash(ex.id, 'Schon gelernt — markiert.', 'correct'); }
  });
}

function setupWriting(ex) {
  const ta = document.getElementById('answer-' + ex.id);
  const wc = document.getElementById('wc-' + ex.id);
  const min = ex.min_words || 100;

  function count() {
    const w = (ta.value || '').trim().split(/\s+/).filter(Boolean).length;
    wc.textContent = w;
    wc.parentElement.classList.toggle('ok', w >= min);
  }
  ta.addEventListener('input', count);
  count();

  bindActions(ex.id, {
    'submit-text': () => {
      const txt = (ta.value || '').trim();
      if (!txt) return;
      const num = (DATA.whatsapp_target || '4916093175902');
      const intro = `📝 Deutsch-Übung — Bitte korrigieren:\n\n*Aufgabe:* ${stripTags(ex.task)}\n\n---\n\n${txt}`;
      const url = `https://wa.me/${num}?text=${encodeURIComponent(intro)}`;
      window.open(url, '_blank');
      recordAnswer(ex.id, true);
      flash(ex.id, 'Text gesendet. Warte auf Cami\'s Assistant für die Korrektur.', 'correct');
    }
  });
}

// ────────────────────────────────────────────────────────────────
// Utils
// ────────────────────────────────────────────────────────────────
function escapeAttr(s) { return String(s).replace(/"/g, '&quot;'); }
function stripTags(s) { return String(s).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }
function cssEsc(s) {
  return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

init();
})();
