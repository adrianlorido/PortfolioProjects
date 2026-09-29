// Refreshes account figures from /api/account. Display only: values come
// from the backend as integer cents and are formatted, never recalculated.
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

  var btn = document.getElementById("refresh");
  if (!btn) return;
  btn.addEventListener("click", function () {
    btn.disabled = true;
    btn.textContent = "Refreshing…";
    fetch("/api/account", { headers: { Accept: "application/json" } })
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
