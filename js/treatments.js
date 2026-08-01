/* ═══════════════════════════════════════════
   MORIYA NAILS – Shared treatment catalogue
   Every treatment on offer, with its time and price, in one place. Loaded by
   both the client booking flow (app.js) and the admin dashboard (admin.js), so
   the add-ons a client picks and the ones Moriya can put on an appointment
   afterwards are always the same list at the same prices.

   The base treatments themselves are also spelled out in index.html's step 1
   markup (data-time / data-price on .base-treatment-row), which is where the
   booking page reads them from; BASES below mirrors those two rows so the admin
   editor can offer them too. Change a base price and both have to move.
═══════════════════════════════════════════ */
(function () {

  // ─── Add-on option pickers ─────────────────────────────────────────────────
  // An add-on whose sub-options the client chooses on a screen of their own: she
  // ticks the add-on, a modal opens with everything on offer, she picks as many
  // as she likes, watches the time and price they add at the top, and confirms
  // with "הוסיפי לתור". Each chosen option then joins the appointment as a
  // service of its own ("קישוט – ציורי גלים"), so Moriya's calendar, the
  // confirmation card and the reschedule panel all list exactly what was picked.
  //
  // The whole mechanism is driven by this config: another add-on that works this
  // way needs an entry here and an .addon-row[data-type="picker"] row pointing
  // at it by key – no new markup or handlers of its own.
  //
  // An option carrying `priceLabel` is priced in person instead of on the site:
  // its price counts as 0 in the total, and the range shows wherever the total
  // does. `note` is shown while that option is picked; the picker's own `note`
  // covers every option that doesn't bring one, unless the option opts out with
  // `sharedNote: false`.
  const PICKERS = {
    deco: {
      prefix:     'קישוט',
      title:      'בחרי את הקישוטים',
      subtitle:   'ניתן לבחור יותר מקישוט אחד · הזמן והמחיר יתווספו לתור',
      editLabel:  'שינוי הקישוטים',
      confirm:       'הוסיפי לתור ✓',
      confirmUpdate: 'עדכני את הטיפול ✓',
      emptyTime:  "10–15 דק'",
      emptyPrice: '5–40 ₪',
      // Priced per nail – which is why french, ombre and pearl powder, covering
      // the whole hand for one price, opt out of it.
      note: {
        emoji: '💗',
        tone:  'pink',
        text:  'הקישוט מתומחר כאחד לכל ציפורן, במידה ותרצי יותר מאחד על כל ציפורן תיתכנה עלויות נוספות במועד התור'
      },
      options: [
        { id: 'french', emoji: '🌸', name: 'פרנץ׳ קלאסי ואלגנטי',       time: 15, price: 20, sharedNote: false },
        { id: 'ombre',  emoji: '🌈', name: 'מעבר אומברה מדורג ועדין',   time: 15, price: 20, sharedNote: false },
        { id: 'pearl',  emoji: '🧚', name: 'אבקת פנינה',                time: 15, price: 15, sharedNote: false },
        { id: 'waves',  emoji: '🌊', name: 'ציורי גלים',                time: 15, price: 15 },
        { id: 'stones', emoji: '💎', name: 'אבנים דמוי יהלום מודבקות',  time: 10, price: 10 },
        { id: 'custom', emoji: '🎨', name: 'עיצוב אישי',                time: 15, price: 0,
          priceLabel: '5–40 ₪ (ייקבע בתור)', priceShort: '5–40 ₪',
          note: { emoji: '💡', text: 'המחיר המדויק של הקישוט ייקבע בתור עצמו בהתאם לעיצוב שתבחרי' } },
      ],
    },
  };

  // The name a chosen option carries as a service, e.g. "קישוט – ציורי גלים".
  function pickerServiceName(cfg, opt) {
    return cfg.prefix ? `${cfg.prefix} – ${opt.name}` : opt.name;
  }

  // A picker's options as stand-alone add-on entries, built from the very same
  // config the booking modal uses – so a decoration already on an appointment
  // maps back onto a control of its own instead of being locked away.
  function pickerExtras(key) {
    const cfg = PICKERS[key];
    if (!cfg) return [];
    return cfg.options.map(o => {
      const x = {
        id: `${key}-${o.id}`, emoji: o.emoji, name: pickerServiceName(cfg, o),
        desc: o.desc || '', type: 'checkbox', time: o.time, price: o.price
      };
      if (o.priceLabel) x.priceLabel = o.priceLabel;
      return x;
    });
  }

  // ─── The base manicure ─────────────────────────────────────────────────────
  // Mirrors index.html step 1. The two are alternatives, never both: `exclusive`
  // groups them so ticking one clears the other wherever they are offered.
  const BASES = [
    { id: 'base-anatomic', emoji: '💅', name: "מניקור לק ג'ל עם מבנה אנטומי", desc: 'מניקור מלא עם לק ג׳ל ומבנה אנטומי', type: 'checkbox', time: 90, price: 160, exclusive: 'base' },
    { id: 'base-plain',    emoji: '💅', name: "מניקור לק ג'ל",                desc: 'מניקור מלא עם לק ג׳ל עמיד ומבריק',  type: 'checkbox', time: 75, price: 140, exclusive: 'base' },
  ];

  // ─── Hand add-ons ──────────────────────────────────────────────────────────
  // In the order the booking page offers them. The `name` fields match the
  // booking flow exactly, so an add-on already on an appointment maps back onto
  // its control (pre-filled and removable). `time`/`price` are per-unit;
  // quantity rows multiply by the chosen count.
  //
  // `rescheduleExtra: false` marks an add-on the client's own reschedule panel
  // leaves out – the polish removal is picked when the appointment is made, not
  // bolted on afterwards. Moriya's editor still offers it, since she is
  // recording what actually happened at the appointment.
  const HAND_EXTRAS = [
    { id: 'double',  emoji: '💎', name: 'שתי שכבות בייס / אבקת אקריל',       desc: 'חיזוק נוסף לציפורניים',                          type: 'checkbox', time: 15, price: 20 },
    ...pickerExtras('deco'),
    { id: 'removal', emoji: '💧', name: 'הסרת לק ושיוף צורה',                desc: 'הסרה מקצועית ועדינה של לק קיים ושיוף הצורה',     type: 'checkbox', time: 30, price: 50, rescheduleExtra: false },
    { id: 'polygel', emoji: '🔧', name: "השלמת ציפורן בטיפס ג'ל",            desc: 'השלמת ציפורן שנשברה · 15 ₪ ו-10 דק׳ לציפורן',    type: 'quantity', time: 10, price: 15 },
    { id: 'crack',   emoji: '🩹', name: 'תיקון סדק בציפורן',                 desc: 'תיקון מהיר לסדק · 5 ₪ ו-5 דק׳ לציפורן',          type: 'quantity', time: 5,  price: 5  },
    { id: 'pincer',  emoji: '📐', name: 'תיקון מבנה נשרי לציפורן',           desc: 'החזרת מבנה ישר לציפורן · 15 ₪ ו-10 דק׳ לציפורן', type: 'quantity', time: 10, price: 15 },
    { id: 'toolkit', emoji: '💼', name: 'סט כלים אישי',                      desc: 'סט כלים אישי הנשמר על שמך לטיפולים הבאים',       type: 'checkbox', time: 0,  price: 30 },
  ];

  // The add-ons a client may add to / remove from an existing appointment while
  // rescheduling. Only the base treatment stays locked there.
  const RESCHEDULE_EXTRAS = HAND_EXTRAS.filter(x => x.rescheduleExtra !== false);

  // ─── Feet ──────────────────────────────────────────────────────────────────
  // Gel polish on the toes and its own add-ons – treatments booked alongside the
  // manicure, chosen on a page of their own (step 1B) between the manicure and
  // the calendar. Every one carries `separate: true`, so Moriya's calendar lists
  // them after the manicure behind "בנוסף,"; their time and price join the
  // appointment total like anything else, which is what keeps every calendar
  // constraint (the breaks, the 90-min grid, the 18:00 close) applying to them
  // unchanged. `requiresGel` mirrors step 1's data-requires-base: those two only
  // make sense on top of the polish itself, while the removal stands on its own.
  // The names repeat step 1's wording, so everything that matches a saved
  // service back to a control compares `separate` alongside the name.
  // Offered only to clients MoriyaAuth.canBookFeetGel() allows.
  const FEET = [
    { id: 'feetgel',     emoji: '🦶', name: "לק ג'ל ברגליים",    desc: "מניקור עדין ומריחת לק ג'ל",                  checkId: 'chk-feet-gel',     type: 'checkbox', time: 60, price: 120, separate: true },
    { id: 'feetdouble',  emoji: '💎', name: 'שתי שכבות בייס',     desc: 'חיזוק נוסף עם שכבת בייס כפולה',              checkId: 'chk-feet-double',  type: 'checkbox', time: 15, price: 20,  separate: true, requiresGel: true },
    { id: 'feetfrench',  emoji: '🌸', name: 'פרנץ׳',              desc: "אפקט פרנץ' קלאסי ואלגנטי",                   checkId: 'chk-feet-french',  type: 'checkbox', time: 15, price: 20,  separate: true, requiresGel: true },
    { id: 'feetremoval', emoji: '💧', name: 'הסרת לק ושיוף צורה', desc: 'הסרה מקצועית ועדינה של לק קיים ושיוף הצורה', checkId: 'chk-feet-removal', type: 'checkbox', time: 30, price: 50,  separate: true },
  ];

  // ─── The whole catalogue, grouped ──────────────────────────────────────────
  // What Moriya's editor shows: everything on offer, in the order the booking
  // page offers it.
  function sections() {
    return [
      { title: 'הטיפול הבסיסי', hint: 'אחד מהשניים', items: BASES },
      { title: 'תוספות לידיים',                       items: HAND_EXTRAS },
      { title: 'טיפולי רגליים', hint: 'נספרים כטיפול נפרד', items: FEET },
    ];
  }

  // Every entry in the catalogue, flat.
  function all() {
    return [...BASES, ...HAND_EXTRAS, ...FEET];
  }

  // A saved service's name as it is stored for a quantity add-on: "<name> (×N)".
  const QTY_RE = /^(.+?)\s*\(×(\d+)\)\s*$/;

  // Match an appointment's saved services back onto catalogue entries.
  // Returns { picked, qty, price, unmatched }:
  //   picked    – { [id]: true } for the checkbox entries on the appointment
  //   qty       – { [id]: n } for the quantity entries
  //   price     – { [id]: ₪ } the price actually saved, for entries priced in
  //               person (the decoration whose price is set at the appointment)
  //   unmatched – services with no entry of their own (an old name, or a
  //               treatment that has since been taken off the list), kept as-is
  //               so an edit can never quietly drop what was booked.
  // Step 1B repeats step 1's wording ("שתי שכבות בייס", "הסרת לק ושיוף צורה"),
  // so a name alone can't tell a hand treatment from a foot one – `separate` is
  // what distinguishes them, and it has to match too.
  function matchServices(services, catalog) {
    const list = catalog || all();
    const picked = {}, qty = {}, price = {}, unmatched = [];
    const sameKind = (x, svc) => !!x.separate === !!svc.separate;
    (services || []).forEach(svc => {
      const q = QTY_RE.exec((svc && svc.name) || '');
      if (q) {
        const cat = list.find(x => x.type === 'quantity' && x.name === q[1].trim() && sameKind(x, svc));
        if (cat) { qty[cat.id] = (qty[cat.id] || 0) + (parseInt(q[2], 10) || 0); return; }
      } else {
        const cat = list.find(x => x.type === 'checkbox' && x.name === svc.name && sameKind(x, svc));
        if (cat) {
          picked[cat.id] = true;
          if (cat.priceLabel) price[cat.id] = Number(svc.price) || 0;
          return;
        }
      }
      unmatched.push(svc);
    });
    return { picked, qty, price, unmatched };
  }

  // A catalogue entry as a service, in the {name,time,price} shape every part of
  // the system stores. `count` multiplies a quantity entry; `overridePrice` is
  // the price Moriya set for an entry priced in person.
  function toService(entry, { count = 1, overridePrice = null } = {}) {
    const s = entry.type === 'quantity'
      ? { name: `${entry.name} (×${count})`, time: entry.time * count, price: entry.price * count }
      : { name: entry.name, time: entry.time, price: entry.price };
    // A price set in person stays a range until it is actually charged; once a
    // real price is on it, it is a price like any other.
    if (overridePrice !== null && overridePrice !== undefined) s.price = Number(overridePrice) || 0;
    else if (entry.priceLabel) s.priceLabel = entry.priceLabel;
    if (entry.separate) s.separate = true;
    return s;
  }

  window.MoriyaTreatments = {
    PICKERS, BASES, HAND_EXTRAS, RESCHEDULE_EXTRAS, FEET,
    pickerServiceName, pickerExtras,
    sections, all, matchServices, toService, QTY_RE,
  };
})();
