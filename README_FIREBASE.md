# Syntax City — Firebase Deployment Guide

This build replaces the old Cloudflare (Workers + Pages Functions) backend
with **Firebase Hosting + Cloud Functions + Firestore**. The gameplay client
is unchanged in terms of hosting requirements — it's still a single
`public/index.html` file — but it now talks to Cloud Functions instead of a
Cloudflare Worker.

## What's in this folder

```
.firebaserc              — Firebase project alias (edit this first, see below)
firebase.json             — Hosting + Functions + Firestore config
firestore.rules           — Locks Firestore to server-only access
firestore.indexes.json    — Empty (no composite indexes needed)
functions/
  index.js                 — Cloud Function (Express app) — all backend routes
  package.json              — Function dependencies
public/
  index.html                — The game itself (deploy target for Hosting)
```

The old `worker.js`, `wrangler.toml`, and `functions/api/*.js` (Cloudflare
Pages Functions) are no longer used and are not included in this package —
everything they did now lives in `functions/index.js`.

## One-time setup

1. **Create a Firebase project** at https://console.firebase.google.com if
   you don't have one already.
2. **Enable Firestore** in the project (Build → Firestore Database → Create
   database; any region is fine, "production mode" is fine since
   `firestore.rules` locks it down anyway).
3. **Install the Firebase CLI** if you don't have it:
   ```
   npm install -g firebase-tools
   firebase login
   ```
4. **Set your project ID** — open `.firebaserc` and replace
   `REPLACE_WITH_YOUR_FIREBASE_PROJECT_ID` with your actual Firebase project
   ID (found in the Firebase console, top-left, or run `firebase projects:list`).
5. **Install function dependencies**:
   ```
   cd functions
   npm install
   cd ..
   ```

## Deploying

From this folder:

```
firebase deploy
```

This deploys Hosting (`public/index.html`), the Cloud Function (`functions/`),
and the Firestore rules together. Firebase will print your live URL, e.g.
`https://your-project-id.web.app` — that's the link to share with students.

To deploy just one piece later (e.g. after editing only the client):
```
firebase deploy --only hosting
firebase deploy --only functions
firebase deploy --only firestore:rules
```

## Local testing before you deploy

```
firebase emulators:start --only functions,firestore,hosting
```
This serves the game at `http://localhost:5000` with a local Firestore
emulator, so you can test registration, saving, the leaderboard, Visit a
City, and the Community Goal without touching production data.

## How the client finds the backend

`index.html` sets `API_BASE = ''` — meaning every API call
(`fetch(API_BASE + '/api/register')`, etc.) is a same-origin relative path.
`firebase.json`'s `rewrites` section routes any request under `/api/**`,
`/leaderboard`, and `/leaderboard/**` to the Cloud Function automatically.
As long as you deploy Hosting and Functions to the same Firebase project,
this works with zero configuration — you never need to paste a Functions URL
into the client.

(If you ever want to point the client at a Cloud Functions URL directly —
for example, testing the backend before Hosting is set up — change
`API_BASE` near the top of the `<script>` block to that full URL instead.)

## Admin / teacher passcode

The admin passcode is `simcity` (log in with that as both the mayor name and
City Key to open the teacher tools, same as before). It's hardcoded in
`functions/index.js` as `ADMIN_PASSCODE` — change it there before deploying
if you want a different passcode, and redeploy functions.

## Weekly Community Goal

The target is 300 class-wide correct answers per week, configurable via
`COMMUNITY_GOAL_TARGET` in `functions/index.js`. The week key is an ISO
week number (e.g. `2026-W34`), computed identically on the client and
server, so the goal automatically resets every Monday with no manual
intervention needed.

## Data model (Firestore)

- `accounts/{lowercaseUsername}` — one document per mayor: `{ username,
  password, game }`. Plaintext password matching, mirroring the original
  Worker's simple classroom-friendly approach (no separate auth system to
  manage). Firestore rules deny all direct client access — only the Cloud
  Function (via the Admin SDK, which bypasses rules) can read or write these.
- `leaderboard/main` — single document holding the leaderboard array.
- `communityGoals/{weekKey}` — one document per week: `{ weekKey, target,
  progress, granted }`, updated via a Firestore transaction so many students
  submitting answers at once can't lose an update.
