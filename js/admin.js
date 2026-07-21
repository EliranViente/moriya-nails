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

// A warm, on-brand reminder message carrying the appointment's details.
function reminderText(appt) {
  const svc = (appt.services || []).map(s => s.name).join(' · ') || "מניקור לק ג'ל";
  const time = (appt.start_time || '').slice(0, 5);
  return [
    `שלום ${appt.client_name} 💕`,
    ``,
    `רק תזכורת קטנה לתור שלך ב-Moriya Nails 💅✨`,
    ``,
    `📅 ${dowLabel(appt.date)} · ${fmtDate(appt.date)}`,
    `⏰ ${time}`,
    `💆‍♀️ ${svc}`,
    `⏳ משך משוער: ${appt.duration_min} דק׳`,
    `💰 לתשלום: ${ils(Number(appt.total_price || 0))}`,
    ``,
    `📍 ${VENUE_ADDR}`,
    `🅿️ הגעה וחניה: ${VENUE_MAPS}`,
    ``,
    `מחכה לראות אותך 💗`,
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
  chartRange: 30,
  apptFilter: 'upcoming',   // 'upcoming' | 'all' | 'cancelled'
  apptWindow: 'all',        // upcoming time window: 'all' | '24h' | 'week' | 'month'
  charts: {},         // Chart.js instances
};

// Availability calendar state
let adminSelDate  = null;
let adminCalYear  = new Date().getFullYear();
let adminCalMonth = new Date().getMonth();
let dashDayRows   = [];   // availability rows for the selected day
let dashDayBlocks = [];   // break intervals {start,end} for the selected day

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

  // Default the availability editor to the next Friday and open the calendar there.
  adminSelDate = nextFridayStr();
  const [y, m] = adminSelDate.split('-').map(Number);
  adminCalYear = y; adminCalMonth = m - 1;
  setEditorTime('start', '09:00');
  setEditorTime('end', '17:00');
  await renderAdminCalendar();
  selectAdminDate(adminSelDate);
}

function nextFridayStr() {
  const d = new Date();
  d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ─── Availability calendar ────────────────────────────────────────────────────
// Per-day model (mirrors the public site): Fridays are work days by default
// (09:00–17:00); the admin can open other days, add breaks, or mark a day closed.
const DEFAULT_FRIDAY = [{ start: 9 * 60, end: 17 * 60 }]; // 09:00–17:00
const isFridayStr = dateStr => new Date(`${dateStr}T00:00:00`).getDay() === 5;

// The effective open windows for a day, applying the Friday default.
function effectiveOpen(dateStr, info) {
  if (info && info.closed) return [];
  if (info && info.open && info.open.length) return info.open;
  return isFridayStr(dateStr) ? DEFAULT_FRIDAY.map(w => ({ ...w })) : [];
}

// Group a month's availability rows by date → {open[], closed}.
async function getMonthDayStates(year, month /* 0-based */) {
  const first   = `${year}-${pad(month + 1)}-01`;
  const lastNum = new Date(year, month + 1, 0).getDate();
  const last    = `${year}-${pad(month + 1)}-${pad(lastNum)}`;
  const byDate = new Map();
  try {
    const { data } = await MoriyaAuth.sb
      .from('availability').select('date,start_time,end_time,kind').gte('date', first).lte('date', last);
    (data || []).forEach(r => {
      const info = byDate.get(r.date) || { open: [], closed: false };
      if (r.kind === 'closed') info.closed = true;
      else if (r.kind === 'open') info.open.push({ start: toMin(r.start_time.slice(0, 5)), end: toMin(r.end_time.slice(0, 5)) });
      byDate.set(r.date, info);
    });
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
  document.querySelectorAll('.ts-hour').forEach(sel => {
    sel.innerHTML = hours.map(h => `<option value="${h}">${h}</option>`).join('');
  });
  document.querySelectorAll('.ts-min').forEach(sel => {
    sel.innerHTML = mins.map(m => `<option value="${m}">${m}</option>`).join('');
  });
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
    .select('id, full_name, phone, email, last_appointment, last_login, created_at')
    .order('last_appointment', { ascending: false, nullsFirst: false });
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

  // Account for breaks already defined on the selected day.
  const slots = sliceSlots(start, end, dashDayBlocks);
  preview.className = 'avail-preview';
  if (slots.length === 0) {
    preview.textContent = 'החלון קצר מ-90 דקות — לא ייווצר אף תור.';
    return;
  }
  let txt = `🟢 ייווצרו ${slots.length} תורים: ${slots.map(fromMin).join(' · ')}`;
  if (dashDayBlocks.length) txt += ' (מתחשב בהפסקות הקיימות)';
  preview.textContent = txt;
}

// Start times for 90-min appointments inside [start, end), skipping past breaks.
// After a break the 90-min cadence resumes from the break's end.
function sliceSlots(start, end, breaks) {
  const bks = (breaks || []).filter(b => b.end > start && b.start < end).sort((a, b) => a.start - b.start);
  const out = [];
  let cursor = start;
  while (cursor + SLOT_LEN <= end) {
    const hit = bks.find(b => cursor < b.end && cursor + SLOT_LEN > b.start);
    if (hit) { cursor = hit.end; continue; }   // jump past the break, then resume cadence
    out.push(cursor);
    cursor += SLOT_LEN;
  }
  return out;
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

  // Opening hours on a day that was marked closed should re-open it first.
  if (editorKind === 'open') {
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

  dashDayRows   = data || [];

  // Everything set here is saved right away; it just isn't offered to clients
  // until the rolling two-month window reaches this date.
  const note = MoriyaBooking.isWithin(date) ? '' :
    `<div class="day-horizon-note">👀 היום הזה עדיין לא מוצג ללקוחות — הוא ייפתח לקביעת תורים ב-${fmtDate(MoriyaBooking.visibleFrom(date))},
     חודשיים לפני המועד. השעות שתגדירי כאן יישמרו ויופיעו אוטומטית באותו יום.</div>`;

  const closed   = dashDayRows.some(r => r.kind === 'closed');
  const openRows = dashDayRows.filter(r => r.kind === 'open');
  const blockRows = dashDayRows.filter(r => r.kind === 'block');
  dashDayBlocks = blockRows.map(w => ({ start: toMin(w.start_time.slice(0, 5)), end: toMin(w.end_time.slice(0, 5)) }));
  updateAvailPreview();   // preview now reflects this day's breaks

  // Day explicitly marked closed.
  if (closed) {
    list.innerHTML = `${note}
      <div class="day-closed">🚫 היום הזה סגור — לא מוצעים בו תורים.</div>
      <button class="admin-btn ghost full" id="reopen-day">↩ החזירי שעות עבודה</button>`;
    document.getElementById('reopen-day').onclick = () => reopenDay(date);
    delDayBtn.style.display = 'none';
    return;
  }

  // Effective work windows: explicit rows, or the Friday default (09:00–17:00).
  const usingDefault = openRows.length === 0 && isFridayStr(date);
  const openWins = openRows.length
    ? openRows.map(r => ({ id: r.id, s: toMin(r.start_time.slice(0, 5)), e: toMin(r.end_time.slice(0, 5)), range: `${r.start_time.slice(0, 5)}–${r.end_time.slice(0, 5)}` }))
    : (usingDefault ? [{ id: null, s: 9 * 60, e: 17 * 60, range: '09:00–17:00' }] : []);

  if (!openWins.length && !blockRows.length) {
    list.innerHTML = `${note}<p class="avail-empty">אין שעות עבודה ליום זה.<br/>הוסיפי חלון עבודה כדי לפתוח תורים.</p>`;
    delDayBtn.style.display = 'none';
    return;
  }

  let rowsHtml = note + openWins.map(w => {
    const slots = sliceSlots(w.s, w.e, dashDayBlocks);
    const slotsTxt = slots.length ? slots.map(fromMin).join(' · ') : 'אין תורים (חלון קצר מדי)';
    const defLabel = w.id ? '' : ' <span class="win-default">ברירת מחדל (שישי)</span>';
    const delBtn = w.id ? `<button class="win-del" data-id="${w.id}">מחיקה</button>` : '';
    return `<div class="avail-win open">
      <div class="win-info">
        <span class="win-badge open">🟢 עבודה</span><strong>${w.range}</strong>${defLabel}
        <span class="win-slots">${slots.length} תורים: ${slotsTxt}</span>
      </div>
      ${delBtn}
    </div>`;
  }).join('');

  rowsHtml += blockRows.map(r => {
    const range = `${r.start_time.slice(0, 5)}–${r.end_time.slice(0, 5)}`;
    return `<div class="avail-win block">
      <div class="win-info"><span class="win-badge block">⛔ הפסקה</span><strong>${range}</strong></div>
      <button class="win-del" data-id="${r.id}">מחיקה</button>
    </div>`;
  }).join('');

  list.innerHTML = rowsHtml;
  delDayBtn.style.display = openWins.length ? '' : 'none';
  delDayBtn.onclick = () => deleteDay(date);
  list.querySelectorAll('.win-del').forEach(b =>
    b.addEventListener('click', () => deleteWindow(b.dataset.id, date)));
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
    list = list.filter(a => a.date >= today && a.status !== 'cancelled');
    list = applyWindowFilter(list);
  } else if (dash.apptFilter === 'cancelled') {
    list = list.filter(a => a.status === 'cancelled');
  }
  list.sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time));

  if (!list.length) {
    box.innerHTML = '<p class="avail-empty">אין תורים להצגה.</p>';
    return;
  }

  const statusLabel = { booked: 'מאושר', done: 'בוצע', cancelled: 'בוטל', no_show: 'לא הגיעה' };
  box.innerHTML = list.map(a => {
    const time = (a.start_time || '').slice(0, 5);
    const svc = (a.services || []).map(s => s.name).join(', ') || "מניקור לק ג'ל";
    const cancelled = a.status === 'cancelled';
    // Reminder only makes sense for an upcoming appointment that has a phone.
    const canRemind = !cancelled && a.date >= today && a.client_phone;
    const remindBtn = canRemind ? `<button class="appt-btn remind" data-id="${a.id}">💬 שלחי תזכורת</button>` : '';
    const actions = cancelled ? '' : `
      ${remindBtn}
      <button class="appt-btn edit" data-id="${a.id}">הזזה</button>
      <button class="appt-btn cancel" data-id="${a.id}">ביטול</button>`;
    return `<div class="admin-appt-card ${cancelled ? 'is-cancelled' : ''}">
      <div class="aac-main">
        <div class="aac-when"><strong>📅 ${fmtDate(a.date)}</strong> · ⏰ ${time} <span class="aac-dow">(${dowLabel(a.date)})</span></div>
        <div class="aac-client">👤 ${a.client_name} · 📞 ${a.client_phone || '—'}</div>
        <div class="aac-svc">${svc}</div>
      </div>
      <div class="aac-side">
        <span class="aac-price">${ils(Number(a.total_price || 0))}</span>
        <span class="aac-dur">${a.duration_min} דק'</span>
        <span class="aac-status st-${a.status}">${statusLabel[a.status] || a.status}</span>
      </div>
      <div class="aac-actions">${actions}</div>
    </div>`;
  }).join('');

  box.querySelectorAll('.appt-btn.remind').forEach(b =>
    b.addEventListener('click', () => sendReminder(b.dataset.id)));
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
    tbody.innerHTML = `<tr><td colspan="6" class="clients-empty">${msg}</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(c => `
    <tr class="client-row" data-client-id="${c.id}">
      <td class="cl-name">${c.full_name || MUTED}</td>
      <td dir="ltr" style="text-align:right;">${c.phone || MUTED}</td>
      <td dir="ltr" style="text-align:right;">${c.email || MUTED}</td>
      <td>${fmtStamp(c.last_appointment, true)}</td>
      <td>${fmtStamp(c.last_login, true)}</td>
      <td>${fmtStamp(c.created_at, false)}</td>
    </tr>`).join('');
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

// Fill the live side panel with a client's stats. The panel stays in the page,
// so hovering down the rows updates it in place instead of covering the table.
function showClientPanel(client) {
  const st = clientStats(client.id);
  document.getElementById('client-panel-empty').hidden = true;
  document.getElementById('client-panel-body').hidden  = false;   // reveal before drawing
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

  const tbody = document.getElementById('clients-tbody');
  if (!tbody) return;

  // Highlight the row and refresh the side panel. Guarded on the client id so
  // moving the pointer within a row doesn't redraw the chart repeatedly.
  let activeId = null;
  const activate = row => {
    if (row.dataset.clientId === activeId) return;
    activeId = row.dataset.clientId;
    tbody.querySelectorAll('.client-row.is-active').forEach(r => r.classList.remove('is-active'));
    row.classList.add('is-active');
    const client = dash.clients.find(c => String(c.id) === row.dataset.clientId);
    if (client) showClientPanel(client);
  };

  // Click works everywhere (and is the only trigger on touch devices)…
  tbody.addEventListener('click', e => {
    const row = e.target.closest('.client-row');
    if (row) activate(row);
  });
  // …and on pointer devices, simply moving between rows updates the panel live.
  if (window.matchMedia('(hover: hover)').matches) {
    tbody.addEventListener('mouseover', e => {
      const row = e.target.closest('.client-row');
      if (row) activate(row);
    });
  }
}

async function adminCancel(id) {
  const appt = dash.appointments.find(a => String(a.id) === String(id));
  if (!appt) return;
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

  renderKPIs(); renderCharts(); renderAppointments();
}

// ── Reschedule modal ──
let reschedTarget = null;
let reschedSelDate = null;
let reschedSelTime = null;
let reschedCalYear = new Date().getFullYear();
let reschedCalMonth = new Date().getMonth();

function openReschedule(id) {
  const appt = dash.appointments.find(a => String(a.id) === String(id));
  if (!appt) return;
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

  renderReschedCalendar().then(() => loadReschedSlots(reschedSelDate));
  document.getElementById('resched-modal').style.display = 'flex';
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

async function loadReschedSlots(dateStr) {
  const box  = document.getElementById('resched-slots-box');
  const grid = document.getElementById('resched-slots-grid');
  const lbl  = document.getElementById('resched-date-label');
  box.style.display = 'block';
  lbl.textContent = `${dowLabel(dateStr)} · ${fmtDate(dateStr)}`;
  grid.innerHTML = '<div class="slots-loading"><div class="spinner"></div><span>טוענת שעות…</span></div>';
  refreshReschedSave();

  const [Y, M] = dateStr.split('-').map(Number);
  const states  = await getMonthDayStates(Y, M - 1);
  const windows = effectiveOpen(dateStr, states.get(dateStr));
  const duration = reschedTarget.duration_min;

  // Other active appointments on this day (the one being moved doesn't block itself).
  const busy = dash.appointments
    .filter(a => a.date === dateStr && a.status !== 'cancelled' && String(a.id) !== String(reschedTarget.id))
    .map(a => ({ start: toMin(a.start_time.slice(0, 5)), end: toMin(a.start_time.slice(0, 5)) + a.duration_min }));

  const today  = todayStr();
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();

  const slots = [];
  windows.forEach(w => {
    for (let m = w.start; m + duration <= w.end; m += 15) {
      if (dateStr === today && m <= nowMin) continue;             // no past times today
      const overlaps = busy.some(b => m < b.end && m + duration > b.start);
      slots.push({ min: m, label: `${pad(Math.floor(m / 60))}:${pad(m % 60)}`, busy: overlaps });
    }
  });

  if (!slots.length) {
    grid.innerHTML = '<div class="no-slots">אין שעות פנויות ביום זה 😔<br/>בחרי יום אחר</div>';
    return;
  }

  grid.innerHTML = slots.map(s =>
    `<div class="time-slot ${s.busy ? 'busy' : ''} ${s.label === reschedSelTime ? 'selected' : ''}" ${s.busy ? '' : `data-time="${s.label}"`}>${s.label}</div>`
  ).join('');
  grid.querySelectorAll('.time-slot[data-time]').forEach(c =>
    c.addEventListener('click', () => selectReschedSlot(c.dataset.time)));
}

function selectReschedSlot(time) {
  reschedSelTime = time;
  document.querySelectorAll('#resched-slots-grid .time-slot').forEach(c => c.classList.remove('selected'));
  document.querySelector(`#resched-slots-grid .time-slot[data-time="${time}"]`)?.classList.add('selected');
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

  const btn = document.getElementById('resched-save');
  btn.disabled = true; btn.textContent = 'מעדכנת…';

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

  document.getElementById('resched-modal').style.display = 'none';
  if (!calOk) alert('התור עודכן במערכת, אך ייתכן שלא עודכן ביומן Google — כדאי לבדוק ידנית.');
  renderKPIs(); renderCharts(); renderAppointments();
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

  document.getElementById('resched-close').addEventListener('click', () =>
    document.getElementById('resched-modal').style.display = 'none');
  document.getElementById('resched-modal').addEventListener('click', e => {
    if (e.target.id === 'resched-modal') e.target.style.display = 'none';
  });
  document.getElementById('resched-save').addEventListener('click', saveReschedule);
}

// Go.
bootstrap();
