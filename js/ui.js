/* ═══════════════════════════════════════════
   MORIYA NAILS – Shared UI helpers
   A pretty, on-brand replacement for window.confirm()
═══════════════════════════════════════════ */

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
