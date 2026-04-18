import "./arena.css";
import { io } from "socket.io-client";

const sessionRaw = localStorage.getItem("buzzer.session");
if (!sessionRaw) {
  window.location.href = "/";
}

const session = sessionRaw ? JSON.parse(sessionRaw) : null;
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || window.location.origin;
const socket = io(SOCKET_URL, {
  transports: ["websocket", "polling"],
});

const teamNameLabel = document.getElementById("teamNameLabel");
const avatarBadge = document.getElementById("avatarBadge");
const statusText = document.getElementById("statusText");
const hitBtn = document.getElementById("hitBtn");
const arenaToast = document.getElementById("arenaToast");

const initials = (name) =>
  String(name || "VG")
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

teamNameLabel.textContent = session?.teamName || "Vigyaanrang";
avatarBadge.textContent = initials(session?.teamName);

const showToast = (message, kind = "good") => {
  arenaToast.textContent = message;
  arenaToast.className = `toast show ${kind}`;
  window.clearTimeout(showToast._timer);
  showToast._timer = window.setTimeout(() => {
    arenaToast.className = "toast";
  }, 2400);
};

const authFetch = async (url, options = {}) => {
  const headers = {
    ...(options.headers || {}),
    Authorization: `Bearer ${session.token}`,
  };

  const response = await fetch(url, { ...options, headers });
  const data = await response.json();

  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem("buzzer.session");
      window.location.href = "/";
      throw new Error("Session expired. Please login again.");
    }

    throw new Error(data?.message || "Request failed");
  }

  return data;
};

const applyState = (data) => {
  teamNameLabel.textContent = data.teamName;
  avatarBadge.textContent = initials(data.teamName);

  if (data.promptOpen) {
    hitBtn.classList.add("armed");
    hitBtn.classList.remove("pressed");
    if (data.myPosition) {
      statusText.innerHTML = "Your response is locked in this round.";
      hitBtn.classList.remove("armed");
    } else {
      statusText.innerHTML = "Host has opened the prompt.";
    }
  } else {
    hitBtn.classList.remove("armed", "pressed");
    statusText.innerHTML = "Wait for the host prompt. Fastest finger earns..";
  }
};

const refreshState = async () => {
  try {
    const data = await authFetch("/api/buzzer/state");
    applyState(data);
  } catch (error) {
    showToast(error.message, "bad");
  }
};

socket.on("buzzer:updated", () => {
  refreshState();
});

socket.on("connect_error", () => {
  showToast("Live sync unavailable. Retrying in the background.", "bad");
});

hitBtn.addEventListener("click", async () => {
  try {
    hitBtn.classList.add("pressed");
    const data = await authFetch("/api/buzzer/hit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    if (data.first) {
      statusText.innerHTML = "You were first to hit in this round.";
      showToast("Lightning fast. You are #1 this round.", "good");
    } else {
      statusText.innerHTML = "Hit received. Your response is locked in this round.";
      showToast("Response registered.", "good");
    }
  } catch (error) {
    showToast(error.message, "bad");
  } finally {
    hitBtn.classList.remove("pressed");
    refreshState();
  }
});

refreshState();
setInterval(refreshState, 15000);

window.addEventListener("beforeunload", () => {
  socket.disconnect();
});
