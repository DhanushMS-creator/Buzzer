import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { Server as SocketIOServer } from "socket.io";
import {
  closePrompt,
  createOrUpdateTeamSession,
  getBuzzerState,
  clearPlayerLoginHistory,
  getRoundState,
  getRoundLeaderboard,
  getRecentPlayerLogins,
  getTeamByToken,
  getTeamScore,
  openPrompt,
  recordPlayerLogin,
  registerHit,
} from "./db.js";

const app = express();
const PORT = Number(process.env.PORT) || 3002;
const HOST_KEY = process.env.HOST_KEY || "buzzer-host";
const HOST_USERNAME = process.env.HOST_USERNAME || "host";
const HOST_PASSWORD = process.env.HOST_PASSWORD || "admin123";
const hostSessions = new Map();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: true,
    credentials: true,
  },
});

app.use(cors());
app.use(express.json());

const loginSchema = z.object({
  teamNo: z
    .string({ required_error: "Team No is required" })
    .trim()
    .min(1, "Team No is required")
    .max(20, "Team No is too long")
    .regex(/^[A-Za-z0-9,\-\s]+$/, "Team No has invalid characters"),
  teamName: z
    .string({ required_error: "Team Name is required" })
    .trim()
    .min(2, "Team Name must be at least 2 characters")
    .max(60, "Team Name is too long"),
});

const openPromptSchema = z.object({
  roundNo: z.number().int().positive().optional(),
});

const hostLoginSchema = z.object({
  username: z.string({ required_error: "Username is required" }).trim().min(1, "Username is required"),
  password: z.string({ required_error: "Password is required" }).min(1, "Password is required"),
});

const readBearerToken = (req) => {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    return null;
  }

  return authHeader.slice("Bearer ".length).trim();
};

const emitBuzzerUpdate = (reason) => {
  const state = getRoundState();
  const leaderboard = getRoundLeaderboard(state.currentRound);

  io.emit("buzzer:updated", {
    reason,
    ...state,
    leaderboard,
    firstResponder: leaderboard[0] || null,
  });
};

const authRequired = (req, res, next) => {
  const token = readBearerToken(req);
  const team = getTeamByToken(token);

  if (!team) {
    return res.status(401).json({ message: "Unauthorized team session" });
  }

  req.team = team;
  return next();
};

const hostRequired = (req, res, next) => {
  const bearerToken = readBearerToken(req);
  if (bearerToken && hostSessions.has(bearerToken)) {
    req.hostUser = hostSessions.get(bearerToken);
    return next();
  }

  if ((req.headers["x-host-key"] || "") === HOST_KEY) {
    req.hostUser = { username: HOST_USERNAME };
    return next();
  }

  return res.status(401).json({ message: "Unauthorized host session" });
};

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "buzzer-live-engine",
    at: new Date().toISOString(),
  });
});

app.post("/api/auth/login", (req, res) => {
  const result = loginSchema.safeParse(req.body);

  if (!result.success) {
    const firstIssue = result.error.issues[0];
    return res.status(400).json({
      message: firstIssue?.message || "Invalid request",
      issues: result.error.issues,
    });
  }

  const { teamNo, teamName } = result.data;
  const team = createOrUpdateTeamSession(teamNo, teamName);
  recordPlayerLogin(team.id, team.teamNo, team.teamName, team.token);
  const state = getBuzzerState(getTeamByToken(team.token).id);
  const session = {
    teamNo: team.teamNo,
    teamName: team.teamName,
    token: team.token,
    score: team.score,
    loginAt: new Date().toISOString(),
    currentRound: state.currentRound,
  };

  return res.status(200).json({
    message: "Login successful",
    session,
  });
});

app.post("/api/auth/host/login", (req, res) => {
  const parsed = hostLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return res.status(400).json({ message: firstIssue?.message || "Invalid request" });
  }

  const { username, password } = parsed.data;
  if (username !== HOST_USERNAME || password !== HOST_PASSWORD) {
    return res.status(401).json({ message: "Invalid host credentials" });
  }

  const token = `host_${randomUUID().replace(/-/g, "")}`;
  hostSessions.set(token, {
    username,
    loginAt: new Date().toISOString(),
  });

  return res.status(200).json({
    message: "Host login successful",
    session: {
      username,
      token,
      loginAt: hostSessions.get(token).loginAt,
    },
  });
});

app.get("/api/auth/host/me", hostRequired, (req, res) => {
  return res.json({
    username: req.hostUser.username,
  });
});

app.get("/api/auth/me", authRequired, (req, res) => {
  res.json({
    teamNo: req.team.teamNo,
    teamName: req.team.teamName,
    score: req.team.score,
  });
});

app.get("/api/buzzer/state", authRequired, (req, res) => {
  const state = getBuzzerState(req.team.id);
  const leaderboard = getRoundLeaderboard(state.currentRound);

  res.json({
    teamNo: req.team.teamNo,
    teamName: req.team.teamName,
    score: getTeamScore(req.team.id),
    currentRound: state.currentRound,
    totalRounds: state.totalRounds,
    promptOpen: state.promptOpen,
    myPosition: state.myPosition,
    firstResponder: leaderboard[0] || null,
  });
});

app.post("/api/buzzer/hit", authRequired, (req, res) => {
  try {
    const result = registerHit(req.team.id);
    const score = getTeamScore(req.team.id);
    emitBuzzerUpdate("hit");

    return res.json({
      ...result,
      score,
      message: result.first
        ? "First responder locked. +500 awarded."
        : `Response captured at position #${result.position}.`,
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      message: error.message || "Unable to register buzzer hit",
    });
  }
});

app.post("/api/host/prompt/open", hostRequired, (req, res) => {
  const parsed = openPromptSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid round number" });
  }

  const updated = openPrompt(parsed.data.roundNo);
  emitBuzzerUpdate("open");
  return res.json({
    message: `Round ${updated.currentRound} opened for buzzing`,
    ...updated,
    leaderboard: getRoundLeaderboard(updated.currentRound),
  });
});

app.post("/api/host/prompt/close", hostRequired, (_req, res) => {
  const updated = closePrompt();
  emitBuzzerUpdate("close");
  return res.json({
    message: `Round ${updated.currentRound} closed`,
    ...updated,
    leaderboard: getRoundLeaderboard(updated.currentRound),
  });
});

app.get("/api/host/leaderboard", hostRequired, (req, res) => {
  const roundNo = Number(req.query.roundNo || 1);
  return res.json({
    roundNo,
    leaderboard: getRoundLeaderboard(roundNo),
  });
});

app.get("/api/host/state", hostRequired, (_req, res) => {
  const state = getRoundState();
  return res.json({
    ...state,
    leaderboard: getRoundLeaderboard(state.currentRound),
  });
});

app.get("/api/host/player-logins", hostRequired, (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
  return res.json({
    logins: getRecentPlayerLogins(limit),
  });
});

app.delete("/api/host/player-logins", hostRequired, (_req, res) => {
  clearPlayerLoginHistory();
  return res.json({
    message: "Player login history cleared",
  });
});

app.use((req, res) => {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.path}` });
});

io.on("connection", (socket) => {
  socket.emit("buzzer:updated", {
    reason: "sync",
    ...getRoundState(),
    leaderboard: getRoundLeaderboard(getRoundState().currentRound),
    firstResponder: getRoundLeaderboard(getRoundState().currentRound)[0] || null,
  });
});

httpServer.listen(PORT, () => {
  console.log(`Buzzer backend running on http://localhost:${PORT}`);
});
