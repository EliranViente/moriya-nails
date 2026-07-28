/**
 * Shared formatting for the treatment list on Moriya's Google Calendar events.
 * Required by /api/book, /api/manage-booking and the standalone dev server so a
 * booking and a later reschedule always read identically on the calendar.
 *
 * A service marked `separate: true` is not part of the manicure — it is its own
 * treatment booked alongside it (currently the gel polish on the toes). Those
 * are listed after every regular treatment, behind a "בנוסף," separator, so the
 * event reads: the manicure the client chose, then her add-ons, then the extra
 * appointment. The event's own start/end already cover the full duration.
 */

const SEPARATE_PREFIX = 'בנוסף,';

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
  const parts = regular.map(s => s.name);
  if (separate.length) parts.push(`${SEPARATE_PREFIX} ${separate.map(s => s.name).join(', ')}`);
  return parts.join(', ');
}

// The description's treatment block, as lines: the manicure and its add-ons on
// the first line, then one line per separately-booked treatment carrying its own
// duration and price so Moriya sees what that part of the appointment is worth.
function serviceDetailLines(services) {
  const { regular, separate } = splitServices(services);
  const lines = [];
  if (regular.length) lines.push(regular.map(s => s.name).join(', '));
  separate.forEach(s => {
    const nums = [
      s.time  ? `${s.time} דק'` : '',
      s.price ? `${s.price} ₪`  : '',
    ].filter(Boolean).join(' · ');
    lines.push(`${SEPARATE_PREFIX} ${s.name}${nums ? ` (${nums})` : ''}`);
  });
  return lines;
}

module.exports = { SEPARATE_PREFIX, serviceTitle, serviceDetailLines };
