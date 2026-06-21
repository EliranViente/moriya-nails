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
  // Services
  baseTime:  75,
  basePrice: 140,
  addons:    [],   // { name, time, price }
  totalTime: 75,
  totalPrice: 140,

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

document.querySelectorAll('.service-card, .about-card, .contact-card, .g-item, .toolkit-note')
  .forEach(el => { el.classList.add('reveal'); revealObserver.observe(el); });

// ═══════════════════════════════════════════════════════════════════════════════
//  STEP 1 – Service Selection
// ═══════════════════════════════════════════════════════════════════════════════

// Helper: recalculate and display totals
function recalculate() {
  // Base manicure is a checkbox now (on by default). Without it = quick fix.
  const baseChecked = document.getElementById('chk-base')?.checked ?? true;
  state.baseIncluded = baseChecked;
  const baseRow = document.querySelector('.base-treatment-row');
  if (baseRow) baseRow.classList.toggle('unchecked', !baseChecked);

  // Hide/show addon rows that only apply with the base manicure
  document.querySelectorAll('.addon-row[data-requires-base="true"]').forEach(row => {
    row.style.display = baseChecked ? '' : 'none';
    if (!baseChecked) {
      const cb = row.querySelector('input[type="checkbox"]');
      if (cb && cb.checked) cb.checked = false;
    }
  });

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
  if (state.baseIncluded) parts.push("מניקור לק ג'ל");
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
    // Rescheduling an existing appointment – reflect its own details.
    const svc = (editingAppointment.services || []).map(s => s.name);
    treatments = svc.length
      ? (svc.length <= 2 ? svc.join(' + ') : `${svc[0]} +${svc.length - 1} תוספות`)
      : "מניקור לק ג'ל";
    duration = formatDuration(editingAppointment.duration_min);
    price    = editingAppointment.total_price + ' ₪';
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
  editingAppointment = null;                 // fresh booking, not a reschedule
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

async function renderCalendar() {
  const box    = document.getElementById('calendar-box');
  const today  = new Date();
  today.setHours(0, 0, 0, 0);

  const byDate = await getMonthAvailability(calYear, calMonth);

  const firstDay = new Date(calYear, calMonth, 1);
  const lastDay  = new Date(calYear, calMonth + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startDow    = firstDay.getDay(); // 0=Sun

  let html = `
    <div class="cal-header">
      <button class="cal-nav" id="cal-prev">›</button>
      <h4>${HE_MONTHS[calMonth]} ${calYear}</h4>
      <button class="cal-nav" id="cal-next">‹</button>
    </div>
    <div class="cal-grid">
      ${HE_DAY_NAMES.map(d => `<div class="cal-day-name">${d}</div>`).join('')}
  `;

  // Empty cells
  for (let i = 0; i < startDow; i++) {
    html += '<div class="cal-day empty"></div>';
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(calYear, calMonth, day);
    const isPast    = d < today;
    const dateStr   = `${calYear}-${padNum(calMonth+1)}-${padNum(day)}`;
    const isSelected = state.selectedDate === dateStr;

    // Bookable when the day has effective open windows (Fridays by default,
    // any day the admin opened explicitly, unless closed for the day).
    const dayInfo  = byDate.get(dateStr);
    const bookable = !isPast && effectiveOpenWindows(dateStr, dayInfo).length > 0;

    let cls = 'cal-day';
    if (!bookable) {
      cls += isPast ? ' past' : ' not-friday';
    } else {
      cls += ' friday-avail';
      if (isSelected) cls += ' selected';
    }

    const dataAttr = bookable ? `data-date="${dateStr}"` : '';
    html += `<div class="${cls}" ${dataAttr}>${day}</div>`;
  }

  html += '</div>';
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

  container.querySelectorAll('.time-slot:not(.busy)').forEach(el => {
    el.addEventListener('click', () => {
      container.querySelectorAll('.time-slot').forEach(e => e.classList.remove('selected'));
      el.classList.add('selected');
      state.selectedTime = el.dataset.time;
      document.getElementById('go-step3').disabled = false;
      updateBookingSummary();
    });
  });
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
  for (let i = 0; i < 70; i++) {                 // search up to ~10 weeks ahead
    const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const wins    = await getDayWindows(dateStr);
    // Bookable when the day has effective open windows (Fridays by default).
    const bookable = wins.open.length > 0;
    if (bookable && !bookedDates.has(dateStr)) {
      let busy = [];
      try {
        const res  = await fetch(`${API_BASE}/api/busy-slots?date=${dateStr}`);
        const data = await res.json();
        busy = data.busySlots || [];
      } catch (e) { /* treat as free */ }
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
  if (!result) { alert('לא נמצא תור פנוי בקרוב. נסי שוב מאוחר יותר 💅'); return; }

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

document.getElementById('back-step1')?.addEventListener('click', () => showStep(1));
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
    ? `<div class="summary-item"><span>💅 מניקור לק ג'ל (בסיסי)</span><span>140 ₪</span></div>`
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

document.getElementById('back-step2')?.addEventListener('click', () => showStep(2));

document.getElementById('booking-form')?.addEventListener('submit', async e => {
  e.preventDefault();

  const name  = document.getElementById('f-name').value.trim();
  const phone = document.getElementById('f-phone').value.trim();
  const notes = document.getElementById('f-notes').value.trim();

  // Simple validation
  let valid = true;
  if (!name) {
    document.getElementById('f-name').classList.add('error');
    valid = false;
  } else {
    document.getElementById('f-name').classList.remove('error');
  }
  if (!phone) {
    document.getElementById('f-phone').classList.add('error');
    valid = false;
  } else {
    document.getElementById('f-phone').classList.remove('error');
  }
  // Treatment policies must be opened and confirmed before booking
  const policyCheck   = document.getElementById('chk-policy');
  const policyConsent = document.getElementById('policy-consent');
  if (!policyCheck || !policyCheck.checked) {
    if (policyConsent) {
      policyConsent.classList.add('error');
      policyConsent.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    valid = false;
  } else if (policyConsent) {
    policyConsent.classList.remove('error');
  }
  if (!valid) return;

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
    ...(state.baseIncluded ? [{ name: "מניקור לק ג'ל", time: 75, price: 140 }] : []),
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

function showSuccess(name, phone, notes) {
  const [y, m, d] = state.selectedDate.split('-');
  document.getElementById('success-details').innerHTML = `
    <strong>${name}</strong><br/>
    📅 ${d}/${m}/${y} ⏰ ${state.selectedTime}<br/>
    ⏱ ${state.totalTime} דקות &nbsp;|&nbsp; 💰 ${state.totalPrice} ₪<br/>
    📞 ${phone}
  `;
  showStep('success');
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

  // Update step indicators
  document.querySelectorAll('.step-item').forEach(item => {
    const n = parseInt(item.dataset.step);
    item.classList.remove('active', 'done');
    if (typeof num === 'number') {
      if (n === num)  item.classList.add('active');
      if (n <  num)   item.classList.add('done');
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
    list.innerHTML = '<p class="appts-empty">אין לך תורים קרובים 💅<br/>אפשר לקבוע תור חדש בכל עת</p>';
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
    message:     'התור יוסר מהיומן שלך. תמיד אפשר לקבוע תור חדש מתי שתרצי 💕',
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
  state.totalTime      = appt.duration_min;
  state.selectedDate   = null;
  state.selectedTime   = null;

  const modal = document.getElementById('appts-modal');
  if (modal) modal.style.display = 'none';

  const next = document.getElementById('go-step3');
  if (next) { next.textContent = 'עדכני תור ✓'; next.disabled = true; }

  showStep(2);
  renderCalendar();
}

async function updateAppointment() {
  if (!editingAppointment) return;
  const btn = document.getElementById('go-step3');
  if (btn) { btn.disabled = true; btn.textContent = 'מעדכנת…'; }

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
          duration: editingAppointment.duration_min,
          accessToken
        })
      });
    }
    // 2) Update the appointment in Supabase.
    await MoriyaAuth.sb.from('appointments')
      .update({ date: state.selectedDate, start_time: state.selectedTime })
      .eq('id', editingAppointment.id);
  } catch (e) { console.warn('update failed:', e.message); }

  const [y, m, d] = state.selectedDate.split('-');
  const details = document.getElementById('success-details');
  const heading = document.querySelector('#step-success h3');
  if (heading) heading.textContent = 'התור עודכן בהצלחה!';
  if (details) details.innerHTML = `📅 ${d}/${m}/${y} ⏰ ${state.selectedTime}`;

  editingAppointment = null;
  if (btn) btn.textContent = 'המשיכי לפרטים ←';
  showStep('success');
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
