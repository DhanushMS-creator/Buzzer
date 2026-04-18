import "./host.css";
import { io } from "socket.io-client";

const hostSessionRaw = localStorage.getItem("buzzer.hostSession");
if (!hostSessionRaw) {
  window.location.href = "/host-login.html";
}

const hostSession = hostSessionRaw ? JSON.parse(hostSessionRaw) : null;
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || window.location.origin;
const socket = io(SOCKET_URL, {
  transports: ["websocket", "polling"],
});
const ROUND_STORAGE_KEY = "buzzer.hostRoundNo";
let currentRoundNo = Math.max(Number(localStorage.getItem(ROUND_STORAGE_KEY) || 1), 1);

const hostUserLabel = document.getElementById("hostUserLabel");
const roundNoLabel = document.getElementById("roundNoLabel");
const openBtn = document.getElementById("openBtn");
const nextBtn = document.getElementById("nextBtn");
const clearLoginsBtn = document.getElementById("clearLoginsBtn");
const logoutBtn = document.getElementById("logoutBtn");
const winnerLabel = document.getElementById("winnerLabel");
const leaderboardList = document.getElementById("leaderboardList");
const playerLoginList = document.getElementById("playerLoginList");
const hostToast = document.getElementById("hostToast");

hostUserLabel.textContent = hostSession?.username || "host";

const persistRoundNo = () => {
  localStorage.setItem(ROUND_STORAGE_KEY, String(currentRoundNo));
};

const renderRoundNo = () => {
  roundNoLabel.textContent = String(currentRoundNo);
};

const showToast = (message, tone = "") => {
  hostToast.textContent = message;
  hostToast.className = `toast show ${tone}`.trim();
  window.clearTimeout(showToast._timer);
  showToast._timer = window.setTimeout(() => {
    hostToast.className = "toast";
  }, 2200);
};

const hostFetch = async (url, options = {}) => {
  const headers = {
    ...(options.headers || {}),
    Authorization: `Bearer ${hostSession.token}`,
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem("buzzer.hostSession");
      window.location.href = "/host-login.html";
      throw new Error("Host session expired. Please login again.");
    }

    throw new Error(data?.message || "Request failed");
  }

  return data;
};

const formatElapsed = (startIso, endIso) => {
  if (!startIso || !endIso) {
    return "-";
  }

  const elapsedMs = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return "-";
  }

  const seconds = Math.floor(elapsedMs / 1000);
  const millis = String(elapsedMs % 1000).padStart(3, "0");
  return `${seconds}.${millis}s`;
};

const renderLeaderboard = (leaderboard, promptOpenedAt) => {
  leaderboardList.innerHTML = "";

  if (!leaderboard.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No team has buzzed in this round yet.";
    leaderboardList.appendChild(li);
    return;
  }

  leaderboard.forEach((row) => {
    const li = document.createElement("li");
    const elapsed = formatElapsed(promptOpenedAt, row.buzzedAt);
    li.innerHTML = `<span>#${row.position} - ${row.teamName} (Team ${row.teamNo})</span><span>${elapsed}</span>`;
    leaderboardList.appendChild(li);
  });
};

const renderPlayerLogins = (logins) => {
  playerLoginList.innerHTML = "";

  if (!logins.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No player logins have been recorded yet.";
    playerLoginList.appendChild(li);
    return;
  }

  logins.forEach((row) => {
    const li = document.createElement("li");
    const exactTime = new Date(row.loggedInAt).toISOString().slice(11, 23);
    li.innerHTML = `<span>${row.teamName} (Team ${row.teamNo})</span><span>${exactTime}</span>`;
    playerLoginList.appendChild(li);
  });
};

const applyState = (state) => {
  renderRoundNo();

  // If host has advanced to a new local round but has not started it yet,
  // keep the board empty to avoid showing previous round data.
  if (!state.promptOpen && state.currentRound !== currentRoundNo) {
    winnerLabel.textContent = "No team has pressed the buzzer yet.";
    renderLeaderboard([], null);
    return;
  }

  const winner = state.firstResponder || state.leaderboard[0];
  winnerLabel.textContent = winner
    ? `FIRST BUZZER: ${winner.teamName} (Team ${winner.teamNo}) in ${formatElapsed(state.promptOpenedAt, winner.buzzedAt)}`
    : "No team has pressed the buzzer yet.";

  renderLeaderboard(state.leaderboard, state.promptOpenedAt);
};

const refreshState = async () => {
  try {
    const [state, loginData] = await Promise.all([
      hostFetch("/api/host/state"),
      hostFetch("/api/host/player-logins?limit=25"),
    ]);
    applyState(state);
    renderPlayerLogins(loginData.logins || []);
  } catch (error) {
    showToast(error.message, "warn");
  }
};

socket.on("buzzer:updated", () => {
  refreshState();
});

socket.on("connect_error", () => {
  showToast("Live sync unavailable. Retrying in the background.", "warn");
});

const setBusy = (busy) => {
  openBtn.disabled = busy;
  nextBtn.disabled = busy;
  clearLoginsBtn.disabled = busy;
};

openBtn.addEventListener("click", async () => {
  const roundNo = currentRoundNo;
  try {
    setBusy(true);
    const response = await hostFetch("/api/host/prompt/open", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ roundNo }),
    });
    showToast(response.message || "Prompt opened.");
    await refreshState();
  } catch (error) {
    showToast(error.message, "warn");
  } finally {
    setBusy(false);
  }
});

nextBtn.addEventListener("click", async () => {
  try {
    setBusy(true);
    await hostFetch("/api/host/prompt/close", {
      method: "POST",
    });
    currentRoundNo += 1;
    persistRoundNo();
    renderRoundNo();
    showToast(`Moved to round ${currentRoundNo}. Click Start Round when ready.`);
    winnerLabel.textContent = "No team has pressed the buzzer yet.";
    renderLeaderboard([], null);
  } catch (error) {
    showToast(error.message, "warn");
  } finally {
    setBusy(false);
  }
});

clearLoginsBtn.addEventListener("click", async () => {
  try {
    setBusy(true);
    const response = await hostFetch("/api/host/player-logins", {
      method: "DELETE",
    });
    showToast(response.message || "Player login history cleared.");
    renderPlayerLogins([]);
  } catch (error) {
    showToast(error.message, "warn");
  } finally {
    setBusy(false);
  }
});

logoutBtn.addEventListener("click", () => {
  localStorage.removeItem("buzzer.hostSession");
  localStorage.removeItem(ROUND_STORAGE_KEY);
  window.location.href = "/host-login.html";
});

renderRoundNo();
refreshState();
setInterval(refreshState, 15000);

window.addEventListener("beforeunload", () => {
  socket.disconnect();
});
