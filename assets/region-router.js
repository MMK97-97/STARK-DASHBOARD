(function () {
  "use strict";

  const requested = new URLSearchParams(location.search).get("region") || "US";
  const suffix = requested === "EU" ? "eu" : requested === "Canada" || requested === "CA" ? "ca" : "us";
  const route = document.documentElement.dataset.route || "inventory";

  location.replace(`${route}-${suffix}.html`);
})();
