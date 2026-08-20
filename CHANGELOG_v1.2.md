# Syntax City v1.2 — Changelog

## Gameplay

- **Upkeep.** Every placed building now costs ~1% of its original money cost
  per completed shift to maintain. If your treasury can't cover it, the
  shortfall becomes debt that carries forward (shown in the shift summary
  and the dashboard stats) and dents happiness until it's paid off. Upkeep
  is charged whether a shift ends naturally or is ended early.

- **Pollution.** Industrial buildings now reduce nearby housing's population.
  Each industrial building within 3 tiles contributes a penalty that fades
  with distance; penalties from multiple nearby industrial buildings stack,
  capped at a 45% reduction overall so housing is never wiped out entirely.
  Plan industrial zones with some buffer from housing, or accept the
  population trade-off for the output.

- **Road network (Town Hall-gated).** Before you've built a Town Hall, any
  adjacent road tile still grants the usual road bonus (same as before).
  Once a Town Hall exists, road bonuses require an actual connected path of
  road tiles leading back to the Town Hall (a real breadth-first search over
  the road graph, not just "is there a road tile next to me somewhere") —
  so road planning starts to matter once your city has a civic center.

- **Happiness meter (0–100).** A new score shown as a topbar pill (😊/😐/😟),
  computed from three factors: amenity coverage (% of housing reached by at
  least one amenity), pollution (inverse of the average industrial penalty
  on housing), and road access (inverse of the % of buildings without a
  valid road connection). Unpaid upkeep debt dents it further. Happiness
  feeds a live ±15% multiplier into every shift's rewards — a well-run city
  quite literally pays better.

- **Visual era progression.** The grid now gets a CSS filter
  (saturation/brightness/contrast) that intensifies as your city advances
  through eras, with a subtle glow once you reach the top era (Modern Age).
  The topbar's accent color shifts per era too, so growth is visible at a
  glance, not just in the stats.

- **Demolish refund.** Demolishing a building now refunds 50% of its
  original resource cost (money, wood, stone, and gold as applicable),
  instead of nothing — city replanning is no longer a pure loss.

## Social layer

- **Visit a City.** A new read-only viewer (dashboard → "🔭 Visit a City")
  lets you look up any mayor by name and see their city laid out on a
  non-interactive grid, along with era/population/money/happiness. No
  editing, no risk of accidentally changing someone else's save.

- **Weekly Community Goal.** A shared, class-wide Firestore counter that
  every mayor's correct answers contribute to automatically at the end of
  each shift. When the class collectively crosses the weekly target (300
  correct answers by default, configurable in `functions/index.js`), every
  mayor who checks back in gets a one-time resource bonus, claimed once per
  student per week. The goal resets automatically every week (ISO week
  number), computed identically on the client and server.

## Hosting migration: Cloudflare → Firebase

The backend has moved from a Cloudflare Worker + KV to **Firebase Hosting +
Cloud Functions + Firestore**. See `README_FIREBASE.md` for full setup and
deployment instructions. In short:

- `worker.js`, `wrangler.toml`, and the old `functions/api/*.js` (Cloudflare
  Pages Functions) are replaced by a single `functions/index.js` Express app
  deployed as one Cloud Function, exposing the *same* route paths
  (`/api/register`, `/api/login`, `/api/save`, `/leaderboard`, etc.) plus two
  new ones (`/api/visit`, `/api/community-goal[/contribute]`).
- Firestore replaces Workers KV for storage (`accounts`, `leaderboard`,
  `communityGoals` collections).
- `firebase.json` rewrites route `/api/**` and `/leaderboard*` requests from
  Hosting straight to the Cloud Function, so the client's `API_BASE` is now
  just `''` (same-origin) instead of a `workers.dev` URL — no CORS
  configuration needed when hosted normally.
- `firestore.rules` denies all direct client access; every read/write goes
  through the Cloud Function (Admin SDK), mirroring how the client never
  talked to Workers KV directly before either.
- The admin/teacher passcode (`simcity`) and the overall account model
  (plaintext username/password pairs, no separate auth provider) are
  unchanged, to keep classroom setup just as simple as before.

## Compatibility

- `ensureGameShape()` was extended to backfill `happiness`,
  `stats.upkeepDebt`, and `stats.communityBonusClaimed` on any older save
  that doesn't have them yet — tested against a simulated pre-v1.2 save with
  no crashes or data loss.
