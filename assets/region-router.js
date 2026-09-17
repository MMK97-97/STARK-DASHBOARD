(function () {
  "use strict";

  function normalizeRegion(value) {
    const normalized = String(value || "").trim().toUpperCase();
    if (normalized === "EU") return "EU";
    if (normalized === "CA" || normalized === "CANADA") return "CA";
    if (normalized === "US" || normalized === "UNITED STATES") return "US";
    return "";
  }

  function referrerRegion() {
    if (!document.referrer) return "";
    try {
      const source = new URL(document.referrer);
      const match = source.pathname.match(/-(us|eu|ca)\.html$/i);
      return normalizeRegion(match?.[1] || source.searchParams.get("region") || source.searchParams.get("workspace"));
    } catch (_) {
      return "";
    }
  }

  let stored = "";
  try { stored = localStorage.getItem("stark-selected-region") || ""; } catch (_) {}
  const query = new URLSearchParams(location.search);
  const requested = normalizeRegion(query.get("region") || query.get("workspace")) || referrerRegion() || normalizeRegion(stored) || "US";
  const suffix = requested === "EU" ? "eu" : requested === "CA" ? "ca" : "us";
  const route = document.documentElement.dataset.route || "inventory";

  try { localStorage.setItem("stark-selected-region", requested); } catch (_) {}

  location.replace(`${route}-${suffix}.html`);
})();
