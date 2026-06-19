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

  // Phone verification
  verifyToken:   null,   // short-lived proof returned by /api/otp-verify
  verifiedPhone: null,   // normalized phone the token was issued for
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

  const slots = buildAvailableSlots(state.totalTime, busySlots, dateStr);
  renderSlots(slots, slotsGrid);
}

// Slot model:
//  • Full appointments (> 30 min) use fixed start times.
//  • Quick fixes (≤ 30 min) open every 10 min, by availability, until 17:30.
const FIXED_SLOTS     = [9*60, 11*60, 12*60+30, 14*60+15, 15*60+45]; // 9:00,11:00,12:30,14:15,15:45
const SMALL_THRESHOLD = 30;            // minutes – at/under this is a "quick fix"
const SMALL_STEP      = 10;            // minutes between quick-fix slots
const SMALL_START     = 9 * 60;        // 09:00
const SMALL_END       = 17 * 60 + 30;  // 17:30 (quick fix must finish by then)

function buildAvailableSlots(durationMin, busySlots, dateStr) {
  const pad      = n => String(n).padStart(2, '0');
  const now      = new Date();
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const isToday  = dateStr === todayStr;
  const nowMin   = now.getHours() * 60 + now.getMinutes();

  // Choose the candidate start times.
  let starts;
  if (durationMin > SMALL_THRESHOLD) {
    starts = FIXED_SLOTS.slice();
  } else {
    starts = [];
    for (let m = SMALL_START; m + durationMin <= SMALL_END; m += SMALL_STEP) starts.push(m);
  }

  return starts.map(m => {
    const endM   = m + durationMin;
    const busy   = busySlots.some(b => m < b.end && endM > b.start); // overlaps a booking
    const isPast = isToday && m <= nowMin;                            // already passed
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
    if (d.getDay() === 5) {                       // Fridays only
      const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      if (!bookedDates.has(dateStr)) {
        let busy = [];
        try {
          const res  = await fetch(`${API_BASE}/api/busy-slots?date=${dateStr}`);
          const data = await res.json();
          busy = data.busySlots || [];
        } catch (e) { /* treat as free */ }
        const free = buildAvailableSlots(state.totalTime, busy, dateStr).find(s => !s.busy);
        if (free) return { date: dateStr, time: free.label };
      }
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
  refreshVerifyUI();
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

// ─── Phone verification (WhatsApp one-time code) ───────────────────────────────

// Mirror of the server's normalizePhone so we can compare numbers client-side.
function normalizePhoneLocal(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/[^\d+]/g, '');
  if (d.startsWith('+')) {
    d = '+' + d.slice(1).replace(/\D/g, '');
  } else {
    d = d.replace(/\D/g, '');
    if (d.startsWith('00'))      d = '+' + d.slice(2);
    else if (d.startsWith('0'))  d = '+972' + d.slice(1);
    else if (d.startsWith('972')) d = '+' + d;
    else                         d = '+' + d;
  }
  return /^\+\d{8,15}$/.test(d) ? d : null;
}

async function getAccessToken() {
  if (!window.MoriyaAuth || !MoriyaAuth.isLoggedIn()) return null;
  try {
    const { data } = await MoriyaAuth.sb.auth.getSession();
    return (data && data.session && data.session.access_token) || null;
  } catch { return null; }
}

// Is the phone currently typed already verified? Either freshly via OTP this
// session, or "remembered" on the logged-in user's profile.
function currentPhoneVerified() {
  const phone = normalizePhoneLocal(document.getElementById('f-phone')?.value);
  if (!phone) return false;
  if (state.verifyToken && state.verifiedPhone === phone) return true;
  const p = window.MoriyaAuth && MoriyaAuth.profile;
  if (p && p.phone_verified && normalizePhoneLocal(p.phone) === phone) return true;
  return false;
}

// Reflect the verification status in the UI and toggle the confirm button.
function refreshVerifyUI() {
  const block    = document.getElementById('verify-block');
  const verified = document.getElementById('verify-verified');
  const pending  = document.getElementById('verify-pending');
  const confirm  = document.getElementById('btn-confirm-booking');
  if (!block) return;

  const isVerified = currentPhoneVerified();
  if (verified) verified.style.display = isVerified ? 'flex' : 'none';
  if (pending)  pending.style.display  = isVerified ? 'none' : 'block';
  if (confirm)  confirm.disabled = !isVerified;
}

function setVerifyMsg(text, type) {
  const el = document.getElementById('verify-msg');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'verify-msg' + (type ? ' ' + type : '');
}

let resendTimer = null;
function startResendCooldown(seconds) {
  const btnSend   = document.getElementById('btn-send-code');
  const btnResend = document.getElementById('btn-resend-code');
  let left = seconds;
  clearInterval(resendTimer);
  const tick = () => {
    const label = `שליחה חוזרת (${left})`;
    [btnSend, btnResend].forEach(b => { if (b) { b.disabled = true; } });
    if (btnResend) btnResend.textContent = label;
    if (left <= 0) {
      clearInterval(resendTimer);
      resendTimer = null;
      [btnSend, btnResend].forEach(b => { if (b) b.disabled = false; });
      if (btnResend) btnResend.textContent = 'שליחה חוזרת של הקוד';
    }
    left--;
  };
  tick();
  resendTimer = setInterval(tick, 1000);
}

async function sendVerificationCode() {
  const phoneRaw = document.getElementById('f-phone')?.value.trim();
  const phone    = normalizePhoneLocal(phoneRaw);
  const phoneEl  = document.getElementById('f-phone');
  if (!phone) {
    if (phoneEl) phoneEl.classList.add('error');
    setVerifyMsg('נא להזין מספר טלפון תקין', 'error');
    return;
  }
  if (phoneEl) phoneEl.classList.remove('error');

  const btnSend = document.getElementById('btn-send-code');
  if (btnSend) { btnSend.disabled = true; btnSend.textContent = 'שולחת…'; }
  setVerifyMsg('שולחת קוד לוואטסאפ…', '');

  try {
    const res  = await fetch(`${API_BASE}/api/otp-send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: phoneRaw })
    });

    if (res.status === 503) {
      // Verification isn't configured on the server yet → allow booking.
      state.verifyToken   = '__skip__';
      state.verifiedPhone = phone;
      refreshVerifyUI();
      return;
    }

    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) {
      const codeBlock = document.getElementById('code-block');
      if (codeBlock) codeBlock.style.display = 'block';
      document.getElementById('f-code')?.focus();
      setVerifyMsg('קוד נשלח לוואטסאפ שלך 💬 הזיני אותו כאן', 'success');
      startResendCooldown(30);
    } else if (res.status === 429 && data.error === 'cooldown') {
      setVerifyMsg(`כבר נשלח קוד. נסי שוב בעוד ${data.retryAfter || 30} שניות`, 'error');
      startResendCooldown(data.retryAfter || 30);
    } else if (data.error === 'invalid_phone') {
      setVerifyMsg('מספר הטלפון אינו תקין', 'error');
    } else {
      setVerifyMsg('שליחת הקוד נכשלה, נסי שוב', 'error');
    }
  } catch (e) {
    setVerifyMsg('שגיאת רשת בשליחת הקוד', 'error');
  } finally {
    // Re-enable the send button only if no cooldown is keeping it disabled.
    if (btnSend) {
      btnSend.textContent = 'שלחי לי קוד אימות';
      if (!resendTimer) btnSend.disabled = false;
    }
  }
}

async function checkVerificationCode() {
  const phoneRaw = document.getElementById('f-phone')?.value.trim();
  const phone    = normalizePhoneLocal(phoneRaw);
  const code     = (document.getElementById('f-code')?.value || '').replace(/\D/g, '');
  if (!phone) { setVerifyMsg('מספר הטלפון אינו תקין', 'error'); return; }
  if (!/^\d{6}$/.test(code)) { setVerifyMsg('יש להזין קוד בן 6 ספרות', 'error'); return; }

  const btn = document.getElementById('btn-verify-code');
  if (btn) { btn.disabled = true; btn.textContent = 'בודקת…'; }

  try {
    const accessToken = await getAccessToken();
    const res  = await fetch(`${API_BASE}/api/otp-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: phoneRaw, code, accessToken })
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok && data.success) {
      state.verifyToken   = data.verifyToken;
      state.verifiedPhone = phone;
      clearInterval(resendTimer);
      // Remember on the in-memory profile so a returning customer skips OTP.
      if (window.MoriyaAuth && MoriyaAuth.isLoggedIn()) {
        MoriyaAuth.profile = Object.assign({}, MoriyaAuth.profile, { phone_verified: true, phone });
      }
      const codeBlock = document.getElementById('code-block');
      if (codeBlock) codeBlock.style.display = 'none';
      setVerifyMsg('', '');
      refreshVerifyUI();
    } else if (data.error === 'wrong_code') {
      const left = typeof data.remaining === 'number' ? data.remaining : null;
      setVerifyMsg(left !== null ? `קוד שגוי. נותרו ${left} ניסיונות` : 'קוד שגוי, נסי שוב', 'error');
    } else if (data.error === 'expired' || data.error === 'no_code') {
      setVerifyMsg('הקוד פג תוקף. בקשי קוד חדש', 'error');
    } else if (data.error === 'too_many_attempts') {
      setVerifyMsg('יותר מדי ניסיונות. בקשי קוד חדש', 'error');
    } else {
      setVerifyMsg('האימות נכשל, נסי שוב', 'error');
    }
  } catch (e) {
    setVerifyMsg('שגיאת רשת באימות הקוד', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'אימות ✓'; }
  }
}

document.getElementById('btn-send-code')?.addEventListener('click', sendVerificationCode);
document.getElementById('btn-resend-code')?.addEventListener('click', sendVerificationCode);
document.getElementById('btn-verify-code')?.addEventListener('click', checkVerificationCode);
document.getElementById('f-code')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); checkVerificationCode(); }
});

// Changing the phone invalidates any prior verification for the old number.
document.getElementById('f-phone')?.addEventListener('input', () => {
  const phone = normalizePhoneLocal(document.getElementById('f-phone').value);
  if (state.verifiedPhone && state.verifiedPhone !== phone) {
    state.verifyToken = null;
    state.verifiedPhone = null;
    const codeBlock = document.getElementById('code-block');
    if (codeBlock) codeBlock.style.display = 'none';
    setVerifyMsg('', '');
  }
  refreshVerifyUI();
});

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

  // Phone must be verified (fresh OTP or remembered on the profile).
  if (!currentPhoneVerified()) {
    setVerifyMsg('יש לאמת את מספר הטלפון לפני שריון התור', 'error');
    refreshVerifyUI();
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
    ...(state.baseIncluded ? [{ name: "מניקור לק ג'ל", time: 75, price: 140 }] : []),
    ...state.addons
  ];

  // 1) Create the Google Calendar event (existing backend).
  //    Includes verification proof: a fresh OTP token and/or the access
  //    token of a returning, already-verified user.
  const accessToken = await getAccessToken();
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
        totalPrice:  state.totalPrice,
        verifyToken: state.verifyToken,
        accessToken
      })
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      googleEventId = data.eventId || null;
    } else if (res.status === 403) {
      // Server rejected: verification expired/invalid → ask to re-verify.
      btn.disabled = false;
      btn.textContent = 'אשרי הזמנה ✓';
      state.verifyToken = null;
      state.verifiedPhone = null;
      setVerifyMsg('האימות פג. נא לאמת שוב את מספר הטלפון', 'error');
      refreshVerifyUI();
      return;
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
    b.addEventListener('click', () => cancelAppointment(b.dataset.id)));
  list.querySelectorAll('.appt-btn.edit').forEach(b =>
    b.addEventListener('click', () => startReschedule(b.dataset.id, appts)));
}

async function cancelAppointment(id) {
  if (!confirm('לבטל את התור?')) return;
  try {
    await MoriyaAuth.sb.from('appointments').update({ status: 'cancelled' }).eq('id', id);
    // Note: the matching Google Calendar event is removed once calendar sync is connected.
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
    await MoriyaAuth.sb.from('appointments')
      .update({ date: state.selectedDate, start_time: state.selectedTime })
      .eq('id', editingAppointment.id);
    // Note: the Google Calendar event is updated once calendar sync is connected.
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
