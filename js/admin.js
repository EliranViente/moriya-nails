/* ═══════════════════════════════════════════
   MORIYA NAILS – Admin Dashboard
   Stats, charts, availability & appointment management.
   Access is restricted to admin emails (see auth.js).
═══════════════════════════════════════════ */

const API_BASE = window.location.hostname === 'localhost'
  ? 'http://localhost:3001'
  : '';

// Each open working window is sliced into bookable appointments of this length.
const SLOT_LEN = 90; // minutes (1.5h)

// ─── Small helpers ────────────────────────────────────────────────────────────
const pad = n => String(n).padStart(2, '0');
const toMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const fromMin = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

function todayStr() {
  const n = new Date();
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
}
function dateStrOffset(days) {
  const n = new Date(); n.setDate(n.getDate() + days);
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
}
function fmtDate(dateStr) {
  const [Y, M, D] = dateStr.split('-');
  return `${D}/${M}/${Y}`;
}
const HE_DOW = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
function dowLabel(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return HE_DOW[d.getDay()];
}
function ils(n) { return Math.round(n).toLocaleString('he-IL') + ' ₪'; }

// Hebrew labels for the appointment statuses stored in the database.
const STATUS_HE = { booked: 'מאושר', done: 'בוצע', cancelled: 'בוטל', no_show: 'לא הגיעה' };

// ─── WhatsApp reminders ───────────────────────────────────────────────────────
// Venue details echoed inside the reminder message.
const VENUE_ADDR = 'יעקב בר סימנטוב 18';
const VENUE_MAPS = 'https://www.google.com/maps/search/?api=1&query=%D7%99%D7%A2%D7%A7%D7%91%20%D7%91%D7%A8%20%D7%A1%D7%99%D7%9E%D7%A0%D7%98%D7%95%D7%91%2018';

// Normalize an Israeli phone (e.g. "050-123 4567") to WhatsApp's intl form "9725…".
function waPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('972')) return d;
  if (d.startsWith('0')) return '972' + d.slice(1);
  return '972' + d;
}

// Emojis are written as ASCII-only \u{…} escapes (not raw characters) so no
// editor, deploy tool, or proxy in the chain can re-encode and corrupt them —
// they were showing up as “�” in the delivered WhatsApp reminder. The runtime
// string is byte-for-byte identical to the literal emoji.
const EMO = {
  heart:    '\u{1F495}',                          // 💕
  polish:   '\u{1F485}\u{2728}',                  // 💅✨
  calendar: '\u{1F4C5}',                          // 📅
  clock:    '\u{23F0}',                           // ⏰
  facial:   '\u{1F486}\u{200D}\u{2640}\u{FE0F}',  // 💆‍♀️
  hourglass:'\u{23F3}',                           // ⏳
  money:    '\u{1F4B0}',                          // 💰
  pin:      '\u{1F4CD}',                          // 📍
  parking:  '\u{1F17F}\u{FE0F}',                  // 🅿️
  sparkH:   '\u{1F497}',                          // 💗
};

// A warm, on-brand reminder message carrying the appointment's details.
function reminderText(appt) {
  const svc = (appt.services || []).map(s => s.name).join(' · ') || "מניקור לק ג'ל";
  const time = (appt.start_time || '').slice(0, 5);
  return [
    `שלום ${appt.client_name} ${EMO.heart}`,
    ``,
    `רק תזכורת קטנה לתור שלך ב-Moriya Nails ${EMO.polish}`,
    ``,
    `${EMO.calendar} ${dowLabel(appt.date)} · ${fmtDate(appt.date)}`,
    `${EMO.clock} ${time}`,
    `${EMO.facial} ${svc}`,
    `${EMO.hourglass} משך משוער: ${appt.duration_min} דק׳`,
    `${EMO.money} לתשלום: ${ils(Number(appt.total_price || 0))}`,
    ``,
    `${EMO.pin} ${VENUE_ADDR}`,
    `${EMO.parking} הגעה וחניה: ${VENUE_MAPS}`,
    ``,
    `מחכה לראות אותך ${EMO.sparkH}`,
  ].join('\n');
}

// Click-to-chat link that opens the admin's own WhatsApp with the message ready.
function waReminderLink(appt) {
  const phone = waPhone(appt.client_phone);
  if (!phone) return '';
  return `https://wa.me/${phone}?text=${encodeURIComponent(reminderText(appt))}`;
}

function sendReminder(id) {
  const appt = dash.appointments.find(a => String(a.id) === String(id));
  if (!appt) return;
  const url = waReminderLink(appt);
  if (!url) { alert('אין מספר טלפון תקין ללקוחה זו 🙈'); return; }
  window.open(url, '_blank', 'noopener');
}

// ─── "I changed your appointment" notices ─────────────────────────────────────
// Appointments Moriya moved or cancelled during this session. Those are the two
// changes a client can't see coming, so they — and only they — offer a WhatsApp
// notice alongside the usual reminder, until the dashboard is reloaded.
const movedAppts     = new Set();
const cancelledAppts = new Set();

function moveText(appt) {
  const time = (appt.start_time || '').slice(0, 5);
  return `${appt.client_name} אהובה, הזזתי את התור שלך ל-${fmtDate(appt.date)} בשעה ${time} ${EMO.heart}`;
}

function cancelNoticeText(appt) {
  const time = (appt.start_time || '').slice(0, 5);
  return `${appt.client_name} אהובה, ביטלתי את התור שלך ב-${fmtDate(appt.date)} בשעה ${time} ${EMO.heart}`;
}

function waLink(appt, text) {
  const phone = waPhone(appt.client_phone);
  if (!phone) return '';
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

function openNotice(id, build) {
  const appt = dash.appointments.find(a => String(a.id) === String(id));
  if (!appt) return;
  const url = waLink(appt, build(appt));
  if (!url) { alert('אין מספר טלפון תקין ללקוחה זו 🙈'); return; }
  window.open(url, '_blank', 'noopener');
}

const sendMoveNotice   = id => openNotice(id, moveText);
const sendCancelNotice = id => openNotice(id, cancelNoticeText);

// Offered the moment the cancellation goes through, while Moriya is still on it.
async function offerCancelNotice(appt) {
  if (!waPhone(appt.client_phone)) return;
  const send = await confirmDialog({
    icon:        '💬',
    title:       'להודיע ללקוחה?',
    message:     cancelNoticeText(appt),
    confirmText: 'שלחי בוואטסאפ',
    cancelText:  'לא עכשיו',
    tone:        'safe',
  });
  if (send) sendCancelNotice(appt.id);
}

async function getAccessToken() {
  try {
    const { data } = await MoriyaAuth.sb.auth.getSession();
    return (data && data.session && data.session.access_token) || null;
  } catch { return null; }
}

// ─── Auth gate ────────────────────────────────────────────────────────────────
function waitForAuth() {
  return new Promise(resolve => {
    if (window.MoriyaAuth && MoriyaAuth.ready) return resolve();
    const t = setInterval(() => {
      if (window.MoriyaAuth && MoriyaAuth.ready) { clearInterval(t); resolve(); }
    }, 60);
  });
}

async function bootstrap() {
  await waitForAuth();
  const gate = document.getElementById('admin-gate');
  const msg = document.getElementById('gate-msg');
  const actions = document.getElementById('gate-actions');

  if (!MoriyaAuth.isLoggedIn()) {
    msg.textContent = 'יש להתחבר כדי לגשת ללוח הניהול';
    actions.style.display = 'flex';
    actions.innerHTML = '<button class="admin-btn primary" id="gate-login">התחברות עם Google</button>';
    document.getElementById('gate-login').addEventListener('click', () => MoriyaAuth.signIn());
    return;
  }
  if (!MoriyaAuth.isAdmin()) {
    msg.textContent = 'אין לך הרשאת גישה ללוח הניהול 🔒';
    actions.style.display = 'flex';
    actions.innerHTML = '<a class="admin-btn ghost" href="index.html">← חזרה לאתר</a>';
    return;
  }

  // Authorized — reveal the dashboard.
  gate.style.display = 'none';
  document.getElementById('admin-app').style.display = 'block';
  document.getElementById('admin-who').textContent = `שלום ${MoriyaAuth.firstName() || ''} 👋`;
  document.getElementById('admin-logout').addEventListener('click', () => MoriyaAuth.signOut());

  initDashboard();
}

const HE_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const HE_DAY_NAMES = ["א'","ב'","ג'","ד'","ה'","ו'","ש'"];

// ─── Dashboard state ──────────────────────────────────────────────────────────
const dash = {
  appointments: [],   // all appointments (admin sees everything via RLS)
  clients: [],        // all client profiles (admin sees everything via RLS)
  clientsCount: 0,
  clientsQuery: '',   // live search filter for the clients table
  clientsEditing: false,  // edit mode: permissions and removal are live only while on
  chartRange: 30,
  apptFilter: 'upcoming',   // 'upcoming' | 'all' | 'cancelled'
  apptWindow: 'all',        // upcoming time window: 'all' | '24h' | 'week' | 'month'
  charts: {},         // Chart.js instances
};

// Availability calendar state
let adminSelDate  = null;
let adminCalYear  = new Date().getFullYear();
let adminCalMonth = new Date().getMonth();
let dashDayRows   = [];   // raw availability rows for the selected day
let dashDay       = {};   // the selected day, as read by the shared schedule model

async function initDashboard() {
  await Promise.all([loadAppointments(), loadClients()]);
  renderKPIs();
  renderCharts();
  renderAppointments();
  renderClients();
  populateTimeSelects();
  wireAvailabilityEditor();
  wireControls();
  wireClientsControls();

  // Open on the day Moriya is most likely to be looking for: today when she is
  // working, otherwise the next day she has hours for.
  adminSelDate = await nextWorkDay(todayStr());
  const [y, m] = adminSelDate.split('-').map(Number);
  adminCalYear = y; adminCalMonth = m - 1;
  setEditorTime('start', '09:00');
  setEditorTime('end', '18:00');
  await renderAdminCalendar();
  selectAdminDate(adminSelDate);
}

function nextFridayStr() {
  const d = new Date();
  d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// The first day from `startStr` onwards with working hours — a Friday by
// default, or any day Moriya opened. A month's availability is read once and
// reused, so this costs one query in the ordinary case. If she has nothing on
// the books for months, fall back to the coming Friday.
async function nextWorkDay(startStr) {
  const d = new Date(`${startStr}T00:00:00`);
  const months = new Map();
  for (let i = 0; i < 120; i++) {
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (!months.has(key)) months.set(key, await getMonthDayStates(d.getFullYear(), d.getMonth()));
    const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (effectiveOpen(dateStr, months.get(key).get(dateStr)).length) return dateStr;
    d.setDate(d.getDate() + 1);
  }
  return nextFridayStr();
}

// ─── Availability calendar ────────────────────────────────────────────────────
// The per-day model itself lives in js/schedule.js, shared with the public site,
// so the day Moriya sees here is sliced exactly the way clients are offered it:
// Fridays open 09:00–18:00 by default, slots on a 90-min grid that real
// appointment lengths push forward, a fixed 10:30–11:15 break that a long
// appointment may bite into, and a floating 15-min afternoon break that gets
// pushed later instead.
const isFridayStr = MoriyaSchedule.isFriday;

// The effective open windows for a day, applying the Friday default.
const effectiveOpen = MoriyaSchedule.openWindows;

// Group a month's availability rows by date → the shared day shape.
async function getMonthDayStates(year, month /* 0-based */) {
  const first   = `${year}-${pad(month + 1)}-01`;
  const lastNum = new Date(year, month + 1, 0).getDate();
  const last    = `${year}-${pad(month + 1)}-${pad(lastNum)}`;
  const byDate = new Map();
  try {
    const { data } = await MoriyaAuth.sb
      .from('availability').select('id,date,start_time,end_time,kind').gte('date', first).lte('date', last);
    const rowsByDate = new Map();
    (data || []).forEach(r => {
      if (!rowsByDate.has(r.date)) rowsByDate.set(r.date, []);
      rowsByDate.get(r.date).push(r);
    });
    rowsByDate.forEach((rows, date) => byDate.set(date, MoriyaSchedule.readRows(rows)));
  } catch (e) { /* defaults still apply */ }
  return byDate;
}

async function renderAdminCalendar() {
  const box   = document.getElementById('admin-cal-box');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const states = await getMonthDayStates(adminCalYear, adminCalMonth);

  const firstDow    = new Date(adminCalYear, adminCalMonth, 1).getDay();
  const daysInMonth = new Date(adminCalYear, adminCalMonth + 1, 0).getDate();

  let html = `
    <div class="cal-header">
      <button class="cal-nav" id="admin-cal-prev">›</button>
      <h4>${HE_MONTHS[adminCalMonth]} ${adminCalYear}</h4>
      <button class="cal-nav" id="admin-cal-next">‹</button>
    </div>
    <div class="cal-grid">
      ${HE_DAY_NAMES.map(d => `<div class="cal-day-name">${d}</div>`).join('')}`;
  for (let i = 0; i < firstDow; i++) html += '<div class="cal-day empty"></div>';
  // The admin calendar itself is unlimited; days past the clients' rolling
  // window are still fully editable, just flagged as not-yet-offered.
  const horizonStr = MoriyaBooking.horizonStr();

  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(adminCalYear, adminCalMonth, day);
    const dateStr = `${adminCalYear}-${pad(adminCalMonth + 1)}-${pad(day)}`;
    const isPast = d < today;
    const info = states.get(dateStr);
    let cls = 'cal-day';
    if (isPast) cls += ' past';
    else cls += ' friday-avail';                 // any non-past day is selectable
    if (dateStr === adminSelDate) cls += ' selected';
    if (info && info.closed) cls += ' is-closed';
    else if (effectiveOpen(dateStr, info).length) cls += ' has-windows';
    let title = '';
    if (!isPast && dateStr > horizonStr) {
      cls += ' beyond-horizon';
      title = ` title="ייפתח ללקוחות ב-${fmtDate(MoriyaBooking.visibleFrom(dateStr))}"`;
    }
    html += `<div class="${cls}" ${isPast ? '' : `data-date="${dateStr}"`}${title}>${day}</div>`;
  }
  html += '</div>';
  box.innerHTML = html;

  document.getElementById('admin-cal-prev').addEventListener('click', () => {
    adminCalMonth--; if (adminCalMonth < 0) { adminCalMonth = 11; adminCalYear--; } renderAdminCalendar();
  });
  document.getElementById('admin-cal-next').addEventListener('click', () => {
    adminCalMonth++; if (adminCalMonth > 11) { adminCalMonth = 0; adminCalYear++; } renderAdminCalendar();
  });
  box.querySelectorAll('.cal-day[data-date]').forEach(c =>
    c.addEventListener('click', () => selectAdminDate(c.dataset.date)));
}

function selectAdminDate(dateStr) {
  adminSelDate = dateStr;
  const sel = document.getElementById('avail-selected');
  if (sel) sel.textContent = `📅 ${dowLabel(dateStr)} · ${fmtDate(dateStr)}`;
  document.querySelectorAll('#admin-cal-box .cal-day').forEach(c => c.classList.remove('selected'));
  const cell = document.querySelector(`#admin-cal-box .cal-day[data-date="${dateStr}"]`);
  if (cell) cell.classList.add('selected');
  updateAvailPreview();
  loadDayWindows(dateStr);
}

// ─── Time selects (hour on the left, minutes on the right) ─────────────────────
function populateTimeSelects() {
  const hours = [];
  for (let h = 6; h <= 23; h++) hours.push(pad(h));
  const mins = ['00', '15', '30', '45'];
  // Moving a single appointment or a break is finer work than setting the day's
  // hours, so those pickers step by five minutes.
  const mins5 = [];
  for (let m = 0; m < 60; m += 5) mins5.push(pad(m));

  document.querySelectorAll('.ts-hour').forEach(sel => {
    sel.innerHTML = hours.map(h => `<option value="${h}">${h}</option>`).join('');
  });
  document.querySelectorAll('.ts-min').forEach(sel => {
    sel.innerHTML = mins.map(m => `<option value="${m}">${m}</option>`).join('');
  });
  document.querySelectorAll('.ts-min5').forEach(sel => {
    sel.innerHTML = mins5.map(m => `<option value="${m}">${m}</option>`).join('');
  });
}

// ─── Shared time-picker modal ─────────────────────────────────────────────────
// Used wherever the day view needs one time (moving a free slot) or a range
// (changing a break). `onSave` returns an error message to show, or null when
// it saved and the modal should close.
let tmSave = null;

function openTimeModal({ title, sub, hint, startLabel, endLabel, start, end, withEnd, onSave }) {
  const modal = document.getElementById('tm-modal');
  document.getElementById('tm-title').textContent = title;
  document.getElementById('tm-sub').innerHTML =
    `${sub || ''}${hint ? `<br/><span class="tm-hint">${hint}</span>` : ''}`;
  document.getElementById('tm-start-label').textContent = startLabel || 'משעה';
  document.getElementById('tm-end-label').textContent   = endLabel   || 'עד שעה';
  document.getElementById('tm-end-field').style.display = withEnd ? '' : 'none';

  setTimeSelect('tm-start', start);
  setTimeSelect('tm-end', typeof end === 'number' ? end : start + 15);

  const fb = document.getElementById('tm-feedback');
  fb.textContent = ''; fb.className = 'avail-feedback';

  tmSave = async () => {
    const s = readTimeSelect('tm-start');
    const e = withEnd ? readTimeSelect('tm-end') : null;
    const btn = document.getElementById('tm-save');
    btn.disabled = true; btn.textContent = 'שומרת…';
    const err = await onSave(s, e);
    btn.disabled = false; btn.textContent = 'שמירה';

    if (err === null) { closeTimeModal(); return; }
    fb.textContent = err || '';
    fb.className = err ? 'avail-feedback err' : 'avail-feedback';
  };

  modal.style.display = 'flex';
}

function closeTimeModal() {
  document.getElementById('tm-modal').style.display = 'none';
  tmSave = null;
}

function setTimeSelect(prefix, minutes) {
  // The hour list starts at 06:00 — keep the value inside what it offers.
  const m = Math.max(6 * 60, Math.min(23 * 60 + 55, Math.round(minutes / 5) * 5));
  document.getElementById(`${prefix}-h`).value = pad(Math.floor(m / 60));
  document.getElementById(`${prefix}-m`).value = pad(m % 60);
}

function readTimeSelect(prefix) {
  return toMin(`${document.getElementById(`${prefix}-h`).value}:${document.getElementById(`${prefix}-m`).value}`);
}
function getEditorTime(which) {
  return `${document.getElementById(`${which}-h`).value}:${document.getElementById(`${which}-m`).value}`;
}
function setEditorTime(which, hhmm) {
  const [h, m] = hhmm.split(':');
  const hs = document.getElementById(`${which}-h`);
  const ms = document.getElementById(`${which}-m`);
  if (hs) hs.value = h;
  if (ms) ms.value = m;
}

// ─── Data loading ─────────────────────────────────────────────────────────────
async function loadAppointments() {
  const { data, error } = await MoriyaAuth.sb
    .from('appointments')
    .select('*')
    .order('date', { ascending: true })
    .order('start_time', { ascending: true });
  if (error) { console.warn('loadAppointments:', error.message); dash.appointments = []; return; }
  dash.appointments = data || [];
}

async function loadClients() {
  const { data, error } = await MoriyaAuth.sb
    .from('profiles')
    .select('id, full_name, phone, email, last_appointment, last_login, created_at, feet_gel_allowed')
    // Newest sign-ups on top, the longest-standing clients at the bottom.
    .order('created_at', { ascending: false, nullsFirst: false });
  if (error) { console.warn('loadClients:', error.message); dash.clients = []; }
  else dash.clients = data || [];
  dash.clientsCount = dash.clients.length;
}

// ─── KPI cards ────────────────────────────────────────────────────────────────
function renderKPIs() {
  const today = todayStr();
  const active = dash.appointments.filter(a => a.status !== 'cancelled');

  const upcoming = active.filter(a => a.date >= today).length;

  const since = dateStrOffset(-30);
  const last30 = active.filter(a => a.date >= since && a.date <= today);
  const revenue30 = last30.reduce((s, a) => s + Number(a.total_price || 0), 0);
  const workingDays = new Set(last30.map(a => a.date)).size;
  const avgPerDay = workingDays ? revenue30 / workingDays : 0;

  document.getElementById('kpi-clients').textContent = dash.clientsCount;
  document.getElementById('kpi-upcoming').textContent = upcoming;
  document.getElementById('kpi-revenue').textContent = ils(revenue30);
  document.getElementById('kpi-avg').textContent = ils(avgPerDay);
}

// ─── Charts ───────────────────────────────────────────────────────────────────
// Aggregate active appointments by date inside the selected window.
function aggregateByDay(range) {
  const from = dateStrOffset(-range);
  const to = dateStrOffset(range);
  const map = new Map(); // date -> { revenue, clients }
  dash.appointments
    .filter(a => a.status !== 'cancelled' && a.date >= from && a.date <= to)
    .forEach(a => {
      const e = map.get(a.date) || { revenue: 0, clients: 0 };
      e.revenue += Number(a.total_price || 0);
      e.clients += 1;
      map.set(a.date, e);
    });
  const dates = [...map.keys()].sort();
  return {
    labels: dates.map(d => fmtDate(d).slice(0, 5)), // dd/mm
    revenue: dates.map(d => map.get(d).revenue),
    clients: dates.map(d => map.get(d).clients),
    empty: dates.length === 0,
  };
}

function renderCharts() {
  const agg = aggregateByDay(dash.chartRange);
  const pink = '#e85880', pinkSoft = 'rgba(232,88,128,0.18)', gold = '#c9966c';

  const baseOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#fff', titleColor: '#333', bodyColor: '#555',
        borderColor: pink, borderWidth: 1, padding: 10,
        titleFont: { family: 'Heebo' }, bodyFont: { family: 'Heebo' },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { font: { family: 'Heebo', size: 11 }, color: '#9e9e9e' } },
      y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Heebo' }, color: '#9e9e9e', precision: 0 } },
    },
  };

  drawChart('chart-revenue', {
    type: 'bar',
    data: { labels: agg.labels, datasets: [{ label: 'הכנסות', data: agg.revenue, backgroundColor: pinkSoft, borderColor: pink, borderWidth: 1.5, borderRadius: 8, maxBarThickness: 38 }] },
    options: { ...baseOpts, plugins: { ...baseOpts.plugins, tooltip: { ...baseOpts.plugins.tooltip, callbacks: { label: c => ` ${ils(c.parsed.y)}` } } } },
  }, agg.empty);

  drawChart('chart-clients', {
    type: 'bar',
    data: { labels: agg.labels, datasets: [{ label: 'לקוחות', data: agg.clients, backgroundColor: 'rgba(201,150,108,0.18)', borderColor: gold, borderWidth: 1.5, borderRadius: 8, maxBarThickness: 38 }] },
    options: { ...baseOpts, plugins: { ...baseOpts.plugins, tooltip: { ...baseOpts.plugins.tooltip, callbacks: { label: c => ` ${c.parsed.y} לקוחות` } } } },
  }, agg.empty);
}

function drawChart(canvasId, config, empty) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (dash.charts[canvasId]) { dash.charts[canvasId].destroy(); dash.charts[canvasId] = null; }
  const wrap = canvas.parentElement;
  let emptyEl = wrap.querySelector('.chart-empty');
  if (empty) {
    canvas.style.display = 'none';
    if (!emptyEl) {
      emptyEl = document.createElement('div');
      emptyEl.className = 'chart-empty';
      emptyEl.textContent = 'אין עדיין נתונים לתקופה זו';
      wrap.appendChild(emptyEl);
    }
    return;
  }
  if (emptyEl) emptyEl.remove();
  canvas.style.display = 'block';
  dash.charts[canvasId] = new Chart(canvas.getContext('2d'), config);
}

// ─── Excel export ─────────────────────────────────────────────────────────────
// The workbook mirrors everything at the top of the dashboard: the KPI cards,
// both charts, and the appointments behind them. Every time window offered by
// the range tabs (week, 30 days, …) is carried into each sheet where it means
// something — as its own summary row, and as a "טווח" column that lets Moriya
// filter the day/appointment sheets down to any of those same windows.

// The range tabs in admin.html are the single source of truth for the windows,
// so renaming or adding a tab there flows straight into the workbook.
const FALLBACK_RANGES = [
  { days: 7, label: 'שבוע' }, { days: 30, label: '30 ימים' }, { days: 90, label: '90 ימים' },
  { days: 180, label: 'חצי שנה' }, { days: 365, label: 'שנה' },
];

function rangeOptions() {
  const tabs = [...document.querySelectorAll('#range-tabs .range-tab')]
    .map(t => ({ days: Number(t.dataset.range), label: t.textContent.trim() }))
    .filter(r => r.days > 0 && r.label)
    .sort((a, b) => a.days - b.days);
  return tabs.length ? tabs : FALLBACK_RANGES;
}

// Charts span today ± range, so the export uses the very same window.
function rangeWindow(days) {
  return { from: dateStrOffset(-days), to: dateStrOffset(days) };
}

// The narrowest window containing this date. Every wider window contains it too,
// so a single column is enough to filter the sheet by any of the tabs.
function rangeLabelFor(dateStr, ranges) {
  for (const r of ranges) {
    const w = rangeWindow(r.days);
    if (dateStr >= w.from && dateStr <= w.to) return r.label;
  }
  return 'מחוץ לטווח';
}

// Sheet 1, top block – the four KPI cards, computed exactly like renderKPIs().
function exportKpiRows() {
  const today = todayStr();
  const active = dash.appointments.filter(a => a.status !== 'cancelled');
  const last30 = active.filter(a => a.date >= dateStrOffset(-30) && a.date <= today);
  const revenue30 = last30.reduce((s, a) => s + Number(a.total_price || 0), 0);
  const workingDays = new Set(last30.map(a => a.date)).size;
  return [
    { 'מדד': 'לקוחות רשומות', 'ערך': dash.clientsCount },
    { 'מדד': 'תורים עתידיים', 'ערך': active.filter(a => a.date >= today).length },
    { 'מדד': 'הכנסות (30 ימים אחרונים) ₪', 'ערך': revenue30 },
    { 'מדד': 'ממוצע ליום עבודה ₪', 'ערך': workingDays ? Math.round(revenue30 / workingDays) : 0 },
  ];
}

// Sheet 1, bottom block – one row per range tab, so all the windows sit
// side by side instead of only the one currently selected on screen.
function exportRangeRows(ranges) {
  const active = dash.appointments.filter(a => a.status !== 'cancelled');
  return ranges.map(r => {
    const w = rangeWindow(r.days);
    const inRange = active.filter(a => a.date >= w.from && a.date <= w.to);
    const revenue = inRange.reduce((s, a) => s + Number(a.total_price || 0), 0);
    const days = new Set(inRange.map(a => a.date)).size;
    return {
      'טווח': r.label,
      'מתאריך': fmtDate(w.from),
      'עד תאריך': fmtDate(w.to),
      'ימי עבודה': days,
      'תורים': inRange.length,
      'סה"כ הכנסות ₪': revenue,
      'ממוצע ליום עבודה ₪': days ? Math.round(revenue / days) : 0,
      'ממוצע לתור ₪': inRange.length ? Math.round(revenue / inRange.length) : 0,
    };
  });
}

// Sheet 2 – the numbers plotted in the two charts, one row per working day.
function exportDayRows(ranges) {
  const map = new Map(); // date -> { revenue, clients }
  dash.appointments
    .filter(a => a.status !== 'cancelled')
    .forEach(a => {
      const e = map.get(a.date) || { revenue: 0, clients: 0 };
      e.revenue += Number(a.total_price || 0);
      e.clients += 1;
      map.set(a.date, e);
    });
  return [...map.keys()].sort().map(d => ({
    'תאריך': fmtDate(d),
    'יום בשבוע': dowLabel(d),
    'לקוחות': map.get(d).clients,
    'הכנסות ₪': map.get(d).revenue,
    'טווח': rangeLabelFor(d, ranges),
  }));
}

// Sheet 3 – every appointment on record, cancelled ones included and marked,
// so nothing is lost even though the aggregates above leave them out.
function exportApptRows(ranges) {
  return dash.appointments
    .slice()
    .sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time))
    .map(a => ({
      'תאריך': fmtDate(a.date),
      'יום בשבוע': dowLabel(a.date),
      'שעה': (a.start_time || '').slice(0, 5),
      'שם הלקוחה': a.client_name || '',
      'טלפון': a.client_phone || '',
      'טיפולים': (a.services || []).map(s => s.name).join(' · '),
      'משך (דק׳)': Number(a.duration_min || 0),
      'מחיר ₪': Number(a.total_price || 0),
      'סטטוס': STATUS_HE[a.status] || a.status,
      'הערות': a.notes || '',
      'נקבע בתאריך': a.created_at ? fmtDate(String(a.created_at).slice(0, 10)) : '',
      'טווח': rangeLabelFor(a.date, ranges),
    }));
}

function colWidths(widths) { return widths.map(wch => ({ wch })); }

function exportToExcel() {
  if (typeof XLSX === 'undefined') {
    alert('לא הצלחתי לטעון את מנוע האקסל. בדקי את החיבור לאינטרנט ונסי שוב 🙈');
    return;
  }
  if (!dash.appointments.length) {
    alert('אין עדיין נתונים לייצוא 🌸');
    return;
  }

  const ranges = rangeOptions();
  const wb = XLSX.utils.book_new();
  // Open the workbook right-to-left, like the dashboard itself.
  wb.Workbook = { Views: [{ RTL: true }] };

  // ── Sheet 1: summary ──
  const summary = XLSX.utils.aoa_to_sheet([
    ['Moriya Nails · דוח הכנסות ותורים'],
    [`הופק בתאריך: ${fmtDate(todayStr())}`],
    ['תורים שבוטלו אינם נספרים בסיכומים, ומופיעים בגיליון "פירוט תורים" עם הסטטוס שלהם.'],
    [''],
    ['מדדים ראשיים (כמו בראש מסך הניהול)'],
  ]);
  XLSX.utils.sheet_add_json(summary, exportKpiRows(), { origin: -1 });
  XLSX.utils.sheet_add_aoa(summary, [[''], ['לפי טווח זמן (כמו בגרפים)']], { origin: -1 });
  XLSX.utils.sheet_add_json(summary, exportRangeRows(ranges), { origin: -1 });
  summary['!cols'] = colWidths([30, 14, 14, 12, 10, 16, 20, 14]);
  XLSX.utils.book_append_sheet(wb, summary, 'סיכום');

  // ── Sheet 2: per working day (the chart data) ──
  const days = XLSX.utils.json_to_sheet(exportDayRows(ranges));
  days['!cols'] = colWidths([14, 12, 10, 14, 12]);
  XLSX.utils.book_append_sheet(wb, days, 'לפי יום עבודה');

  // ── Sheet 3: appointment by appointment ──
  const appts = XLSX.utils.json_to_sheet(exportApptRows(ranges));
  appts['!cols'] = colWidths([14, 12, 8, 20, 15, 34, 12, 12, 12, 28, 14, 12]);
  XLSX.utils.book_append_sheet(wb, appts, 'פירוט תורים');

  XLSX.writeFile(wb, `moriya-nails-report-${todayStr()}.xlsx`);
}

// ─── Availability editor ──────────────────────────────────────────────────────
let editorKind = 'open';

function wireAvailabilityEditor() {
  document.querySelectorAll('#kind-toggle .kind-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#kind-toggle .kind-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      editorKind = btn.dataset.kind;
      updateAvailPreview();
    });
  });

  ['start-h', 'start-m', 'end-h', 'end-m'].forEach(id =>
    document.getElementById(id).addEventListener('change', updateAvailPreview));
  document.getElementById('avail-add').addEventListener('click', addAvailability);

  updateAvailPreview();
}

function updateAvailPreview() {
  const preview = document.getElementById('avail-preview');
  const start = toMin(getEditorTime('start'));
  const end = toMin(getEditorTime('end'));
  if (end <= start) { preview.textContent = '⚠ שעת הסיום חייבת להיות אחרי שעת ההתחלה'; preview.className = 'avail-preview warn'; return; }

  if (editorKind === 'block') {
    preview.className = 'avail-preview';
    preview.textContent = `⛔ ייחסם הזמן ${fromMin(start)}–${fromMin(end)} (לא יוצעו בו תורים).`;
    return;
  }

  // Account for the breaks already defined on the selected day.
  const slots = sliceSlots(start, end);
  preview.className = 'avail-preview';
  if (slots.length === 0) {
    preview.textContent = 'החלון קצר מ-90 דקות — לא ייווצר אף תור.';
    return;
  }
  // Base-90 estimate; real start times shift with each appointment's length.
  const brk = MoriyaSchedule.dayBreaks(adminSelDate || '', dashDay);
  let txt = `🟢 עד ${slots.length} תורים (הערכה לפי 90 דק'): ${slots.map(fromMin).join(' · ')}`;
  if (brk.big || brk.float || (dashDay.block || []).length) {
    txt += ' — מתחשב בהפסקות; הזמנים בפועל זזים לפי אורך כל תור';
  }
  preview.textContent = txt;
}

// Base-90 start times inside [start, end) on the selected day, sliced by the
// same rules clients get — so the estimate here can't drift from the real day.
function sliceSlots(start, end) {
  const brk = MoriyaSchedule.dayBreaks(adminSelDate || '', dashDay);
  return MoriyaSchedule.anchors({ start, end }, brk.big, brk.float, dashDay.block || [])
    .filter(m => m + SLOT_LEN <= end);
}

async function addAvailability() {
  const date = adminSelDate;
  const start = getEditorTime('start');
  const end = getEditorTime('end');
  const fb = document.getElementById('avail-feedback');

  if (!date) { fb.textContent = 'בחרי תאריך מהלוח'; fb.className = 'avail-feedback err'; return; }
  if (toMin(end) <= toMin(start)) { fb.textContent = 'שעת הסיום חייבת להיות אחרי ההתחלה'; fb.className = 'avail-feedback err'; return; }

  const btn = document.getElementById('avail-add');
  btn.disabled = true; btn.textContent = 'מוסיפה…';

  // Opening hours on a day that was marked closed should re-open it first. A
  // window of her own also takes a Friday off the default schedule, so the
  // day's breaks are written out first and survive the change.
  if (editorKind === 'open') {
    await materializeBreaks(date);
    await MoriyaAuth.sb.from('availability').delete().eq('date', date).eq('kind', 'closed');
  }
  const { error } = await MoriyaAuth.sb.from('availability').insert({
    date, start_time: start, end_time: end, kind: editorKind,
  });

  btn.disabled = false; btn.textContent = 'הוספה ליום';
  if (error) { fb.textContent = 'שגיאה: ' + error.message; fb.className = 'avail-feedback err'; return; }
  fb.textContent = '✓ נוסף בהצלחה'; fb.className = 'avail-feedback ok';
  loadDayWindows(date);
  renderAdminCalendar();   // refresh the day markers
}

async function loadDayWindows(date) {
  const title = document.getElementById('avail-day-title');
  const list  = document.getElementById('avail-windows');
  const delDayBtn = document.getElementById('avail-del-day');
  if (!date) { title.textContent = 'בחרי תאריך לצפייה'; list.innerHTML = ''; delDayBtn.style.display = 'none'; return; }
  title.textContent = `${dowLabel(date)} · ${fmtDate(date)}`;
  list.innerHTML = '<div class="slots-loading"><div class="spinner"></div></div>';

  const { data, error } = await MoriyaAuth.sb
    .from('availability')
    .select('*')
    .eq('date', date)
    .order('start_time', { ascending: true });

  if (error) { list.innerHTML = '<p class="avail-empty">שגיאה בטעינה</p>'; delDayBtn.style.display = 'none'; return; }

  dashDayRows = data || [];
  dashDay     = MoriyaSchedule.readRows(dashDayRows);
  updateAvailPreview();   // the preview now reflects this day's breaks

  // Everything set here is saved right away; it just isn't offered to clients
  // until the rolling two-month window reaches this date.
  const note = MoriyaBooking.isWithin(date) ? '' :
    `<div class="day-horizon-note">👀 היום הזה עדיין לא מוצג ללקוחות — הוא ייפתח לקביעת תורים ב-${fmtDate(MoriyaBooking.visibleFrom(date))},
     חודשיים לפני המועד. השעות שתגדירי כאן יישמרו ויופיעו אוטומטית באותו יום.</div>`;

  // Day explicitly marked closed.
  if (dashDay.closed) {
    list.innerHTML = `${note}
      <div class="day-closed">🚫 היום הזה סגור — לא מוצעים בו תורים.</div>
      <button class="admin-btn ghost full" id="reopen-day">↩ החזירי שעות עבודה</button>`;
    document.getElementById('reopen-day').onclick = () => reopenDay(date);
    delDayBtn.style.display = 'none';
    return;
  }

  const wins = MoriyaSchedule.openWindows(date, dashDay);
  if (!wins.length && !dashDay.block.length) {
    list.innerHTML = `${note}<p class="avail-empty">אין שעות עבודה ליום זה.<br/>הוסיפי חלון עבודה כדי לפתוח תורים.</p>`;
    delDayBtn.style.display = 'none';
    return;
  }

  const items = buildDayItems(date);
  list.innerHTML = note + renderDaySummary(date, wins, items) + renderDayTimeline(date, items, wins);
  delDayBtn.style.display = wins.length ? '' : 'none';
  delDayBtn.onclick = () => deleteDay(date);
  wireDayActions(list, date);
}

// The headline: the hours Moriya is actually booked for, and what's still open.
function renderDaySummary(date, wins, items) {
  if (!wins.length) return '';   // a day with breaks but no working hours
  const booked = items.filter(i => i.kind === 'appt');
  const open   = items.filter(i => i.kind === 'free' && !isPastMin(date, i.start));
  const free   = open.filter(i => i.full);
  // The shortest treatment on the menu is an hour (the feet gel polish), so a
  // leftover that long is still worth something even if no full slot fits in it.
  const gaps   = open.filter(i => !i.full && i.end - i.start >= 60);

  const hours = booked.length
    ? `<strong dir="ltr">${fromMin(Math.min(...booked.map(b => b.start)))}–${fromMin(Math.max(...booked.map(b => b.end)))}</strong>`
    : '<strong class="win-none">טרם נקבעו תורים</strong>';
  const left = free.length === 1 ? 'נותר תור פנוי אחד'
             : free.length ? `נותרו ${free.length} תורים פנויים`
             : 'לא נותרו תורים פנויים';
  const shortTxt = gaps.length === 1 ? 'רווח לטיפול קצר'
                 : gaps.length ? `${gaps.length} רווחים לטיפול קצר` : '';

  // Windows Moriya added herself can be removed one by one; the Friday default
  // has no row of its own, and goes through "בטלי יום".
  const chips = wins.filter(w => w.id).map(w =>
    `<button class="win-del" data-id="${w.id}"><span dir="ltr">${fromMin(w.start)}–${fromMin(w.end)}</span> ✕</button>`).join('');

  return `<div class="avail-win open">
    <div class="win-head"><span class="win-badge open">🟢 עבודה</span>${hours}</div>
    <span class="win-slots">${left}${shortTxt ? ` · <span class="win-short">${shortTxt}</span>` : ''}</span>
    ${chips ? `<div class="win-chips">${chips}</div>` : ''}
  </div>`;
}

// ─── The day, hour by hour ────────────────────────────────────────────────────
// One row per stretch of the day, in order: every booked appointment, every slot
// still waiting for a client, and every break — each with the two things Moriya
// can do to it, cancel and move.

// Has this point in the day already gone by?
function isPastMin(date, minutes) {
  const today = todayStr();
  if (date < today) return true;
  if (date > today) return false;
  const now = new Date();
  return minutes <= now.getHours() * 60 + now.getMinutes();
}

// The selected day as an ordered list of stretches. Cancelled appointments free
// their time up, so they leave no row behind.
function buildDayItems(date) {
  const appts = dash.appointments
    .filter(a => a.date === date && a.status !== 'cancelled')
    .map(a => {
      const start = toMin((a.start_time || '00:00').slice(0, 5));
      return { key: `appt-${a.id}`, kind: 'appt', start, end: start + (Number(a.duration_min) || 0), appt: a };
    });
  return MoriyaSchedule.dayTimeline(date, dashDay, appts);
}

function renderDayTimeline(date, items, wins) {
  const rows = items.map(item => timelineRow(date, item, wins)).filter(Boolean);

  if (!rows.length) return '<p class="avail-empty">אין תורים או הפסקות ביום זה.</p>';
  return `<div class="day-timeline">
    <h4 class="dt-head">מהלך היום</h4>
    ${rows.join('')}
  </div>`;
}

// Every row is built the same way: the hours, a short label beside them, the
// buttons pinned to the far edge, and any long detail flowing onto its own line.
function dtRow(cls, item, label, actions, detail) {
  return `<div class="dt-row ${cls}">
    <span class="dt-time" dir="ltr">${fromMin(item.start)}–${fromMin(item.end)}</span>
    <span class="dt-label">${label}</span>
    <div class="dt-actions">${actions}</div>
    ${detail ? `<span class="dt-meta">${detail}</span>` : ''}
  </div>`;
}

function timelineRow(date, item, wins) {
  // A free slot is gone the moment its start passes — nobody can book it any
  // more. An appointment or a break is still live until it ends.
  const past = item.kind === 'free'
    ? isPastMin(date, item.start)
    : isPastMin(date, item.end);

  if (item.kind === 'appt') return apptTimelineRow(item);

  if (item.kind === 'free') {
    // Leftovers too short for a standard appointment are shown for context but
    // aren't slots anyone can take, so they carry no actions.
    if (!item.full) {
      const gap = item.end - item.start;
      return gap < 15 ? '' : dtRow('is-gap', item, `רווח ${gap} דק׳ · לטיפול קצר`, '');
    }
    const win     = item.win || wins[0] || { end: item.end };
    const actions = past ? '' : `
      <button class="dt-btn move" data-act="free-move"
              data-start="${item.start}" data-end="${item.end}" data-win-end="${win.end}">הזזה</button>
      <button class="dt-btn del" title="ביטול התור — השעה לא תוצע יותר ללקוחות" aria-label="ביטול התור"
              data-act="free-block" data-start="${item.start}" data-end="${item.end}">✕</button>`;
    return dtRow(`is-free${past ? ' is-past' : ''}`, item,
      '<span class="is-open">לא הוזמן עדיין</span>', actions);
  }

  return breakTimelineRow(item, past);
}

// A booked appointment is locked once it is over — done is done.
function apptTimelineRow(item) {
  const a       = item.appt;
  const svc     = (a.services || []).map(s => s.name).join(' · ') || "מניקור לק ג'ל";
  const locked  = isPastAppt(a);
  const outside = item.outside ? '<span class="dt-flag">מחוץ לשעות העבודה</span>' : '';
  // The notice button appears only for an appointment Moriya actually moved.
  const notify  = movedAppts.has(String(a.id)) && a.client_phone && !locked
    ? `<button class="dt-btn notify" data-act="appt-notify" data-id="${a.id}">💬</button>` : '';
  const actions = locked ? '' : `${notify}
    <button class="dt-btn move" data-act="appt-move" data-id="${a.id}">הזזה</button>
    <button class="dt-btn del" title="ביטול התור" aria-label="ביטול התור של ${escAttr(a.client_name)}"
            data-act="appt-cancel" data-id="${a.id}">✕</button>`;

  return dtRow(`is-appt${locked ? ' is-past' : ''}`, item,
    `<span class="dt-who">${escAttr(a.client_name)}</span>${outside}`, actions,
    `${escAttr(svc)} · ${a.duration_min} דק׳ · ${ils(Number(a.total_price || 0))}`);
}

function breakTimelineRow(item, past) {
  // Fixed: the break that always sits in the schedule, and any break Moriya put
  // there herself. Incidental: the floating one, which lands wherever the day's
  // appointments push it.
  const label = item.kind === 'float' ? '☕ הפסקה מזדמנת' : '⛔ הפסקה קבועה';
  // A break the day inherits from the Friday default has no row of its own yet;
  // editing or removing one writes this date's own rows (see materializeBreaks).
  const id      = (item.ref && item.ref.id) || item.id || '';
  const actions = past ? '' : `
    <button class="dt-btn move" data-act="brk-edit" data-brk="${item.kind}" data-id="${id}"
            data-start="${item.start}" data-end="${item.end}">שינוי</button>
    <button class="dt-btn del" title="ביטול ההפסקה" aria-label="ביטול ההפסקה"
            data-act="brk-del" data-brk="${item.kind}" data-id="${id}">✕</button>`;

  return dtRow(`is-break${past ? ' is-past' : ''}`, item, label, actions);
}

function wireDayActions(list, date) {
  list.querySelectorAll('.win-del').forEach(b =>
    b.addEventListener('click', () => deleteWindow(b.dataset.id, date)));

  list.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
    const d = b.dataset;
    switch (d.act) {
      case 'appt-cancel': return adminCancel(d.id);
      case 'appt-move':   return openReschedule(d.id, true);
      case 'appt-notify': return sendMoveNotice(d.id);
      case 'free-block':  return cancelFreeSlot(date, Number(d.start), Number(d.end));
      case 'free-move':   return moveFreeSlot(date, Number(d.start), Number(d.end), Number(d.winEnd));
      case 'brk-del':     return deleteBreak(date, d.brk, d.id);
      case 'brk-edit':    return editBreak(date, d.brk, d.id, Number(d.start), Number(d.end));
    }
  }));
}

// Re-read the selected day and repaint it along with the calendar markers.
async function refreshDayView() {
  if (adminSelDate) await loadDayWindows(adminSelDate);
  renderAdminCalendar();
}

// ─── Free slots: cancel and move ──────────────────────────────────────────────
// A slot nobody has booked is not an entity of its own — it is simply time the
// grid left open. So cancelling one blocks that time, and moving one blocks the
// stretch in front of it, which slides that slot (and everything after it) to
// the hour Moriya picked.

async function cancelFreeSlot(date, start, end) {
  const ok = await confirmDialog({
    icon:        '🚫',
    title:       'לבטל את התור הפנוי?',
    message:     `הזמן ${fromMin(start)}–${fromMin(end)} ייחסם ולא יוצע יותר ללקוחות. אפשר להחזיר אותו בכל רגע ממחיקת ההפסקה.`,
    confirmText: 'כן, בטלי את התור',
    cancelText:  'חזרה',
    tone:        'danger',
  });
  if (!ok) return;

  const { error } = await MoriyaAuth.sb.from('availability')
    .insert({ date, start_time: fromMin(start), end_time: fromMin(end), kind: 'block' });
  if (error) { alert('הביטול נכשל: ' + error.message); return; }
  refreshDayView();
}

function moveFreeSlot(date, start, end, winEnd) {
  openTimeModal({
    title:      'הזזת תור פנוי',
    sub:        `כרגע <span dir="ltr">${fromMin(start)}–${fromMin(end)}</span> · התור עוד לא הוזמן`,
    hint:       'קדימה בלבד. הזמן שלפני השעה החדשה ייחסם, והתורים הפנויים שאחריו יזוזו איתו.',
    startLabel: 'לשעה',
    start,
    onSave: async (newStart) => {
      if (newStart <= start) return 'אפשר להזיז תור פנוי רק לשעה מאוחרת יותר. כדי להקדים את תחילת היום שני את שעות העבודה.';
      if (newStart >= winEnd) return 'השעה שנבחרה מחוץ לשעות העבודה של היום.';

      // Try the change on paper first: with the gap blocked, is there still room
      // for a full appointment at that hour? If not, say so and let her decide.
      const probe = {
        ...dashDay,
        block: [...(dashDay.block || []), { start, end: newStart }],
      };
      const fits = MoriyaSchedule.availableStarts(SLOT_LEN, date, probe, apptIntervals(date)).includes(newStart);
      if (!fits) {
        const ok = await confirmDialog({
          icon:        '⚠️',
          title:       'לא נשאר מקום לתור מלא',
          message:     `בשעה ${fromMin(newStart)} אין ${SLOT_LEN} דקות פנויות עד ההפסקה או עד סוף היום, ולכן התור לא יוצע ללקוחות בשעה הזו.`,
          confirmText: 'בכל זאת, הזיזי',
          cancelText:  'חזרה',
          tone:        'danger',
        });
        if (!ok) return '';
      }

      const { error } = await MoriyaAuth.sb.from('availability')
        .insert({ date, start_time: fromMin(start), end_time: fromMin(newStart), kind: 'block' });
      if (error) return 'ההזזה נכשלה: ' + error.message;
      refreshDayView();
      return null;
    },
  });
}

// The day's booked time, as plain intervals.
function apptIntervals(date) {
  return dash.appointments
    .filter(a => a.date === date && a.status !== 'cancelled')
    .map(a => {
      const s = toMin((a.start_time || '00:00').slice(0, 5));
      return { start: s, end: s + (Number(a.duration_min) || 0) };
    });
}

// ─── Breaks: cancel and change ────────────────────────────────────────────────
// A break Moriya added is a row she can edit outright. The Friday defaults have
// no row until she touches them — the first change freezes that date's breaks
// into rows of its own, so every other Friday keeps the standard schedule.

async function materializeBreaks(date) {
  if (!MoriyaSchedule.usesDefaults(date, dashDay)) return true;

  const brk  = MoriyaSchedule.dayBreaks(date, dashDay);
  const rows = [{ date, start_time: '00:00', end_time: '00:00', kind: 'nodefault' }];
  if (brk.big) {
    rows.push({ date, start_time: fromMin(brk.big.start), end_time: fromMin(brk.big.end), kind: 'bigbreak' });
  }
  if (brk.float) {
    rows.push({
      date, kind: 'float',
      start_time: fromMin(brk.float.notBefore),
      end_time:   fromMin(brk.float.notBefore + brk.float.len),
    });
  }

  const { error } = await MoriyaAuth.sb.from('availability').insert(rows);
  if (error) { alert('שגיאה בשמירת ההפסקות ליום זה: ' + error.message); return false; }

  // Work from the rows that now exist, so the change lands on a real row.
  const { data } = await MoriyaAuth.sb.from('availability').select('*').eq('date', date);
  dashDayRows = data || [];
  dashDay     = MoriyaSchedule.readRows(dashDayRows);
  return true;
}

// The row behind a break in the timeline, materialising this date's own rows first.
async function breakRowId(date, brkKind, id) {
  if (id) return id;
  if (!(await materializeBreaks(date))) return null;
  const kindOf = { big: 'bigbreak', float: 'float', block: 'block' }[brkKind];
  const row = dashDayRows.find(r => r.kind === kindOf);
  return row ? row.id : null;
}

async function deleteBreak(date, brkKind, id) {
  const what = brkKind === 'float' ? 'ההפסקה הצפה' : 'ההפסקה';
  const ok = await confirmDialog({
    icon:        '🗑️',
    title:       `לבטל את ${what} ביום זה?`,
    message:     brkKind === 'block'
      ? 'החסימה תוסר והזמן יחזור להיות פנוי לתורים.'
      : `${what} תבוטל בתאריך הזה בלבד — כל שאר ימי שישי ימשיכו כרגיל.`,
    confirmText: 'כן, בטלי',
    cancelText:  'חזרה',
    tone:        'danger',
  });
  if (!ok) return;

  const rowId = await breakRowId(date, brkKind, id);
  if (!rowId) { refreshDayView(); return; }
  const { error } = await MoriyaAuth.sb.from('availability').delete().eq('id', rowId);
  if (error) { alert('הביטול נכשל: ' + error.message); return; }
  refreshDayView();
}

function editBreak(date, brkKind, id, start, end) {
  const isFloat = brkKind === 'float';
  openTimeModal({
    title:      isFloat ? 'שינוי ההפסקה הצפה' : 'שינוי ההפסקה',
    sub:        `כרגע <span dir="ltr">${fromMin(start)}–${fromMin(end)}</span>`,
    hint:       isFloat
      ? 'נלקחת אחרי התור הראשון שמסתיים משעת ההתחלה, ואורכה לפי הטווח כאן.'
      : 'קבועה בשעות שתגדירי. תור ארוך יכול לנגוס בה, אך לא לחצות אותה.',
    start, end, withEnd: true,
    onSave: async (newStart, newEnd) => {
      if (newEnd <= newStart) return 'שעת הסיום חייבת להיות אחרי שעת ההתחלה';

      const rowId = await breakRowId(date, brkKind, id);
      if (!rowId) return 'לא הצלחתי לשמור את ההפסקה ליום זה';
      const { error } = await MoriyaAuth.sb.from('availability')
        .update({ start_time: fromMin(newStart), end_time: fromMin(newEnd) }).eq('id', rowId);
      if (error) return 'השמירה נכשלה: ' + error.message;
      refreshDayView();
      return null;
    },
  });
}

// Appointments (non-cancelled) on `date` overlapping [sMin, eMin) minutes.
function apptsInRange(date, sMin, eMin) {
  return dash.appointments.filter(a => {
    if (a.status === 'cancelled' || a.date !== date) return false;
    const st = toMin(a.start_time.slice(0, 5));
    const en = st + (a.duration_min || 0);
    return st < eMin && en > sMin;
  });
}

// Warn the admin before removing availability that already has bookings.
function confirmConflict(conflicts, action) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const items = conflicts
    .map(a => `<li>👤 ${esc(a.client_name)} — ${a.start_time.slice(0, 5)} (${a.duration_min} דק')</li>`)
    .join('');
  return confirmDialog({
    icon:        '⚠️',
    title:       'שימי לב — יש כבר תורים',
    message:     `ללקוחות הבאות כבר נקבע תור בשעות אלו. התורים עצמם לא יבוטלו אוטומטית.`,
    html:        `<ul>${items}</ul>`,
    confirmText: `${action} בכל זאת`,
    cancelText:  'חזרה',
    tone:        'danger',
  });
}

function confirmDeleteWindow() {
  return confirmDialog({
    icon:        '🗑️',
    title:       'למחוק חלון זה?',
    message:     'החלון יוסר מהיום. אפשר תמיד להוסיף חלון חדש מאוחר יותר.',
    confirmText: 'כן, מחקי',
    cancelText:  'חזרה',
    tone:        'danger',
  });
}

async function deleteWindow(id, date) {
  const row = dashDayRows.find(r => String(r.id) === String(id));
  if (row && row.kind !== 'block') {
    const s = toMin(row.start_time.slice(0, 5)), e = toMin(row.end_time.slice(0, 5));
    const conflicts = apptsInRange(date, s, e);
    if (conflicts.length) {
      if (!(await confirmConflict(conflicts, 'למחוק את חלון העבודה'))) return;
    } else if (!(await confirmDeleteWindow())) return;
  } else if (!(await confirmDeleteWindow())) return;

  const { error } = await MoriyaAuth.sb.from('availability').delete().eq('id', id);
  if (error) { alert('שגיאה במחיקה: ' + error.message); return; }
  loadDayWindows(date);
  renderAdminCalendar();   // refresh the configured-day markers
}

async function deleteDay(date) {
  const conflicts = apptsInRange(date, 0, 24 * 60);
  if (conflicts.length) {
    if (!(await confirmConflict(conflicts, 'לבטל את כל יום העבודה'))) return;
  } else {
    const ok = await confirmDialog({
      icon:        '📅',
      title:       'ביטול יום עבודה',
      message:     `כל שעות העבודה בתאריך ${fmtDate(date)} יבוטלו, ולקוחות לא יוכלו לקבוע תור ביום זה.`,
      confirmText: 'כן, בטלי את היום',
      cancelText:  'חזרה',
      tone:        'danger',
    });
    if (!ok) return;
  }

  // Remove any existing windows/breaks for the day.
  const { error: delErr } = await MoriyaAuth.sb.from('availability').delete().eq('date', date);
  if (delErr) { alert('שגיאה בביטול היום: ' + delErr.message); return; }

  // Fridays are open by default — record a 'closed' marker so they stay off.
  if (isFridayStr(date)) {
    const { error: insErr } = await MoriyaAuth.sb.from('availability')
      .insert({ date, start_time: '00:00', end_time: '23:59', kind: 'closed' });
    if (insErr) { alert('שגיאה: ' + insErr.message); return; }
  }
  loadDayWindows(date);
  renderAdminCalendar();
}

async function reopenDay(date) {
  const { error } = await MoriyaAuth.sb.from('availability').delete().eq('date', date).eq('kind', 'closed');
  if (error) { alert('שגיאה: ' + error.message); return; }
  loadDayWindows(date);
  renderAdminCalendar();
}

// ─── Appointments management ──────────────────────────────────────────────────
// Full Date of an appointment's start, for time-precise window filtering.
function apptStart(a) {
  return new Date(`${a.date}T${(a.start_time || '00:00').slice(0, 5)}:00`);
}

// An appointment is "past" once its end time has gone by. Past appointments
// are treated as completed: they can no longer be rescheduled or cancelled.
function isPastAppt(a) {
  const end = apptStart(a).getTime() + (Number(a.duration_min) || 0) * 60 * 1000;
  return end < Date.now();
}

// Narrow upcoming appointments to a relative time window from now.
// Windows are cumulative: 24h = next 24 hours, week = next 7 days,
// month = next 30 days. "all" returns the full upcoming list.
function applyWindowFilter(list) {
  if (dash.apptWindow === 'all') return list;
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const span = dash.apptWindow === '24h' ? DAY
             : dash.apptWindow === 'week' ? 7 * DAY
             : dash.apptWindow === 'month' ? 30 * DAY
             : Infinity;
  return list.filter(a => {
    const t = apptStart(a).getTime();
    return t >= now && t <= now + span;
  });
}

function renderAppointments() {
  const box = document.getElementById('admin-appts');
  const today = todayStr();
  let list = dash.appointments.slice();
  if (dash.apptFilter === 'upcoming') {
    list = list.filter(a => a.date >= today && a.status !== 'cancelled' && !isPastAppt(a));
    list = applyWindowFilter(list);
  } else if (dash.apptFilter === 'cancelled') {
    list = list.filter(a => a.status === 'cancelled');
  }
  list.sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time));

  if (!list.length) {
    box.innerHTML = '<p class="avail-empty">אין תורים להצגה.</p>';
    return;
  }

  box.innerHTML = list.map(a => {
    const time = (a.start_time || '').slice(0, 5);
    const svc = (a.services || []).map(s => s.name).join(', ') || "מניקור לק ג'ל";
    const cancelled = a.status === 'cancelled';
    const past      = !cancelled && isPastAppt(a);
    // A past appointment is shown as completed and is locked for editing.
    const statusKey   = past ? 'done' : a.status;
    const statusLabel = STATUS_HE[statusKey] || statusKey;
    // Reminder only makes sense for an upcoming appointment that has a phone.
    const canRemind = !cancelled && !past && a.client_phone;
    const remindBtn = canRemind ? `<button class="appt-btn remind" data-id="${a.id}">💬 שלחי תזכורת</button>` : '';
    // An appointment Moriya moved gets its own notice, so the client hears about
    // the new time from her rather than discovering it.
    const movedBtn = canRemind && movedAppts.has(String(a.id))
      ? `<button class="appt-btn moved" data-id="${a.id}">💬 הודעה על ההזזה</button>` : '';
    // A cancelled appointment keeps one action: telling the client it's off.
    const cancelledBtn = cancelled && cancelledAppts.has(String(a.id)) && a.client_phone
      ? `<button class="appt-btn moved" data-act="cancel-notice" data-id="${a.id}">💬 הודעה על הביטול</button>` : '';
    const actions = cancelled ? cancelledBtn : past ? '' : `
      ${movedBtn}
      ${remindBtn}
      <button class="appt-btn edit" data-id="${a.id}">הזזה</button>
      <button class="appt-btn cancel" data-id="${a.id}">ביטול</button>`;
    return `<div class="admin-appt-card ${cancelled ? 'is-cancelled' : ''}${past ? ' is-past' : ''}">
      <div class="aac-main">
        <div class="aac-when"><strong>📅 ${fmtDate(a.date)}</strong> · ⏰ ${time} <span class="aac-dow">(${dowLabel(a.date)})</span></div>
        <div class="aac-client">👤 ${a.client_name} · 📞 ${a.client_phone || '—'}</div>
        <div class="aac-svc">${svc}</div>
      </div>
      <div class="aac-side">
        <span class="aac-price">${ils(Number(a.total_price || 0))}</span>
        <span class="aac-dur">${a.duration_min} דק'</span>
        <span class="aac-status st-${statusKey}">${statusLabel}</span>
      </div>
      <div class="aac-actions">${actions}</div>
    </div>`;
  }).join('');

  box.querySelectorAll('.appt-btn.remind').forEach(b =>
    b.addEventListener('click', () => sendReminder(b.dataset.id)));
  box.querySelectorAll('.appt-btn.moved').forEach(b => b.addEventListener('click', () =>
    (b.dataset.act === 'cancel-notice' ? sendCancelNotice : sendMoveNotice)(b.dataset.id)));
  box.querySelectorAll('.appt-btn.edit').forEach(b =>
    b.addEventListener('click', () => openReschedule(b.dataset.id)));
  box.querySelectorAll('.appt-btn.cancel').forEach(b =>
    b.addEventListener('click', () => adminCancel(b.dataset.id)));
}

// ─── Clients table ──────────────────────────────────────────────────────────────
const MUTED = '<span class="cl-muted">—</span>';

// Format a timestamptz as DD/MM/YYYY, optionally with HH:MM. Empty → em dash.
function fmtStamp(ts, withTime) {
  if (!ts) return MUTED;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return MUTED;
  const date = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  return withTime ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
}

function renderClients() {
  const tbody = document.getElementById('clients-tbody');
  if (!tbody) return;

  const q = dash.clientsQuery.trim().toLowerCase();
  let list = dash.clients;
  if (q) {
    list = list.filter(c =>
      (c.full_name || '').toLowerCase().includes(q) ||
      (c.phone || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q));
  }

  if (!list.length) {
    const msg = q ? 'לא נמצאו לקוחות תואמות' : 'אין עדיין לקוחות';
    tbody.innerHTML = `<tr><td colspan="8" class="clients-empty">${msg}</td></tr>`;
    return;
  }

  // Out of edit mode the permission checkbox is disabled outright, so the column
  // can still be read but not changed by a stray tap. The remove button is only
  // rendered while editing; CSS hides its column too, so the table keeps its
  // shape.
  const editing = dash.clientsEditing;
  tbody.innerHTML = list.map(c => `
    <tr class="client-row" data-client-id="${c.id}">
      <td class="cl-name">${c.full_name || MUTED}</td>
      <td dir="ltr" style="text-align:right;">${c.phone || MUTED}</td>
      <td dir="ltr" style="text-align:right;">${c.email || MUTED}</td>
      <td>${fmtStamp(c.last_appointment, true)}</td>
      <td>${fmtStamp(c.last_login, true)}</td>
      <td>${fmtStamp(c.created_at, false)}</td>
      <td class="cl-fg">
        <label class="fg-toggle" title="הרשאה לקביעת תור ללק ג'ל ברגליים">
          <input type="checkbox" class="fg-check" data-client-id="${c.id}"
                 ${c.feet_gel_allowed ? 'checked' : ''} ${editing ? '' : 'disabled'} />
          <span class="fg-box"></span>
        </label>
      </td>
      <td class="cl-del">
        ${editing ? `<button type="button" class="cl-del-btn" data-client-id="${c.id}"
                       title="הסרת הלקוחה" aria-label="הסרת ${escAttr(c.full_name || c.email || 'הלקוחה')}">🗑</button>` : ''}
      </td>
    </tr>`).join('');
}

// Escape a value going into a double-quoted HTML attribute.
function escAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Turn the clients list's edit mode on or off and re-render to match. Leaving
// edit mode is always allowed; entering it is a deliberate choice from the ⋮ menu.
function setClientsEditing(on) {
  dash.clientsEditing = !!on;

  const table  = document.getElementById('clients-table');
  const banner = document.getElementById('clients-edit-banner');
  const label  = document.getElementById('clients-edit-label');
  if (table)  table.classList.toggle('is-editing', dash.clientsEditing);
  if (banner) banner.hidden = !dash.clientsEditing;
  if (label)  label.textContent = dash.clientsEditing ? 'סיום עריכה' : 'עריכת הרשימה';

  renderClients();
}

// Grant or revoke a client's access to the feet gel-polish treatment. Every
// change is confirmed first, and the checkbox is put back the way it was if the
// admin cancels or the save fails — so the column always shows what is actually
// in the database. Clients can't set this themselves: the schema's
// guard_feet_gel_allowed() trigger rejects the change for anyone but an admin.
async function toggleFeetGel(cb) {
  const id     = cb.dataset.clientId;
  const client = dash.clients.find(c => String(c.id) === String(id));
  if (!client) return;

  // Belt and braces: the checkbox is rendered disabled outside edit mode, so this
  // should be unreachable — but the permission must never turn on a UI detail.
  if (!dash.clientsEditing) { cb.checked = !!client.feet_gel_allowed; return; }

  const grant = cb.checked;
  const name  = client.full_name || client.email || 'הלקוחה';
  const ok = await confirmDialog({
    icon:  grant ? '🦶' : '🚫',
    title: grant ? "להוסיף הרשאה ללק ג'ל ברגליים?" : "להסיר את ההרשאה ללק ג'ל ברגליים?",
    message: grant
      ? `${name} תראה את הטיפול ותוכל לקבוע אותו (60 דק' · 120 ₪), לבד או יחד עם מניקור.`
      : `${name} לא תראה יותר את הטיפול ולא תוכל לקבוע אותו. תורים שכבר נקבעו לא ישתנו.`,
    confirmText: grant ? 'כן, הוסיפי הרשאה' : 'כן, הסירי הרשאה',
    cancelText:  'ביטול',
    tone:        grant ? 'safe' : 'danger',
  });
  if (!ok) { cb.checked = !grant; return; }

  cb.disabled = true;
  const { error } = await MoriyaAuth.sb
    .from('profiles').update({ feet_gel_allowed: grant }).eq('id', id);
  cb.disabled = false;

  if (error) {
    cb.checked = !grant;
    alert('שגיאה בעדכון ההרשאה: ' + error.message);
    return;
  }
  client.feet_gel_allowed = grant;
}

// Remove a client from the salon. Only reachable from edit mode, and always
// confirmed first — spelling out what survives, because "delete" reads like it
// might take the appointment history with it, and it doesn't.
//
// The actual deletion runs server-side (/api/delete-client): it removes the
// Google identity itself, not just the profile row, so a deleted client cannot
// linger as a signed-in user with no profile. Her past appointments stay on the
// books under her name, so revenue and the charts are unaffected.
async function deleteClient(btn) {
  const id     = btn.dataset.clientId;
  const client = dash.clients.find(c => String(c.id) === String(id));
  if (!client || !dash.clientsEditing) return;

  const name  = client.full_name || client.email || 'הלקוחה';
  const today = todayStr();
  // Appointments she has coming up: those stay in the calendar and in the
  // dashboard, but she loses the ability to see or change them herself.
  const upcoming = dash.appointments.filter(a =>
    a.user_id === client.id && a.status === 'booked' && a.date >= today).length;

  const ok = await confirmDialog({
    icon:  '🗑',
    title: `להסיר את ${name} מרשימת הלקוחות?`,
    message: upcoming
      ? `ל${name} יש ${upcoming === 1 ? 'תור עתידי אחד' : `${upcoming} תורים עתידיים`}. התורים יישארו ביומן ובלוח הבקרה, אבל היא לא תוכל לראות או לשנות אותם יותר. כדאי לבטל אותם קודם אם אינך מעוניינת בהם.`
      : `${name} תוסר מהרשימה ותנותק מהאתר. היסטוריית התורים וההכנסות שלה תישמר.`,
    html: `<p style="margin:0;color:#8a8a8a;font-size:0.85rem;">אם היא תתחבר שוב עם Google בעתיד, היא תיווצר כלקוחה חדשה — בלי ההרשאות שהיו לה.</p>`,
    confirmText: 'כן, הסירי אותה',
    cancelText:  'ביטול',
    tone:        'danger',
  });
  if (!ok) return;

  btn.disabled = true;
  let res, payload;
  try {
    const accessToken = await getAccessToken();
    res = await fetch(`${API_BASE}/api/delete-client`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: id, accessToken }),
    });
    payload = await res.json().catch(() => ({}));
  } catch (e) {
    btn.disabled = false;
    alert('ההסרה נכשלה: ' + e.message);
    return;
  }

  if (!res.ok || !payload.success) {
    btn.disabled = false;
    const reasons = {
      not_configured:     'ההסרה לא מוגדרת בשרת (חסר מפתח service role).',
      not_authorized:     'אין הרשאה לבצע את הפעולה.',
      cannot_delete_self: 'אי אפשר להסיר את המשתמשת שאיתה את מחוברת.',
      cannot_delete_admin:'אי אפשר להסיר משתמשת ניהול.',
    };
    alert('ההסרה נכשלה: ' + (reasons[payload.error] || payload.error || `שגיאת שרת (${res.status})`));
    return;
  }

  // Drop her locally rather than reloading the whole dashboard, and detach the
  // appointments that were hers so the details popover can't be opened on a
  // client who no longer exists.
  dash.clients = dash.clients.filter(c => String(c.id) !== String(id));
  dash.clientsCount = dash.clients.length;
  dash.appointments.forEach(a => { if (a.user_id === client.id) a.user_id = null; });

  renderKPIs();
  renderClients();
  document.getElementById('client-panel')?.classList.remove('is-open');
}

// Tally a client's appointments by status (matched on user_id).
function clientStats(clientId) {
  const appts = dash.appointments.filter(a => a.user_id === clientId);
  const by = s => appts.filter(a => a.status === s).length;
  return {
    total:     appts.length,
    done:      by('done'),
    booked:    by('booked'),
    cancelled: by('cancelled'),
    noShow:    by('no_show'),
  };
}

// Fill the details popover with a client's stats and draw the chart.
function showClientPanel(client) {
  const st = clientStats(client.id);
  document.getElementById('cp-name').textContent = client.full_name || 'לקוחה ללא שם';
  document.getElementById('cp-sub').textContent  = client.phone || client.email || '';
  document.getElementById('cstat-total').textContent     = st.total;
  document.getElementById('cstat-done').textContent      = st.done;
  document.getElementById('cstat-cancelled').textContent = st.cancelled;
  renderClientPie(st);
}

// On-brand doughnut of the client's appointment mix. Empty statuses are dropped.
function renderClientPie(st) {
  const canvas = document.getElementById('client-pie');
  const empty  = document.getElementById('client-chart-empty');
  if (dash.charts.clientPie) { dash.charts.clientPie.destroy(); dash.charts.clientPie = null; }

  const segs = [
    { label: 'בוצעו',    value: st.done,      color: '#e85880' },
    { label: 'עתידיים',  value: st.booked,    color: '#ff9ab5' },
    { label: 'בוטלו',    value: st.cancelled, color: '#cfcfcf' },
    { label: 'לא הגיעה', value: st.noShow,    color: '#c9966c' },
  ].filter(s => s.value > 0);

  if (!segs.length) {
    canvas.style.display = 'none';
    empty.style.display  = 'flex';
    return;
  }
  canvas.style.display = 'block';
  empty.style.display  = 'none';

  const heebo = "'Heebo', sans-serif";
  dash.charts.clientPie = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: segs.map(s => s.label),
      datasets: [{
        data: segs.map(s => s.value),
        backgroundColor: segs.map(s => s.color),
        borderColor: '#ffffff',
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '58%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { font: { family: heebo, size: 12 }, color: '#4a4a4a', padding: 12,
                    usePointStyle: true, pointStyle: 'circle' },
        },
        tooltip: { bodyFont: { family: heebo }, titleFont: { family: heebo } },
      },
    },
  });
}

function wireClientsControls() {
  const search = document.getElementById('clients-search');
  if (search) search.addEventListener('input', e => {
    dash.clientsQuery = e.target.value;
    renderClients();
  });

  wireClientsMenu();

  const tbody = document.getElementById('clients-tbody');
  const panel = document.getElementById('client-panel');
  if (!tbody || !panel) return;

  const canHover = window.matchMedia('(hover: hover)').matches;
  let activeId = null;
  const clearActive = () =>
    tbody.querySelectorAll('.client-row.is-active').forEach(r => r.classList.remove('is-active'));

  // Open the popover for a row. Guarded on the client id so moving the pointer
  // within a row doesn't redraw the chart repeatedly.
  const open = row => {
    if (row.dataset.clientId !== activeId) {
      activeId = row.dataset.clientId;
      clearActive();
      row.classList.add('is-active');
      const client = dash.clients.find(c => String(c.id) === row.dataset.clientId);
      if (client) showClientPanel(client);
    }
    panel.classList.add('is-open');
  };
  const close = () => { panel.classList.remove('is-open'); activeId = null; clearActive(); };

  // Feet gel-polish access, toggled per client straight from the table.
  // Only live in edit mode — outside it the checkbox is rendered disabled.
  tbody.addEventListener('change', e => {
    const cb = e.target.closest('.fg-check');
    if (cb) toggleFeetGel(cb);
  });

  // Removing a client. The button only exists while editing.
  tbody.addEventListener('click', e => {
    const btn = e.target.closest('.cl-del-btn');
    if (btn) { e.stopPropagation(); deleteClient(btn); }
  });

  // The client's name is the handle for the details card — tapped on a phone,
  // hovered on a desktop. The rest of the row is inert, so reading the table (or
  // reaching the permission toggle at its end) never pops the chart open unasked.
  const nameCellOf = e => e.target.closest('.cl-name');

  // Tap/click opens on every device (the only trigger on touch).
  tbody.addEventListener('click', e => {
    const cell = nameCellOf(e);
    if (cell) open(cell.closest('.client-row'));
  });

  if (canHover) {
    // Desktop: moving between names updates the left-pinned popover live, and
    // moving off them hides it again; so does leaving the table altogether.
    tbody.addEventListener('mouseover', e => {
      const cell = nameCellOf(e);
      if (cell) open(cell.closest('.client-row'));
      else      close();
    });
    const wrap = document.querySelector('.clients-table-wrap');
    if (wrap) wrap.addEventListener('mouseleave', close);
  } else {
    // Touch: close the modal via the ✕ button or a tap on the backdrop.
    const closeBtn = document.getElementById('cp-close');
    if (closeBtn) closeBtn.addEventListener('click', close);
    panel.addEventListener('click', e => { if (e.target === panel) close(); });
  }
}

// The ⋮ menu above the clients table. It holds a single entry today — edit mode
// on/off — but is the place any future list-wide action belongs.
function wireClientsMenu() {
  const btn    = document.getElementById('clients-menu-btn');
  const menu   = document.getElementById('clients-menu');
  const toggle = document.getElementById('clients-edit-toggle');
  const done   = document.getElementById('clients-edit-done');
  if (!btn || !menu || !toggle) return;

  const closeMenu = () => {
    menu.hidden = true;
    btn.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
  };
  const openMenu = () => {
    menu.hidden = false;
    btn.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');
  };

  btn.addEventListener('click', e => {
    e.stopPropagation();
    menu.hidden ? openMenu() : closeMenu();
  });

  toggle.addEventListener('click', () => {
    setClientsEditing(!dash.clientsEditing);
    closeMenu();
  });

  // "סיום עריכה" on the banner – the way out without reopening the menu.
  if (done) done.addEventListener('click', () => setClientsEditing(false));

  // Click-away and Escape close the menu (they never leave edit mode: that is
  // its own deliberate choice, so an accidental click can't silently re-lock
  // the table mid-edit).
  document.addEventListener('click', e => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== btn) closeMenu();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !menu.hidden) { closeMenu(); btn.focus(); }
  });
}

async function adminCancel(id) {
  const appt = dash.appointments.find(a => String(a.id) === String(id));
  if (!appt || appt.status === 'cancelled' || isPastAppt(appt)) return;
  const ok = await confirmDialog({
    icon:        '🗓️',
    title:       'ביטול תור',
    message:     `התור של ${appt.client_name} בתאריך ${fmtDate(appt.date)} יבוטל ויוסר מהיומן.`,
    confirmText: 'כן, בטלי את התור',
    cancelText:  'חזרה',
    tone:        'danger',
  });
  if (!ok) return;

  // Best-effort calendar sync (works for past appointments too).
  let calOk = true;
  try {
    if (appt.google_event_id) {
      const accessToken = await getAccessToken();
      const r = await fetch(`${API_BASE}/api/manage-booking`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', eventId: appt.google_event_id, accessToken }),
      });
      calOk = r.ok;
    }
  } catch (e) { calOk = false; console.warn('calendar cancel failed:', e.message); }

  // Source of truth: mark cancelled in Supabase.
  const { error } = await MoriyaAuth.sb.from('appointments').update({ status: 'cancelled' }).eq('id', id);
  if (error) { alert('הביטול נכשל: ' + error.message); return; }
  appt.status = 'cancelled';
  if (!calOk) alert('התור בוטל במערכת, אך ייתכן שלא הוסר מיומן Google — כדאי לבדוק ידנית.');

  cancelledAppts.add(String(appt.id));
  renderKPIs(); renderCharts(); renderAppointments(); refreshDayView();
  offerCancelNotice(appt);
}

// ── Reschedule modal ──
let reschedTarget = null;
let reschedSelDate = null;
let reschedSelTime = null;
let reschedDay = {};           // the shown day, as read by the schedule model
let reschedCalYear = new Date().getFullYear();
let reschedCalMonth = new Date().getMonth();

// `sameDay` opens the modal on the hour alone — the day view's default, since a
// move there is almost always a shift within the day being looked at. The date
// is one button away.
function openReschedule(id, sameDay) {
  const appt = dash.appointments.find(a => String(a.id) === String(id));
  if (!appt || appt.status === 'cancelled' || isPastAppt(appt)) return;
  reschedTarget  = appt;
  reschedSelDate = appt.date;
  reschedSelTime = (appt.start_time || '').slice(0, 5);
  const [Y, M] = appt.date.split('-').map(Number);
  reschedCalYear  = Y;
  reschedCalMonth = M - 1;

  const svc = (appt.services || []).map(s => s.name).join(' · ') || "מניקור לק ג'ל";
  document.getElementById('resched-sub').textContent = appt.client_name;
  document.getElementById('resched-current').innerHTML = `
    <span class="rc-label">המועד הנוכחי</span>
    <span class="rc-when">📅 ${dowLabel(appt.date)} · ${fmtDate(appt.date)} · ⏰ ${appt.start_time.slice(0, 5)}</span>
    <span class="rc-svc">${svc} · ${appt.duration_min} דק'</span>`;
  document.getElementById('resched-feedback').textContent = '';
  document.getElementById('resched-feedback').className = 'avail-feedback';

  // Back to the picker: the "done" panel belongs to the move just before it.
  document.getElementById('resched-done').style.display = 'none';
  document.getElementById('resched-picker').style.display = '';
  document.getElementById('resched-current').style.display = '';
  document.getElementById('resched-save').style.display = '';

  showReschedDate(!sameDay);
  document.getElementById('resched-title').textContent =
    sameDay ? 'הזזת שעה' : 'הזזת תור';

  renderReschedCalendar().then(() => loadReschedSlots(reschedSelDate));
  document.getElementById('resched-modal').style.display = 'flex';
}

// Show the calendar, or fold it away behind the "another date" button.
function showReschedDate(open) {
  document.getElementById('resched-cal-box').style.display   = open ? '' : 'none';
  document.getElementById('resched-other-date').style.display = open ? 'none' : '';
}

async function renderReschedCalendar() {
  const box   = document.getElementById('resched-cal-box');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const states = await getMonthDayStates(reschedCalYear, reschedCalMonth);

  const firstDow    = new Date(reschedCalYear, reschedCalMonth, 1).getDay();
  const daysInMonth = new Date(reschedCalYear, reschedCalMonth + 1, 0).getDate();

  let html = `
    <div class="cal-header">
      <button class="cal-nav" id="resched-cal-prev">›</button>
      <h4>${HE_MONTHS[reschedCalMonth]} ${reschedCalYear}</h4>
      <button class="cal-nav" id="resched-cal-next">‹</button>
    </div>
    <div class="cal-grid">
      ${HE_DAY_NAMES.map(d => `<div class="cal-day-name">${d}</div>`).join('')}`;
  for (let i = 0; i < firstDow; i++) html += '<div class="cal-day empty"></div>';
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(reschedCalYear, reschedCalMonth, day);
    const dateStr = `${reschedCalYear}-${pad(reschedCalMonth + 1)}-${pad(day)}`;
    const isPast  = d < today;
    const info    = states.get(dateStr);
    const isOpen  = !isPast && effectiveOpen(dateStr, info).length > 0;
    let cls = 'cal-day';
    if (isPast) cls += ' past';
    if (info && info.closed) cls += ' is-closed';
    else if (isOpen) cls += ' has-windows friday-avail';
    if (dateStr === reschedSelDate) cls += ' selected';
    html += `<div class="${cls}" ${isOpen ? `data-date="${dateStr}"` : ''}>${day}</div>`;
  }
  html += '</div>';
  box.innerHTML = html;

  document.getElementById('resched-cal-prev').addEventListener('click', () => {
    reschedCalMonth--; if (reschedCalMonth < 0) { reschedCalMonth = 11; reschedCalYear--; } renderReschedCalendar();
  });
  document.getElementById('resched-cal-next').addEventListener('click', () => {
    reschedCalMonth++; if (reschedCalMonth > 11) { reschedCalMonth = 0; reschedCalYear++; } renderReschedCalendar();
  });
  box.querySelectorAll('.cal-day[data-date]').forEach(c =>
    c.addEventListener('click', () => selectReschedDate(c.dataset.date)));
}

function selectReschedDate(dateStr) {
  reschedSelDate = dateStr;
  reschedSelTime = null;
  document.querySelectorAll('#resched-cal-box .cal-day').forEach(c => c.classList.remove('selected'));
  document.querySelector(`#resched-cal-box .cal-day[data-date="${dateStr}"]`)?.classList.add('selected');
  loadReschedSlots(dateStr);
}

// What a move to `start` would actually disturb, or null when it disturbs
// nothing. The grid offers the tidy slots on the 90-minute rhythm; here only
// real clashes count, because an hour off the rhythm is still a perfectly good
// hour when the day has room for it.
function reschedConflict(dateStr, day, start) {
  const end  = start + (Number(reschedTarget.duration_min) || 0);
  const wins = MoriyaSchedule.openWindows(dateStr, day);
  if (!wins.some(w => start >= w.start && end <= w.end)) return 'מחוץ לשעות העבודה';

  // Another client would have to move for this one.
  const clash = dash.appointments.find(a => {
    if (a.date !== dateStr || a.status === 'cancelled' || String(a.id) === String(reschedTarget.id)) return false;
    const s = toMin((a.start_time || '00:00').slice(0, 5));
    return start < s + (Number(a.duration_min) || 0) && end > s;
  });
  if (clash) return `מתנגשת בתור של ${clash.client_name}`;

  const brk = MoriyaSchedule.dayBreaks(dateStr, day);
  // The fixed break is meant to be bitten into: an appointment may run into it
  // and stop at its end. Starting inside it, or running past it, is not biting.
  if (brk.big && ((start >= brk.big.start && start < brk.big.end) ||
                  (start < brk.big.start && end > brk.big.end))) return 'נופלת בהפסקה קבועה';
  if ((day.block || []).some(b => start < b.end && end > b.start)) return 'נופלת בהפסקה קבועה';
  // The floating break isn't bitten, it's pushed — worth saying out loud.
  if (brk.float && end > brk.float.notBefore && start < brk.float.notBefore + brk.float.len) {
    return 'תדחה את ההפסקה המזדמנת';
  }
  return null;
}

// Times the day genuinely has room for, sliced by the same rules clients get —
// breaks included, so a move never lands on top of one by accident.
async function reschedFreeStarts(dateStr) {
  const [Y, M] = dateStr.split('-').map(Number);
  const states = await getMonthDayStates(Y, M - 1);
  const day    = states.get(dateStr) || {};
  reschedDay   = day;
  const today  = todayStr();
  const notBefore = dateStr === today ? new Date().getHours() * 60 + new Date().getMinutes() : undefined;

  // The appointment being moved doesn't block itself.
  const busy = dash.appointments
    .filter(a => a.date === dateStr && a.status !== 'cancelled' && String(a.id) !== String(reschedTarget.id))
    .map(a => {
      const s = toMin((a.start_time || '00:00').slice(0, 5));
      return { start: s, end: s + (Number(a.duration_min) || 0) };
    });

  return MoriyaSchedule.availableStarts(reschedTarget.duration_min, dateStr, day, busy, notBefore);
}

async function loadReschedSlots(dateStr) {
  const box  = document.getElementById('resched-slots-box');
  const grid = document.getElementById('resched-slots-grid');
  const lbl  = document.getElementById('resched-date-label');
  box.style.display = 'block';
  lbl.textContent = `${dowLabel(dateStr)} · ${fmtDate(dateStr)}`;
  grid.innerHTML = '<div class="slots-loading"><div class="spinner"></div><span>טוענת שעות…</span></div>';
  refreshReschedSave();

  const starts = await reschedFreeStarts(dateStr);
  setTimeSelect('resched', reschedSelTime ? toMin(reschedSelTime) : (starts[0] ?? 9 * 60));
  document.getElementById('resched-manual-note').textContent = '';

  grid.innerHTML = starts.length
    ? starts.map(m => {
        const label = fromMin(m);
        return `<div class="time-slot ${label === reschedSelTime ? 'selected' : ''}" data-time="${label}">${label}</div>`;
      }).join('')
    : '<div class="no-slots">אין שעות פנויות ביום זה 😔<br/>אפשר לבחור יום אחר, או להזין שעה ידנית למטה</div>';

  grid.querySelectorAll('.time-slot[data-time]').forEach(c =>
    c.addEventListener('click', () => selectReschedSlot(c.dataset.time)));
}

function selectReschedSlot(time) {
  reschedSelTime = time;
  document.querySelectorAll('#resched-slots-grid .time-slot').forEach(c => c.classList.remove('selected'));
  document.querySelector(`#resched-slots-grid .time-slot[data-time="${time}"]`)?.classList.add('selected');
  document.getElementById('resched-manual-note').textContent = '';
  refreshReschedSave();
}

// Any hour Moriya types in is allowed. She is only warned when the hour would
// actually displace something — another client, or a break that gets pushed
// rather than bitten into.
function pickManualReschedTime() {
  const min  = readTimeSelect('resched');
  const time = fromMin(min);
  reschedSelTime = time;
  document.querySelectorAll('#resched-slots-grid .time-slot').forEach(c =>
    c.classList.toggle('selected', c.dataset.time === time));

  const note = document.getElementById('resched-manual-note');
  const why  = reschedConflict(reschedSelDate, reschedDay, min);
  const end  = fromMin(min + (Number(reschedTarget.duration_min) || 0));
  if (why) {
    note.innerHTML = `⚠ <span dir="ltr">${time}–${end}</span> ${why}. אפשר לשמור בכל זאת.`;
    note.className = 'mt-note warn';
  } else {
    note.innerHTML = `✓ <span dir="ltr">${time}–${end}</span> פנוי`;
    note.className = 'mt-note ok';
  }
  refreshReschedSave();
}

function refreshReschedSave() {
  const btn = document.getElementById('resched-save');
  if (btn) btn.disabled = !(reschedSelDate && reschedSelTime);
}

async function saveReschedule() {
  if (!reschedTarget) return;
  const date = reschedSelDate;
  const time = reschedSelTime;
  const fb = document.getElementById('resched-feedback');
  if (!date || !time) { fb.textContent = 'יש לבחור תאריך ושעה'; fb.className = 'avail-feedback err'; return; }

  // An hour with room for the appointment is simply taken. Only one that would
  // displace something is worth stopping for.
  const why = reschedConflict(date, reschedDay, toMin(time));
  if (why) {
    const ok = await confirmDialog({
      icon:        '⚠️',
      title:       'שימי לב',
      message:     `השעה ${time} בתאריך ${fmtDate(date)} ${why}. להזיז לשם בכל זאת?`,
      confirmText: 'כן, הזיזי לשם',
      cancelText:  'חזרה',
      tone:        'danger',
    });
    if (!ok) return;
  }

  const btn = document.getElementById('resched-save');
  btn.disabled = true; btn.textContent = 'מעדכנת…';

  // The client's appointment lives on Moriya's Google Calendar too, so the move
  // is pushed there before the database is touched.
  let calOk = true;
  try {
    if (reschedTarget.google_event_id) {
      const accessToken = await getAccessToken();
      const r = await fetch(`${API_BASE}/api/manage-booking`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update', eventId: reschedTarget.google_event_id,
          date, time, duration: reschedTarget.duration_min, accessToken,
        }),
      });
      calOk = r.ok;
    }
  } catch (e) { calOk = false; console.warn('calendar update failed:', e.message); }

  const { error } = await MoriyaAuth.sb.from('appointments')
    .update({ date, start_time: time }).eq('id', reschedTarget.id);

  btn.disabled = false; btn.textContent = 'שמירה ועדכון יומן';
  if (error) { fb.textContent = 'העדכון נכשל: ' + error.message; fb.className = 'avail-feedback err'; return; }
  reschedTarget.date = date; reschedTarget.start_time = time;

  if (!calOk) alert('התור עודכן במערכת, אך ייתכן שלא עודכן ביומן Google — כדאי לבדוק ידנית.');
  movedAppts.add(String(reschedTarget.id));
  showReschedDone(reschedTarget);
  renderKPIs(); renderCharts(); renderAppointments(); refreshDayView();
}

// The move is saved; now offer the one thing only Moriya can do — tell her.
function showReschedDone(appt) {
  const done = document.getElementById('resched-done');
  document.getElementById('resched-picker').style.display  = 'none';
  document.getElementById('resched-current').style.display = 'none';
  document.getElementById('resched-save').style.display    = 'none';

  const notify = document.getElementById('resched-notify');
  const hasPhone = !!waPhone(appt.client_phone);
  notify.style.display = hasPhone ? '' : 'none';
  document.getElementById('resched-done-msg').textContent = hasPhone
    ? moveText(appt)
    : `${appt.client_name} — אין מספר טלפון שמור, אז אי אפשר לשלוח הודעה מכאן.`;

  done.style.display = 'block';
  notify.onclick = () => sendMoveNotice(appt.id);
}

// ─── Controls (range tabs, filters, modal) ────────────────────────────────────
function wireControls() {
  document.querySelectorAll('#range-tabs .range-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#range-tabs .range-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      dash.chartRange = Number(tab.dataset.range);
      renderCharts();
    });
  });

  const exportBtn = document.getElementById('export-xlsx');
  if (exportBtn) exportBtn.addEventListener('click', exportToExcel);

  const subfilters = document.getElementById('appt-subfilters');
  document.querySelectorAll('#appt-filters .range-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#appt-filters .range-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      dash.apptFilter = tab.dataset.filter;
      // The time-window sub-filters only make sense for the upcoming view.
      if (subfilters) subfilters.style.display = dash.apptFilter === 'upcoming' ? '' : 'none';
      renderAppointments();
    });
  });

  document.querySelectorAll('#appt-subfilters .range-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#appt-subfilters .range-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      dash.apptWindow = tab.dataset.window;
      renderAppointments();
    });
  });

  const closeResched = () => document.getElementById('resched-modal').style.display = 'none';
  document.getElementById('resched-close').addEventListener('click', closeResched);
  document.getElementById('resched-done-close').addEventListener('click', closeResched);
  document.getElementById('resched-modal').addEventListener('click', e => {
    if (e.target.id === 'resched-modal') e.target.style.display = 'none';
  });
  document.getElementById('resched-save').addEventListener('click', saveReschedule);
  // Turning the dials picks the hour straight away, so what the note says and
  // what the save button would write are never out of step.
  document.getElementById('resched-manual').addEventListener('click', pickManualReschedTime);
  ['resched-h', 'resched-m'].forEach(id =>
    document.getElementById(id).addEventListener('change', pickManualReschedTime));
  document.getElementById('resched-other-date').addEventListener('click', () => {
    showReschedDate(true);
    document.getElementById('resched-title').textContent = 'הזזת תור';
  });

  document.getElementById('tm-close').addEventListener('click', closeTimeModal);
  document.getElementById('tm-modal').addEventListener('click', e => {
    if (e.target.id === 'tm-modal') closeTimeModal();
  });
  document.getElementById('tm-save').addEventListener('click', () => { if (tmSave) tmSave(); });
}

// Go.
bootstrap();
