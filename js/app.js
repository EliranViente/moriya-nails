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
  let totalTime  = state.baseTime;
  let totalPrice = state.basePrice;
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
  showStep(2);
  renderCalendar();
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

function renderCalendar() {
  const box    = document.getElementById('calendar-box');
  const today  = new Date();
  today.setHours(0, 0, 0, 0);

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
    const isFriday  = d.getDay() === 5;
    const isPast    = d < today;
    const dateStr   = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const isSelected = state.selectedDate === dateStr;

    let cls = 'cal-day';
    if (!isFriday || isPast) {
      cls += isPast ? ' past' : ' not-friday';
    } else {
      cls += ' friday-avail';
      if (isSelected) cls += ' selected';
    }

    const dataAttr = isFriday && !isPast ? `data-date="${dateStr}"` : '';
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

  const slots = buildAvailableSlots(state.totalTime, busySlots);
  renderSlots(slots, slotsGrid);
}

// Minimum bookable gap: a standard appointment is 75 minutes, so we never leave
// a free gap shorter than this before a booking (it would be wasted time).
const MIN_GAP = 75;

// Build slot list (9:00–17:00, every 30 min, must finish by 17:00)
function buildAvailableSlots(durationMin, busySlots) {
  const START = 9 * 60;   // minutes since midnight
  const END   = 17 * 60;
  const STEP  = 30;
  const slots = [];

  for (let m = START; m + durationMin <= END; m += STEP) {
    const endM = m + durationMin;

    // Does this slot overlap an existing booking?
    const busy = busySlots.some(b => m < b.end && endM > b.start);

    // Find the boundary right before this slot: either the start of the day,
    // or the end of the latest booking that finishes at/before this slot.
    let boundaryBefore = START;
    busySlots.forEach(b => {
      if (b.end <= m && b.end > boundaryBefore) boundaryBefore = b.end;
    });
    const gapBefore = m - boundaryBefore;

    // Block slots that would leave a small (1–74 min) unfillable gap before them.
    const wastesGap = gapBefore > 0 && gapBefore < MIN_GAP;

    slots.push({
      label: `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`,
      busy: busy || wastesGap,
      blockedReason: wastesGap && !busy ? 'gap' : null
    });
  }
  return slots;
}

function renderSlots(slots, container) {
  if (slots.length === 0) {
    container.innerHTML = '<div class="no-slots">אין שעות פנויות ביום זה 😔<br/>נסי לבחור יום שישי אחר</div>';
    return;
  }
  container.innerHTML = slots.map(s => {
    const title = s.blockedReason === 'gap'
      ? 'title="לא ניתן להזמין – נשאר פרק זמן קצר מדי לפני התור"'
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
    });
  });
}

document.getElementById('back-step1')?.addEventListener('click', () => showStep(1));
document.getElementById('go-step3')?.addEventListener('click', () => {
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

  box.innerHTML = `
    <h4>סיכום הזמנה</h4>
    <div class="summary-item"><span>📅 תאריך</span><span>${dateDisplay} (שישי)</span></div>
    <div class="summary-item"><span>⏰ שעה</span><span>${state.selectedTime}</span></div>
    <div class="summary-item"><span>💅 מניקור לק ג'ל (בסיסי)</span><span>140 ₪</span></div>
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
  if (!valid) return;

  const btn = e.target.querySelector('.btn-confirm');
  btn.disabled    = true;
  btn.textContent = 'שולחת…';

  const services = [
    { name: "מניקור לק ג'ל", time: 75, price: 140 },
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
        services:        state.addons,
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

  // Scroll to booking section smoothly
  const bookingEl = document.getElementById('booking');
  if (bookingEl) bookingEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
