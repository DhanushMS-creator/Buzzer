import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, "../data");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.DB_PATH || path.join(dataDir, "buzzer.sqlite");
export const db = new Database(dbPath);

// WAL mode improves write behavior for fast inserts from many clients.
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_no TEXT NOT NULL UNIQUE,
    team_name TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    score INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_login_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS player_logins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    team_no TEXT NOT NULL,
    team_name TEXT NOT NULL,
    token TEXT NOT NULL,
    logged_in_at TEXT NOT NULL,
    FOREIGN KEY (team_id) REFERENCES teams(id)
  );

  CREATE TABLE IF NOT EXISTS round_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    current_round INTEGER NOT NULL DEFAULT 1,
    total_rounds INTEGER NOT NULL DEFAULT 12,
    prompt_open INTEGER NOT NULL DEFAULT 0,
    prompt_opened_at TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS buzz_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_no INTEGER NOT NULL,
    team_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    buzzed_at TEXT NOT NULL,
    FOREIGN KEY (team_id) REFERENCES teams(id),
    UNIQUE (round_no, team_id),
    UNIQUE (round_no, position)
  );
`);

const roundStateColumns = db.prepare("PRAGMA table_info(round_state)").all();
const hasPromptOpenedAt = roundStateColumns.some((column) => column.name === "prompt_opened_at");
if (!hasPromptOpenedAt) {
  db.prepare("ALTER TABLE round_state ADD COLUMN prompt_opened_at TEXT").run();
}

const nowIso = () => new Date().toISOString();

const hasState = db.prepare("SELECT id FROM round_state WHERE id = 1").get();
if (!hasState) {
  db.prepare(
    "INSERT INTO round_state (id, current_round, total_rounds, prompt_open, prompt_opened_at, updated_at) VALUES (1, 1, 12, 0, NULL, ?)"
  ).run(nowIso());
}

export const createOrUpdateTeamSession = (teamNo, teamName) => {
  const token = `buzzer_${randomUUID().replace(/-/g, "")}`;
  const existing = db.prepare("SELECT id FROM teams WHERE team_no = ?").get(teamNo);

  if (existing) {
    db.prepare(
      "UPDATE teams SET team_name = ?, token = ?, last_login_at = ? WHERE id = ?"
    ).run(teamName, token, nowIso(), existing.id);

    return db
      .prepare("SELECT id, team_no AS teamNo, team_name AS teamName, token, score FROM teams WHERE id = ?")
      .get(existing.id);
  }

  const result = db
    .prepare(
      "INSERT INTO teams (team_no, team_name, token, score, created_at, last_login_at) VALUES (?, ?, ?, 0, ?, ?)"
    )
    .run(teamNo, teamName, token, nowIso(), nowIso());

  return db
    .prepare("SELECT id, team_no AS teamNo, team_name AS teamName, token, score FROM teams WHERE id = ?")
    .get(result.lastInsertRowid);
};

export const recordPlayerLogin = (teamId, teamNo, teamName, token) => {
  const loggedInAt = nowIso();

  return db.prepare(
    "INSERT INTO player_logins (team_id, team_no, team_name, token, logged_in_at) VALUES (?, ?, ?, ?, ?)"
  ).run(teamId, teamNo, teamName, token, loggedInAt);
};

export const getRecentPlayerLogins = (limit = 20) => {
  return db
    .prepare(
      `
        SELECT
          pl.team_no AS teamNo,
          pl.team_name AS teamName,
          pl.token,
          pl.logged_in_at AS loggedInAt
        FROM player_logins pl
        ORDER BY pl.logged_in_at DESC, pl.id DESC
        LIMIT ?
      `
    )
    .all(limit);
};

export const clearPlayerLoginHistory = () => {
  return db.prepare("DELETE FROM player_logins").run();
};

export const getTeamByToken = (token) => {
  if (!token) {
    return null;
  }

  return db
    .prepare("SELECT id, team_no AS teamNo, team_name AS teamName, token, score FROM teams WHERE token = ?")
    .get(token);
};

export const getBuzzerState = (teamId) => {
  const state = db
    .prepare("SELECT current_round AS currentRound, total_rounds AS totalRounds, prompt_open AS promptOpen FROM round_state WHERE id = 1")
    .get();

  const myPosition = db
    .prepare("SELECT position FROM buzz_events WHERE round_no = ? AND team_id = ?")
    .get(state.currentRound, teamId);

  return {
    currentRound: state.currentRound,
    totalRounds: state.totalRounds,
    promptOpen: Boolean(state.promptOpen),
    myPosition: myPosition?.position || null,
  };
};

export const getRoundState = () => {
  const state = db
    .prepare(
      "SELECT current_round AS currentRound, total_rounds AS totalRounds, prompt_open AS promptOpen, prompt_opened_at AS promptOpenedAt FROM round_state WHERE id = 1"
    )
    .get();

  return {
    currentRound: state.currentRound,
    totalRounds: state.totalRounds,
    promptOpen: Boolean(state.promptOpen),
    promptOpenedAt: state.promptOpenedAt || null,
  };
};

const hitTxn = db.transaction((teamId) => {
  const state = db
    .prepare("SELECT current_round AS currentRound, prompt_open AS promptOpen FROM round_state WHERE id = 1")
    .get();

  if (!state.promptOpen) {
    const error = new Error("Prompt is closed. Wait for host to open the round.");
    error.status = 409;
    throw error;
  }

  const existingHit = db
    .prepare("SELECT position FROM buzz_events WHERE round_no = ? AND team_id = ?")
    .get(state.currentRound, teamId);

  if (existingHit) {
    return {
      roundNo: state.currentRound,
      position: existingHit.position,
      first: existingHit.position === 1,
      duplicate: true,
    };
  }

  const count = db
    .prepare("SELECT COUNT(*) AS total FROM buzz_events WHERE round_no = ?")
    .get(state.currentRound).total;

  const position = Number(count) + 1;

  db.prepare(
    "INSERT INTO buzz_events (round_no, team_id, position, buzzed_at) VALUES (?, ?, ?, ?)"
  ).run(state.currentRound, teamId, position, nowIso());

  if (position === 1) {
    db.prepare("UPDATE teams SET score = score + 500 WHERE id = ?").run(teamId);
  }

  return {
    roundNo: state.currentRound,
    position,
    first: position === 1,
    duplicate: false,
  };
});

export const registerHit = (teamId) => hitTxn(teamId);

export const getTeamScore = (teamId) => {
  return db.prepare("SELECT score FROM teams WHERE id = ?").get(teamId)?.score || 0;
};

export const openPrompt = (roundNo) => {
  const current = db.prepare("SELECT total_rounds AS totalRounds FROM round_state WHERE id = 1").get();
  const selectedRound = Math.min(Math.max(Number(roundNo || 1), 1), current.totalRounds);
  const openedAt = nowIso();

  // Every time a round is started by host, begin with a clean slate for that round.
  db.prepare("DELETE FROM buzz_events WHERE round_no = ?").run(selectedRound);

  db.prepare("UPDATE round_state SET current_round = ?, prompt_open = 1, prompt_opened_at = ?, updated_at = ? WHERE id = 1").run(
    selectedRound,
    openedAt,
    openedAt
  );

  return db
    .prepare(
      "SELECT current_round AS currentRound, total_rounds AS totalRounds, prompt_open AS promptOpen, prompt_opened_at AS promptOpenedAt FROM round_state WHERE id = 1"
    )
    .get();
};

export const closePrompt = () => {
  db.prepare("UPDATE round_state SET prompt_open = 0, updated_at = ? WHERE id = 1").run(nowIso());

  return db
    .prepare(
      "SELECT current_round AS currentRound, total_rounds AS totalRounds, prompt_open AS promptOpen, prompt_opened_at AS promptOpenedAt FROM round_state WHERE id = 1"
    )
    .get();
};

export const getRoundLeaderboard = (roundNo) => {
  return db
    .prepare(
      `
        SELECT
          be.position,
          t.team_no AS teamNo,
          t.team_name AS teamName,
          be.buzzed_at AS buzzedAt
        FROM buzz_events be
        JOIN teams t ON t.id = be.team_id
        WHERE be.round_no = ?
        ORDER BY be.position ASC
      `
    )
    .all(roundNo);
};
