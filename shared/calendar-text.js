/**
 * Shared formatting for the treatment list on a Google Calendar event – Moriya's
 * and, through the "add to my calendar" link, the client's too. Required by
 * /api/book, /api/manage-booking, the standalone dev server and the booking page
 * itself, so a booking, a later reschedule and the client's own copy always read
 * identically.
 *
 * A service marked `separate: true` is not part of the manicure — it is its own
 * treatment booked alongside it (currently the gel polish on the toes). Those
 * are listed after every regular treatment, behind a "בנוסף," separator, so the
 * event reads: the manicure the client chose, then her add-ons, then the extra
 * appointment. The event's own start/end already cover the full duration.
 */

const SEPARATE_PREFIX = 'בנוסף,';

// Options chosen from one add-on picker come through as services sharing a
// prefix ("קישוט – פרנץ׳ קלאסי ואלגנטי", "קישוט – מעבר אומברה עדין"). Saying the
// prefix once reads far better on a calendar, so they are gathered back into
// "קישוט – פרנץ׳ קלאסי ואלגנטי, מעבר אומברה עדין".
const PREFIX_SEP = ' – ';

// Join services into one line, with same-prefix ones gathered. Takes services or
// plain names, and keeps the order they were booked in.
function joinServiceNames(services) {
  const groups = [];   // { prefix, parts } in first-seen order
  (services || []).forEach(s => {
    const name = (typeof s === 'string' ? s : s && s.name) || '';
    if (!name) return;
    const at     = name.indexOf(PREFIX_SEP);
    const prefix = at > 0 ? name.slice(0, at) : null;
    const rest   = at > 0 ? name.slice(at + PREFIX_SEP.length) : name;
    const group  = prefix && groups.find(g => g.prefix === prefix);
    if (group) group.parts.push(rest);
    else groups.push({ prefix, parts: [rest] });
  });
  return groups
    .map(g => (g.prefix ? g.prefix + PREFIX_SEP : '') + g.parts.join(', '))
    .join(', ');
}

// Split into the treatments that make up the manicure and the separately-booked
// ones. When nothing but separate treatments were booked there is nothing to be
// "in addition" to, so they are the regular list.
function splitServices(services) {
  const all      = (services || []).filter(Boolean);
  const regular  = all.filter(s => !s.separate);
  const separate = all.filter(s => s.separate);
  return regular.length ? { regular, separate } : { regular: separate, separate: [] };
}

// One-line list for the event title, e.g.
// "מניקור לק ג'ל עם מבנה אנטומי, פרנץ׳ קלאסי, בנוסף, לק ג'ל ברגליים"
function serviceTitle(services) {
  const { regular, separate } = splitServices(services);
  const parts = regular.length ? [joinServiceNames(regular)] : [];
  if (separate.length) parts.push(`${SEPARATE_PREFIX} ${joinServiceNames(separate)}`);
  return parts.join(', ');
}

// The description's treatment block, as lines: the manicure and its add-ons on
// the first line, then one line per separately-booked treatment carrying its own
// duration and price so Moriya sees what that part of the appointment is worth.
function serviceDetailLines(services) {
  const { regular, separate } = splitServices(services);
  const lines = [];
  if (regular.length) lines.push(joinServiceNames(regular));
  separate.forEach(s => {
    const nums = [
      s.time  ? `${s.time} דק'` : '',
      s.price ? `${s.price} ₪`  : '',
    ].filter(Boolean).join(' · ');
    lines.push(`${SEPARATE_PREFIX} ${s.name}${nums ? ` (${nums})` : ''}`);
  });
  return lines;
}

// The booking page loads this as a plain <script> (the functions above are then
// simply globals); the server and the Netlify functions require() it.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SEPARATE_PREFIX, joinServiceNames, serviceTitle, serviceDetailLines };
}
