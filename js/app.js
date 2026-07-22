/* ═══════════════════════════════════════════
   MORIYA NAILS – Frontend Application
   Booking logic, calendar, API integration
═══════════════════════════════════════════ */

// Backend URL – update this after deploying the server
const API_BASE = window.location.hostname === 'localhost'
  ? 'http://localhost:3001'
  : ''; // Set to your deployed backend URL

// ─── Booking state ───────────────────────────────────────────────────────────
const state = {
  // Services – base treatment defaults to gel polish with anatomic structure.
  baseName:  "מניקור לק ג'ל עם מבנה אנטומי",
  baseTime:  90,
  basePrice: 160,
  addons:    [],   // { name, time, price }
  totalTime: 90,
  totalPrice: 160,

  // Date & time
  selectedDate: null,   // 'YYYY-MM-DD'
  selectedTime: null,   // 'HH:MM'

  // Personal
  clientName:  '',
  clientPhone: '',
  clientNotes: '',
};

// When set, the booking date/time step reschedules this existing appointment
// instead of creating a new one.
let editingAppointment = null;

// Add-ons a client may add to / remove from an existing appointment while
// rescheduling. Only the base treatment (gel polish / anatomic structure) stays
// locked – every add-on is editable, and the changes sync to Moriya's calendar
// on update. The `name` fields match the booking flow exactly so add-ons already
// on the appointment map back onto these controls (pre-filled and removable).
// `time`/`price` are per-unit; quantity rows multiply by the chosen count.
const RESCHEDULE_EXTRAS = [
  { id: 'double',  emoji: '💎', name: 'שתי שכבות בייס / אבקת אקריל',              desc: 'חיזוק נוסף לציפורניים',                        type: 'checkbox', time: 15, price: 20 },
  { id: 'french',  emoji: '🌸', name: 'פרנץ׳ קלאסי ואלגנטי / מעבר אומברה עדין', desc: 'פרנץ׳ קלאסי או מעבר אומברה עדין',              type: 'checkbox', time: 15, price: 20 },
  { id: 'deco',    emoji: '🎨', name: 'קישוט',                                   desc: 'המחיר (5–40 ₪) ייקבע בתור לפי העיצוב',         type: 'checkbox', time: 10, price: 0, priceLabel: '5–40 ₪ (ייקבע בתור)' },
  { id: 'polygel', emoji: '🔧', name: "השלמת ציפורן בטיפס ג'ל",                  desc: 'השלמת ציפורן שנשברה · 15 ₪ ו-10 דק׳ לציפורן', type: 'quantity', time: 10, price: 15 },
  { id: 'crack',   emoji: '🩹', name: 'תיקון סדק בציפורן',                       desc: 'תיקון מהיר לסדק · 5 ₪ ו-5 דק׳ לציפורן',       type: 'quantity', time: 5,  price: 5  },
  { id: 'pincer',  emoji: '📐', name: 'תיקון מבנה נשרי לציפורן',                 desc: 'החזרת מבנה ישר לציפורן · 15 ₪ ו-10 דק׳ לציפורן', type: 'quantity', time: 10, price: 15 },
  { id: 'toolkit', emoji: '💼', name: 'סט כלים אישי',                            desc: 'סט כלים אישי הנשמר על שמך לטיפולים הבאים',      type: 'checkbox', time: 0,  price: 30 },
];

// Extras chosen for the current reschedule, in the same {name,time,price} shape
// as the booking flow so they can be merged straight back onto the appointment.
let rescheduleExtras = [];

// The locked part of the appointment being rescheduled (the base manicure plus
// any service that doesn't map to an editable add-on). Its time/price form the
// floor that the editable extras are added on top of.
let rescheduleBase = { services: [], time: 0, price: 0 };

// Pre-fill state for the extras controls, derived from the appointment's current
// add-ons: { [extraId]: true } for checkboxes, { [extraId]: qty } for quantities.
let reschedulePrefill = {};

// ─── Navbar scroll effect ─────────────────────────────────────────────────────
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 40);
});

// ─── Mobile hamburger ─────────────────────────────────────────────────────────
document.getElementById('hamburger').addEventListener('click', () => {
  document.getElementById('nav-links').classList.toggle('open');
});
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => {
    document.getElementById('nav-links').classList.remove('open');
  });
});

// ─── Scroll reveal ────────────────────────────────────────────────────────────
const revealObserver = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
}, { threshold: 0.15 });

document.querySelectorAll('.about-card, .contact-card')
  .forEach(el => { el.classList.add('reveal'); revealObserver.observe(el); });

// ─── Polish teaser: scroll-driven floating hand ──────────────────────────────
// A small transparent hand fixed to the bottom-right corner. As the page is
// scrolled, its nails fill with gel polish: scroll progress 0→1 is written into
// --p and CSS derives the fill. Non-blocking (only reads scrollY). The whole
// widget is an <a> to #booking, so clicking navigates there.
(function initPolishTeaser() {
  const widget = document.querySelector('.polish-teaser');
  if (!widget) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  widget.classList.add('ready');
  if (reduce) return;                        // CSS shows the finished hand

  let ticking = false;

  function update() {
    ticking = false;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    widget.style.setProperty('--p', p.toFixed(4));
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  update();
})();

// ═══════════════════════════════════════════════════════════════════════════════
//  STEP 1 – Service Selection
// ═══════════════════════════════════════════════════════════════════════════════

// Helper: recalculate and display totals
function recalculate() {
  // Two mutually-exclusive base treatments (basic vs. anatomic structure).
  // Whichever base checkbox is selected defines the base name/time/price;
  // with none selected there is no base manicure = quick fix.
  const selectedBase = document.querySelector('.base-treatment-row .base-check:checked')
    ?.closest('.base-treatment-row');
  const baseChecked = !!selectedBase;
  state.baseIncluded = baseChecked;
  state.baseName  = selectedBase?.querySelector('.t-name')?.textContent.trim() || '';
  state.baseTime  = selectedBase ? (parseInt(selectedBase.dataset.time)  || 0) : 0;
  state.basePrice = selectedBase ? (parseInt(selectedBase.dataset.price) || 0) : 0;
  document.querySelectorAll('.base-treatment-row').forEach(row => {
    const cb = row.querySelector('.base-check');
    row.classList.toggle('unchecked', !(cb && cb.checked));
  });

  // Hide/show addon rows that only apply with the base manicure
  document.querySelectorAll('.addon-row[data-requires-base="true"]').forEach(row => {
    row.style.display = baseChecked ? '' : 'none';
    if (!baseChecked) {
      const cb = row.querySelector('input[type="checkbox"]');
      if (cb && cb.checked) cb.checked = false;
    }
  });

  // Personal toolkit add-on: selectable only alongside another treatment.
  // "Another treatment" = the base manicure, any other checked add-on, or any
  // quantity add-on with a count above zero.
  let hasOtherTreatment = baseChecked;
  document.querySelectorAll('.addon-row[data-type="checkbox"]').forEach(row => {
    if (row.classList.contains('toolkit-row')) return;
    const cb = row.querySelector('input[type="checkbox"]');
    if (cb && cb.checked) hasOtherTreatment = true;
  });
  document.querySelectorAll('.addon-row[data-type="quantity"] .qty-input').forEach(input => {
    if ((parseInt(input.value) || 0) > 0) hasOtherTreatment = true;
  });
  const toolkitCb   = document.getElementById('chk-toolkit');
  const toolkitRow  = document.querySelector('.toolkit-row');
  const toolkitHint = document.getElementById('toolkit-hint');
  if (toolkitCb) {
    if (!hasOtherTreatment && toolkitCb.checked) toolkitCb.checked = false;
    toolkitCb.disabled = !hasOtherTreatment;
  }
  if (toolkitRow)  toolkitRow.classList.toggle('disabled', !hasOtherTreatment);
  if (toolkitHint) toolkitHint.style.display = hasOtherTreatment ? 'none' : 'block';

  let totalTime  = baseChecked ? state.baseTime  : 0;
  let totalPrice = baseChecked ? state.basePrice : 0;
  const addons   = [];

  // Checkbox add-ons
  document.querySelectorAll('.addon-row[data-type="checkbox"]').forEach(row => {
    const checkbox = row.querySelector('input[type="checkbox"]');
    if (!checkbox) return;
    if (checkbox.checked) {
      const t = parseInt(row.dataset.time  || 0);
      const p = parseInt(row.dataset.price || 0);
      const name = row.querySelector('.a-name')?.textContent.trim() || '';
      totalTime  += t;
      totalPrice += p;
      addons.push({ name, time: t, price: p });
      row.classList.add('checked');
    } else {
      row.classList.remove('checked');
    }
  });

  // Decoration (special – price decided at the appointment, 5–40 ₪)
  // Time (+10 min) is counted by the checkbox loop above (data-time="10").
  // The price is NOT added to the numeric total – it is set in person by the design.
  const decoCheck   = document.getElementById('chk-deco');
  const decoNoteBox = document.getElementById('deco-note-box');
  const decoSummaryNote = document.getElementById('summary-deco-note');
  const decoSelected = !!(decoCheck && decoCheck.checked);
  if (decoNoteBox)     decoNoteBox.style.display     = decoSelected ? 'flex'  : 'none';
  if (decoSummaryNote) decoSummaryNote.style.display = decoSelected ? 'block' : 'none';
  if (decoSelected) {
    // Mark the decoration add-on with a range label instead of a fixed price.
    const idx = addons.findIndex(a => a.name.includes('קישוט'));
    if (idx !== -1) addons[idx].priceLabel = '5–40 ₪ (ייקבע בתור)';
  }

  // Quantity add-ons
  document.querySelectorAll('.addon-row[data-type="quantity"]').forEach(row => {
    const qtyInput = row.querySelector('.qty-input');
    if (!qtyInput) return;
    const qty      = Math.max(0, parseInt(qtyInput.value) || 0);
    const tPerUnit = parseInt(row.dataset.timePerUnit  || 0);
    const pPerUnit = parseInt(row.dataset.pricePerUnit || 0);
    const name     = row.querySelector('.a-name')?.textContent.trim() || '';
    const t = qty * tPerUnit;
    const p = qty * pPerUnit;
    totalTime  += t;
    totalPrice += p;

    // Update per-row display
    const timeEl  = row.querySelector('.qty-time');
    const priceEl = row.querySelector('.qty-price');
    if (timeEl)  timeEl.textContent  = '+' + t + ' דק\'';
    if (priceEl) priceEl.textContent = '+' + p + ' ₪';

    if (qty > 0) addons.push({ name: `${name} (×${qty})`, time: t, price: p });
  });

  state.totalTime  = totalTime;
  state.totalPrice = totalPrice;
  state.addons     = addons;

  document.getElementById('sum-time').textContent  = totalTime + ' דקות';
  document.getElementById('sum-price').textContent = totalPrice + ' ₪';

  // Can't continue with nothing selected
  const goStep2 = document.getElementById('go-step2');
  if (goStep2) goStep2.disabled = totalTime === 0;

  updateBookingSummary();
}

// ─── Live appointment summary (under the steps) ───────────────────────────────
// The current booking step (1–3); used to decide when the summary should show.
let currentBookingStep = 1;

function summaryTreatmentsLabel() {
  const parts = [];
  if (state.baseIncluded) parts.push(state.baseName);
  state.addons.forEach(a => parts.push(a.name));
  if (!parts.length) return '';
  return parts.length <= 2 ? parts.join(' + ') : `${parts[0]} +${parts.length - 1} תוספות`;
}

// Format a minutes total as a friendly Hebrew duration (e.g. "שעה ורבע", "75 דק'").
function formatDuration(min) {
  const h = Math.floor(min / 60), m = min % 60;
  if (h === 0) return `${m} דק׳`;
  const hWord = h === 1 ? 'שעה' : h === 2 ? 'שעתיים' : `${h} שעות`;
  if (m === 0)  return hWord;
  if (m === 15) return `${hWord} ורבע`;
  if (m === 30) return `${hWord} וחצי`;
  if (m === 45) return `${hWord} ושלושת רבעי`;
  return `${hWord} ו-${m} דק׳`;
}

function updateBookingSummary() {
  const bar = document.getElementById('booking-summary');
  if (!bar) return;

  let treatments, duration, price;
  if (editingAppointment) {
    // Rescheduling an existing appointment – reflect the locked base plus the
    // add-ons currently selected (which the client can add to or remove).
    const svc = [
      ...rescheduleBase.services.map(s => s.name),
      ...rescheduleExtras.map(e => e.name)
    ];
    treatments = svc.length
      ? (svc.length <= 2 ? svc.join(' + ') : `${svc[0]} +${svc.length - 1} תוספות`)
      : "מניקור לק ג'ל";
    const newDuration = rescheduleBase.time  + extrasTotalTime();
    const newPrice    = rescheduleBase.price + extrasTotalPrice();
    const hasDeco     = rescheduleExtras.some(e => e.priceLabel);
    duration = formatDuration(newDuration);
    price    = newPrice + ' ₪' + (hasDeco ? ' + קישוט' : '');
  } else {
    if (!state.totalTime) { bar.style.display = 'none'; return; }
    // On step 1 stay hidden until the client adds something beyond the default
    // base manicure; from step 2 onward it always shows.
    const isDefaultSelection = state.baseIncluded && state.addons.length === 0;
    if (currentBookingStep === 1 && isDefaultSelection) { bar.style.display = 'none'; return; }

    treatments = summaryTreatmentsLabel() || '—';
    duration   = formatDuration(state.totalTime);
    const hasDeco = state.addons.some(a => a.priceLabel);
    price = state.totalPrice + ' ₪' + (hasDeco ? ' + קישוט' : '');
  }

  bar.style.display = 'flex';
  document.getElementById('bs-treatments').textContent = treatments;
  document.getElementById('bs-duration').textContent   = duration;
  document.getElementById('bs-price').textContent      = price;

  const whenWrap = document.getElementById('bs-when-wrap');
  const whenEl   = document.getElementById('bs-when');
  if (state.selectedDate) {
    const [, m, d] = state.selectedDate.split('-');
    whenEl.textContent = state.selectedTime ? `${d}/${m} · ${state.selectedTime}` : `${d}/${m}`;
    whenWrap.style.display = 'flex';
  } else {
    whenWrap.style.display = 'none';
  }
}

// Attach listeners
document.querySelectorAll('.addon-check').forEach(cb => {
  cb.addEventListener('change', recalculate);
});
// Base treatments are mutually exclusive – selecting one clears the other.
document.querySelectorAll('.base-check').forEach(cb => {
  cb.addEventListener('change', () => {
    if (cb.checked) {
      document.querySelectorAll('.base-check').forEach(other => {
        if (other !== cb) other.checked = false;
      });
    }
    recalculate();
  });
});
document.querySelectorAll('.qty-input').forEach(input => {
  input.addEventListener('input', () => {
    let v = parseInt(input.value) || 0;
    const max = parseInt(input.max) || 10;
    if (v < 0)   v = 0;
    if (v > max) v = max;
    input.value = v;
    recalculate();
  });
});
document.querySelectorAll('.qty-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const targetId = btn.dataset.target;
    const input    = document.getElementById(targetId);
    if (!input) return;
    let v   = parseInt(input.value) || 0;
    const max = parseInt(input.max) || 10;
    if (btn.classList.contains('plus')  && v < max) v++;
    if (btn.classList.contains('minus') && v > 0)   v--;
    input.value = v;
    recalculate();
  });
});
document.getElementById('chk-deco')?.addEventListener('change', recalculate);

recalculate(); // initial

// Step 1 → Step 2
document.getElementById('go-step2').addEventListener('click', () => {
  exitRescheduleMode();                      // fresh booking, not a reschedule
  state.selectedTime = null;                 // reset – duration may have changed
  const next = document.getElementById('go-step3');
  if (next) { next.textContent = 'המשיכי לפרטים ←'; next.disabled = true; }
  showStep(2);
  renderCalendar();
  if (state.selectedDate) loadTimeSlots(state.selectedDate);
});

// ═══════════════════════════════════════════════════════════════════════════════
//  STEP 2 – Calendar & Time Slots
// ═══════════════════════════════════════════════════════════════════════════════

let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth();

const HE_MONTHS = [
  'ינואר','פברואר','מרץ','אפריל','מאי','יוני',
  'יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'
];
const HE_DAY_NAMES = ['א\'','ב\'','ג\'','ד\'','ה\'','ו\'','ש\''];

// ─── Availability (admin-managed) ─────────────────────────────────────────────
// Per-day model:
//   • Fridays are work days by default (09:00–17:00) — no DB row needed.
//   • The admin can add explicit 'open' windows (any day), 'block' breaks, or a
//     'closed' marker that turns a default Friday off.
// Effective open windows for a day:
//   closed → none · explicit open rows → those · else Friday → default · else none.
// Each open window is sliced into appointments on a grid that depends on the
// treatment length (90-min standard, 30-min for short treatments), minus breaks.
const SLOT_LEN = 90; // minutes per bookable appointment slot (standard treatments)
// Short treatments (under SHORT_TREATMENT_MAX) book on a tighter 30-min grid
// instead of the 90-min cadence, so quick visits don't waste a full slot.
const SHORT_SLOT_LEN = 30;
const SHORT_TREATMENT_MAX = 35; // durations strictly under this use the 30-min grid
const DEFAULT_FRIDAY_OPEN = [{ start: 9 * 60, end: 17 * 60 }]; // 09:00–17:00
const padNum   = n => String(n).padStart(2, '0');
const hhmmToMin = hhmm => { const [h, m] = hhmm.slice(0, 5).split(':').map(Number); return h * 60 + m; };
const isFridayStr = dateStr => new Date(`${dateStr}T00:00:00`).getDay() === 5;

const availabilityCache = new Map(); // 'YYYY-M' → Map(date → {open,block,closed})

async function getMonthAvailability(year, month /* 0-based */) {
  const key = `${year}-${month}`;
  if (availabilityCache.has(key)) return availabilityCache.get(key);

  const first   = `${year}-${padNum(month + 1)}-01`;
  const lastNum = new Date(year, month + 1, 0).getDate();
  const last    = `${year}-${padNum(month + 1)}-${padNum(lastNum)}`;

  const byDate = new Map();
  try {
    if (window.MoriyaAuth && MoriyaAuth.sb) {
      const { data } = await MoriyaAuth.sb
        .from('availability')
        .select('date,start_time,end_time,kind')
        .gte('date', first).lte('date', last);
      (data || []).forEach(r => {
        const info = byDate.get(r.date) || { open: [], block: [], closed: false };
        if (r.kind === 'closed') info.closed = true;
        else if (r.kind === 'block') info.block.push({ start: hhmmToMin(r.start_time), end: hhmmToMin(r.end_time) });
        else info.open.push({ start: hhmmToMin(r.start_time), end: hhmmToMin(r.end_time) });
        byDate.set(r.date, info);
      });
    }
  } catch (e) { /* network/RLS error → defaults still apply (Fridays) */ }

  availabilityCache.set(key, byDate);
  return byDate;
}

// The day's effective open windows, applying the Friday default.
function effectiveOpenWindows(dateStr, info) {
  if (info && info.closed) return [];
  if (info && info.open && info.open.length) return info.open;
  return isFridayStr(dateStr) ? DEFAULT_FRIDAY_OPEN.map(w => ({ ...w })) : [];
}

async function getDayWindows(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  const byDate = await getMonthAvailability(y, m - 1);
  const info   = byDate.get(dateStr) || { open: [], block: [], closed: false };
  return { open: effectiveOpenWindows(dateStr, info), block: info.block || [] };
}

// Busy intervals for a day, cached so the calendar can check every open day
// without re-hitting the backend on each re-render. On error we treat the day
// as free (safe default – the day stays available).
const busySlotsCache = new Map(); // dateStr → [{start,end}]
async function getBusySlots(dateStr) {
  if (busySlotsCache.has(dateStr)) return busySlotsCache.get(dateStr);
  let busy = [];
  try {
    const res  = await fetch(`${API_BASE}/api/busy-slots?date=${dateStr}`);
    const data = await res.json();
    busy = data.busySlots || [];
  } catch (e) { /* backend unreachable → treat as free */ }
  busySlotsCache.set(dateStr, busy);
  return busy;
}

// Remove [s,e) from a list of busy intervals, splitting any interval it cuts
// through. Used so an appointment's own slot doesn't count as busy against
// itself while rescheduling (otherwise its current time would look taken).
function subtractInterval(busy, s, e) {
  const out = [];
  (busy || []).forEach(b => {
    if (e <= b.start || s >= b.end) { out.push(b); return; }  // no overlap
    if (s > b.start) out.push({ start: b.start, end: s });
    if (e < b.end)   out.push({ start: e,       end: b.end });
  });
  return out;
}

// On the appointment's own date during a reschedule, free up its current slot so
// the client can keep the same time (and so it stays selectable after changes).
function carveOwnAppointment(dateStr, busy) {
  if (!editingAppointment || dateStr !== editingAppointment.date) return busy;
  const [h, m] = (editingAppointment.start_time || '00:00').split(':').map(Number);
  const s = h * 60 + m;
  return subtractInterval(busy, s, s + (editingAppointment.duration_min || 0));
}

async function renderCalendar() {
  const box    = document.getElementById('calendar-box');
  const today  = new Date();
  today.setHours(0, 0, 0, 0);

  const byDate = await getMonthAvailability(calYear, calMonth);

  const firstDay = new Date(calYear, calMonth, 1);
  const lastDay  = new Date(calYear, calMonth + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startDow    = firstDay.getDay(); // 0=Sun

  // Clients book inside a rolling window only – no navigating past its month,
  // and no navigating back before the current one.
  const horizon    = MoriyaBooking.horizonDate();
  const horizonStr = MoriyaBooking.toDateStr(horizon);
  const atLast  = calYear > horizon.getFullYear() ||
                  (calYear === horizon.getFullYear() && calMonth >= horizon.getMonth());
  const atFirst = calYear < today.getFullYear() ||
                  (calYear === today.getFullYear() && calMonth <= today.getMonth());

  let html = `
    <div class="cal-header">
      <button class="cal-nav" id="cal-prev" ${atFirst ? 'disabled' : ''}>›</button>
      <h4>${HE_MONTHS[calMonth]} ${calYear}</h4>
      <button class="cal-nav" id="cal-next" ${atLast ? 'disabled' : ''}>‹</button>
    </div>
    <div class="cal-grid">
      ${HE_DAY_NAMES.map(d => `<div class="cal-day-name">${d}</div>`).join('')}
  `;

  // Empty cells
  for (let i = 0; i < startDow; i++) {
    html += '<div class="cal-day empty"></div>';
  }

  // First pass: classify each day. A "candidate" has effective open windows
  // (Fridays by default, any day the admin opened, unless closed) and falls
  // inside the rolling booking window.
  const dayMeta = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const d        = new Date(calYear, calMonth, day);
    const isPast   = d < today;
    const dateStr  = `${calYear}-${padNum(calMonth+1)}-${padNum(day)}`;
    const isBeyond = dateStr > horizonStr;
    const hasWindows = effectiveOpenWindows(dateStr, byDate.get(dateStr)).length > 0;
    dayMeta.push({ day, dateStr, isPast, isBeyond, candidate: !isPast && !isBeyond && hasWindows });
  }

  // Second pass: for candidate days, check the calendar so days whose free
  // slots are all taken render (and behave) like non-working days – the client
  // can only pick a date that still has room for her selected treatment.
  const fullDates = new Set();
  await Promise.all(dayMeta.filter(m => m.candidate).map(async m => {
    const wins    = await getDayWindows(m.dateStr);
    const busy    = carveOwnAppointment(m.dateStr, await getBusySlots(m.dateStr));
    const hasFree = buildAvailableSlots(state.totalTime, busy, m.dateStr, wins).some(s => !s.busy);
    if (!hasFree) fullDates.add(m.dateStr);
  }));

  for (const meta of dayMeta) {
    const { day, dateStr, isPast, isBeyond, candidate } = meta;
    const isSelected = state.selectedDate === dateStr;
    const bookable   = candidate && !fullDates.has(dateStr);

    let cls = 'cal-day';
    if (!bookable) {
      cls += isPast ? ' past' : isBeyond ? ' beyond-horizon' : ' not-friday';
    } else {
      cls += ' friday-avail';
      if (isSelected) cls += ' selected';
    }

    const dataAttr = bookable ? `data-date="${dateStr}"` : '';
    let title = '';
    if (isBeyond)                    title = ' title="ניתן לקבוע תורים עד חודשיים מראש"';
    else if (candidate && !bookable) title = ' title="אין שעות פנויות ביום זה"';
    html += `<div class="${cls}" ${dataAttr}${title}>${day}</div>`;
  }

  html += '</div>';
  // Explain the window only on the last navigable month – the first page where
  // days actually appear blocked. Earlier months need no explanation.
  if (atLast) {
    const [hY, hM, hD] = horizonStr.split('-');
    html += `<p class="cal-horizon-note">🗓️ ניתן לקבוע תור עד ${hD}/${hM}/${hY} · מועדים רחוקים יותר ייפתחו בהמשך 💕</p>`;
  }
  box.innerHTML = html;

  document.getElementById('cal-prev')?.addEventListener('click', () => {
    calMonth--;
    if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCalendar();
  });
  document.getElementById('cal-next')?.addEventListener('click', () => {
    calMonth++;
    if (calMonth > 11) { calMonth = 0; calYear++; }
    renderCalendar();
  });

  box.querySelectorAll('.friday-avail').forEach(cell => {
    cell.addEventListener('click', () => {
      state.selectedDate = cell.dataset.date;
      state.selectedTime = null;
      document.getElementById('go-step3').disabled = true;
      updateBookingSummary();
      renderCalendar();
      loadTimeSlots(state.selectedDate);
    });
  });
}

async function loadTimeSlots(dateStr) {
  const slotsBox  = document.getElementById('slots-box');
  const slotsGrid = document.getElementById('slots-grid');
  const dateLabel = document.getElementById('selected-date-label');

  // Format date for display
  const [y, m, d] = dateStr.split('-');
  dateLabel.textContent = `${d}/${m}/${y}`;

  slotsBox.style.display = 'block';
  slotsGrid.innerHTML = '<div class="slots-loading"><div class="spinner"></div><span>טוענת שעות פנויות…</span></div>';

  let busySlots = [];
  try {
    const res  = await fetch(`${API_BASE}/api/busy-slots?date=${dateStr}`);
    const data = await res.json();
    busySlots  = data.busySlots || [];
  } catch (e) {
    // Backend not connected yet – show all slots as available
    console.warn('Backend not reachable, showing all slots as available');
  }

  // A logged-in user may have only one appointment per day.
  if (window.MoriyaAuth && MoriyaAuth.isLoggedIn()) {
    try {
      const { data: existing } = await MoriyaAuth.sb
        .from('appointments')
        .select('id')
        .eq('user_id', MoriyaAuth.user.id)
        .eq('date', dateStr)
        .neq('status', 'cancelled');
      const conflicts = (existing || []).filter(
        a => !editingAppointment || a.id !== editingAppointment.id
      );
      if (conflicts.length > 0) {
        slotsGrid.innerHTML = '<div class="no-slots">כבר קבעת תור ליום זה 💅<br/>ניתן לקבוע תור אחד בלבד בכל יום</div>';
        return;
      }
    } catch (e) { /* on error, allow booking */ }
  }

  busySlots = carveOwnAppointment(dateStr, busySlots);
  const dayWindows = await getDayWindows(dateStr);
  const slots = buildAvailableSlots(state.totalTime, busySlots, dateStr, dayWindows);
  renderSlots(slots, slotsGrid);
}

// Slice an open window [ws,we) into appointment start times. The cadence depends
// on the treatment length: short treatments (under SHORT_TREATMENT_MAX) book on a
// 30-min grid, everything else on the 90-min grid. A break shifts the cadence: the
// next start resumes from the break's end (so a 10:30–10:45 break makes the next
// slot 10:45, then a full step later …).
function sliceWindowWithBreaks(ws, we, breaks, durationMin) {
  const step = durationMin < SHORT_TREATMENT_MAX ? SHORT_SLOT_LEN : SLOT_LEN;
  const bks = (breaks || []).filter(b => b.end > ws && b.start < we).sort((a, b) => a.start - b.start);
  const starts = [];
  let cursor = ws;
  while (cursor + durationMin <= we) {
    const hit = bks.find(b => cursor < b.end && cursor + durationMin > b.start);
    if (hit) { cursor = hit.end; continue; }   // can't fit before this break → jump past it
    starts.push(cursor);
    cursor += step;                             // gap between appointments
  }
  return starts;
}

function buildAvailableSlots(durationMin, busySlots, dateStr, dayWindows) {
  const pad      = n => String(n).padStart(2, '0');
  const now      = new Date();
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const isToday  = dateStr === todayStr;
  const nowMin   = now.getHours() * 60 + now.getMinutes();

  const wins   = dayWindows || { open: [], block: [] };
  const blocks = wins.block || [];

  // 90-min cadence inside each effective open window, shifted by breaks.
  let starts = [];
  (wins.open || []).forEach(w => {
    sliceWindowWithBreaks(w.start, w.end, blocks, durationMin).forEach(m => starts.push(m));
  });
  starts = [...new Set(starts)].sort((a, b) => a - b);

  return starts.map(m => {
    const endM   = m + durationMin;
    const busy   = busySlots.some(b => m < b.end && endM > b.start);   // overlaps a booking
    const isPast = isToday && m <= nowMin;                              // already passed
    return {
      label: `${pad(Math.floor(m/60))}:${pad(m%60)}`,
      busy: busy || isPast,
      blockedReason: isPast ? 'past' : null
    };
  });
}

function renderSlots(slots, container) {
  if (slots.length === 0) {
    container.innerHTML = '<div class="no-slots">אין שעות פנויות ביום זה 😔<br/>נסי לבחור יום שישי אחר</div>';
    return;
  }
  container.innerHTML = slots.map(s => {
    const title = s.blockedReason === 'gap'
      ? 'title="לא ניתן להזמין – נשאר פרק זמן קצר מדי לפני התור"'
      : s.blockedReason === 'past'
      ? 'title="השעה כבר עברה"'
      : s.blockedReason === 'block'
      ? 'title="הפסקה – לא מתקבלים תורים בשעה זו"'
      : '';
    return `
    <div class="time-slot ${s.busy ? 'busy' : ''} ${s.blockedReason === 'gap' ? 'gap-blocked' : ''}"
         ${!s.busy ? `data-time="${s.label}"` : ''} ${title}>
      ${s.label}
    </div>`;
  }).join('');

  // Re-apply an existing selection: after a duration change the grid is rebuilt,
  // and if the chosen time still fits we keep it selected so the client can
  // update straight away without re-picking.
  let selectionSurvived = false;
  container.querySelectorAll('.time-slot:not(.busy)').forEach(el => {
    if (state.selectedTime && el.dataset.time === state.selectedTime) {
      el.classList.add('selected');
      selectionSurvived = true;
    }
    el.addEventListener('click', () => {
      container.querySelectorAll('.time-slot').forEach(e => e.classList.remove('selected'));
      el.classList.add('selected');
      state.selectedTime = el.dataset.time;
      document.getElementById('go-step3').disabled = false;
      updateBookingSummary();
    });
  });

  if (!selectionSurvived) state.selectedTime = null;
  const go = document.getElementById('go-step3');
  if (go) go.disabled = !state.selectedTime;
  updateBookingSummary();
}

// ─── Nearest available appointment ────────────────────────────────────────────
async function findNearestSlot() {
  const pad = n => String(n).padStart(2, '0');
  const today = new Date(); today.setHours(0, 0, 0, 0);

  // Dates the logged-in user already booked (one appointment per day)
  const bookedDates = new Set();
  if (window.MoriyaAuth && MoriyaAuth.isLoggedIn()) {
    try {
      const { data } = await MoriyaAuth.sb.from('appointments')
        .select('date').eq('user_id', MoriyaAuth.user.id).neq('status', 'cancelled');
      (data || []).forEach(a => bookedDates.add(a.date));
    } catch (e) { /* ignore */ }
  }

  const d = new Date(today);
  const horizon = MoriyaBooking.horizonDate();
  while (d <= horizon) {                         // search the whole booking window
    const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const wins    = await getDayWindows(dateStr);
    // Bookable when the day has effective open windows (Fridays by default).
    const bookable = wins.open.length > 0;
    if (bookable && !bookedDates.has(dateStr)) {
      const busy = await getBusySlots(dateStr);
      const free = buildAvailableSlots(state.totalTime, busy, dateStr, wins).find(s => !s.busy);
      if (free) return { date: dateStr, time: free.label };
    }
    d.setDate(d.getDate() + 1);
  }
  return null;
}

async function goToNearestSlot() {
  const btn = document.getElementById('btn-nearest');
  if (btn) { btn.disabled = true; btn.textContent = '🔎 מחפשת תור פנוי…'; }

  const result = await findNearestSlot();

  if (btn) { btn.disabled = false; btn.textContent = '✨ מצאי לי את התור הקרוב ביותר'; }
  if (!result) { alert('לא נמצא תור פנוי בחודשיים הקרובים. נסי שוב מאוחר יותר 💅'); return; }

  // Navigate the calendar to that month and auto-select the found slot
  const [y, m] = result.date.split('-').map(Number);
  calYear = y; calMonth = m - 1;
  state.selectedDate = result.date;
  state.selectedTime = null;
  renderCalendar();
  await loadTimeSlots(result.date);

  const grid = document.getElementById('slots-grid');
  const el   = grid && grid.querySelector(`.time-slot[data-time="${result.time}"]`);
  if (el) { el.click(); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
}

document.getElementById('btn-nearest')?.addEventListener('click', goToNearestSlot);

document.getElementById('back-step1')?.addEventListener('click', () => {
  // During a reschedule, "back" returns to the appointments list, not step 1.
  if (editingAppointment) {
    exitRescheduleMode();
    openMyAppointments();
    return;
  }
  showStep(1);
});
document.getElementById('go-step3')?.addEventListener('click', () => {
  if (editingAppointment) { updateAppointment(); return; }   // reschedule flow
  showStep(3);
  renderOrderSummary();
  prefillUserDetails();
});

// ═══════════════════════════════════════════════════════════════════════════════
//  STEP 3 – Personal Details & Submit
// ═══════════════════════════════════════════════════════════════════════════════

function renderOrderSummary() {
  const box = document.getElementById('order-summary');
  const [y, m, d] = state.selectedDate.split('-');
  const dateDisplay = `${d}/${m}/${y}`;

  const addonRows = state.addons.map(a => {
    const priceText = a.priceLabel ? a.priceLabel : (a.price > 0 ? '+' + a.price + ' ₪' : '');
    return `<div class="summary-item"><span>${a.name}</span><span>${priceText}</span></div>`;
  }).join('');

  const hasDeco = state.addons.some(a => a.priceLabel);
  const decoNote = hasDeco
    ? `<p class="summary-deco-note">✦ מחיר הקישוט (5–40 ₪) ייקבע בתור לפי העיצוב ואינו כלול בסכום למעלה</p>`
    : '';

  const baseRow = state.baseIncluded
    ? `<div class="summary-item"><span>💅 ${state.baseName}</span><span>${state.basePrice} ₪</span></div>`
    : '';

  box.innerHTML = `
    <h4>סיכום הזמנה</h4>
    <div class="summary-item"><span>📅 תאריך</span><span>${dateDisplay} (שישי)</span></div>
    <div class="summary-item"><span>⏰ שעה</span><span>${state.selectedTime}</span></div>
    ${baseRow}
    ${addonRows}
    <div class="summary-item total"><span>⏱ זמן כולל: ${state.totalTime} דקות</span><span>${state.totalPrice} ₪</span></div>
    ${decoNote}
  `;
}

// Prefill name & phone from the logged-in user's profile (autofill)
function prefillUserDetails() {
  if (!window.MoriyaAuth || !MoriyaAuth.isLoggedIn()) return;
  const nameEl  = document.getElementById('f-name');
  const phoneEl = document.getElementById('f-phone');
  const name    = MoriyaAuth.displayName();
  const phone   = (MoriyaAuth.profile && MoriyaAuth.profile.phone) || '';
  if (nameEl  && !nameEl.value  && name)  nameEl.value  = name;
  if (phoneEl && !phoneEl.value && phone) phoneEl.value = phone;
}

// Supabase access token of the logged-in user (used to authenticate
// cancel/reschedule calls to the calendar-sync backend).
async function getAccessToken() {
  if (!window.MoriyaAuth || !MoriyaAuth.isLoggedIn()) return null;
  try {
    const { data } = await MoriyaAuth.sb.auth.getSession();
    return (data && data.session && data.session.access_token) || null;
  } catch { return null; }
}

// Clear the error highlight as soon as the client starts filling a field.
['f-name', 'f-phone'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', function () {
    this.classList.remove('error');
  });
});

document.getElementById('back-step2')?.addEventListener('click', () => showStep(2));

document.getElementById('booking-form')?.addEventListener('submit', async e => {
  e.preventDefault();

  const name  = document.getElementById('f-name').value.trim();
  const phone = document.getElementById('f-phone').value.trim();
  const notes = document.getElementById('f-notes').value.trim();

  // Validation. Autofill fills name/phone for Google users, but a guest who
  // skipped a required field must be shown exactly what's missing – so we mark
  // each empty field and scroll the page to the first one (and focus it).
  let valid = true;
  let firstInvalid = null;
  const nameEl  = document.getElementById('f-name');
  const phoneEl = document.getElementById('f-phone');
  if (!name) {
    nameEl.classList.add('error');
    if (!firstInvalid) firstInvalid = nameEl;
    valid = false;
  } else {
    nameEl.classList.remove('error');
  }
  if (!phone) {
    phoneEl.classList.add('error');
    if (!firstInvalid) firstInvalid = phoneEl;
    valid = false;
  } else {
    phoneEl.classList.remove('error');
  }
  // Treatment policies must be opened and confirmed before booking
  const policyCheck   = document.getElementById('chk-policy');
  const policyConsent = document.getElementById('policy-consent');
  if (!policyCheck || !policyCheck.checked) {
    if (policyConsent) {
      policyConsent.classList.add('error');
      if (!firstInvalid) firstInvalid = policyConsent;
    }
    valid = false;
  } else if (policyConsent) {
    policyConsent.classList.remove('error');
  }
  if (!valid) {
    if (firstInvalid) {
      firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Focus the field so the client lands right on the highlighted input,
      // without a second jump (we already smooth-scrolled to it).
      if (typeof firstInvalid.focus === 'function') firstInvalid.focus({ preventScroll: true });
    }
    return;
  }

  const btn = e.target.querySelector('.btn-confirm');

  // Guard: one appointment per day per logged-in user (final safety check)
  if (window.MoriyaAuth && MoriyaAuth.isLoggedIn()) {
    try {
      const { data: existing } = await MoriyaAuth.sb
        .from('appointments')
        .select('id')
        .eq('user_id', MoriyaAuth.user.id)
        .eq('date', state.selectedDate)
        .neq('status', 'cancelled');
      if (existing && existing.length > 0) {
        alert('כבר קבעת תור ליום זה. ניתן לקבוע תור אחד בלבד בכל יום.');
        return;
      }
    } catch (e) { /* on error, continue */ }
  }

  btn.disabled    = true;
  btn.textContent = 'שולחת…';

  const services = [
    ...(state.baseIncluded ? [{ name: state.baseName, time: state.baseTime, price: state.basePrice }] : []),
    ...state.addons
  ];

  // 1) Create the Google Calendar event (existing backend)
  let googleEventId = null;
  try {
    const res = await fetch(`${API_BASE}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date:        state.selectedDate,
        time:        state.selectedTime,
        duration:    state.totalTime,
        clientName:  name,
        clientPhone: phone,
        notes,
        services,
        totalPrice:  state.totalPrice
      })
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      googleEventId = data.eventId || null;
    }
  } catch (err) {
    console.warn('Calendar booking failed (demo mode?):', err.message);
  }

  // 2) Save to Supabase (profile + appointment) for logged-in users
  try {
    if (window.MoriyaAuth && MoriyaAuth.isLoggedIn()) {
      const uid = MoriyaAuth.user.id;
      // remember name+phone for next-time autofill
      await MoriyaAuth.sb.from('profiles').update({ full_name: name, phone }).eq('id', uid);
      MoriyaAuth.profile = Object.assign({}, MoriyaAuth.profile, { full_name: name, phone });
      // store the appointment
      await MoriyaAuth.sb.from('appointments').insert({
        user_id:         uid,
        client_name:     name,
        client_phone:    phone,
        date:            state.selectedDate,
        start_time:      state.selectedTime,
        duration_min:    state.totalTime,
        services:        services,
        total_price:     state.totalPrice,
        status:          'booked',
        google_event_id: googleEventId,
        notes:           notes || null
      });
    }
  } catch (err) {
    console.warn('Supabase save failed:', err.message);
  }

  showSuccess(name, phone, notes);
});

// Format a 'YYYY-MM-DD' date as a friendly Hebrew string, e.g. "יום שישי, 27 ביוני 2026".
function formatHebrewDate(dateStr) {
  const dayNames   = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const monthNames = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
                      'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  const dt = new Date(`${dateStr}T00:00:00`);
  return `יום ${dayNames[dt.getDay()]}, ${dt.getDate()} ב${monthNames[dt.getMonth()]} ${dt.getFullYear()}`;
}

// Fill the confirmation card with appointment details and show the success step.
function renderSuccessCard({ heading, subtitle, treatments, duration, durationMinutes, price }) {
  const headingEl  = document.querySelector('#step-success h3');
  const subtitleEl = document.getElementById('success-subtitle');
  if (headingEl)  headingEl.textContent  = heading;
  if (subtitleEl) subtitleEl.textContent = subtitle;

  document.getElementById('sc-date').textContent     = formatHebrewDate(state.selectedDate);
  document.getElementById('sc-time').textContent     = state.selectedTime;
  document.getElementById('sc-duration').textContent = duration;
  document.getElementById('sc-price').textContent    = price;

  const treatEl = document.getElementById('sc-treatments');
  treatEl.innerHTML = treatments.map(t => `<span class="sc-treatment-item">${t}</span>`).join('');

  const gcalEl = document.getElementById('sc-gcal');
  if (gcalEl) gcalEl.href = buildGoogleCalendarUrl(treatments, durationMinutes, price);

  showStep('success');
}

// Build a Google Calendar "add event" link so the client can save the appointment
// to her own phone calendar with one tap. Times are anchored to Israel time.
function buildGoogleCalendarUrl(treatments, durationMinutes, priceText) {
  const pad = n => String(n).padStart(2, '0');
  const [y, m, d]   = state.selectedDate.split('-').map(Number);
  const [hh, mm]    = state.selectedTime.split(':').map(Number);
  const start = new Date(y, m - 1, d, hh, mm);
  const end   = new Date(start.getTime() + durationMinutes * 60000);
  const fmt = dt => `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}`
                  + `T${pad(dt.getHours())}${pad(dt.getMinutes())}00`;

  const params = new URLSearchParams({
    action:   'TEMPLATE',
    text:     `תור אצל מוריה – ${treatments.join(', ')}`,
    dates:    `${fmt(start)}/${fmt(end)}`,
    details:  `הטיפול: ${treatments.join(', ')}\nמחיר: ${priceText}`,
    location: 'יעקב בר סימנטוב 18',
    ctz:      'Asia/Jerusalem'
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function showSuccess(name, phone, notes) {
  const treatments = [
    ...(state.baseIncluded ? [state.baseName] : []),
    ...state.addons.map(a => a.name)
  ];
  if (!treatments.length) treatments.push("מניקור לק ג'ל");

  const hasDeco = state.addons.some(a => a.priceLabel);
  renderSuccessCard({
    heading:    'התור נקבע בהצלחה!',
    subtitle:   'ההזמנה נרשמה ביומן של מוריה. אשמח לראות אותך! 💅',
    treatments,
    duration:       formatDuration(state.totalTime),
    durationMinutes: state.totalTime,
    price:      `${state.totalPrice} ₪${hasDeco ? ' + קישוט (ייקבע בתור)' : ''}`
  });
}

// ─── Step navigation ──────────────────────────────────────────────────────────
function showStep(num) {
  if (typeof num === 'number') currentBookingStep = num;
  ['1','2','3','success'].forEach(id => {
    const el = document.getElementById(`step-${id}`);
    if (el) el.style.display = 'none';
  });
  const target = document.getElementById(`step-${num}`);
  if (target) target.style.display = 'block';

  // Update step indicators. A completed step doubles as a shortcut back to it.
  document.querySelectorAll('.step-item').forEach(item => {
    const n = parseInt(item.dataset.step);
    item.classList.remove('active', 'done');
    if (typeof num === 'number') {
      if (n === num)  item.classList.add('active');
      if (n <  num)   item.classList.add('done');
    }
    const canGoBack = item.classList.contains('done');
    item.classList.toggle('clickable', canGoBack);
    if (canGoBack) {
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      item.setAttribute('title', 'חזרה לשלב זה');
    } else {
      item.removeAttribute('role');
      item.removeAttribute('tabindex');
      item.removeAttribute('title');
    }
  });

  // The live summary follows steps 1–3 but hides on the success screen.
  const summary = document.getElementById('booking-summary');
  if (summary) {
    if (num === 'success') summary.style.display = 'none';
    else updateBookingSummary();
  }

  // Scroll to booking section smoothly
  const bookingEl = document.getElementById('booking');
  if (bookingEl) bookingEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── Step bar – jump back to a step already completed ─────────────────────────
// Only completed steps are clickable; moving forward stays with the flow's own
// buttons, which validate the step and refresh what the next one needs.
function goBackToStep(num) {
  if (num >= currentBookingStep) return;
  showStep(num);
}

document.querySelectorAll('.step-item').forEach(item => {
  const n = parseInt(item.dataset.step);
  item.addEventListener('click', () => {
    if (item.classList.contains('done')) goBackToStep(n);
  });
  item.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && item.classList.contains('done')) {
      e.preventDefault();
      goBackToStep(n);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  MY APPOINTMENTS – view / reschedule / cancel (logged-in users)
// ═══════════════════════════════════════════════════════════════════════════════

function localTodayStr() {
  const n = new Date(), p = x => String(x).padStart(2, '0');
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
}

async function openMyAppointments() {
  if (!window.MoriyaAuth || !MoriyaAuth.isLoggedIn()) return;
  const modal = document.getElementById('appts-modal');
  const list  = document.getElementById('appts-list');
  if (!modal || !list) return;

  modal.style.display = 'flex';
  list.innerHTML = '<div class="slots-loading"><div class="spinner"></div><span>טוען את התורים שלך…</span></div>';

  const { data, error } = await MoriyaAuth.sb
    .from('appointments')
    .select('*')
    .eq('user_id', MoriyaAuth.user.id)
    .neq('status', 'cancelled')
    .gte('date', localTodayStr())
    .order('date', { ascending: true })
    .order('start_time', { ascending: true });

  if (error) { list.innerHTML = '<p class="appts-empty">שגיאה בטעינת התורים 😔</p>'; return; }
  renderApptsList(data || []);
}
window.openMyAppointments = openMyAppointments;

function renderApptsList(appts) {
  const list = document.getElementById('appts-list');
  if (!appts.length) {
    list.innerHTML = '<p class="appts-empty">אין לך תורים קרובים 💅<br/>ניתן לקבוע תור חדש בכל עת</p>';
    return;
  }

  list.innerHTML = appts.map(a => {
    const [Y, M, D]  = a.date.split('-');
    const dateLabel  = `${D}/${M}/${Y}`;
    const timeLabel  = (a.start_time || '').slice(0, 5);
    const start      = new Date(`${a.date}T${a.start_time}`);
    const canEdit    = (start.getTime() - Date.now()) > 24 * 60 * 60 * 1000; // up to 1 day before
    const svc        = (a.services || []).map(s => s.name).join(', ') || "מניקור לק ג'ל";
    const actions    = canEdit
      ? `<button class="appt-btn edit"   data-id="${a.id}">שינוי</button>
         <button class="appt-btn cancel" data-id="${a.id}">ביטול</button>`
      : `<span class="appt-locked">לא ניתן לשנות (פחות מ-24 שעות)</span>`;
    return `
      <div class="appt-card">
        <div class="appt-info">
          <strong class="appt-when">📅 ${dateLabel} · ⏰ ${timeLabel}</strong>
          <span class="appt-svc">${svc}</span>
          <span class="appt-meta">${a.total_price} ₪ · ${a.duration_min} דק'</span>
        </div>
        <div class="appt-actions">${actions}</div>
      </div>`;
  }).join('');

  list.querySelectorAll('.appt-btn.cancel').forEach(b =>
    b.addEventListener('click', () => cancelAppointment(b.dataset.id, appts)));
  list.querySelectorAll('.appt-btn.edit').forEach(b =>
    b.addEventListener('click', () => startReschedule(b.dataset.id, appts)));
}

async function cancelAppointment(id, appts) {
  const ok = await confirmDialog({
    icon:        '🗓️',
    title:       'לבטל את התור?',
    message:     'התור יוסר מהיומן שלך. ניתן לקבוע תור חדש בכל עת 💗',
    confirmText: 'כן, בטלי את התור',
    cancelText:  'השאירי את התור',
    tone:        'danger',
  });
  if (!ok) return;
  const appt = (appts || []).find(a => String(a.id) === String(id));
  try {
    // 1) Remove the matching event from Google Calendar.
    if (appt && appt.google_event_id) {
      const accessToken = await getAccessToken();
      await fetch(`${API_BASE}/api/manage-booking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', eventId: appt.google_event_id, accessToken })
      });
    }
    // 2) Mark the appointment cancelled in Supabase.
    await MoriyaAuth.sb.from('appointments').update({ status: 'cancelled' }).eq('id', id);
  } catch (e) { console.warn('cancel failed:', e.message); }
  openMyAppointments();
}

function startReschedule(id, appts) {
  const appt = appts.find(a => String(a.id) === String(id));
  if (!appt) return;
  editingAppointment   = appt;
  rescheduleExtras     = [];
  // Lock the base treatment; surface the current add-ons as editable extras.
  const split          = splitReschedule(appt);
  rescheduleBase       = { services: split.base, time: split.time, price: split.price };
  reschedulePrefill    = split.prefill;
  state.totalTime      = appt.duration_min;
  // Pre-select the appointment's current date & time so the client can update
  // right away (e.g. only adding an extra, keeping the same slot). Its own slot
  // is freed up by carveOwnAppointment so it shows as available and selectable.
  state.selectedDate   = appt.date;
  state.selectedTime   = (appt.start_time || '').slice(0, 5) || null;
  const [aY, aM]       = appt.date.split('-').map(Number);
  calYear = aY; calMonth = aM - 1;

  const modal = document.getElementById('appts-modal');
  if (modal) modal.style.display = 'none';

  // Prepare the "add extras" panel (collapsed by default).
  const extrasWrap = document.getElementById('reschedule-extras');
  const rxPanel    = document.getElementById('rx-panel');
  const rxToggle   = document.getElementById('rx-toggle');
  if (extrasWrap) extrasWrap.style.display = 'block';
  if (rxPanel)    rxPanel.style.display    = 'none';
  if (rxToggle) { rxToggle.setAttribute('aria-expanded', 'false'); rxToggle.classList.remove('open'); }
  renderRescheduleExtras();

  // Switch the booking card into reschedule mode: hide the 1-2-3 step bar
  // (only the date/time changes) and surface the appointment being moved.
  document.querySelector('.booking-card')?.classList.add('reschedule-mode');
  const banner = document.getElementById('reschedule-banner');
  if (banner) {
    const svc = (appt.services || []).map(s => s.name).join(' · ') || "מניקור לק ג'ל";
    document.getElementById('rb-current-when').textContent =
      `${formatHebrewDate(appt.date)} · ${(appt.start_time || '').slice(0, 5)}`;
    document.getElementById('rb-current-svc').textContent = svc;
    banner.style.display = 'block';
  }
  const title = document.getElementById('step2-title');
  const hint  = document.getElementById('step2-hint');
  if (title) title.textContent = 'עדכון התור';
  if (hint)  hint.textContent  = '📅 אפשר לשנות מועד ו/או להוסיף תוספות, ואז לעדכן';

  const next = document.getElementById('go-step3');
  if (next) { next.textContent = 'עדכני תור ✓'; next.disabled = true; }
  const back = document.getElementById('back-step1');
  if (back) back.textContent = '→ חזרה לתורים שלי';

  showStep(2);
  renderCalendar();
  // Render the slots for the current date; renderSlots re-selects the current
  // time and enables the update button.
  if (state.selectedDate) loadTimeSlots(state.selectedDate);
}

// Leave reschedule mode and restore the normal booking UI.
function exitRescheduleMode() {
  editingAppointment = null;
  rescheduleExtras   = [];
  rescheduleBase     = { services: [], time: 0, price: 0 };
  reschedulePrefill  = {};
  document.querySelector('.booking-card')?.classList.remove('reschedule-mode');
  const banner = document.getElementById('reschedule-banner');
  if (banner) banner.style.display = 'none';
  const extrasWrap = document.getElementById('reschedule-extras');
  if (extrasWrap) extrasWrap.style.display = 'none';
  const rxPanel = document.getElementById('rx-panel');
  if (rxPanel) rxPanel.style.display = 'none';
  const title = document.getElementById('step2-title');
  const hint  = document.getElementById('step2-hint');
  if (title) title.textContent = 'בחרי תאריך ושעה';
  if (hint)  hint.textContent  = '📅 בחרי יום ושעה פנויים לתור';
  const back = document.getElementById('back-step1');
  if (back) back.textContent = '→ חזרה';
  const next = document.getElementById('go-step3');
  if (next) { next.textContent = 'המשיכי לפרטים ←'; next.disabled = true; }
}

// ─── Reschedule extras (add-ons on an existing appointment) ───────────────────
function extrasTotalTime()  { return rescheduleExtras.reduce((s, e) => s + e.time,  0); }
function extrasTotalPrice() { return rescheduleExtras.reduce((s, e) => s + e.price, 0); }

// Split an appointment's services into the locked base (the manicure and any
// service that doesn't map to an editable add-on) and a pre-fill map for the
// extras controls. Quantity add-ons are stored as "<name> (×N)".
function splitReschedule(appt) {
  const base = [];
  const prefill = {};
  (appt.services || []).forEach(svc => {
    const q = /^(.+?)\s*\(×(\d+)\)\s*$/.exec(svc.name || '');
    if (q) {
      const cat = RESCHEDULE_EXTRAS.find(x => x.type === 'quantity' && x.name === q[1].trim());
      if (cat) { prefill[cat.id] = (prefill[cat.id] || 0) + (parseInt(q[2], 10) || 0); return; }
    } else {
      const cat = RESCHEDULE_EXTRAS.find(x => x.type === 'checkbox' && x.name === svc.name);
      if (cat) { prefill[cat.id] = true; return; }
    }
    base.push(svc); // unmatched (e.g. the base manicure) → stays locked
  });
  const time  = base.reduce((s, x) => s + (x.time  || 0), 0);
  const price = base.reduce((s, x) => s + (x.price || 0), 0);
  return { base, time, price, prefill };
}

// Build the extras panel and wire its controls. The base treatment is shown
// read-only; only the RESCHEDULE_EXTRAS add-ons are selectable.
function renderRescheduleExtras() {
  const list = document.getElementById('rx-list');
  if (!list || !editingAppointment) return;

  const lockedSvc = document.getElementById('rx-locked-svc');
  if (lockedSvc) {
    const names = rescheduleBase.services.map(s => s.name);
    lockedSvc.textContent = names.length ? names.join(' · ') : "מניקור לק ג'ל";
  }

  list.innerHTML = RESCHEDULE_EXTRAS.map(x => {
    if (x.type === 'checkbox') {
      const priceText = x.priceLabel ? x.priceLabel : `+${x.price} ₪`;
      return `
        <label class="rx-row" data-id="${x.id}">
          <input type="checkbox" class="rx-check" data-id="${x.id}" />
          <span class="rx-box"></span>
          <span class="rx-emoji">${x.emoji}</span>
          <span class="rx-detail"><span class="rx-name">${x.name}</span><span class="rx-desc">${x.desc}</span></span>
          <span class="rx-nums"><span class="rx-time">+${x.time} דק'</span><span class="rx-price">${priceText}</span></span>
        </label>`;
    }
    return `
      <div class="rx-row" data-id="${x.id}">
        <span class="rx-emoji">${x.emoji}</span>
        <span class="rx-detail"><span class="rx-name">${x.name}</span><span class="rx-desc">${x.desc}</span></span>
        <span class="rx-qty">
          <button type="button" class="rx-qty-btn minus" data-id="${x.id}">−</button>
          <input type="number" class="rx-qty-input" data-id="${x.id}" value="0" min="0" max="10" />
          <button type="button" class="rx-qty-btn plus" data-id="${x.id}">+</button>
        </span>
      </div>`;
  }).join('');

  // Pre-fill the controls with the add-ons already on the appointment so the
  // client sees them here and can adjust or remove them.
  Object.entries(reschedulePrefill).forEach(([id, val]) => {
    const cb = list.querySelector(`.rx-check[data-id="${id}"]`);
    if (cb) { cb.checked = true; return; }
    const inp = list.querySelector(`.rx-qty-input[data-id="${id}"]`);
    if (inp) inp.value = Math.max(0, Math.min(parseInt(inp.max) || 10, val));
  });

  list.querySelectorAll('.rx-check').forEach(cb =>
    cb.addEventListener('change', recalcRescheduleExtras));
  list.querySelectorAll('.rx-qty-input').forEach(inp =>
    inp.addEventListener('input', () => {
      let v = parseInt(inp.value) || 0;
      const max = parseInt(inp.max) || 10;
      if (v < 0) v = 0;
      if (v > max) v = max;
      inp.value = v;
      recalcRescheduleExtras();
    }));
  list.querySelectorAll('.rx-qty-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      const inp = list.querySelector(`.rx-qty-input[data-id="${btn.dataset.id}"]`);
      if (!inp) return;
      let v = parseInt(inp.value) || 0;
      const max = parseInt(inp.max) || 10;
      if (btn.classList.contains('plus')  && v < max) v++;
      if (btn.classList.contains('minus') && v > 0)   v--;
      inp.value = v;
      recalcRescheduleExtras();
    }));

  recalcRescheduleExtras();
}

// Recompute the chosen extras, refresh the mini-summary, and – when the total
// duration changed – reload the time slots so availability reflects the longer
// appointment (a previously-picked time may no longer fit).
function recalcRescheduleExtras() {
  const list = document.getElementById('rx-list');
  if (!list || !editingAppointment) return;

  const extras = [];
  RESCHEDULE_EXTRAS.forEach(x => {
    if (x.type === 'checkbox') {
      const cb  = list.querySelector(`.rx-check[data-id="${x.id}"]`);
      const row = cb && cb.closest('.rx-row');
      if (cb && cb.checked) {
        const e = { name: x.name, time: x.time, price: x.price };
        if (x.priceLabel) e.priceLabel = x.priceLabel;
        extras.push(e);
        row && row.classList.add('checked');
      } else if (row) {
        row.classList.remove('checked');
      }
    } else {
      const inp = list.querySelector(`.rx-qty-input[data-id="${x.id}"]`);
      const row = inp && inp.closest('.rx-row');
      const qty = Math.max(0, parseInt(inp && inp.value) || 0);
      if (qty > 0) {
        extras.push({ name: `${x.name} (×${qty})`, time: qty * x.time, price: qty * x.price });
        row && row.classList.add('checked');
      } else if (row) {
        row.classList.remove('checked');
      }
    }
  });
  rescheduleExtras = extras;

  // Keep state.totalTime in sync so renderCalendar/loadTimeSlots size the slots
  // for the (possibly longer or shorter) appointment.
  const prevTime = state.totalTime;
  const newTime  = rescheduleBase.time + extrasTotalTime();
  state.totalTime = newTime;

  const sum = document.getElementById('rx-summary');
  if (sum) {
    const newPrice = rescheduleBase.price + extrasTotalPrice();
    const hasDeco  = extras.some(e => e.priceLabel);
    sum.style.display = 'flex';
    sum.innerHTML = `
      <span class="rx-sum-label">סה״כ מעודכן</span>
      <span class="rx-sum-vals"><strong>${formatDuration(newTime)}</strong> · <strong>${newPrice} ₪${hasDeco ? ' + קישוט' : ''}</strong></span>`;
  }

  updateBookingSummary();

  // The appointment length changed → refresh availability. loadTimeSlots →
  // renderSlots keeps the current time selected if it still fits (so the update
  // button stays enabled) and only clears it when the slot no longer works.
  if (newTime !== prevTime) {
    renderCalendar();
    if (state.selectedDate) loadTimeSlots(state.selectedDate);
  }
}

// Expand / collapse the extras panel.
document.getElementById('rx-toggle')?.addEventListener('click', () => {
  const panel = document.getElementById('rx-panel');
  const btn   = document.getElementById('rx-toggle');
  if (!panel || !btn) return;
  const open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : 'block';
  btn.setAttribute('aria-expanded', String(!open));
  btn.classList.toggle('open', !open);
});

async function updateAppointment() {
  if (!editingAppointment) return;
  const btn = document.getElementById('go-step3');
  if (btn) { btn.disabled = true; btn.textContent = 'מעדכנת…'; }

  // The base treatment is locked; the editable extras are re-attached on top, so
  // additions and removals both flow through to the calendar and Supabase.
  const mergedServices = [...rescheduleBase.services, ...rescheduleExtras];
  const newDuration    = rescheduleBase.time  + extrasTotalTime();
  const newPrice       = rescheduleBase.price + extrasTotalPrice();

  try {
    // 1) Move the matching event on Google Calendar.
    if (editingAppointment.google_event_id) {
      const accessToken = await getAccessToken();
      await fetch(`${API_BASE}/api/manage-booking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:   'update',
          eventId:  editingAppointment.google_event_id,
          date:     state.selectedDate,
          time:     state.selectedTime,
          duration: newDuration,
          // Always resend the treatment list so the event title/description stay
          // in sync whether the client added or removed an extra.
          services:    mergedServices,
          totalPrice:  newPrice,
          clientName:  editingAppointment.client_name,
          clientPhone: editingAppointment.client_phone,
          notes:       editingAppointment.notes || '',
          accessToken
        })
      });
    }
    // 2) Persist the new time, treatment list, duration and price in Supabase.
    await MoriyaAuth.sb.from('appointments').update({
      date:         state.selectedDate,
      start_time:   state.selectedTime,
      duration_min: newDuration,
      total_price:  newPrice,
      services:     mergedServices
    }).eq('id', editingAppointment.id);
  } catch (e) { console.warn('update failed:', e.message); }

  const svc = mergedServices.map(s => s.name);
  const treatments = svc.length ? svc : ["מניקור לק ג'ל"];
  renderSuccessCard({
    heading:    'התור עודכן בהצלחה!',
    subtitle:   'המועד עודכן ונשמר ביומן של מוריה. נתראה! 💅',
    treatments,
    duration:        formatDuration(newDuration),
    durationMinutes: newDuration,
    price:      `${newPrice} ₪`
  });

  exitRescheduleMode();
}

// Modal close handlers
document.getElementById('appts-close')?.addEventListener('click', () => {
  document.getElementById('appts-modal').style.display = 'none';
});
document.getElementById('appts-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'appts-modal') e.target.style.display = 'none';
});

// ═══════════════════════════════════════════════════════════════════════════════
//  TREATMENT POLICIES – open, read, confirm
// ═══════════════════════════════════════════════════════════════════════════════
function openPolicyModal() {
  const modal = document.getElementById('policy-modal');
  if (modal) modal.style.display = 'flex';
  // The client has now seen the policies → allow ticking the consent checkbox.
  const chk = document.getElementById('chk-policy');
  if (chk) chk.disabled = false;
  const hint = document.getElementById('policy-hint');
  if (hint) hint.textContent = 'סמני את התיבה כדי לאשר את הנהלים';
}
function closePolicyModal() {
  const modal = document.getElementById('policy-modal');
  if (modal) modal.style.display = 'none';
}

document.getElementById('open-policy')?.addEventListener('click', openPolicyModal);
document.getElementById('policy-close')?.addEventListener('click', closePolicyModal);
document.getElementById('policy-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'policy-modal') closePolicyModal();
});
// "I have read and agree" inside the modal ticks the box and closes it.
document.getElementById('policy-agree')?.addEventListener('click', () => {
  const chk = document.getElementById('chk-policy');
  if (chk) { chk.disabled = false; chk.checked = true; }
  document.getElementById('policy-consent')?.classList.remove('error');
  const hint = document.getElementById('policy-hint');
  if (hint) hint.textContent = 'אישרת את נהלי הטיפול ✓';
  closePolicyModal();
});
// Clear the error highlight as soon as the box is ticked.
document.getElementById('chk-policy')?.addEventListener('change', (e) => {
  const consent = document.getElementById('policy-consent');
  const hint    = document.getElementById('policy-hint');
  if (e.target.checked) {
    consent?.classList.remove('error');
    if (hint) hint.textContent = 'אישרת את נהלי הטיפול ✓';
  } else if (hint) {
    hint.textContent = 'סמני את התיבה כדי לאשר את הנהלים';
  }
});
