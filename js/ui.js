/* ═══════════════════════════════════════════
   MORIYA NAILS – Shared UI helpers
   A pretty, on-brand replacement for window.confirm()
═══════════════════════════════════════════ */

/* ─── Booking horizon ─────────────────────────────────────────────────────────
   Clients may only book inside a rolling window of HORIZON_MONTHS from today;
   the admin's calendar has no such limit. Because the window rolls forward every
   day, working hours the admin sets further out need no extra step — they simply
   become bookable once their date enters the window. */
(function initBookingHorizon() {
  const HORIZON_MONTHS = 2;

  const p2  = n => String(n).padStart(2, '0');
  const str = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const midnight = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

  // Last bookable date counting from `from`: the same day-of-month HORIZON_MONTHS
  // later, clamped to that month's length (31/12 → 28/2, never spilling to 3/3).
  function horizonFrom(from) {
    const lastDay = new Date(from.getFullYear(), from.getMonth() + HORIZON_MONTHS + 1, 0).getDate();
    return new Date(from.getFullYear(), from.getMonth() + HORIZON_MONTHS, Math.min(from.getDate(), lastDay));
  }

  const horizonDate = () => horizonFrom(midnight());
  const horizonStr  = () => str(horizonDate());
  const isWithin    = dateStr => dateStr <= horizonStr();

  // The day the rolling window first reaches `dateStr` — i.e. when clients start
  // seeing it. Found by scanning forward from the 1st of HORIZON_MONTHS earlier,
  // so month-length clamping is accounted for exactly.
  function visibleFrom(dateStr) {
    const target = new Date(`${dateStr}T00:00:00`);
    const d = new Date(target.getFullYear(), target.getMonth() - HORIZON_MONTHS, 1);
    for (let i = 0; i < 70 && horizonFrom(d) < target; i++) d.setDate(d.getDate() + 1);
    return str(d);
  }

  window.MoriyaBooking = { HORIZON_MONTHS, horizonDate, horizonStr, isWithin, visibleFrom, toDateStr: str };
})();

// Show a styled confirmation dialog. Returns a Promise that resolves to
// `true` when the user confirms and `false` when they cancel / dismiss.
//
// confirmDialog({
//   icon:        '🗓️',                 // emoji shown in the header bubble
//   title:       'לבטל את התור?',
//   message:     'טקסט הסבר קצר ועדין',  // plain text (escaped)
//   html:        '<ul>…</ul>',           // optional rich body (used as-is)
//   confirmText: 'כן, בטלי',
//   cancelText:  'חזרה',
//   tone:        'danger' | 'default',   // styles the confirm button
// })
function confirmDialog(opts = {}) {
  const {
    icon        = '💖',
    title       = 'לאשר את הפעולה?',
    message     = '',
    html        = '',
    confirmText = 'אישור',
    cancelText  = 'ביטול',
    tone        = 'danger',
  } = opts;

  const esc = s => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'cdlg-overlay';
    overlay.innerHTML = `
      <div class="cdlg-card" role="dialog" aria-modal="true" aria-labelledby="cdlg-title">
        <div class="cdlg-icon ${tone === 'danger' ? 'is-danger' : ''}">${icon}</div>
        <h3 class="cdlg-title" id="cdlg-title">${esc(title)}</h3>
        ${message ? `<p class="cdlg-msg">${esc(message)}</p>` : ''}
        ${html ? `<div class="cdlg-body">${html}</div>` : ''}
        <div class="cdlg-actions">
          <button type="button" class="cdlg-btn cdlg-cancel">${esc(cancelText)}</button>
          <button type="button" class="cdlg-btn cdlg-confirm ${tone === 'danger' ? 'is-danger' : ''}">${esc(confirmText)}</button>
        </div>
      </div>`;

    let settled = false;
    const close = (result) => {
      if (settled) return;
      settled = true;
      overlay.classList.add('cdlg-closing');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => { overlay.remove(); resolve(result); }, 180);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
      else if (e.key === 'Enter') close(true);
    };

    overlay.querySelector('.cdlg-confirm').addEventListener('click', () => close(true));
    overlay.querySelector('.cdlg-cancel').addEventListener('click', () => close(false));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    document.addEventListener('keydown', onKey);

    document.body.appendChild(overlay);
    // Focus the confirm button on the next frame so the pop-in animation plays.
    requestAnimationFrame(() => overlay.querySelector('.cdlg-confirm').focus());
  });
}

window.confirmDialog = confirmDialog;
