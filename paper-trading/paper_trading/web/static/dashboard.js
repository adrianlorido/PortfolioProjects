// Refreshes account figures from /api/account and sends replay commands to
// the backend. Display only: values come from the backend as integer cents and
// are formatted, never recalculated.
(function () {
  "use strict";

  function usd(cents, signed) {
    if (cents === null || cents === undefined) return "Unavailable";
    var neg = cents < 0;
    var abs = Math.abs(cents);
    var dollars = Math.floor(abs / 100).toLocaleString("en-US");
    var rem = String(abs % 100).padStart(2, "0");
    var sign = neg ? "−" : (signed && cents > 0 ? "+" : "");
    return sign + "$" + dollars + "." + rem;
  }

  function apply(data) {
    var snap = data.snapshot;
    document.querySelectorAll("[data-field]").forEach(function (el) {
      var key = el.getAttribute("data-field");
      if (!(key in snap)) return;
      var v = snap[key];
      el.textContent = key.slice(-6) === "_cents" ? usd(v, el.hasAttribute("data-signed")) : String(v);
    });
    var recon = document.getElementById("recon");
    if (recon) {
      recon.textContent = data.reconciliation.ok ? "Ledger reconciled" : "Reconciliation FAILED";
      recon.className = "pill " + (data.reconciliation.ok ? "pill-ok" : "pill-bad");
      recon.title = data.reconciliation.discrepancies.join("; ");
    }
  }

  // --- Replay commands ---------------------------------------------------
  // One idempotency key per click. Network failures are retried with the SAME
  // key, so the server applies the command at most once.
  function newKey() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return "ui-" + window.crypto.randomUUID();
    return "ui-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  }

  function post(url, body, attemptsLeft) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    }).catch(function (err) {
      if (attemptsLeft > 0) return post(url, body, attemptsLeft - 1);
      throw err;
    });
  }

  var ENDPOINTS = {
    load: "replay/load", step: "replay/step", pause: "replay/pause", resume: "replay/resume",
    "run-to-end": "replay/run-to-end", start: "trading/start", "request-close": "trading/request-close",
    cancel: "trading/cancel",
  };
  var head = document.getElementById("page-head");
  var runKey = head ? head.getAttribute("data-run-key") : "";
  var msg = document.getElementById("command-msg");
  document.querySelectorAll("[data-command]").forEach(function (el) {
    el.addEventListener("click", function () {
      var command = el.getAttribute("data-command");
      var body = command === "load"
        ? { fixture_id: el.getAttribute("data-fixture-id") }
        : { idempotency_key: newKey() };
      if (command === "cancel") body.order_id = el.getAttribute("data-order-id");
      var enabled = Array.prototype.filter.call(
        document.querySelectorAll("[data-command]"), function (b) { return !b.disabled; });
      enabled.forEach(function (b) { b.disabled = true; });
      if (msg) { msg.className = "command-msg muted small"; msg.textContent = "Sending " + command + "…"; }
      post("/api/" + ENDPOINTS[command] + "?run=" + encodeURIComponent(runKey), body, 2)
        .then(function (r) {
          return r.json().then(function (data) {
            if (!r.ok) {
              var detail = data && (data.detail || data.error);
              throw new Error(typeof detail === "string" ? detail : (JSON.stringify(detail) || "HTTP " + r.status));
            }
            return data;
          });
        })
        .then(function () { window.location.reload(); })
        .catch(function (err) {
          if (msg) { msg.className = "command-msg small error"; msg.textContent = command + " failed: " + err.message; }
          enabled.forEach(function (b) { b.disabled = false; });
        });
    });
  });

  // --- Refresh -----------------------------------------------------------
  var btn = document.getElementById("refresh");
  if (!btn) return;
  btn.addEventListener("click", function () {
    btn.disabled = true;
    btn.textContent = "Refreshing…";
    fetch("/api/account?run=" + encodeURIComponent(runKey), { headers: { Accept: "application/json" } })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        apply(data);
        btn.textContent = "Refreshed " + new Date().toLocaleTimeString();
      })
      .catch(function (err) {
        btn.textContent = "Refresh failed (" + err.message + ")";
      })
      .finally(function () {
        btn.disabled = false;
      });
  });
})();
