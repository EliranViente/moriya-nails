/* ═══════════════════════════════════════════
   MORIYA NAILS – Accessibility menu
   Voluntary self-service accessibility widget, built to sit alongside the
   IS 5568 / WCAG 2.0 AA baseline already in the markup and CSS (skip link,
   alt text, focus-visible outlines, keyboard support). The floating button
   and panel are built here instead of as static markup in index.html to
   match how confirmDialog() in ui.js builds its overlay – one script owns
   both the DOM and the behavior.
═══════════════════════════════════════════ */
(function initAccessibilityWidget() {
  const STORAGE_KEY = 'moriyaA11y';
  // Keep in sync with the early-apply <script> in index.html's <head>.
  const FONT_SCALE  = [1, 1.125, 1.25, 1.375, 1.5];
  const FONT_LABELS = ['100%', '112%', '125%', '137%', '150%'];

  const DEFAULTS = {
    fontStep: 0,
    contrast: 'normal', // 'normal' | 'dark' | 'gray'
    links: false,
    headings: false,
    readableFont: false,
    bigCursor: false,
    noMotion: false,
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
    } catch (_) {
      return { ...DEFAULTS };
    }
  }
  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) { /* private mode */ }
  }

  let state = loadState();

  const TOGGLE_KEYS = ['links', 'headings', 'readableFont', 'bigCursor', 'noMotion'];
  const TOGGLE_CLASS = {
    links: 'a11y-links-highlight',
    headings: 'a11y-headings-highlight',
    readableFont: 'a11y-readable-font',
    bigCursor: 'a11y-big-cursor',
    noMotion: 'a11y-no-motion',
  };

  function applyState() {
    const root = document.documentElement.classList;
    root.remove('a11y-contrast-dark', 'a11y-grayscale');
    if (state.contrast === 'dark') root.add('a11y-contrast-dark');
    else if (state.contrast === 'gray') root.add('a11y-grayscale');

    TOGGLE_KEYS.forEach(key => root.toggle(TOGGLE_CLASS[key], !!state[key]));

    document.documentElement.style.fontSize = state.fontStep > 0
      ? (16 * FONT_SCALE[state.fontStep]) + 'px'
      : '';

    syncPanelUI();
  }

  function update(patch) {
    state = { ...state, ...patch };
    saveState();
    applyState();
  }

  function resetAll() {
    state = { ...DEFAULTS };
    saveState();
    applyState();
  }

  /* ── Build the widget ── */
  const wrap = document.createElement('div');
  wrap.className = 'a11y-widget';
  wrap.innerHTML = `
    <button type="button" class="a11y-toggle" id="a11y-toggle" aria-haspopup="dialog" aria-expanded="false" aria-controls="a11y-panel" aria-label="תפריט נגישות">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="6.2" r="2.2" fill="currentColor" />
        <path d="M4.5 9.3c2 1.1 4.9 1.7 7.5 1.7s5.5-.6 7.5-1.7" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" />
        <line x1="12" y1="11" x2="12" y2="15.2" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        <path d="M12 15.2 8.6 21M12 15.2l3.4 5.8" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" />
      </svg>
    </button>

    <div class="a11y-panel" id="a11y-panel" role="dialog" aria-modal="false" aria-labelledby="a11y-panel-title" hidden>
      <div class="a11y-panel-head">
        <h2 id="a11y-panel-title">תפריט נגישות</h2>
        <button type="button" class="a11y-close" id="a11y-close" aria-label="סגירת תפריט הנגישות">✕</button>
      </div>

      <div class="a11y-panel-body">
        <div class="a11y-group">
          <span class="a11y-group-label">גודל טקסט</span>
          <div class="a11y-font-row">
            <button type="button" class="a11y-font-btn" id="a11y-font-dec" aria-label="הקטנת טקסט">א−</button>
            <span class="a11y-font-level" id="a11y-font-level" aria-live="polite">100%</span>
            <button type="button" class="a11y-font-btn" id="a11y-font-inc" aria-label="הגדלת טקסט">א+</button>
          </div>
        </div>

        <button type="button" class="a11y-toggle-btn" data-contrast="dark" aria-pressed="false">
          <span class="a11y-btn-icon" aria-hidden="true">🌙</span> ניגודיות כהה
        </button>
        <button type="button" class="a11y-toggle-btn" data-contrast="gray" aria-pressed="false">
          <span class="a11y-btn-icon" aria-hidden="true">◐</span> גווני אפור
        </button>
        <button type="button" class="a11y-toggle-btn" data-key="links" aria-pressed="false">
          <span class="a11y-btn-icon" aria-hidden="true">🔗</span> הדגשת קישורים
        </button>
        <button type="button" class="a11y-toggle-btn" data-key="headings" aria-pressed="false">
          <span class="a11y-btn-icon" aria-hidden="true">🔠</span> הדגשת כותרות
        </button>
        <button type="button" class="a11y-toggle-btn" data-key="readableFont" aria-pressed="false">
          <span class="a11y-btn-icon" aria-hidden="true">🔤</span> פונט קריא
        </button>
        <button type="button" class="a11y-toggle-btn" data-key="bigCursor" aria-pressed="false">
          <span class="a11y-btn-icon" aria-hidden="true">🖱️</span> סמן מוגדל
        </button>
        <button type="button" class="a11y-toggle-btn" data-key="noMotion" aria-pressed="false">
          <span class="a11y-btn-icon" aria-hidden="true">⏸️</span> עצירת אנימציות
        </button>
      </div>

      <div class="a11y-panel-foot">
        <button type="button" class="a11y-reset" id="a11y-reset">איפוס הגדרות</button>
        <button type="button" class="a11y-statement-link" id="a11y-statement">הצהרת נגישות</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  const toggleBtn = wrap.querySelector('#a11y-toggle');
  const panel = wrap.querySelector('#a11y-panel');
  const closeBtn = wrap.querySelector('#a11y-close');
  const fontLevel = wrap.querySelector('#a11y-font-level');
  const contrastBtns = [...wrap.querySelectorAll('[data-contrast]')];
  const toggleBtns = [...wrap.querySelectorAll('[data-key]')];

  function syncPanelUI() {
    fontLevel.textContent = FONT_LABELS[state.fontStep];
    contrastBtns.forEach(btn => {
      const on = state.contrast === btn.dataset.contrast;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
    toggleBtns.forEach(btn => {
      const on = !!state[btn.dataset.key];
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
  }

  function openPanel() {
    panel.hidden = false;
    toggleBtn.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => panel.classList.add('is-open'));
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('click', onOutsideClick, true);
    closeBtn.focus();
  }
  function closePanel() {
    panel.classList.remove('is-open');
    toggleBtn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKeydown);
    document.removeEventListener('click', onOutsideClick, true);
    setTimeout(() => { panel.hidden = true; }, 200);
    toggleBtn.focus();
  }
  function onKeydown(e) { if (e.key === 'Escape') closePanel(); }
  function onOutsideClick(e) { if (!wrap.contains(e.target)) closePanel(); }

  toggleBtn.addEventListener('click', () => {
    panel.hidden ? openPanel() : closePanel();
  });
  closeBtn.addEventListener('click', closePanel);

  wrap.querySelector('#a11y-font-inc').addEventListener('click', () => {
    update({ fontStep: Math.min(state.fontStep + 1, FONT_SCALE.length - 1) });
  });
  wrap.querySelector('#a11y-font-dec').addEventListener('click', () => {
    update({ fontStep: Math.max(state.fontStep - 1, 0) });
  });

  contrastBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.contrast;
      update({ contrast: state.contrast === mode ? 'normal' : mode });
    });
  });
  toggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      update({ [key]: !state[key] });
    });
  });

  wrap.querySelector('#a11y-reset').addEventListener('click', resetAll);
  wrap.querySelector('#a11y-statement').addEventListener('click', () => {
    closePanel();
    openStatementModal();
  });

  /* ── Accessibility statement modal ──
     Reuses the site's existing .modal-overlay/.modal-card look so it feels
     like the other modals (appointments, policies) instead of a one-off. */
  function openStatementModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-card a11y-statement-card" role="dialog" aria-modal="true" aria-labelledby="a11y-statement-title">
        <button class="modal-close" id="a11y-statement-close" aria-label="סגירה">✕</button>
        <h3 class="modal-title" id="a11y-statement-title">הצהרת נגישות</h3>
        <div class="a11y-statement-body">
          <p>אתר מוריה ניילס פועל במטרה לאפשר לכל אדם, לרבות אנשים עם מוגבלות, להשתמש באתר בנוחות ובעצמאות.</p>
          <p>האתר תוכנן ונבנה תוך שאיפה לעמידה בדרישות תקנות שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות), התשע"ג-2013, ובהנחיות הנגישות לתוכן אינטרנט WCAG 2.0 ברמה AA, כפי שאומצו בתקן הישראלי ת"י 5568.</p>
          <p>בין ההתאמות שבוצעו באתר:</p>
          <ul>
            <li>תפריט נגישות המאפשר הגדלת טקסט, שינוי ניגודיות, הדגשת קישורים וכותרות, פונט קריא, סמן מוגדל ועצירת אנימציות.</li>
            <li>תמיכה בניווט וניהול האתר באמצעות מקלדת בלבד, כולל קישור "דלגי לתוכן הראשי".</li>
            <li>טקסט חלופי לתמונות ותיאורים לרכיבים גרפיים עבור קוראי מסך.</li>
            <li>ניגודיות צבעים ועיצוב התומכים בקריאות.</li>
          </ul>
          <p>אנו פועלים באופן שוטף לשיפור רמת הנגישות באתר. אם נתקלת בקושי או בבעיית נגישות בעת השימוש באתר, נשמח שתפני/י אלינו ונטפל בפנייה בהקדם האפשרי:</p>
          <p class="a11y-statement-contact">
            רכזת הנגישות: מוריה<br />
            טלפון / וואטסאפ: <a href="tel:+972504264057">050-4264057</a><br />
            אימייל: <a href="mailto:moriya681@gmail.com">moriya681@gmail.com</a>
          </p>
          <p class="a11y-statement-date">תאריך עדכון ההצהרה: 16.09.2026</p>
        </div>
      </div>`;

    const close = () => overlay.remove();
    overlay.querySelector('#a11y-statement-close').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
    });

    document.body.appendChild(overlay);
  }

  applyState();
})();
