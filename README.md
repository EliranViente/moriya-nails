# Moriya Nails Website

Beautiful Hebrew nail salon website with Google Calendar booking integration.

---

## Project Structure

```
MoriyaNails/
├── index.html          ← Main website (open this in browser)
├── css/style.css       ← All styles
├── js/app.js           ← Frontend logic (booking, calendar, UI)
├── images/
│   ├── logo.jpg        ← The Moriya Nails logo (navbar / hero / footer / favicon)
│   └── insta/          ← Real work photos used in the gallery collage
├── netlify.toml        ← Netlify config (static site + /api routes)
├── package.json        ← Dependencies for the serverless functions
├── netlify/functions/  ← Booking backend on Netlify (busy-slots.js, book.js)
└── server/             ← Same backend as a standalone Express server (local dev only)
    ├── server.js
    ├── package.json
    └── .env.example
```

---

## Running the website WITHOUT the backend

Just open `index.html` in any browser. The booking form will work in "demo mode" – appointments won't sync to Google Calendar yet, but everything else (UI, price calculation, date selection) will work perfectly.

---

## Setting up Google Calendar sync (one-time setup)

### Step 1 – Create a Google Cloud project

1. Go to https://console.cloud.google.com
2. Click **New Project**, name it `moriya-nails`, click Create
3. In the sidebar go to **APIs & Services → Library**
4. Search for **Google Calendar API** and click **Enable**

### Step 2 – Create a Service Account

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → Service Account**
3. Name it `moriya-nails-bot`, click **Done**
4. Click the service account you just created
5. Go to **Keys** tab → **Add Key → Create new key → JSON**
6. A `.json` file will download – keep it safe!

### Step 3 – Share the calendar with the service account

1. Open the downloaded JSON file and copy the `client_email` value
   (looks like: `moriya-nails-bot@your-project.iam.gserviceaccount.com`)
2. Open Google Calendar at https://calendar.google.com (logged in as moriya681@gmail.com)
3. Find your calendar on the left → click the three dots → **Settings and sharing**
4. Under **Share with specific people** → Add the `client_email` you copied
5. Set permission to **Make changes to events** → click **Send**

### Step 4 – Configure the server

```bash
cd server
cp .env.example .env
```

Open `.env` and paste the entire contents of the downloaded JSON file as the value of `GOOGLE_CREDENTIALS` (all on one line, no line breaks).

### Step 5 – Install dependencies and start the server

```bash
cd server
npm install
npm start
```

The server runs on http://localhost:3001

### Step 6 – Update the frontend URL

Open `js/app.js` and find this line near the top:

```js
const API_BASE = window.location.hostname === 'localhost'
  ? 'http://localhost:3001'
  : ''; // ← Set to your deployed backend URL here
```

For local use, `http://localhost:3001` is already correct.

---

## The logo

The real Moriya Nails logo lives at `images/logo.jpg` and appears automatically in the
navbar, hero, footer and browser tab. To swap in a higher-resolution version, just
replace that file (keep the same name) – everything updates automatically.

---

## Deploying to the internet (Netlify – site + calendar in one place)

The project is already configured for Netlify (`netlify.toml`, root `package.json`,
and the booking backend as serverless functions in `netlify/functions/`). The site
and the Google Calendar sync are hosted **together** on one free URL.

### A. Do the Google Calendar setup first
Complete **Steps 1–3** above (create a Google Cloud project, create a service account
+ JSON key, and share the `moriya681@gmail.com` calendar with the service account email
as "Make changes to events"). Keep the downloaded JSON file handy.

### B. Put the project on GitHub (recommended) or deploy the folder directly
**Option 1 – GitHub (best, gives auto-updates):**
1. Create a free account at https://github.com and a new repository.
2. Upload all the project files to it (drag-and-drop in the GitHub web UI works).

**Option 2 – Drag & drop:** skip GitHub and use Netlify's manual deploy (see next step).

### C. Connect to Netlify
1. Create a free account at https://app.netlify.com (you can log in with GitHub).
2. **Add new site → Import an existing project** → pick your GitHub repo.
   (Or **Deploy manually** and drag the whole `MoriyaNails` folder in.)
3. Netlify auto-detects `netlify.toml`. Leave build settings as-is and click **Deploy**.

### D. Add the two environment variables
In Netlify: **Site configuration → Environment variables → Add a variable**:
- `GOOGLE_CREDENTIALS` → paste the **entire** contents of the service-account JSON file
  (one value, the whole JSON).
- `CALENDAR_ID` → `moriya681@gmail.com`

Then **Deploys → Trigger deploy → Deploy site** so the functions pick up the variables.

### E. You're live 🎉
Your site is at something like `https://moriya-nails.netlify.app` (you can rename the
subdomain under **Site configuration → Change site name**). Bookings made on the site
now appear automatically in the `moriya681@gmail.com` calendar. Put this link in your
Instagram bio.

> No code changes are needed: in production the frontend calls `/api/...`, which
> `netlify.toml` routes to the serverless functions. `API_BASE` only points to
> `localhost:3001` when you run the old Express server locally.

---

## Calendar: moriya681@gmail.com

All bookings create events in this calendar automatically.
Each event includes the client's name, phone, treatments, duration, and price.
