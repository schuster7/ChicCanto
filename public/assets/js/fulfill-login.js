(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  // Try common patterns without relying on exact IDs
  const form =
    $("form") ||
    $(".fulfill-login form") ||
    $("#loginForm") ||
    $("#fulfillLoginForm");

  const passwordInput =
    $("#password") ||
    $("input[type='password']") ||
    $("input[name='password']") ||
    $("input[data-password]");

  const submitBtn =
    $("button[type='submit']") || $("button[data-action='login']");

  // Where to show errors (optional element)
  const errorEl =
    $("#error") ||
    $(".error") ||
    $(".form-error") ||
    document.createElement("div");

  if (!errorEl.isConnected) {
    errorEl.className = "form-error";
    errorEl.style.marginTop = "12px";
    errorEl.style.whiteSpace = "pre-line";
    (form || document.body).appendChild(errorEl);
  }

  function setError(msg) {
    errorEl.textContent = msg || "";
  }

  function setBusy(isBusy) {
    if (submitBtn) submitBtn.disabled = !!isBusy;
    if (passwordInput) passwordInput.disabled = !!isBusy;
  }

  async function login(password) {
    const res = await fetch("/auth", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({ password }),
    });

    // Try to parse JSON, but don’t depend on it
    let data = null;
    try {
      data = await res.json();
    } catch (_) {}

    if (!res.ok) {
      const msg =
        (data && (data.error || data.message)) ||
        (res.status === 401 ? "Wrong password." : "Login failed.");
      throw new Error(msg);
    }

    return data || {};
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError("");

    const password = (passwordInput && passwordInput.value) ? passwordInput.value.trim() : "";
    if (!password) {
      setError("Enter the password.");
      return;
    }

    setBusy(true);
    try {
      await login(password);
      // Do not keep password in memory/UI longer than needed
      if (passwordInput) passwordInput.value = "";
      window.location.assign("/fulfill/");
    } catch (err) {
      setError(err && err.message ? err.message : "Login failed.");
      setBusy(false);
    }
  }

  // If the HTML has no form, still allow Enter-to-submit
  if (form) {
    form.addEventListener("submit", onSubmit);
  } else if (passwordInput) {
    passwordInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") onSubmit(e);
    });
  } else {
    setError("Login form not found on this page.");
  }
})();
