// Deutsch Übungen — app logic
(function () {
'use strict';

const STORE_KEY = 'deutsch-uebungen-state-v1';
const TODAY = new Date().toISOString().slice(0, 10);

// ────────────────────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────────────────────
let DATA = null;            // loaded exercises.json
let DECK = [];              // filtered exercises list
let idx = 0;                // current exercise index within DECK
let activeTopic = 'all';

const state = loadState();

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || defaultState();
  } catch { return defaultState(); }
}
function saveState() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
function defaultState() {
  return {
    answers: {},          // {exerciseId: {correct: bool, attempts: N, lastAt: ISO}}
    vocabStatus: {},      // {exerciseId: 'learned' | 'review' | 'unseen'}
    streak: 0,            // consecutive days with at least one answer
    lastActiveDate: null
  };
}

function bumpStreak() {
  if (state.lastActiveDate === TODAY) return; // already counted
  const y = new Date(TODAY); y.setDate(y.getDate() - 1);
  const yISO = y.toISOString().slice(0, 10);
  state.streak = (state.lastActiveDate === yISO) ? state.streak + 1 : 1;
  state.lastActiveDate = TODAY;
  saveState();
  renderStats();
}

function recordAnswer(id, correct) {
  const a = state.answers[id] || { attempts: 0, correct: false };
  a.attempts += 1;
  a.correct = correct;
  a.lastAt = new Date().toISOString();
  state.answers[id] = a;
  bumpStreak();
  saveState();
  renderStats();
}

function recordVocab(id, status) {
  state.vocabStatus[id] = status;
  bumpStreak();
  saveState();
  renderStats();
}

function scorePct() {
  const entries = Object.values(state.answers).filter(a => a.attempts > 0);
  if (entries.length === 0) return null;
  const correct = entries.filter(a => a.correct).length;
  return Math.round((correct / entries.length) * 100);
}

// ────────────────────────────────────────────────────────────────
// Boot
// ────────────────────────────────────────────────────────────────
async function init() {
  try {
    const res = await fetch('exercises.json?_t=' + Date.now());
    DATA = await res.json();
  } catch (e) {
    document.getElementById('card-root').innerHTML =
      '<div class="empty">Konnte exercises.json nicht laden. Lokal? Server: <code>python3 -m http.server 8765</code></div>';
    return;
  }
  renderTopics();
  applyFilter('all');
  renderStats();
  wireNav();
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
  DECK = (slug === 'all')
    ? DATA.exercises.slice()
    : DATA.exercises.filter(e => e.topic === slug);
  idx = 0;
  renderTopics();
  renderCard();
}

function goto(n) {
  if (n < 0 || n >= DECK.length) return;
  idx = n;
  renderCard();
}

// ────────────────────────────────────────────────────────────────
// Render: topics + stats + progress
// ────────────────────────────────────────────────────────────────
function renderTopics() {
  const root = document.getElementById('topics');
  const counts = {};
  DATA.exercises.forEach(e => counts[e.topic] = (counts[e.topic] || 0) + 1);
  const total = DATA.exercises.length;

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
  if (pct === null) {
    scoreEl.textContent = '—';
    wrap.classList.remove('low');
  } else {
    scoreEl.textContent = pct + ' %';
    wrap.classList.toggle('low', pct < 60);
  }
}

function renderProgress() {
  const total = DECK.length;
  const pct = total === 0 ? 0 : Math.round(((idx + 1) / total) * 100);
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('pos-text').textContent = `Übung ${idx + 1} von ${total}`;
  document.getElementById('pct-text').textContent = pct + ' %';
  document.getElementById('nav-pos').textContent = `Übung ${idx + 1} von ${total}`;
  document.getElementById('btn-back').disabled = idx === 0;
  document.getElementById('btn-next').disabled = idx === total - 1;
}

// ────────────────────────────────────────────────────────────────
// Render: exercise card (delegates by type)
// ────────────────────────────────────────────────────────────────
function renderCard() {
  const root = document.getElementById('card-root');
  const nav = document.getElementById('nav');

  if (DECK.length === 0) {
    root.innerHTML = '<div class="empty">Keine Übungen für dieses Thema.</div>';
    nav.style.display = 'none';
    renderProgress();
    return;
  }
  nav.style.display = 'flex';

  const ex = DECK[idx];
  const renderer = RENDERERS[ex.type] || renderUnknown;
  root.innerHTML = renderer(ex, idx);
  attachExerciseHandlers(ex);
  renderProgress();
}

const RENDERERS = {};

// ── MCQ ────────────────────────────────────────────────────────
RENDERERS.mcq = (ex, i) => {
  const prev = state.answers[ex.id];
  return cardWrap(ex, i, `
    <div class="ex-prompt">${ex.prompt}</div>
    ${ex.context ? `<div class="ex-context">${ex.context}</div>` : ''}
    <div class="ex-sentence">${ex.sentence_pre}<span class="blank"></span>${ex.sentence_post}</div>
    <div class="options" data-correct="${ex.correct_index}">
      ${ex.options.map((opt, ix) => `
        <button class="opt" data-idx="${ix}">
          <span class="letter">${String.fromCharCode(65 + ix)}</span> ${opt}
        </button>`).join('')}
    </div>
    <div id="fb-${ex.id}"></div>
  `);
};

// ── Transform (Konjunktiv I etc.) ──────────────────────────────
RENDERERS.transform = (ex, i) => cardWrap(ex, i, `
  <div class="ex-prompt">${ex.prompt}</div>
  ${ex.context ? `<div class="ex-context">${ex.context}</div>` : ''}
  <div class="ex-sentence">${ex.source}</div>
  <input type="text" class="text-input" id="answer-${ex.id}" placeholder="…">
  <div class="actions">
    <button class="btn" data-action="check">Prüfen</button>
    <button class="btn secondary" data-action="hint">Tipp anzeigen</button>
  </div>
  <div id="fb-${ex.id}"></div>
`);

// ── Wortstellung (word order) ──────────────────────────────────
RENDERERS.wortstellung = (ex, i) => {
  const words = ex.words.slice();
  return cardWrap(ex, i, `
    <div class="ex-prompt">${ex.prompt}</div>
    ${ex.context ? `<div class="ex-context">${ex.context}</div>` : ''}
    <div class="word-bank" id="bank-${ex.id}">
      ${words.map((w, ix) => `<button class="word-chip" data-word="${escapeAttr(w)}" data-ix="${ix}">${w}</button>`).join('')}
    </div>
    <div class="word-target" id="target-${ex.id}">${ex.prefix || ''}<span class="cursor">|</span></div>
    <div class="actions">
      <button class="btn" data-action="check">Prüfen</button>
      <button class="btn secondary" data-action="reset">Zurücksetzen</button>
    </div>
    <div id="fb-${ex.id}"></div>
  `);
};

// ── Lückentext (multiple blanks) ───────────────────────────────
RENDERERS.lueckentext = (ex, i) => {
  let html = '';
  let blankIx = 0;
  ex.segments.forEach(seg => {
    if (seg.blank) {
      html += `<input type="text" class="text-input inline-input" data-bix="${blankIx++}" data-answer="${escapeAttr(seg.answer)}" maxlength="6">`;
    } else {
      html += seg.text;
    }
  });
  return cardWrap(ex, i, `
    <div class="ex-prompt">${ex.prompt}</div>
    ${ex.context ? `<div class="ex-context">${ex.context}</div>` : ''}
    <div class="ex-sentence">${html}</div>
    <div class="actions">
      <button class="btn" data-action="check">Prüfen</button>
    </div>
    <div id="fb-${ex.id}"></div>
  `);
};

// ── Vocab card ─────────────────────────────────────────────────
RENDERERS.vocab = (ex, i) => {
  const status = state.vocabStatus[ex.id] || 'unseen';
  return cardWrap(ex, i, `
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
        ? `<button class="btn" data-action="reveal">Definition anzeigen</button>
           <div class="vocab-reveal">Versuche zuerst, das Wort selbst zu definieren.</div>`
        : `<div class="vocab-buttons">
             <button class="btn warn" data-action="review">Nochmal üben</button>
             <button class="btn success" data-action="learned">Schon gelernt</button>
           </div>`}
    </div>
    <div id="fb-${ex.id}"></div>
  `);
};

// ── Writing ────────────────────────────────────────────────────
RENDERERS.writing = (ex, i) => {
  const min = ex.min_words || 100;
  return cardWrap(ex, i, `
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
      <button class="btn" data-action="submit-text">Zur Korrektur senden</button>
      <span style="color: var(--muted); font-size: 13px;">öffnet WhatsApp / Chat</span>
    </div>
    <div id="fb-${ex.id}"></div>
  `);
};

function renderUnknown(ex) {
  return cardWrap(ex, 0, `<div class="empty">Unbekannter Übungstyp: ${ex.type}</div>`);
}

function cardWrap(ex, i, inner) {
  const typeLabel = LABELS[ex.type] || ex.type;
  return `
    <div class="card active" data-id="${ex.id}" data-type="${ex.type}">
      <div class="ex-type">${typeLabel}</div>
      ${inner}
      <div class="ex-meta">
        <span class="source">Thema: ${ex.theme || '—'}</span>
        <span>${i + 1} / ${DECK.length}</span>
      </div>
    </div>`;
}

const LABELS = {
  mcq: 'Multiple Choice · Konjunktionen',
  transform: 'Umformung · Indirekte Rede',
  wortstellung: 'Wortstellung · Satzbau',
  lueckentext: 'Lückentext · Grammatik',
  vocab: 'Wortschatzkarte · Wortschatz',
  writing: 'Schreibübung · Text einreichen'
};

// ────────────────────────────────────────────────────────────────
// Event handlers per exercise type
// ────────────────────────────────────────────────────────────────
function attachExerciseHandlers(ex) {
  const root = document.getElementById('card-root');

  if (ex.type === 'mcq') {
    root.querySelectorAll('.opt').forEach(btn => {
      btn.onclick = () => checkMCQ(ex, parseInt(btn.dataset.idx));
    });
  } else if (ex.type === 'transform') {
    bindActions(root, {
      check: () => checkTransform(ex),
      hint: () => showHint(ex)
    });
  } else if (ex.type === 'wortstellung') {
    setupWortstellung(ex);
  } else if (ex.type === 'lueckentext') {
    bindActions(root, { check: () => checkLueckentext(ex) });
  } else if (ex.type === 'vocab') {
    bindActions(root, {
      reveal: () => revealVocab(ex),
      review: () => { recordVocab(ex.id, 'review'); flash(ex.id, 'Nochmal üben — markiert.', 'wrong'); },
      learned: () => { recordVocab(ex.id, 'learned'); flash(ex.id, 'Schon gelernt — markiert.', 'correct'); }
    });
  } else if (ex.type === 'writing') {
    setupWriting(ex);
  }
}

function bindActions(root, map) {
  root.querySelectorAll('[data-action]').forEach(b => {
    const fn = map[b.dataset.action];
    if (fn) b.onclick = fn;
  });
}

function flash(id, msg, kind) {
  const el = document.getElementById('fb-' + id);
  if (!el) return;
  el.innerHTML = `<div class="feedback ${kind}"><strong>${msg}</strong></div>`;
}

// ── Type-specific checkers ─────────────────────────────────────
function checkMCQ(ex, picked) {
  const opts = document.querySelectorAll('.opt');
  opts.forEach(o => { o.classList.add('disabled'); o.onclick = null; });
  const correct = picked === ex.correct_index;
  opts[ex.correct_index].classList.add('correct');
  if (!correct) opts[picked].classList.add('wrong');
  const kind = correct ? 'correct' : 'wrong';
  const head = correct ? 'Richtig!' : 'Leider falsch.';
  document.getElementById('fb-' + ex.id).innerHTML =
    `<div class="feedback ${kind}"><strong>${head}</strong> ${ex.explanation}</div>`;
  recordAnswer(ex.id, correct);
}

function checkTransform(ex) {
  const v = (document.getElementById('answer-' + ex.id).value || '').trim();
  const norm = s => s.toLowerCase().replace(/[„""]/g, '"').replace(/\s+/g, ' ').replace(/\.$/, '');
  const goal = norm(ex.answer);
  const alts = (ex.accepted_alternatives || []).map(norm);
  const got  = norm(v);
  const ok = got === goal || alts.includes(got);
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
  const root = document.getElementById('card-root');
  const tgt = document.getElementById('target-' + ex.id);
  const bank = document.getElementById('bank-' + ex.id);
  const chosen = [];

  function repaintTarget() {
    const parts = chosen.map((w, ix) => `<span class="chosen" data-cix="${ix}">${w}</span>`);
    tgt.innerHTML = (ex.prefix || '') + parts.join(' ') + ' <span class="cursor">|</span>';
    tgt.querySelectorAll('.chosen').forEach(s => {
      s.onclick = () => {
        const cix = parseInt(s.dataset.cix);
        const w = chosen.splice(cix, 1)[0];
        // Re-enable the first chip with that word in the bank
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

  bindActions(root, {
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
  const inputs = document.querySelectorAll(`[data-id="${ex.id}"] .inline-input`);
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
      <button class="btn warn" data-action="review">Nochmal üben</button>
      <button class="btn success" data-action="learned">Schon gelernt</button>
    </div>
  `;
  bindActions(document.getElementById('card-root'), {
    review: () => { recordVocab(ex.id, 'review'); flash(ex.id, 'Nochmal üben — markiert.', 'wrong'); },
    learned: () => { recordVocab(ex.id, 'learned'); flash(ex.id, 'Schon gelernt — markiert.', 'correct'); }
  });
}

function setupWriting(ex) {
  const root = document.getElementById('card-root');
  const ta = document.getElementById('answer-' + ex.id);
  const wc = document.getElementById('wc-' + ex.id);
  const min = ex.min_words || 100;

  function countWords() {
    const w = (ta.value || '').trim().split(/\s+/).filter(Boolean).length;
    wc.textContent = w;
    wc.parentElement.classList.toggle('ok', w >= min);
  }
  ta.addEventListener('input', countWords);
  countWords();

  bindActions(root, {
    'submit-text': () => {
      const txt = (ta.value || '').trim();
      if (!txt) return;
      const num = (DATA.whatsapp_target || '4916093175902');
      const intro = `📝 Deutsch-Übung — Bitte korrigieren:\n\n*Aufgabe:* ${stripTags(ex.task)}\n\n---\n\n${txt}`;
      const url = `https://wa.me/${num}?text=${encodeURIComponent(intro)}`;
      window.open(url, '_blank');
      // Mark as submitted (counted as correct for score purposes — it's a participation metric here)
      recordAnswer(ex.id, true);
      flash(ex.id, 'Text gesendet. Warte auf Cami\'s Assistant für die Korrektur.', 'correct');
    }
  });
}

// ────────────────────────────────────────────────────────────────
// Utilities
// ────────────────────────────────────────────────────────────────
function escapeAttr(s) { return String(s).replace(/"/g, '&quot;'); }
function stripTags(s) { return String(s).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }

// ────────────────────────────────────────────────────────────────
init();
})();
