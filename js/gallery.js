/* ═══════════════════════════════════════════
   MORIYA NAILS – Gallery
   Instagram-style post carousel: swipe / arrows / dots,
   tap an image to open the Instagram profile.
═══════════════════════════════════════════ */
(function () {
  const frame = document.getElementById('ip-frame');
  const track = document.getElementById('ip-track');
  if (!frame || !track) return;

  const slides  = Array.from(track.querySelectorAll('.ip-slide'));
  const prevBtn = document.getElementById('ip-prev');
  const nextBtn = document.getElementById('ip-next');
  const counter = document.getElementById('ip-counter');
  const dotsBox = document.getElementById('ip-dots');
  const total   = slides.length;
  let index = 0;

  // Build position dots
  const dots = slides.map((_, i) => {
    const d = document.createElement('span');
    d.className = 'ip-dot' + (i === 0 ? ' active' : '');
    d.addEventListener('click', () => goTo(i));
    dotsBox.appendChild(d);
    return d;
  });

  function render() {
    track.style.transform = `translateX(${-index * 100}%)`;
    if (counter) counter.textContent = `${index + 1}/${total}`;
    dots.forEach((d, i) => d.classList.toggle('active', i === index));
    if (prevBtn) prevBtn.classList.toggle('hidden', index === 0);
    if (nextBtn) nextBtn.classList.toggle('hidden', index === total - 1);
  }

  function goTo(i) {
    index = Math.max(0, Math.min(total - 1, i));
    render();
  }

  // ‹ is visually on the left → previous · › on the right → next
  prevBtn?.addEventListener('click', () => goTo(index - 1));
  nextBtn?.addEventListener('click', () => goTo(index + 1));

  // ─── Swipe / drag ────────────────────────────────────────────────────────────
  let startX = 0, deltaX = 0, dragging = false, moved = false;
  const DRAG_THRESHOLD = 8;   // px before a touch counts as a swipe (not a tap)
  const SWIPE_TRIGGER  = 50;  // px swiped to advance a slide

  function onDown(x) {
    startX = x; deltaX = 0; dragging = true; moved = false;
    track.classList.add('dragging');
  }
  function onMove(x) {
    if (!dragging) return;
    deltaX = x - startX;
    if (Math.abs(deltaX) > DRAG_THRESHOLD) moved = true;
    const pct = (deltaX / frame.offsetWidth) * 100;
    track.style.transform = `translateX(${-index * 100 + pct}%)`;
  }
  function onUp() {
    if (!dragging) return;
    dragging = false;
    track.classList.remove('dragging');
    // Swipe left (deltaX < 0) → next image · swipe right → previous
    if (deltaX <= -SWIPE_TRIGGER) goTo(index + 1);
    else if (deltaX >= SWIPE_TRIGGER) goTo(index - 1);
    else render();
  }

  // Touch
  frame.addEventListener('touchstart', e => onDown(e.touches[0].clientX), { passive: true });
  frame.addEventListener('touchmove',  e => onMove(e.touches[0].clientX), { passive: true });
  frame.addEventListener('touchend',   onUp);

  // Mouse (desktop drag)
  frame.addEventListener('mousedown', e => { e.preventDefault(); onDown(e.clientX); });
  window.addEventListener('mousemove', e => onMove(e.clientX));
  window.addEventListener('mouseup', onUp);

  // A drag must not also trigger the slide's link – suppress the click after a swipe.
  slides.forEach(slide => {
    slide.addEventListener('click', e => { if (moved) e.preventDefault(); });
  });

  // Keyboard support
  frame.setAttribute('tabindex', '0');
  frame.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') goTo(index - 1); // RTL: right arrow → previous
    if (e.key === 'ArrowLeft')  goTo(index + 1);
  });

  render();
})();
