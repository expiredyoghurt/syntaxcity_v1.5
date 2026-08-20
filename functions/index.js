/**
 * Syntax City — Backend (Firebase Cloud Functions + Firestore)
 * --------------------------------------------------------------
 * This replaces the old Cloudflare Worker (worker.js) with an equivalent
 * Express app deployed as a single Cloud Function, fronted by Firebase
 * Hosting rewrites so the client's existing relative fetch('/api/...') calls
 * keep working unchanged (see firebase.json).
 *
 * Firestore layout:
 *   accounts/{lowercaseUsername}      { username, password, game }
 *   leaderboard/main                  { entries: [ {name, population, era,
 *                                        money, buildings, correct,
 *                                        attempted, ts}, ... ] }
 *   communityGoals/{weekKey}          { weekKey, target, progress, granted }
 *
 * Routes (identical paths/methods to the old Worker, so the client did not
 * need to change its endpoint paths — only API_BASE):
 *   POST /api/register                { username, password }
 *   POST /api/login                   { username, password }
 *   POST /api/save                    { username, password, game }
 *   GET  /api/visit?name=x            (public, read-only, no password)
 *   GET  /api/admin/player?name=x     (header X-Admin-Passcode: simcity)
 *   POST /api/admin/player            { name, game } (header X-Admin-Passcode)
 *   GET  /leaderboard
 *   POST /leaderboard                 { name, population, era, money,
 *                                        buildings, correct, attempted }
 *   POST /leaderboard/reset           (header X-Admin-Passcode: simcity)
 *   GET  /api/community-goal
 *   POST /api/community-goal/contribute  { username, correct }
 *
 * Security model: this mirrors the original Worker's simple shared-passcode
 * approach (plaintext password match, no Firebase Auth) to keep classroom
 * setup effortless. All reads/writes go through this Admin-SDK-backed
 * function, so Firestore security rules simply deny all direct client
 * access (see firestore.rules) — the client never talks to Firestore itself.
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');

admin.initializeApp();
const db = admin.firestore();

const ADMIN_PASSCODE = 'simcity';
const MAX_LEADERBOARD_ENTRIES = 200;
const GRID_SIZE = 20;
const COMMUNITY_GOAL_TARGET = 300; // correct answers/week, class-wide

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

function defaultGameState() {
  return {
    money: 500, wood: 200, stone: 100, gold: 0,
    population: 0, maxPopulation: 50, era: 1, happiness: 100,
    publicUtilitiesBuilt: false,
    industrialBonuses: { wood: 0, stone: 0, gold: 0, all: 0 },
    gridSize: GRID_SIZE,
    layout: Array(GRID_SIZE * GRID_SIZE).fill(null),
    stats: {
      shiftsCompleted: 0, correct: 0, wrong: 0, byCategory: {},
      streakCurrent: 0, streakBest: 0, mistakeLog: [], achievements: [],
      hadPerfectShift: false, hadEndlessLegend: false,
      upkeepDebt: 0, communityBonusClaimed: '',
    },
  };
}

function accountDocId(username) {
  return String(username || '').trim().toLowerCase();
}

async function readAccount(username) {
  const doc = await db.collection('accounts').doc(accountDocId(username)).get();
  return doc.exists ? doc.data() : null;
}
async function writeAccount(account) {
  await db.collection('accounts').doc(accountDocId(account.username)).set(account);
}

async function readLeaderboard() {
  const doc = await db.collection('leaderboard').doc('main').get();
  if (!doc.exists) return [];
  const data = doc.data();
  return Array.isArray(data.entries) ? data.entries : [];
}
async function writeLeaderboard(entries) {
  await db.collection('leaderboard').doc('main').set({ entries });
}

function checkAdminPasscode(req) {
  return req.get('X-Admin-Passcode') === ADMIN_PASSCODE;
}

// ISO-week key, e.g. "2026-W34" — matches the client's currentWeekKey() so
// both sides agree on when the weekly goal rolls over.
function currentWeekKey() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const week1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const weekNo = 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// ---------------- Accounts ----------------
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'A username and password are required.' });
  const existing = await readAccount(username);
  if (existing) return res.status(409).json({ error: 'That mayor name is already taken.' });

  const account = { username, password, game: defaultGameState() };
  await writeAccount(account);
  return res.json({ game: account.game });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'A username and password are required.' });
  const account = await readAccount(username);
  if (!account || account.password !== password) return res.status(401).json({ error: 'Mayor name and City Key do not match.' });
  return res.json({ game: account.game });
});

app.post('/api/save', async (req, res) => {
  const { username, password, game } = req.body || {};
  if (!username || !password || !game) return res.status(400).json({ error: 'Missing username, password, or game data.' });
  const account = await readAccount(username);
  if (!account || account.password !== password) return res.status(401).json({ error: 'Mayor name and City Key do not match.' });
  account.game = game;
  await writeAccount(account);
  return res.json({ ok: true });
});

// ---------------- Visit a City (public, read-only) ----------------
app.get('/api/visit', async (req, res) => {
  const name = req.query.name;
  if (!name) return res.status(400).json({ error: 'A mayor name is required.' });
  const account = await readAccount(name);
  if (!account) return res.status(404).json({ error: 'No account found for that mayor.' });
  // Never return the password field, even though nothing here currently exposes it directly.
  return res.json({ username: account.username, game: account.game });
});

// ---------------- Admin (teacher tools) ----------------
app.get('/api/admin/player', async (req, res) => {
  if (!checkAdminPasscode(req)) return res.status(403).json({ error: 'Incorrect admin passcode.' });
  const name = req.query.name;
  if (!name) return res.status(400).json({ error: 'A mayor name is required.' });
  const account = await readAccount(name);
  if (!account) return res.status(404).json({ error: 'No account found for that mayor.' });
  return res.json({ username: account.username, game: account.game });
});

app.post('/api/admin/player', async (req, res) => {
  if (!checkAdminPasscode(req)) return res.status(403).json({ error: 'Incorrect admin passcode.' });
  const { name, game } = req.body || {};
  if (!name || !game) return res.status(400).json({ error: 'A mayor name and game data are required.' });
  const account = await readAccount(name);
  if (!account) return res.status(404).json({ error: 'No account found for that mayor.' });
  account.game = game;
  await writeAccount(account);
  return res.json({ ok: true });
});

// ---------------- Leaderboard ----------------
app.get('/leaderboard', async (req, res) => {
  const entries = await readLeaderboard();
  entries.sort((a, b) => (b.population || 0) - (a.population || 0));
  return res.json(entries.slice(0, MAX_LEADERBOARD_ENTRIES));
});

app.post('/leaderboard', async (req, res) => {
  const body = req.body || {};
  if (!body.name) return res.status(400).json({ error: 'A mayor name is required.' });
  const entry = {
    name: String(body.name).trim().slice(0, 40),
    population: Math.max(0, Math.min(100000, Number(body.population) || 0)),
    era: Math.max(1, Math.min(10, Number(body.era) || 1)),
    money: Math.max(0, Math.min(10000000, Number(body.money) || 0)),
    buildings: Math.max(0, Math.min(1000, Number(body.buildings) || 0)),
    correct: Math.max(0, Math.min(1000000, Number(body.correct) || 0)),
    attempted: Math.max(0, Math.min(1000000, Number(body.attempted) || 0)),
    ts: Date.now(),
  };
  let entries = await readLeaderboard();
  entries = entries.filter((e) => e.name.toLowerCase() !== entry.name.toLowerCase());
  entries.push(entry);
  entries.sort((a, b) => b.population - a.population);
  entries = entries.slice(0, MAX_LEADERBOARD_ENTRIES);
  await writeLeaderboard(entries);
  return res.json(entries);
});

app.post('/leaderboard/reset', async (req, res) => {
  if (!checkAdminPasscode(req)) return res.status(403).json({ error: 'Incorrect admin passcode.' });
  await writeLeaderboard([]);
  return res.json({ ok: true, message: 'Leaderboard cleared.' });
});

// ---------------- Weekly Community Goal ----------------
// Uses a Firestore transaction so simultaneous contributions from many
// students never lose an update, and rolls over automatically into a fresh
// document whenever currentWeekKey() changes.
async function getOrCreateGoalDoc(weekKey) {
  const ref = db.collection('communityGoals').doc(weekKey);
  const doc = await ref.get();
  if (doc.exists) return { ref, data: doc.data() };
  const fresh = { weekKey, target: COMMUNITY_GOAL_TARGET, progress: 0, granted: false };
  await ref.set(fresh);
  return { ref, data: fresh };
}

app.get('/api/community-goal', async (req, res) => {
  const weekKey = currentWeekKey();
  const { data } = await getOrCreateGoalDoc(weekKey);
  return res.json(data);
});

app.post('/api/community-goal/contribute', async (req, res) => {
  const { username, correct } = req.body || {};
  const amount = Math.max(0, Math.min(200, Number(correct) || 0)); // sanity cap per request
  const weekKey = currentWeekKey();
  const ref = db.collection('communityGoals').doc(weekKey);

  const result = await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    let data = doc.exists ? doc.data() : { weekKey, target: COMMUNITY_GOAL_TARGET, progress: 0, granted: false };
    data.progress = (data.progress || 0) + amount;
    if (data.progress >= data.target) data.granted = true;
    tx.set(ref, data);
    return data;
  });

  return res.json(result);
});

exports.api = functions.https.onRequest(app);
