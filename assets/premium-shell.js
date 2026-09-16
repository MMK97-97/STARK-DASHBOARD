(() => {
  "use strict";

  const body = document.body;
  if (!body || body.querySelector(".tv-app") || document.documentElement.dataset.route) return;

  const path = location.pathname.split("/").pop() || "index.html";
  const suffixMatch = path.match(/-(us|eu|ca)\.html$/i);
  const queryRegion = new URLSearchParams(location.search).get("region") || new URLSearchParams(location.search).get("workspace");
  const storedRegion = localStorage.getItem("stark-selected-region");
  const region = suffixMatch
    ? suffixMatch[1].toLowerCase()
    : String(queryRegion || storedRegion || "US").toLowerCase().replace("canada", "ca");
  const regionCode = region === "eu" ? "EU" : region === "ca" ? "CA" : "US";
  const regional = name => `${name}-${region}.html`;

  const icon = paths => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
  const icons = {
    dashboard: icon('<path d="M4 13h6V4H4zM14 20h6V11h-6zM4 20h6v-4H4zM14 8h6V4h-6z"/>'),
    raw: icon('<path d="M5 3h10l4 4v14H5z"/><path d="M15 3v5h5M8 12h8M8 16h8"/>'),
    reorder: icon('<path d="M4 7h16M4 12h16M4 17h10"/><path d="m17 15 3 3-3 3"/>'),
    brands: icon('<path d="M12 3 4 7v10l8 4 8-4V7z"/><path d="m4 7 8 4 8-4M12 11v10"/>'),
    sales: icon('<path d="M4 19V9M10 19V5M16 19v-7M3 19h18"/><path d="m15 7 3-3 3 3"/>'),
    events: icon('<path d="M5 5h14v15H5zM8 3v4M16 3v4M5 10h14"/><path d="m9 15 2 2 4-4"/>'),
    freight: icon('<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>'),
    consolidate: icon('<path d="M4 5h6v6H4zM14 5h6v6h-6zM9 16h6v4H9zM7 11v2.5h10V11M12 13.5V16"/>'),
    tracking: icon('<circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/>'),
    instructions: icon('<path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/>')
  };

  const inventoryPages = new Set([
    "inventory-dashboard-us.html", "inventory-dashboard-eu.html", "inventory-dashboard-ca.html",
    "raw-report-us.html", "raw-report-eu.html", "raw-report-ca.html",
    "reorder-report-us.html", "reorder-report-eu.html", "reorder-report-ca.html",
    "active-brands-us.html", "active-brands-eu.html", "active-brands-ca.html",
    "instructions-us.html", "instructions-eu.html", "instructions-ca.html", "ats-eu.html"
  ]);
  const supported = inventoryPages.has(path) || [
    "index.html", "sales-analysis.html", "events.html", "freight-estimator.html", "shipment-tracking.html"
  ].includes(path);
  if (!supported) return;

  const activeKey = path.startsWith("inventory-dashboard") ? "dashboard"
    : path.startsWith("raw-report") ? "raw"
      : path.startsWith("reorder-report") ? "reorder"
        : path.startsWith("active-brands") ? "brands"
          : path.startsWith("instructions") ? "instructions"
            : path === "sales-analysis.html" ? "sales"
              : path === "events.html" ? "events"
                : path === "freight-estimator.html" && location.hash === "#consolidator" ? "consolidate"
                  : path === "freight-estimator.html" ? "freight"
                    : path === "shipment-tracking.html" ? "tracking"
                      : "";

  const inventoryItems = [
    ["dashboard", "Inventory Dashboard", regional("inventory-dashboard"), icons.dashboard],
    ["raw", "Raw Report", regional("raw-report"), icons.raw],
    ["reorder", "Reorder Report", regional("reorder-report"), icons.reorder],
    ["brands", "Active Brands", regional("active-brands"), icons.brands],
    ["instructions", "Instructions", regional("instructions"), icons.instructions]
  ];
  const primaryItems = [
    ["sales", "Sales Analysis", `sales-analysis.html?region=${regionCode}`, icons.sales],
    ["events", "Events", `events.html?region=${regionCode}`, icons.events],
    ["freight", "Freight Estimator", "freight-estimator.html", icons.freight],
    ["consolidate", "Freight Consolidate", "freight-estimator.html#consolidator", icons.consolidate],
    ["tracking", "Tracking", "shipment-tracking.html", icons.tracking]
  ];
  const navLink = ([key, label, href, glyph], submenu = false) => `<a href="${href}" data-premium-nav="${key}" class="${submenu ? "premium-nav-subitem " : ""}${key === activeKey ? "active" : ""}" ${key === activeKey ? 'aria-current="page"' : ""}>${glyph}<span>${label}</span></a>`;

  const rail = document.createElement("aside");
  rail.className = "premium-side-rail";
  rail.setAttribute("aria-label", "Primary workspace navigation");
  rail.innerHTML = `
    <a class="premium-rail-brand" href="index.html" aria-label="Stark Premium home"><span>S</span><div><small>Stark Premium</small><strong>Supply Chain Intelligence</strong></div></a>
    <div class="premium-rail-region"><span>${regionCode}</span><div><small>Regional workspace</small><strong>${regionCode === "US" ? "United States" : regionCode === "EU" ? "European Union" : "Canada"}</strong></div></div>
    <nav>
      <section class="premium-nav-group" aria-label="Inventory analysis">
        <div class="premium-nav-parent">${icons.dashboard}<span>Inventory Analysis</span></div>
        <div class="premium-nav-submenu">${inventoryItems.map(item => navLink(item, true)).join("")}</div>
      </section>
      <div class="premium-nav-separator" aria-hidden="true"></div>
      ${primaryItems.map(item => navLink(item)).join("")}
    </nav>`;

  const toggle = document.createElement("button");
  toggle.className = "premium-rail-toggle";
  toggle.type = "button";
  toggle.setAttribute("aria-label", "Open workspace navigation");
  toggle.setAttribute("aria-expanded", "false");
  toggle.innerHTML = '<span></span><span></span><span></span>';

  body.prepend(rail);
  body.prepend(toggle);

  const closeRail = () => {
    body.classList.remove("premium-rail-open");
    toggle.setAttribute("aria-expanded", "false");
  };
  toggle.addEventListener("click", () => {
    const open = body.classList.toggle("premium-rail-open");
    toggle.setAttribute("aria-expanded", String(open));
  });
  rail.addEventListener("click", event => {
    if (event.target.closest("a")) closeRail();
  });
  const syncFreightHash = () => {
    if (path !== "freight-estimator.html") return;
    const key = location.hash === "#consolidator" ? "consolidate" : "freight";
    rail.querySelectorAll("[data-premium-nav]").forEach(link => {
      const selected = link.dataset.premiumNav === key;
      link.classList.toggle("active", selected);
      if (selected) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  };
  window.addEventListener("hashchange", syncFreightHash);
  let navigationInProgress = false;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const resetTransitionState = () => {
    navigationInProgress = false;
    body.classList.remove("premium-content-leaving", "page-leaving", "inventory-fallback-leaving");
  };
  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    const link = target?.closest("a[href]");
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (link.target === "_blank" || link.hasAttribute("download")) return;
    const destination = new URL(link.href, location.href);
    if (destination.origin !== location.origin || destination.protocol !== location.protocol) return;
    const sameDocument = destination.pathname === location.pathname && destination.search === location.search;
    if (sameDocument && destination.hash !== location.hash) return;
    if (destination.href === location.href || navigationInProgress) {
      if (destination.href === location.href) event.preventDefault();
      return;
    }
    event.preventDefault();
    navigationInProgress = true;
    closeRail();
    if (reducedMotion.matches) {
      location.assign(destination.href);
      return;
    }
    body.classList.add("premium-content-leaving");
    window.setTimeout(() => location.assign(destination.href), 135);
  }, true);
  window.addEventListener("pageshow", resetTransitionState);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") resetTransitionState();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeRail();
  });

  const syncIndexMode = () => {
    if (path !== "index.html") {
      body.classList.add("premium-shell-active");
      return;
    }
    const moduleScreen = document.getElementById("module-screen");
    const regionalApp = document.getElementById("regional-app");
    const active = (moduleScreen && !moduleScreen.classList.contains("hidden")) || (regionalApp && !regionalApp.classList.contains("hidden"));
    body.classList.toggle("premium-shell-active", Boolean(active));
    if (!active) closeRail();
  };
  syncIndexMode();
  if (path === "index.html") {
    const observer = new MutationObserver(syncIndexMode);
    [document.getElementById("module-screen"), document.getElementById("regional-app")].filter(Boolean).forEach(node => observer.observe(node, {attributes: true, attributeFilter: ["class"]}));
  }
})();
