/* ═══════════════════════════════════════════
   MORIYA NAILS – Authentication
   Supabase + Google login, navbar greeting
═══════════════════════════════════════════ */

const SUPABASE_URL      = 'https://yspzwxyxhdjtpcqaebls.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_C77ymTC07RcpoMwmNDESRw_V_gY31OG';
const ADMIN_EMAILS      = ['eliran.viente@gmail.com', 'moriya681@gmail.com'];

// Supabase hands the session back by appending "#access_token=…" to the URL we
// redirect to. If that URL already had a hash (tapping "הזמיני תור עכשיו" leaves
// "#booking" on it), she comes back to "#booking#access_token=…", which the
// client can't read — so she lands on the site still logged out, every time.
// The section she was on is therefore kept here instead of in the URL, and put
// back once she returns (see restoreResumeHash).
const RESUME_HASH_KEY = 'moriya-auth-resume-hash';

function rememberResumeHash(hash) {
  try {
    if (hash) sessionStorage.setItem(RESUME_HASH_KEY, hash);
    else      sessionStorage.removeItem(RESUME_HASH_KEY);
  } catch (_) { /* private mode: she just won't be scrolled back */ }
}

// A login started before this fix (or from a tab that was already open) can
// still come back as "#booking#access_token=…". Split it before the Supabase
// client reads the URL, so that login goes through too.
(function rescueTokensBehindHash() {
  const hash = window.location.hash;
  const second = hash.indexOf('#', 1);
  if (second === -1) return;
  const tokens = hash.slice(second + 1);
  if (!/(^|&)(access_token|error_description)=/.test(tokens)) return;
  rememberResumeHash(hash.slice(0, second));
  history.replaceState(history.state, '', window.location.pathname + window.location.search + '#' + tokens);
})();

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const MoriyaAuth = {
  sb,
  user: null,
  profile: null,
  ready: false,

  isLoggedIn() { return !!this.user; },
  isAdmin() {
    return this.user && ADMIN_EMAILS.includes((this.user.email || '').toLowerCase());
  },

  // Gel polish on the toes is offered to admins and to the clients the admin has
  // flagged in the dashboard (profiles.feet_gel_allowed). Everyone else never
  // sees the treatment. The flag is admin-only to write — see the schema's
  // guard_feet_gel_allowed() trigger — so this check can't be talked around by
  // editing a profile from the client side.
  canBookFeetGel() {
    if (!this.user) return false;
    return this.isAdmin() || !!(this.profile && this.profile.feet_gel_allowed);
  },

  // The name saved on the profile always wins — the one she last booked with, or
  // the one Moriya set for her in the dashboard. Google's name is only the
  // starting point (see seedProfileName), so logging out and back in never
  // undoes a rename.
  displayName() {
    const meta = (this.user && this.user.user_metadata) || {};
    return ((this.profile && this.profile.full_name) || '').trim() ||
           meta.full_name || meta.name ||
           ((this.user && this.user.email) ? this.user.email.split('@')[0] : '');
  },
  firstName() {
    return (this.displayName() || '').trim().split(/\s+/)[0];
  },

  async signIn() {
    // Keeps the query (e.g. the WhatsApp review link's ?review=1) through the
    // Google redirect round-trip, so a flow started while logged out resumes
    // where it left off. The hash must stay out of redirectTo — see
    // RESUME_HASH_KEY — so it travels in sessionStorage instead.
    rememberResumeHash(window.location.hash);
    const redirectTo = window.location.origin + window.location.pathname +
      window.location.search;
    await sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        // Always show Google's account chooser, so a client with more than one
        // Gmail picks the one she wants instead of being signed straight into
        // whichever the phone used last.
        queryParams: { prompt: 'select_account' },
      },
    });
  },

  async signOut() {
    await sb.auth.signOut();
    // Always land on the public home page logged-out. On admin.html a plain
    // reload would re-open the gated dashboard with no session (blank screen),
    // so send every logout back to index.html like any other visitor.
    const onHome = /(^|\/)index\.html$/.test(window.location.pathname) ||
                   window.location.pathname === '/' ||
                   window.location.pathname === '';
    if (onHome) window.location.reload();
    else        window.location.href = 'index.html';
  },

  async loadProfile() {
    if (!this.user) { this.profile = null; return; }
    try {
      const { data } = await sb.from('profiles').select('*').eq('id', this.user.id).maybeSingle();
      this.profile = data || null;
    } catch (e) {
      console.warn('loadProfile failed:', e.message);
      this.profile = null;
    }
    await this.seedProfileName();
  },

  // Copy the Google name into the profile the first time, and only then. Once
  // the profile carries a name, that name is the one shown everywhere and this
  // does nothing — which is what keeps a rename (hers on the booking form, or
  // Moriya's in the dashboard) from being overwritten on the next login.
  //
  // The signup trigger normally fills the row in, but a client who signed in
  // before it existed — or whose Google account had no name to give at the time
  // — can still be sitting there nameless, so the row is repaired (or created)
  // here rather than left to fall back to Google's copy forever.
  async seedProfileName() {
    if (!this.user) return;
    if (((this.profile && this.profile.full_name) || '').trim()) return;

    const meta = this.user.user_metadata || {};
    const googleName = (meta.full_name || meta.name || '').trim();
    if (!googleName) return;

    try {
      // Only the columns listed here are written, so a profile that already
      // exists keeps its phone and its feet gel-polish permission untouched.
      const { data, error } = await sb.from('profiles')
        .upsert({ id: this.user.id, email: this.user.email, full_name: googleName })
        .select().maybeSingle();
      if (error) { console.warn('seedProfileName failed:', error.message); return; }
      if (data) this.profile = data;
    } catch (e) {
      console.warn('seedProfileName failed:', e.message);
    }
  },
};
window.MoriyaAuth = MoriyaAuth;

// Google "G" logo (multicolor)
const GOOGLE_G = `
  <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
    <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>
    <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/>
    <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"/>
    <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>
  </svg>`;

function renderAuthUI() {
  const box = document.getElementById('nav-auth');
  if (!box) return;

  // Flag the navbar with who is looking at it. Only the logged-in client bar
  // carries the extra "my appointments" button, so only it needs the tighter
  // phone sizing — the admin and logged-out bars stay exactly as they were.
  const navbar = document.getElementById('navbar');
  const isAdmin = MoriyaAuth.isLoggedIn() && MoriyaAuth.isAdmin();
  const isClient = MoriyaAuth.isLoggedIn() && !isAdmin;
  if (navbar) {
    navbar.classList.toggle('is-admin', isAdmin);
    navbar.classList.toggle('is-client', isClient);
  }

  if (MoriyaAuth.isLoggedIn()) {
    const name = MoriyaAuth.firstName();
    // Admins get a quick link to the management dashboard.
    const adminLink = isAdmin
      ? `<a class="nav-admin-link" href="admin.html">📊 ניהול</a>`
      : '';
    box.innerHTML = `
      ${adminLink}
      <button class="nav-auth-btn myappts" id="btn-myappts">התורים שלי</button>
      <span class="nav-greeting">שלום ${name} 👋</span>
      <button class="nav-auth-btn logout" id="btn-logout">התנתקות</button>
    `;
    const my = document.getElementById('btn-myappts');
    if (my) my.addEventListener('click', () => window.openMyAppointments && window.openMyAppointments());
    const lo = document.getElementById('btn-logout');
    if (lo) lo.addEventListener('click', () => MoriyaAuth.signOut());
  } else {
    box.innerHTML = `
      <button class="nav-auth-btn google" id="btn-login">
        ${GOOGLE_G}
        <span>התחברות עם Google</span>
      </button>`;
    const li = document.getElementById('btn-login');
    if (li) li.addEventListener('click', () => MoriyaAuth.signIn());
  }
  // notify the rest of the app (e.g. booking autofill)
  document.dispatchEvent(new CustomEvent('moriya-auth-changed'));
}

// Back from Google: put the section she was on ("#booking") back in the URL and
// scroll to it. Runs once the client has read and cleared the tokens.
function restoreResumeHash() {
  let hash = null;
  try {
    hash = sessionStorage.getItem(RESUME_HASH_KEY);
    sessionStorage.removeItem(RESUME_HASH_KEY);
  } catch (_) { return; }
  if (!hash || hash.length < 2) return;
  history.replaceState(history.state, '', window.location.pathname + window.location.search + hash);
  let target = null;
  try { target = document.getElementById(decodeURIComponent(hash.slice(1))); } catch (_) {}
  if (target) target.scrollIntoView();
}

async function initAuth() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    MoriyaAuth.user = (session && session.user) || null;
    await MoriyaAuth.loadProfile();
  } catch (e) {
    console.warn('initAuth error:', e.message);
  }
  restoreResumeHash();
  MoriyaAuth.ready = true;
  renderAuthUI();

  sb.auth.onAuthStateChange(async (_event, session) => {
    MoriyaAuth.user = (session && session.user) || null;
    await MoriyaAuth.loadProfile();
    renderAuthUI();
  });
}
initAuth();
