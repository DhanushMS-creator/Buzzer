import "./host-login.css";

const existingHostSession = localStorage.getItem("buzzer.hostSession");
if (existingHostSession) {
  window.location.href = "/host.html";
}

const form = document.getElementById("hostLoginForm");
const submitBtn = document.getElementById("hostSubmitBtn");
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
  submitBtn.querySelector(".btn-text").textContent = loading
    ? "Authenticating..."
    : "Enter Control Room";
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const payload = {
    username: String(formData.get("hostUsername") || "").trim(),
    password: String(formData.get("hostPassword") || ""),
  };

  if (!payload.username || !payload.password) {
    showToast("Please enter host username and password.", "error");
    return;
  }

  try {
    setSubmitting(true);

    const response = await fetch("/api/auth/host/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.message || "Host login failed. Try again.");
    }

    localStorage.setItem("buzzer.hostSession", JSON.stringify(data.session));
    localStorage.setItem("buzzer.hostRoundNo", "1");
    showToast(`Welcome ${data.session.username}. Control room is ready.`, "success");
    window.setTimeout(() => {
      window.location.href = "/host.html";
    }, 500);
  } catch (error) {
    showToast(error.message || "Something went wrong.", "error");
  } finally {
    setSubmitting(false);
  }
});
