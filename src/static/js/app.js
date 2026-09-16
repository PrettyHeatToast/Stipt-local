// ── State ──────────────────────────────────────────────────────────
const state = {
  course: null,           // { id, name, course_code }
  sections: [],           // all sections for selected course
  selectedSections: [],   // selected section IDs (numbers)
  quizAssignmentId: null,
  currentPin: null,
  students: [],           // raw enrollment objects
  attendance: {},         // { userId: 0 | 1 }
  motivations: {},        // { userId: criterionKey } — why a checked-in student got 0
  feedbackCommentIds: {}, // { userId: Canvas submission comment id } — last synced feedback
  checkedIn: new Set(),   // userIds whose quiz submission has already been processed
  gradeQueue: {},         // { userId: Promise } — grade syncs run one after another per student
  quizQuestion: '',
  sectionMap: {},         // { sectionId: sectionName }
  sortKey: 'name',
  sortAsc: true,
  studentFilter: '',
  countdownInterval: null,
  countdownSeconds: 30,
  sessionInterval: null,
  sessionSeconds: 600,
  sessionEnded: false,
  reviewMode: false,      // true when an earlier session was reopened to adjust scores
  sessionDate: null,      // created_at of the reopened session
  settings: {
    sessionDuration: 600,
    pinDuration: 30,
    hiddenCourseIds: null,
  },
};

// ── Router ─────────────────────────────────────────────────────────
const screens = ['setup', 'courses', 'course', 'sections', 'history', 'session'];

function showScreen(name) {
  screens.forEach(s => {
    const el = document.getElementById(`screen-${s}`);
    el.classList.remove('active', 'visible');
  });
  const target = document.getElementById(`screen-${name}`);
  target.classList.add('active');
  requestAnimationFrame(() => requestAnimationFrame(() => target.classList.add('visible')));
}

function navigate(screen) {
  location.hash = `#screen-${screen}`;
}

// ── Utilities ──────────────────────────────────────────────────────
function closeBanner(id) {
  document.getElementById(id).style.display = 'none';
}

function showBanner(id, msg) {
  const el = document.getElementById(id);
  const msgEl = document.getElementById(`${id}-msg`);
  if (msgEl && msg) msgEl.textContent = msg;
  el.style.display = 'flex';
}

async function apiFetch(url, opts = {}) {
  const resp = await fetch(url, opts);
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

function generatePin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function formatTime(s) {
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const sec = (s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

// ── Theme ──────────────────────────────────────────────────────────
const themeBtn = document.getElementById('theme-toggle');
const iconSun  = document.getElementById('icon-sun');
const iconMoon = document.getElementById('icon-moon');

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  iconSun.style.display  = theme === 'dark' ? 'none'  : '';
  iconMoon.style.display = theme === 'dark' ? '' : 'none';
  if (pipWindow) pipWindow.document.documentElement.setAttribute('data-theme', theme);
  syncNativePip();
}

themeBtn.addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(next);
});

function applyRingState(ring, textEl, s, total, circ) {
  textEl.textContent = formatTime(s);
  ring.style.strokeDashoffset = circ * (1 - s / total);
  ring.style.stroke = s > 300 ? 'var(--color-success)' : s > 120 ? 'var(--color-warning)' : 'var(--color-error)';
}

// ── Document Picture-in-Picture ────────────────────────────────────
let pipWindow = null;
let pipNativeOpen = false;

const _sysMql = window.matchMedia('(prefers-color-scheme: dark)');
applyTheme(_sysMql.matches ? 'dark' : 'light');
_sysMql.addEventListener('change', e => applyTheme(e.matches ? 'dark' : 'light'));
const PIP_R    = 36;
const PIP_CIRC = 2 * Math.PI * PIP_R;

async function togglePip() {
  if (IS_NATIVE && window.pywebview) {
    if (pipNativeOpen) {
      await window.pywebview.api.close_pip();
      pipNativeOpen = false;
    } else {
      await window.pywebview.api.open_pip();
      pipNativeOpen = true;
      syncNativePip();
    }
    updatePipBtn();
    return;
  }
  const fallbackDialog = document.getElementById('pip-fallback-dialog');
  if (pipWindow) { pipWindow.close(); return; }
  if (fallbackDialog && fallbackDialog.open) { closePipFallback(); return; }

  if (!('documentPictureInPicture' in window)) {
    openPipFallback();
    return;
  }

  try {
    pipWindow = await window.documentPictureInPicture.requestWindow({ width: 380, height: 260 });

    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    pipWindow.document.documentElement.setAttribute('data-theme', theme);
    pipWindow.document.title = 'PIN – Stipt. Local';

    const link = pipWindow.document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&display=swap';
    pipWindow.document.head.appendChild(link);

    const style = pipWindow.document.createElement('style');
    style.textContent = pipCSS();
    pipWindow.document.head.appendChild(style);

    pipWindow.document.body.innerHTML = pipHTML();
    syncPip();

    pipWindow.addEventListener('pagehide', () => {
      pipWindow = null;
      updatePipBtn();
    });
    updatePipBtn();
  } catch (e) {
    pipWindow = null;
    showBanner('pin-update-error', `PiP kon niet worden geopend: ${e.message}`);
  }
}

function updatePipBtn() {
  const btn   = document.getElementById('pip-btn');
  const label = document.getElementById('pip-btn-label');
  if (!btn) return;
  const fallbackDialog = document.getElementById('pip-fallback-dialog');
  const isActive = !!pipWindow || pipNativeOpen || (fallbackDialog && fallbackDialog.open);
  btn.classList.toggle('active', isActive);
  label.textContent = isActive ? 'Sluit zwevend venster' : 'Zwevend venster';
  btn.setAttribute('aria-label', isActive ? 'Zwevend venster sluiten' : 'Zwevend venster openen');
}

function syncPip() {
  if (!pipWindow) return;
  const pin = state.currentPin || '0000';
  for (let i = 0; i < 4; i++) {
    const el = pipWindow.document.getElementById(`pip-d${i}`);
    if (el) el.textContent = pin[i] || '0';
  }
  const s    = state.countdownSeconds;
  const ring = pipWindow.document.getElementById('pip-ring');
  const text = pipWindow.document.getElementById('pip-text');
  if (ring && text) applyRingState(ring, text, s, state.settings.pinDuration, PIP_CIRC);
  syncPipSessionTimer(state.sessionSeconds);
}

function syncPipSessionTimer(s) {
  if (!pipWindow) return;
  const el = pipWindow.document.getElementById('pip-session-timer');
  if (!el) return;
  el.textContent = formatTime(s);
  el.classList.toggle('warning', s <= 120 && s > 60);
  el.classList.toggle('urgent',  s <= 60);
}

function syncNativePip() {
  if (!pipNativeOpen) return;
  fetch('/api/pip/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pin: state.currentPin || '0000',
      seconds_left: state.countdownSeconds,
      total_seconds: state.settings.pinDuration,
      session_seconds: state.sessionSeconds,
      theme: document.documentElement.getAttribute('data-theme'),
    }),
  }).catch(() => {});
}

// ── PiP fallback (non-Document-PiP contexts, e.g. WebView2) ────────
const PIP_FB_CIRC = 2 * Math.PI * 36;

// ── Close-warning dialog ────────────────────────────────────────────
function showCloseWarning() {
  document.getElementById('close-warning-dialog').showModal();
}
document.getElementById('cw-cancel').addEventListener('click', () => {
  document.getElementById('close-warning-dialog').close();
});
document.getElementById('cw-confirm').addEventListener('click', async () => {
  document.getElementById('close-warning-dialog').close();
  await endSession();
  if (window.pywebview) window.pywebview.api.force_close();
});

function openPipFallback() {
  const dialog = document.getElementById('pip-fallback-dialog');
  if (!dialog) return;
  syncPipFallback();
  dialog.show();
  updatePipBtn();
}

function closePipFallback() {
  const dialog = document.getElementById('pip-fallback-dialog');
  if (dialog) dialog.close();
  updatePipBtn();
}

function syncPipFallback() {
  const dialog = document.getElementById('pip-fallback-dialog');
  if (!dialog || !dialog.open) return;
  const pin = state.currentPin || '0000';
  for (let i = 0; i < 4; i++) {
    const el = document.getElementById(`pfb-d${i}`);
    if (el) el.textContent = pin[i] || '0';
  }
  const s    = state.countdownSeconds;
  const ring = document.getElementById('pfb-ring');
  const text = document.getElementById('pfb-text');
  if (ring && text) applyRingState(ring, text, s, state.settings.pinDuration, PIP_FB_CIRC);
  const sessionEl = document.getElementById('pfb-session-timer');
  if (sessionEl) {
    sessionEl.textContent = formatTime(state.sessionSeconds);
    sessionEl.classList.toggle('warning', state.sessionSeconds <= 120 && state.sessionSeconds > 60);
    sessionEl.classList.toggle('urgent',  state.sessionSeconds <= 60);
  }
}

function pipCSS() {
  return `
:root{--color-bg:#FAF8F3;--color-surface:#FFFFFF;--color-surface-alt:#F2EDE4;--color-border:#E4DDD1;--color-text:#1C1916;--color-text-secondary:#5C5650;--color-success:#16A34A;--color-warning:#D97706;--color-error:#DC2626;--text-sm:.8125rem;--text-xs:.75rem;--text-2xl:2rem;--space-2:.5rem;--space-3:.75rem;--space-4:1rem;--radius:10px}
[data-theme=dark]{--color-bg:#18160F;--color-surface:#221F18;--color-surface-alt:#2C2820;--color-border:#3A352B;--color-text:#F2EDE4;--color-text-secondary:#9B9188;--color-success:#22C55E;--color-warning:#F59E0B;--color-error:#EF4444}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;font-family:'Satoshi',system-ui,sans-serif;background:var(--color-bg);color:var(--color-text)}
.pip-root{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:var(--space-3);padding:var(--space-4)}
.pip-label{font-size:var(--text-xs);font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--color-text-secondary)}
.pip-inner{display:flex;align-items:center;gap:1.5rem}
.pin-display{display:flex;gap:.5rem}
.pin-digit{width:54px;height:66px;display:flex;align-items:center;justify-content:center;font-size:var(--text-2xl);font-weight:700;font-family:'SF Mono','Fira Code',monospace;background:var(--color-surface-alt);border:2px solid var(--color-border);border-radius:var(--radius);color:var(--color-text)}
.cw{position:relative;width:80px;height:80px;display:flex;align-items:center;justify-content:center}
.cw svg{transform:rotate(-90deg)}
.ct{fill:none;stroke:var(--color-border);stroke-width:6}
.cr{fill:none;stroke-width:6;stroke-linecap:round;transition:stroke-dashoffset 1s linear,stroke .5s ease}
.cx{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:var(--text-sm);font-weight:700;font-variant-numeric:tabular-nums}
.pip-session{display:flex;align-items:center;gap:.5rem;padding-top:var(--space-2);border-top:1px solid var(--color-border);width:100%;justify-content:center}
.pip-st{font-size:var(--text-sm);font-weight:700;font-variant-numeric:tabular-nums;color:var(--color-text);transition:color .4s}
.pip-st.warning{color:var(--color-warning)}.pip-st.urgent{color:var(--color-error)}`;
}

function pipHTML() {
  const pin  = state.currentPin || '0000';
  const circ = PIP_CIRC.toFixed(2);
  const digits = [0,1,2,3].map(i => `<div class="pin-digit" id="pip-d${i}">${pin[i]||'0'}</div>`).join('');
  const sessionTime = formatTime(state.sessionSeconds);
  return `<div class="pip-root">
  <div class="pip-label">Toegangscode voor studenten</div>
  <div class="pip-inner">
    <div class="pin-display">${digits}</div>
    <div class="cw">
      <svg width="80" height="80" viewBox="0 0 80 80">
        <circle class="ct" cx="40" cy="40" r="${PIP_R}"/>
        <circle class="cr" id="pip-ring" cx="40" cy="40" r="${PIP_R}"
          stroke-dasharray="${circ}" stroke-dashoffset="0" stroke="var(--color-success)"/>
      </svg>
      <div class="cx" id="pip-text">${formatTime(state.settings.pinDuration)}</div>
    </div>
  </div>
  <div class="pip-session">
    <span class="pip-label">Check-in sluit over&nbsp;</span>
    <span class="pip-st" id="pip-session-timer">${sessionTime}</span>
  </div>
</div>`;
}

// ── Screen 0: Setup ────────────────────────────────────────────────
document.getElementById('setup-save-btn').addEventListener('click', async () => {
  const url   = document.getElementById('setup-url').value.trim();
  const token = document.getElementById('setup-token').value.trim();
  const errEl = document.getElementById('setup-error');
  errEl.style.display = 'none';
  if (!url || !token) {
    errEl.textContent = 'Vul beide velden in.';
    errEl.style.display = '';
    return;
  }
  const btn = document.getElementById('setup-save-btn');
  btn.disabled = true;
  btn.textContent = 'Opslaan…';
  try {
    await apiFetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canvas_base_url: url, canvas_api_token: token, ical_url: document.getElementById('setup-ical').value.trim() }),
    });
    navigate('courses');
  } catch (e) {
    errEl.textContent = `Fout: ${e.message}`;
    errEl.style.display = '';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Opslaan en starten';
  }
});

// ── Screen 1: Courses ──────────────────────────────────────────────
let allCourses = [];
let todaySuggestions = [];

async function loadCourses() {
  closeBanner('courses-error');
  document.getElementById('courses-loading').style.display = '';
  document.getElementById('courses-list').style.display = 'none';
  document.getElementById('courses-empty').style.display = 'none';
  document.getElementById('suggestions-section').style.display = 'none';
  document.getElementById('all-courses-label').style.display = 'none';

  const [coursesResult, suggestionsResult] = await Promise.allSettled([
    apiFetch('/api/courses'),
    apiFetch('/api/ical-suggestions'),
  ]);

  if (coursesResult.status === 'rejected') {
    document.getElementById('courses-loading').style.display = 'none';
    showBanner('courses-error', `Kon vakken niet laden: ${coursesResult.reason.message}`);
    return;
  }

  allCourses = coursesResult.value;
  todaySuggestions = suggestionsResult.status === 'fulfilled' ? suggestionsResult.value : [];

  renderSuggestions(todaySuggestions);
  renderCourses(allCourses);
}

function renderCourseCards(list, containerId) {
  const el = document.getElementById(containerId);
  el.innerHTML = list.map(c => `
    <div class="card" tabindex="0" role="button" aria-label="${escHtml(c.name)}"
         data-id="${c.id}" data-name="${escHtml(c.name)}" data-code="${escHtml(c.course_code || '')}">
      <div class="card-title">${escHtml(c.name)}</div>
      <div class="card-sub">${escHtml(c.course_code || '')}</div>
    </div>
  `).join('');
  el.querySelectorAll('.card').forEach(card => {
    card.addEventListener('click', () => selectCourse(card));
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectCourse(card); }
    });
  });
}

function renderCourses(list) {
  const loading = document.getElementById('courses-loading');
  const listEl  = document.getElementById('courses-list');
  const emptyEl = document.getElementById('courses-empty');
  loading.style.display = 'none';

  if (!list.length) {
    listEl.style.display = 'none';
    emptyEl.style.display = '';
    return;
  }
  emptyEl.style.display = 'none';
  renderCourseCards(list, 'courses-list');
  listEl.style.display = '';
}

function selectCourse(card) {
  state.course = {
    id: parseInt(card.dataset.id),
    name: card.dataset.name,
    course_code: card.dataset.code,
  };
  navigate('course');
}

function renderSuggestions(list) {
  const section  = document.getElementById('suggestions-section');
  const allLabel = document.getElementById('all-courses-label');
  if (!list || list.length === 0) {
    section.style.display  = 'none';
    allLabel.style.display = 'none';
    return;
  }
  renderCourseCards(list, 'suggestions-list');
  section.style.display  = '';
  allLabel.style.display = '';
}

document.getElementById('course-search').addEventListener('input', e => {
  const q = e.target.value.toLowerCase();
  if (q) {
    document.getElementById('suggestions-section').style.display = 'none';
    document.getElementById('all-courses-label').style.display = 'none';
  } else {
    renderSuggestions(todaySuggestions);
  }
  const filtered = allCourses.filter(c =>
    (c.name || '').toLowerCase().includes(q) ||
    (c.course_code || '').toLowerCase().includes(q)
  );
  renderCourses(filtered);
});

document.getElementById('back-to-courses').addEventListener('click', () => navigate('course'));

// ── Screen 1b: Course menu ─────────────────────────────────────────
function bindCardAction(card, action) {
  card.addEventListener('click', action);
  card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); action(); }
  });
}

document.getElementById('course-back-btn').addEventListener('click', () => navigate('courses'));
bindCardAction(document.getElementById('course-new-session'), () => navigate('sections'));
bindCardAction(document.getElementById('course-edit-session'), () => navigate('history'));

// ── Screen 2: Sections ─────────────────────────────────────────────
let allSections = [];

async function loadSections() {
  closeBanner('sections-error');
  document.getElementById('sections-course-name').textContent = state.course.name;
  document.getElementById('sections-loading').style.display = '';
  document.getElementById('sections-list').style.display = 'none';
  document.getElementById('toggle-all-btn').style.display = 'none';
  document.getElementById('sections-count-label').textContent = 'Secties laden…';
  state.selectedSections = [];
  updateStartBtn();

  try {
    allSections = await apiFetch(`/api/courses/${state.course.id}/sections`);
    renderSections(allSections);
  } catch (e) {
    document.getElementById('sections-loading').style.display = 'none';
    showBanner('sections-error', `Kon secties niet laden: ${e.message}`);
  }
}

function renderSections(sections) {
  const loading = document.getElementById('sections-loading');
  const listEl  = document.getElementById('sections-list');
  loading.style.display = 'none';

  document.getElementById('toggle-all-btn').style.display = sections.length ? '' : 'none';
  document.getElementById('sections-count-label').textContent = `${sections.length} sectie${sections.length !== 1 ? 's' : ''}`;

  listEl.innerHTML = sections.map(s => `
    <div class="section-item" role="checkbox" aria-checked="false" tabindex="0" data-id="${s.id}">
      <input type="checkbox" id="sec-${s.id}" value="${s.id}" aria-label="${escHtml(s.name)}">
      <label for="sec-${s.id}">${escHtml(s.name)}</label>
      <span class="enroll-count">${s.total_students != null ? s.total_students + ' studenten' : ''}</span>
    </div>
  `).join('');
  listEl.style.display = '';

  listEl.querySelectorAll('.section-item').forEach(item => {
    const cb = item.querySelector('input[type="checkbox"]');
    const toggle = () => {
      cb.checked = !cb.checked;
      item.setAttribute('aria-checked', cb.checked);
      syncSectionSelection();
    };
    item.addEventListener('click', e => {
      if (e.target === cb || e.target.tagName === 'LABEL') return;
      toggle();
    });
    item.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } });
    cb.addEventListener('change', () => { item.setAttribute('aria-checked', cb.checked); syncSectionSelection(); });
  });
}

function syncSectionSelection() {
  state.selectedSections = Array.from(
    document.querySelectorAll('#sections-list input[type="checkbox"]:checked')
  ).map(cb => parseInt(cb.value));
  updateStartBtn();
  updateToggleAllBtn();
}

function updateStartBtn() {
  document.getElementById('start-session-btn').disabled = state.selectedSections.length === 0;
}

function updateToggleAllBtn() {
  const all = allSections.length;
  const sel = state.selectedSections.length;
  document.getElementById('toggle-all-btn').textContent = sel === all ? 'Deselecteer alles' : 'Selecteer alles';
}

document.getElementById('toggle-all-btn').addEventListener('click', () => {
  const all = allSections.length;
  const sel = state.selectedSections.length;
  const check = sel < all;
  document.querySelectorAll('#sections-list input[type="checkbox"]').forEach(cb => {
    cb.checked = check;
    cb.closest('.section-item').setAttribute('aria-checked', check);
  });
  syncSectionSelection();
});

document.getElementById('start-session-btn').addEventListener('click', startSession);

async function startSession() {
  closeBanner('sections-error');
  const btn = document.getElementById('start-session-btn');
  const label = document.getElementById('start-btn-label');
  const spinner = document.getElementById('start-btn-spinner');

  btn.disabled = true;
  label.style.display = 'none';
  spinner.style.display = '';

  try {
    // Find assignment group
    const groups = await apiFetch(`/api/courses/${state.course.id}/assignment_groups`);
    const group = groups.find(g => g.name.toLowerCase() === 'aanwezigheden');
    if (!group) {
      showBanner('sections-error', "Geen 'Aanwezigheden' toewijzingsgroep gevonden. Maak deze aan in Canvas.");
      return;
    }

    const pin = generatePin();
    const today = new Date().toLocaleDateString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const me = await apiFetch('/api/me').catch(() => ({ name: '' }));
    const title = me.name ? `Aanwezigheid – ${me.name} – ${today}` : `Aanwezigheid – ${today}`;

    const result = await apiFetch(`/api/courses/${state.course.id}/create_quiz`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, assignment_group_id: group.id, pin, section_ids: state.selectedSections }),
    });

    state.quizAssignmentId = result.quiz_assignment_id;
    state.quizQuestion = result.question || '';
    state.currentPin = pin;
    navigate('session');
  } catch (e) {
    showBanner('sections-error', `Fout bij aanmaken quiz: ${e.message}`);
  } finally {
    btn.disabled = state.selectedSections.length === 0;
    label.style.display = '';
    spinner.style.display = 'none';
  }
}

// ── Screen 2b: Past sessions ───────────────────────────────────────
document.getElementById('history-back-btn').addEventListener('click', () => navigate('course'));

async function loadHistory() {
  closeBanner('history-error');
  document.getElementById('history-course-name').textContent = state.course.name;
  document.getElementById('history-loading').style.display = '';
  document.getElementById('history-list').style.display = 'none';
  document.getElementById('history-empty').style.display = 'none';

  try {
    const [sessions, sections] = await Promise.all([
      apiFetch(`/api/courses/${state.course.id}/sessions`),
      apiFetch(`/api/courses/${state.course.id}/sections`),
    ]);
    allSections = sections;
    renderHistory(sessions);
  } catch (e) {
    document.getElementById('history-loading').style.display = 'none';
    showBanner('history-error', `Kon sessies niet laden: ${e.message}`);
  }
}

function formatSessionDate(iso) {
  const d = new Date(iso);
  const date = d.toLocaleDateString('nl-BE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

function renderHistory(sessions) {
  const listEl = document.getElementById('history-list');
  document.getElementById('history-loading').style.display = 'none';
  if (!sessions.length) {
    document.getElementById('history-empty').style.display = '';
    return;
  }

  const sectionNames = ids => ids.length
    ? allSections.filter(s => ids.includes(s.id)).map(s => s.name).join(', ')
    : 'Alle secties';

  listEl.innerHTML = sessions.map((s, i) => {
    const title = s.created_at ? formatSessionDate(s.created_at) : s.name;
    const locked = s.lock_at && new Date(s.lock_at) <= new Date();
    const end = locked
      ? `beëindigd ${new Date(s.lock_at).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}`
      : 'Nog open';
    return `
    <div class="card" tabindex="0" role="button" aria-label="${escHtml(title)}" data-index="${i}">
      <div class="card-title">${escHtml(title)}</div>
      <div class="card-sub">${escHtml(`${sectionNames(s.section_ids)} · ${end}`)}</div>
    </div>`;
  }).join('');
  listEl.querySelectorAll('.card').forEach(card => {
    bindCardAction(card, () => openPastSession(sessions[parseInt(card.dataset.index, 10)]));
  });
  listEl.style.display = '';
}

function openPastSession(s) {
  state.quizAssignmentId = s.id;
  state.selectedSections = s.section_ids.length ? s.section_ids : allSections.map(sec => sec.id);
  state.quizQuestion = '';
  state.currentPin = null;
  state.sessionDate = s.created_at;
  state.reviewMode = true;
  state.sessionEnded = true;
  navigate('session');
}

// ── Screen 3: Session ──────────────────────────────────────────────
const END_SESSION_BTN_HTML = document.getElementById('end-session-btn').innerHTML;

// showSessionEndedUI hides the PIN panel and timer; restore them for the next session
function resetSessionUI() {
  document.getElementById('pin-panel').style.display = '';
  document.querySelector('.session-timer').style.display = '';
  document.getElementById('end-session-btn').innerHTML = END_SESSION_BTN_HTML;
  document.getElementById('session-ended-banner').style.display = 'none';
}

function initSession() {
  const sectionNames = allSections
    .filter(s => state.selectedSections.includes(s.id))
    .map(s => s.name).join(', ');

  resetSessionUI();
  document.getElementById('session-course-name').textContent = state.course.name;
  let subtitle = sectionNames;
  if (state.reviewMode && state.sessionDate) subtitle = `${sectionNames} · ${formatSessionDate(state.sessionDate)}`;
  else if (state.quizQuestion) subtitle = `${sectionNames} · Quizvraag: ${state.quizQuestion}`;
  document.getElementById('session-sections-subtitle').textContent = subtitle;

  state.sectionMap = {};
  allSections.forEach(s => { state.sectionMap[s.id] = s.name; });

  if (state.reviewMode) {
    showSessionEndedUI();
    loadStudents();
    return;
  }

  setPinDisplay(state.currentPin);
  startCountdown();
  startSessionTimer();
  loadStudents();
}

// ── PIN ────────────────────────────────────────────────────────────
function setPinDisplay(pin) {
  for (let i = 0; i < 4; i++) {
    document.getElementById(`pin-d${i}`).textContent = pin[i] || '0';
  }
  document.getElementById('pin-display').setAttribute('aria-label', `PIN code: ${pin.split('').join(' ')}`);
  if (pipWindow) {
    for (let i = 0; i < 4; i++) {
      const el = pipWindow.document.getElementById(`pip-d${i}`);
      if (el) el.textContent = pin[i] || '0';
    }
  }
  syncPipFallback();
  syncNativePip();
}

async function rotatePin() {
  const newPin = generatePin();
  state.currentPin = newPin;
  setPinDisplay(newPin);

  try {
    await apiFetch(`/api/quiz/${state.quizAssignmentId}/update_password`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: newPin }),
    });
    closeBanner('pin-update-error');
  } catch (e) {
    showBanner('pin-update-error', `PIN update mislukt: ${e.message}`);
  }
  await pollAndUpdateSubmissions();
}

// ── Session timer ──────────────────────────────────────────────────
function startSessionTimer() {
  if (state.sessionInterval) clearInterval(state.sessionInterval);
  state.sessionSeconds = state.settings.sessionDuration;
  updateSessionTimerUI(state.settings.sessionDuration);

  state.sessionInterval = setInterval(() => {
    state.sessionSeconds--;
    updateSessionTimerUI(state.sessionSeconds);
    if (state.sessionSeconds <= 0) {
      clearInterval(state.sessionInterval);
      state.sessionInterval = null;
      endSession();
    }
  }, 1000);
}

function updateSessionTimerUI(s) {
  const el = document.getElementById('session-timer-value');
  if (!el) return;
  el.textContent = formatTime(s);
  el.classList.toggle('warning', s <= 120 && s > 60);
  el.classList.toggle('urgent',  s <= 60);
  syncPipSessionTimer(s);
}

// ── Countdown ──────────────────────────────────────────────────────
const CIRCUMFERENCE = 2 * Math.PI * 54; // 339.29

function startCountdown() {
  if (state.countdownInterval) clearInterval(state.countdownInterval);
  state.countdownSeconds = state.settings.pinDuration;
  updateCountdownUI(state.settings.pinDuration);

  state.countdownInterval = setInterval(async () => {
    state.countdownSeconds--;
    updateCountdownUI(state.countdownSeconds);
    if (state.countdownSeconds <= 0) {
      state.countdownSeconds = state.settings.pinDuration;
      updateCountdownUI(state.settings.pinDuration);
      await rotatePin();
    }
  }, 1000);
}

function updateCountdownUI(s) {
  const ring = document.getElementById('countdown-ring');
  const text = document.getElementById('countdown-text');
  applyRingState(ring, text, s, state.settings.pinDuration, CIRCUMFERENCE);

  if (pipWindow) {
    const pipRing = pipWindow.document.getElementById('pip-ring');
    const pipText = pipWindow.document.getElementById('pip-text');
    if (pipRing && pipText) applyRingState(pipRing, pipText, s, state.settings.pinDuration, PIP_CIRC);
  }
  syncPipFallback();
  syncNativePip();
}

// ── Students ───────────────────────────────────────────────────────
function submissionsUrl() {
  return `/api/session/submissions?course_id=${state.course.id}&assignment_id=${state.quizAssignmentId}`;
}

// A student checked in when they submitted the quiz themselves. Absent students who got
// grade 0 at the end of a session are 'graded' too, so workflow_state is not a signal.
function hasCheckedIn(sub) {
  return !!(sub.submitted_at || sub.attempt);
}

async function pollAndUpdateSubmissions() {
  if (!state.quizAssignmentId || state.sessionEnded) return;
  const submissions = await apiFetch(submissionsUrl()).catch(() => []);
  const gradePromises = [];
  (Array.isArray(submissions) ? submissions : [])
    .filter(hasCheckedIn)
    .forEach(s => {
      const uid = s.user_id;
      // Only handle each check-in once, so manual changes are never overridden
      if (state.checkedIn.has(uid)) return;
      state.checkedIn.add(uid);
      if ((state.attendance[uid] ?? 0) === 0 && !state.motivations[uid]) {
        state.attendance[uid] = 1;
        gradePromises.push(syncGrade(uid, 1).catch(() => {}));
      }
    });
  if (gradePromises.length) {
    renderTable();
    await Promise.allSettled(gradePromises);
  }
}

// Grade syncs for one student are chained, so the comment id returned by one call
// is known when the next call needs to remove that comment.
function syncGrade(uid, score, criterion = null) {
  if (!state.quizAssignmentId) return Promise.resolve(null);
  const courseId     = state.course.id;
  const assignmentId = state.quizAssignmentId;
  const previous = state.gradeQueue[uid] || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const result = await apiFetch('/api/session/grade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: uid,
        score,
        criterion,
        remove_comment_id: state.feedbackCommentIds[uid] ?? null,
        course_id: courseId,
        assignment_id: assignmentId,
      }),
    });
    state.feedbackCommentIds[uid] = result.comment_id ?? null;
    return result;
  });
  state.gradeQueue[uid] = next;
  return next;
}

async function loadStudents() {
  document.getElementById('students-loading').style.display = '';
  document.getElementById('table-wrap').style.display = 'none';
  document.getElementById('students-empty').style.display = 'none';
  document.getElementById('summary-bar').innerHTML = '';

  try {
    const sectionIds = state.selectedSections.join(',');
    const [enrollments, submissions] = await Promise.all([
      apiFetch(`/api/courses/${state.course.id}/enrollments?section_ids=${sectionIds}`),
      apiFetch(submissionsUrl()).catch(() => []),
    ]);
    const subs = Array.isArray(submissions) ? submissions : [];
    state.students = enrollments;
    state.attendance = {};
    state.motivations = {};
    state.feedbackCommentIds = {};
    state.checkedIn = new Set(subs.filter(hasCheckedIn).map(s => s.user_id));

    enrollments.forEach(e => {
      state.attendance[e.user_id] = state.checkedIn.has(e.user_id) ? 1 : 0;
    });
    restoreScores(subs);
    document.getElementById('students-loading').style.display = 'none';

    if (!enrollments.length) {
      document.getElementById('students-empty').style.display = '';
      return;
    }
    renderTable();
  } catch (e) {
    document.getElementById('students-loading').style.display = 'none';
    showBanner('pin-update-error', `Fout bij laden studenten: ${e.message}`);
  }
}

// Rebuild scores and feedback from Canvas, so an earlier session can be edited again.
// The criterion is recognised by the exact comment text update_grade posts.
function restoreScores(subs) {
  const criterionByText = {};
  CRITERIA.forEach(c => { criterionByText[`${c.title}: ${c.feedback}`] = c.key; });

  subs.forEach(sub => {
    const uid = sub.user_id;
    if (!(uid in state.attendance)) return;
    if (sub.score != null) state.attendance[uid] = sub.score >= 1 ? 1 : 0;

    const feedback = (sub.submission_comments || [])
      .filter(c => criterionByText[c.comment])
      .sort((a, b) => a.id - b.id)
      .pop();
    if (!feedback) return;
    state.feedbackCommentIds[uid] = feedback.id;
    if (state.attendance[uid] === 0) state.motivations[uid] = criterionByText[feedback.comment];
  });
}

function sortedFilteredStudents() {
  const q = state.studentFilter.toLowerCase();
  let list = state.students.filter(e => {
    const name = ((e.user && e.user.sortable_name) || e.user_name || '').toLowerCase();
    return !q || name.includes(q);
  });
  list.sort((a, b) => {
    let cmp;
    if (state.sortKey === 'status') {
      cmp = scoreInfo(a.user_id).rank - scoreInfo(b.user_id).rank;
    } else {
      const na = (a.user && a.user.sortable_name) || a.user_name || '';
      const nb = (b.user && b.user.sortable_name) || b.user_name || '';
      cmp = na.localeCompare(nb, 'nl');
    }
    return state.sortAsc ? cmp : -cmp;
  });
  return list;
}

function renderTable() {
  const list = sortedFilteredStudents();
  const tbody = document.getElementById('students-tbody');
  const tableWrap = document.getElementById('table-wrap');
  const emptyEl = document.getElementById('students-empty');

  if (!list.length && state.studentFilter) {
    tableWrap.style.display = 'none';
    emptyEl.style.display = '';
    emptyEl.querySelector('p').textContent = 'Geen studenten gevonden voor deze zoekopdracht';
    updateSummary();
    return;
  }
  emptyEl.style.display = 'none';
  tableWrap.style.display = '';

  tbody.innerHTML = list.map(e => {
    const uid   = e.user_id;
    const name  = studentName(e);
    const secId = e.course_section_id;
    const secName = state.sectionMap[secId] || `Sectie ${secId}`;
    const score = state.attendance[uid] ?? 0;
    const motivated = !!state.motivations[uid];
    const { label, cls } = scoreInfo(uid);
    const lowerLabel = motivated ? `Wijzig motivatie voor ${name}` : `Verlaag aanwezigheid voor ${name}`;
    const canRaise = canRaiseToPresent(uid);

    return `<tr data-uid="${uid}">
      <td>${escHtml(name)}</td>
      <td>${escHtml(secName)}</td>
      <td><span class="status-badge ${cls}">${escHtml(label)}</span></td>
      <td>
        <div class="actions-cell">
          <button class="btn-icon" aria-label="Verhoog aanwezigheid voor ${escHtml(name)}"
            title="${canRaise ? 'Verhoog' : 'Enkel studenten die zelf ingecheckt hebben kunnen aanwezig zijn'}"
            data-uid="${uid}" data-action="raise" ${canRaise ? '' : 'disabled'}>+</button>
          <button class="btn-icon" aria-label="${escHtml(lowerLabel)}" title="${motivated ? 'Wijzig motivatie' : 'Verlaag'}"
            data-uid="${uid}" data-action="lower" ${score === 0 && !motivated ? 'disabled' : ''}>−</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  updateSummary();
}

function studentName(e) {
  return (e.user && e.user.sortable_name) || e.user_name || `Student ${e.user_id}`;
}

// rank: sort order for the status column (afwezig < niet behaald < aanwezig)
function scoreInfo(uid) {
  if ((state.attendance[uid] ?? 0) === 1) return { label: 'Aanwezig', cls: 'badge-present', rank: 2 };
  const criterion = CRITERIA.find(c => c.key === state.motivations[uid]);
  if (criterion) return { label: `Niet behaald · ${criterion.title}`, cls: 'badge-partial', rank: 1 };
  return { label: 'Afwezig', cls: 'badge-absent', rank: 0 };
}

// Only a check-in makes a student present: the teacher can undo a "Niet behaald",
// but never mark a student who did not check in as present.
function canRaiseToPresent(uid) {
  return state.checkedIn.has(uid) && (state.attendance[uid] ?? 0) === 0;
}

function raiseToPresent(uid) {
  if (!canRaiseToPresent(uid)) return;
  state.attendance[uid] = 1;
  delete state.motivations[uid];
  renderTable();
  syncGrade(uid, 1).catch(e => showBanner('pin-update-error', `Grade update mislukt: ${e.message}`));
}

function applyMotivation(uid, criterion) {
  if (state.attendance[uid] === 0 && state.motivations[uid] === criterion) return;
  state.attendance[uid] = 0;
  state.motivations[uid] = criterion;
  renderTable();
  syncGrade(uid, 0, criterion).catch(e => showBanner('pin-update-error', `Feedback opslaan mislukt: ${e.message}`));
}

// ── Motivation dialog ──────────────────────────────────────────────
let motivationUid = null;

function openMotivationDialog(uid) {
  motivationUid = uid;
  const student = state.students.find(e => e.user_id === uid);
  document.getElementById('motivation-student').textContent = student ? studentName(student) : '';
  const current = state.motivations[uid];
  document.getElementById('motivation-options').innerHTML = CRITERIA.map((c, i) => `
    <button type="button" class="motivation-option${c.key === current ? ' active' : ''}" data-criterion="${escHtml(c.key)}">
      <span class="motivation-option-title">${i + 1}. ${escHtml(c.title)}</span>
      <span class="motivation-option-feedback">${escHtml(c.feedback)}</span>
    </button>
  `).join('');
  document.getElementById('motivation-dialog').showModal();
}

document.getElementById('motivation-options').addEventListener('click', e => {
  const btn = e.target.closest('[data-criterion]');
  if (!btn || motivationUid === null) return;
  const uid = motivationUid;
  motivationUid = null;
  document.getElementById('motivation-dialog').close();
  applyMotivation(uid, btn.dataset.criterion);
});
document.getElementById('motivation-cancel').addEventListener('click', () => {
  motivationUid = null;
  document.getElementById('motivation-dialog').close();
});

function updateSummary() {
  const counts = [0, 0, 0];   // indexed by scoreInfo rank
  state.students.forEach(e => { counts[scoreInfo(e.user_id).rank]++; });
  document.getElementById('summary-bar').innerHTML = `
    <span class="summary-chip chip-present">✓ ${counts[2]} aanwezig</span>
    <span class="summary-chip chip-partial">◑ ${counts[1]} niet behaald</span>
    <span class="summary-chip chip-absent">✕ ${counts[0]} afwezig</span>
  `;
}

// ── Sort ───────────────────────────────────────────────────────────
function applySort(key) {
  if (state.sortKey === key) {
    state.sortAsc = !state.sortAsc;
  } else {
    state.sortKey = key;
    state.sortAsc = true;
  }

  const thName   = document.getElementById('th-name');
  const thStatus = document.getElementById('th-status');
  const iconName   = document.getElementById('sort-icon-name');
  const iconStatus = document.getElementById('sort-icon-status');

  thName.classList.toggle('sorted', key === 'name');
  thStatus.classList.toggle('sorted', key === 'status');
  thName.setAttribute('aria-sort', key === 'name' ? (state.sortAsc ? 'ascending' : 'descending') : 'none');
  thStatus.setAttribute('aria-sort', key === 'status' ? (state.sortAsc ? 'ascending' : 'descending') : 'none');

  iconName.textContent   = key === 'name'   ? (state.sortAsc ? '↑' : '↓') : '';
  iconStatus.textContent = key === 'status' ? (state.sortAsc ? '↑' : '↓') : '';

  renderTable();
}

document.getElementById('th-name').addEventListener('click', () => applySort('name'));
document.getElementById('th-name').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); applySort('name'); }
});
document.getElementById('th-status').addEventListener('click', () => applySort('status'));
document.getElementById('th-status').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); applySort('status'); }
});

// ── Score buttons (delegated) ──────────────────────────────────────
document.getElementById('students-tbody').addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const uid = parseInt(btn.dataset.uid, 10);
  if (btn.dataset.action === 'raise') raiseToPresent(uid);
  else openMotivationDialog(uid);
});

// ── Filter ─────────────────────────────────────────────────────────
document.getElementById('student-search').addEventListener('input', e => {
  state.studentFilter = e.target.value;
  renderTable();
});

// ── End Session ────────────────────────────────────────────────────
document.getElementById('end-session-btn').addEventListener('click', () => {
  if (state.sessionEnded) { leaveSession(); return; }
  document.getElementById('end-confirm').classList.add('show');
});
document.getElementById('end-confirm-no').addEventListener('click', () => {
  document.getElementById('end-confirm').classList.remove('show');
});
document.getElementById('end-confirm-yes').addEventListener('click', () => {
  endSession();
});

async function endSession() {
  if (state.countdownInterval) { clearInterval(state.countdownInterval); state.countdownInterval = null; }
  if (state.sessionInterval)   { clearInterval(state.sessionInterval);   state.sessionInterval = null; }
  document.getElementById('end-confirm').classList.remove('show');
  if (pipWindow) { pipWindow.close(); pipWindow = null; }
  if (pipNativeOpen && window.pywebview) {
    try { await window.pywebview.api.close_pip(); } catch (_) {}
    pipNativeOpen = false;
  }
  closePipFallback();
  updatePipBtn();

  // Rename and unpublish the quiz in Canvas (best-effort)
  try { await apiFetch('/api/session/end', { method: 'POST' }); } catch (_) {}

  // Final poll — capture any last-second submissions before flushing absents
  await pollAndUpdateSubmissions();

  // Submit grade 0 for all still-absent students (zeros with a motivation are already synced)
  await Promise.allSettled(
    state.students
      .filter(e => (state.attendance[e.user_id] ?? 0) === 0 && !state.motivations[e.user_id])
      .map(e => syncGrade(e.user_id, 0))
  );

  state.sessionEnded = true;
  state.currentPin = null;
  showSessionEndedUI();
}

function showSessionEndedUI() {
  document.getElementById('pin-panel').style.display = 'none';
  document.querySelector('.session-timer').style.display = 'none';

  const btn = document.getElementById('end-session-btn');
  const label = state.reviewMode ? 'Terug naar sessies' : 'Terug naar vakken';
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg> ${label}`;

  document.getElementById('session-ended-banner').style.display = 'flex';
}

function leaveSession() {
  state.quizAssignmentId = null;
  state.currentPin = null;
  state.quizQuestion = '';
  state.students = [];
  state.attendance = {};
  state.motivations = {};
  state.feedbackCommentIds = {};
  state.checkedIn = new Set();
  state.gradeQueue = {};
  state.sessionEnded = false;
  const wasReview = state.reviewMode;
  state.reviewMode = false;
  state.sessionDate = null;
  navigate(wasReview ? 'history' : 'courses');
}

// ── Hash Routing / Screen Enter Hooks ─────────────────────────────
function onScreenEnter(name) {
  if (name === 'courses') {
    loadCourses();
  } else if (name === 'course') {
    if (!state.course) { navigate('courses'); return; }
    document.getElementById('course-menu-name').textContent = state.course.name;
  } else if (name === 'sections') {
    if (!state.course) { navigate('courses'); return; }
    state.reviewMode = false;
    loadSections();
  } else if (name === 'history') {
    if (!state.course) { navigate('courses'); return; }
    loadHistory();
  } else if (name === 'session') {
    if (!state.quizAssignmentId) return;
    initSession();
  }
}

function openSettings() {
  loadSettingsScreen();
  document.getElementById('settings-dialog').showModal();
}

window.addEventListener('hashchange', () => {
  const hash = location.hash.replace('#screen-', '') || 'courses';
  if (screens.includes(hash)) {
    showScreen(hash);
    onScreenEnter(hash);
  }
});

// ── XSS helper ────────────────────────────────────────────────────
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Settings ────────────────────────────────────────────────────────
let _settingsAllCourses = [];
let _settingsHiddenIds  = new Set();

async function loadSettingsScreen() {
  document.getElementById('settings-course-list').innerHTML =
    '<span class="settings-course-loading">Vakken laden…</span>';
  try {
    const [s, courses] = await Promise.all([
      apiFetch('/api/settings'),
      apiFetch('/api/all-courses').catch(() => []),
    ]);
    document.getElementById('settings-canvas-url').value   = s.canvas_base_url || '';
    document.getElementById('settings-ical-url').value     = s.ical_url || '';
    document.getElementById('settings-duration').value     = Math.round((s.session_duration || 600) / 60);
    document.getElementById('settings-pin-duration').value = s.pin_duration || 30;
    document.getElementById('settings-quiz-question').value = s.quiz_question || '';
    document.getElementById('settings-logging-enabled').checked = !!s.logging_enabled;
    document.getElementById('settings-log-path').textContent = s.log_path || '';

    _settingsAllCourses = Array.isArray(courses) ? courses : [];
    const configuredIds = s.hidden_course_ids;
    if (configuredIds === null || configuredIds === undefined) {
      // Nog niet geconfigureerd → vorig jaar standaard uitvinken
      _settingsHiddenIds = new Set(
        _settingsAllCourses.filter(c => !c.is_current_year).map(c => c.id)
      );
    } else {
      _settingsHiddenIds = new Set(configuredIds);
    }
  } catch (_) {
    _settingsAllCourses = [];
    _settingsHiddenIds  = new Set(state.settings.hiddenCourseIds || []);
  }
  document.getElementById('settings-api-token').value = '';
  renderCoursesFilter();
}

function renderCoursesFilter() {
  const el = document.getElementById('settings-course-list');
  if (!el) return;
  if (!_settingsAllCourses.length) {
    el.innerHTML = '<span class="settings-course-loading">Geen vakken gevonden.</span>';
    return;
  }
  el.innerHTML = _settingsAllCourses.map(course => {
    const checked  = !_settingsHiddenIds.has(course.id);
    const prevYear = !course.is_current_year;
    return `<label class="settings-course-item${prevYear ? ' prev-year' : ''}">` +
      `<input type="checkbox" data-course-id="${course.id}"${checked ? ' checked' : ''}>` +
      `<span>${escHtml(course.name || course.course_code || String(course.id))}</span>` +
      `</label>`;
  }).join('');
}

async function saveSettings() {
  const btn = document.getElementById('settings-save-btn');
  btn.disabled = true;
  btn.textContent = 'Opslaan…';
  closeBanner('settings-error');

  const durationMin = parseInt(document.getElementById('settings-duration').value) || 10;
  const pinDuration = parseInt(document.getElementById('settings-pin-duration').value) || 30;
  const canvasUrl   = document.getElementById('settings-canvas-url').value.trim();
  const icalUrl     = document.getElementById('settings-ical-url').value.trim();
  const token       = document.getElementById('settings-api-token').value.trim();

  const hiddenIds = [];
  document.querySelectorAll('#settings-course-list input[type="checkbox"]').forEach(cb => {
    if (!cb.checked) hiddenIds.push(parseInt(cb.dataset.courseId, 10));
  });

  const payload = {
    canvas_base_url:   canvasUrl,
    ical_url:          icalUrl,
    session_duration:  durationMin * 60,
    pin_duration:      pinDuration,
    quiz_question:     document.getElementById('settings-quiz-question').value.trim(),
    hidden_course_ids: hiddenIds,
    logging_enabled:   document.getElementById('settings-logging-enabled').checked,
  };
  if (token) payload.canvas_api_token = token;

  try {
    const result = await apiFetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const s = result.settings;
    state.settings.sessionDuration = s.session_duration;
    state.settings.pinDuration     = s.pin_duration;
    state.settings.hiddenCourseIds = s.hidden_course_ids;
    state.settings.loggingEnabled  = s.logging_enabled;
    document.getElementById('settings-dialog').close();
    if (document.getElementById('screen-courses').classList.contains('active')) loadCourses();
  } catch (e) {
    showBanner('settings-error', `Fout bij opslaan: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Opslaan';
  }
}

document.getElementById('settings-close-btn').addEventListener('click', () => document.getElementById('settings-dialog').close());
document.getElementById('settings-cancel-btn').addEventListener('click', () => document.getElementById('settings-dialog').close());
document.getElementById('settings-save-btn').addEventListener('click', saveSettings);
document.getElementById('settings-btn').addEventListener('click', openSettings);

// ── Init ───────────────────────────────────────────────────────────
(async function init() {
  const [cfgResult, settResult] = await Promise.allSettled([
    apiFetch('/api/config'),
    apiFetch('/api/settings'),
  ]);
  const cfg  = cfgResult.status  === 'fulfilled' ? cfgResult.value  : { configured: false };
  const sett = settResult.status === 'fulfilled' ? settResult.value : {};

  state.settings.sessionDuration = sett.session_duration ?? 600;
  state.settings.pinDuration     = sett.pin_duration     ?? 30;
  state.settings.hiddenCourseIds = sett.hidden_course_ids ?? null;
  state.sessionSeconds           = state.settings.sessionDuration;
  state.countdownSeconds         = state.settings.pinDuration;

  if (!cfg.configured) {
    if (sett.canvas_base_url) document.getElementById('setup-url').value   = sett.canvas_base_url;
    if (sett.ical_url)        document.getElementById('setup-ical').value  = sett.ical_url;
    showScreen('setup');
    return;
  }
  if (cfg.ical_url) document.getElementById('setup-ical').value = cfg.ical_url;
  const hash = location.hash.replace('#screen-', '') || 'courses';
  const screen = (screens.includes(hash) && hash !== 'setup') ? hash : 'courses';
  showScreen(screen);
  onScreenEnter(screen);
})();
