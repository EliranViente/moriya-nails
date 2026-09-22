/* ═══════════════════════════════════════════
   MORIYA NAILS – Reviews
   Public reviews section (below the gallery): average + star breakdown,
   "text only" filter, "load more" pagination, and the write/edit flow. A
   review is general (about the salon/treatment, not a specific booking) and
   one per client, upserted on her user_id – see supabase/schema.sql.
═══════════════════════════════════════════ */
(function () {
  const PAGE_SIZE = 6;
  const ELIGIBLE_STATUSES_EXCLUDED = ['cancelled', 'rejected', 'no_show', 'pending_urgent_approval'];

  let allReviews   = [];   // every visible review, newest edited first
  let textOnly     = false;
  let visibleCount = PAGE_SIZE;
  let eligible     = false; // logged-in user has at least one real past visit
  let myReview     = null;  // her own review row, if she already wrote one
  let currentRating = 0;
  let deepLinkPending = new URLSearchParams(window.location.search).get('review') === '1';

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function fmtDate(iso) {
    const d = new Date(iso);
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
  }

  function starsMarkup(rating) {
    let out = '';
    for (let i = 1; i <= 5; i++) out += `<span class="star${i <= rating ? ' filled' : ''}">★</span>`;
    return out;
  }

  // ─── Fetching & rendering the public list ─────────────────────────────────
  async function fetchReviews() {
    const { data, error } = await MoriyaAuth.sb
      .from('reviews')
      .select('id, client_name, rating, body, updated_at')
      .eq('status', 'visible')
      .order('updated_at', { ascending: false });
    if (error) { console.warn('fetchReviews failed:', error.message); return []; }
    return data || [];
  }

  function renderSummary() {
    const box = document.getElementById('reviews-summary');
    if (!box) return;
    if (!allReviews.length) { box.style.display = 'none'; return; }
    const avg = allReviews.reduce((s, r) => s + r.rating, 0) / allReviews.length;
    box.style.display = 'flex';
    document.getElementById('reviews-avg').textContent = avg.toFixed(2);
    document.getElementById('reviews-avg-stars').innerHTML = starsMarkup(Math.round(avg));
    document.getElementById('reviews-count').textContent = `(${allReviews.length})`;
  }

  function renderList() {
    const box = document.getElementById('reviews-list');
    const moreBtn = document.getElementById('reviews-more-btn');
    if (!box) return;

    const list = textOnly ? allReviews.filter(r => (r.body || '').trim()) : allReviews;
    if (!list.length) {
      box.innerHTML = `<p class="reviews-empty">${allReviews.length
        ? 'אין חוות דעת עם טקסט להצגה כרגע'
        : 'עדיין אין חוות דעת — היי הראשונה לכתוב 💗'}</p>`;
      if (moreBtn) moreBtn.style.display = 'none';
      return;
    }

    box.innerHTML = list.slice(0, visibleCount).map(r => `
      <div class="review-card">
        <div class="review-card-top">
          <span class="review-avatar">${escapeHtml((r.client_name || 'ל').trim().charAt(0))}</span>
          <div class="review-who">
            <strong class="review-name">${escapeHtml(r.client_name)}</strong>
            <span class="review-date">${fmtDate(r.updated_at)}</span>
          </div>
        </div>
        <div class="stars">${starsMarkup(r.rating)}</div>
        ${r.body ? `<p class="review-body">${escapeHtml(r.body)}</p>` : ''}
      </div>
    `).join('');

    if (moreBtn) moreBtn.style.display = list.length > visibleCount ? 'block' : 'none';
  }

  async function loadReviews() {
    allReviews = await fetchReviews();
    visibleCount = PAGE_SIZE;
    renderSummary();
    renderList();
  }

  // ─── Eligibility: does this client have a real past visit? ───────────────
  async function checkEligibility() {
    if (!MoriyaAuth.isLoggedIn()) { eligible = false; myReview = null; updateWriteButtons(); return; }
    try {
      const [{ data: appts }, { data: mine }] = await Promise.all([
        MoriyaAuth.sb.from('appointments').select('date, start_time, status').eq('user_id', MoriyaAuth.user.id),
        MoriyaAuth.sb.from('reviews').select('id, rating, body').eq('user_id', MoriyaAuth.user.id).maybeSingle(),
      ]);
      const now = Date.now();
      eligible = (appts || []).some(a =>
        !ELIGIBLE_STATUSES_EXCLUDED.includes(a.status) &&
        new Date(`${a.date}T${a.start_time}`).getTime() < now
      );
      myReview = mine || null;
    } catch (e) {
      console.warn('checkEligibility failed:', e.message);
      eligible = false; myReview = null;
    }
    updateWriteButtons();
  }

  function updateWriteButtons() {
    const label = myReview ? '✏️ ערכי את חוות הדעת שלך' : '✍️ כתבי חוות דעת';
    const loggedIn = MoriyaAuth.isLoggedIn();
    // Visible to logged-out visitors too – clicking prompts Google sign-in.
    const showBtn  = !loggedIn || eligible;
    // Logged in but no real past visit yet: explain why the button is gone
    // instead of just hiding it with no trace.
    const showHint = loggedIn && !eligible;

    const sectionBtn = document.getElementById('review-write-btn');
    if (sectionBtn) {
      sectionBtn.style.display = showBtn ? 'inline-flex' : 'none';
      sectionBtn.textContent = label;
    }
    const hint = document.getElementById('reviews-write-hint');
    if (hint) hint.style.display = showHint ? 'inline' : 'none';

    // The "my appointments" CTA only makes sense once logged in.
    const cta = document.getElementById('appts-review-cta');
    const apptsBtn = document.getElementById('appts-review-btn');
    if (cta) cta.style.display = eligible ? 'block' : 'none';
    if (apptsBtn) apptsBtn.textContent = label;
  }

  // ─── Write / edit modal ────────────────────────────────────────────────────
  function renderStarsInput() {
    const box = document.getElementById('review-stars-input');
    if (!box) return;
    box.innerHTML = Array.from({ length: 5 }, (_, i) => {
      const n = i + 1;
      return `<button type="button" class="star-btn${n <= currentRating ? ' filled' : ''}" data-star="${n}" aria-label="${n} כוכבים">★</button>`;
    }).join('');
    box.querySelectorAll('.star-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        currentRating = Number(btn.dataset.star);
        renderStarsInput();
        updateSubmitState();
      });
    });
  }

  function updateSubmitState() {
    const submit = document.getElementById('review-submit');
    if (submit) submit.disabled = currentRating < 1;
  }

  function reviewDisplayName() {
    const full = (MoriyaAuth.displayName() || '').trim();
    if (!full) return 'לקוחה';
    const parts = full.split(/\s+/);
    return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[1].charAt(0)}.`;
  }

  function openReviewModal() {
    if (!window.MoriyaAuth || !MoriyaAuth.ready) {
      alert('רק רגע, האתר עדיין נטען… נסי שוב בעוד שנייה 💗');
      return;
    }
    if (!MoriyaAuth.isLoggedIn()) { MoriyaAuth.signIn(); return; }
    if (!eligible) {
      alert('אפשר להשאיר חוות דעת אחרי שהיה לך ביקור אצל מוריה — נשמח לשמוע ממך אחרי הפעם הבאה! 💗');
      return;
    }
    const modal   = document.getElementById('review-modal');
    const title   = document.getElementById('review-modal-title');
    const bodyEl  = document.getElementById('review-body');
    const submit  = document.getElementById('review-submit');
    if (!modal) return;

    currentRating = myReview ? myReview.rating : 0;
    bodyEl.value  = myReview ? (myReview.body || '') : '';
    title.textContent  = myReview ? 'עדכני את חוות הדעת שלך' : 'כתבי חוות דעת';
    submit.textContent = myReview ? 'עדכני חוות דעת ✓' : 'פרסמי חוות דעת ✓';
    renderStarsInput();
    updateSubmitState();
    modal.style.display = 'flex';
  }

  function closeReviewModal() {
    const modal = document.getElementById('review-modal');
    if (modal) modal.style.display = 'none';
  }

  async function submitReview() {
    if (currentRating < 1) return;
    const submit = document.getElementById('review-submit');
    const bodyEl = document.getElementById('review-body');
    const prevLabel = submit.textContent;
    submit.disabled = true;
    submit.textContent = 'שולחת…';
    try {
      const { data, error } = await MoriyaAuth.sb
        .from('reviews')
        .upsert({
          user_id:     MoriyaAuth.user.id,
          client_name: reviewDisplayName(),
          rating:      currentRating,
          body:        (bodyEl.value || '').trim() || null,
        }, { onConflict: 'user_id' })
        .select()
        .maybeSingle();
      if (error) throw error;
      myReview = data;
      closeReviewModal();
      updateWriteButtons();
      await loadReviews();
    } catch (e) {
      console.warn('submitReview failed:', e.message);
      alert('משהו השתבש בשליחת חוות הדעת, נסי שוב 🙈');
      submit.disabled = false;
      submit.textContent = prevLabel;
    }
  }

  // ─── WhatsApp deep link: ?review=1#reviews opens the modal directly ──────
  function handleDeepLink() {
    const url = new URL(window.location.href);
    url.searchParams.delete('review');
    window.history.replaceState({}, '', url.pathname + url.search + '#reviews');
    const section = document.getElementById('reviews');
    if (section) section.scrollIntoView({ behavior: 'smooth' });
    setTimeout(openReviewModal, 400);
  }

  // ─── Wiring ────────────────────────────────────────────────────────────────
  document.getElementById('review-write-btn')?.addEventListener('click', openReviewModal);
  document.getElementById('appts-review-btn')?.addEventListener('click', openReviewModal);
  document.getElementById('review-close')?.addEventListener('click', closeReviewModal);
  document.getElementById('review-modal')?.addEventListener('click', e => {
    if (e.target.id === 'review-modal') closeReviewModal();
  });
  document.getElementById('review-submit')?.addEventListener('click', submitReview);
  document.getElementById('reviews-text-only')?.addEventListener('change', e => {
    textOnly = e.target.checked;
    visibleCount = PAGE_SIZE;
    renderList();
  });
  document.getElementById('reviews-more-btn')?.addEventListener('click', () => {
    visibleCount += PAGE_SIZE;
    renderList();
  });

  document.addEventListener('moriya-auth-changed', async () => {
    await checkEligibility();
    if (deepLinkPending) { deepLinkPending = false; handleDeepLink(); }
  });
  // MoriyaAuth may already be ready by the time this script runs (unlikely,
  // since initAuth() awaits a network call, but cheap to cover).
  if (window.MoriyaAuth && MoriyaAuth.ready) checkEligibility();

  loadReviews();
})();
