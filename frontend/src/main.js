import "./style.css";

const form = document.getElementById("loginForm");
const submitBtn = document.getElementById("submitBtn");
const toast = document.getElementById("statusToast");

const showToast = (message, kind = "info") => {
  toast.textContent = message;
  toast.className = `toast show ${kind}`;
  window.clearTimeout(showToast._timer);
  showToast._timer = window.setTimeout(() => {
    toast.className = "toast";
  }, 3000);
};

const setSubmitting = (loading) => {
  submitBtn.disabled = loading;
  submitBtn.querySelector(".btn-text").textContent = loading ? "Checking..." : "Ready";
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const payload = {
    teamNo: String(formData.get("teamNo") || "").trim(),
    teamName: String(formData.get("teamName") || "").trim(),
  };

  if (!payload.teamNo || !payload.teamName) {
    showToast("Please enter both Team No and Team Name.", "error");
    return;
  }

  try {
    setSubmitting(true);

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.message || "Login failed. Try again.");
    }

    localStorage.setItem("buzzer.session", JSON.stringify(data.session));
    showToast(`Welcome ${data.session.teamName}. You are live.`, "success");
    window.setTimeout(() => {
      window.location.href = "/arena.html";
    }, 500);
  } catch (error) {
    showToast(error.message || "Something went wrong.", "error");
  } finally {
    setSubmitting(false);
  }
});
