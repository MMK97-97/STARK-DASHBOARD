(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  if (!$('consolidator')) return;

  const LIMITS = { pallets: 26, weight: 45000, cube: 3900, linearFeet: 53 };
  const STORAGE_KEY = "stark-freight-consolidator-v1";
  const state = { loads: [], plan: null };

  const number = value => {
    const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const positive = value => Math.max(0, number(value));
  const format = (value, digits = 0) => Number(value).toLocaleString("en-US", { maximumFractionDigits: digits });
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const dateValue = value => value ? new Date(`${value}T12:00:00`) : null;
  const dateText = value => {
    const date = dateValue(value);
    return date && !Number.isNaN(date.valueOf()) ? date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Not set";
  };
  const normalizeZip = value => String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
  const dayGap = (first, second) => Math.abs((first - second) / 86400000);

  function toast(message) {
    const node = $("toast");
    if (!node) return;
    node.textContent = message;
    node.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove("show"), 2200);
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.loads)); } catch (_) {}
  }

  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      state.loads = Array.isArray(saved) ? saved.filter(load => load && load.id) : [];
    } catch (_) {
      state.loads = [];
    }
  }

  function readForm() {
    const pallets = Math.ceil(positive($("con-pallets").value));
    const weight = positive($("con-weight").value);
    const cubeInput = positive($("con-cube").value);
    const linearInput = positive($("con-linear").value);
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      reference: $("con-reference").value.trim() || `Load ${state.loads.length + 1}`,
      origin: normalizeZip($("con-origin").value),
      destination: normalizeZip($("con-destination").value),
      ready: $("con-ready").value,
      delivery: $("con-delivery").value,
      pallets,
      weight,
      cube: cubeInput || pallets * 80,
      linearFeet: linearInput || Math.ceil(pallets / 2) * 4,
      stackable: $("con-stackable").checked
    };
  }

  function validate(load) {
    if (!load.origin || !load.destination) return "Enter origin and destination ZIP/postal codes.";
    if (!load.pallets || !load.weight) return "Enter positive pallet and weight values.";
    if (load.ready && load.delivery && dateValue(load.ready) > dateValue(load.delivery)) return "Required delivery must be after the ready date.";
    return "";
  }

  function resetForm() {
    $("con-reference").value = "";
    $("con-pallets").value = "1";
    $("con-weight").value = "";
    $("con-cube").value = "";
    $("con-linear").value = "";
    $("con-stackable").checked = true;
  }

  function addLoad(load) {
    const error = validate(load);
    if (error) {
      toast(error);
      return;
    }
    state.loads.push(load);
    state.plan = null;
    save();
    renderLoads();
    resetResults();
    resetForm();
    toast("Freight load added");
  }

  function renderLoads() {
    const list = $("con-load-list");
    $("con-load-count").textContent = `${state.loads.length} ${state.loads.length === 1 ? "load" : "loads"}`;
    $("con-analyze").disabled = state.loads.length < 2;
    $("con-clear").disabled = !state.loads.length;
    if (!state.loads.length) {
      list.innerHTML = '<div class="con-empty-list"><strong>No freight loads added</strong><span>Add at least two loads to evaluate consolidation.</span></div>';
      return;
    }
    list.innerHTML = state.loads.map((load, index) => `
      <article class="con-load-card">
        <span class="con-load-number">${String(index + 1).padStart(2, "0")}</span>
        <div class="con-load-copy">
          <strong>${escapeHtml(load.reference)}</strong>
          <span>${escapeHtml(load.origin)} → ${escapeHtml(load.destination)}</span>
          <small>${format(load.pallets)} pallets • ${format(load.weight, 1)} lb • ${format(load.cube, 1)} ft³ • ${format(load.linearFeet, 1)} linear ft</small>
        </div>
        <div class="con-load-dates"><small>Ready</small><strong>${dateText(load.ready)}</strong></div>
        <button class="con-remove" type="button" data-remove-load="${escapeHtml(load.id)}" aria-label="Remove ${escapeHtml(load.reference)}">×</button>
      </article>`).join("");
  }

  function scheduleCompatible(loads) {
    const readyDates = loads.map(load => dateValue(load.ready)).filter(Boolean);
    const deliveryDates = loads.map(load => dateValue(load.delivery)).filter(Boolean);
    if (readyDates.length > 1) {
      const earliest = new Date(Math.min(...readyDates));
      const latest = new Date(Math.max(...readyDates));
      if (dayGap(earliest, latest) > 3) return false;
    }
    if (readyDates.length && deliveryDates.length) {
      const latestReady = new Date(Math.max(...readyDates));
      const earliestDelivery = new Date(Math.min(...deliveryDates));
      if (latestReady > earliestDelivery) return false;
    }
    return true;
  }

  function totals(loads) {
    return loads.reduce((sum, load) => ({
      pallets: sum.pallets + load.pallets,
      weight: sum.weight + load.weight,
      cube: sum.cube + load.cube,
      linearFeet: sum.linearFeet + load.linearFeet
    }), { pallets: 0, weight: 0, cube: 0, linearFeet: 0 });
  }

  function tripCount(total) {
    return Math.max(1,
      Math.ceil(total.pallets / LIMITS.pallets),
      Math.ceil(total.weight / LIMITS.weight),
      Math.ceil(total.cube / LIMITS.cube),
      Math.ceil(total.linearFeet / LIMITS.linearFeet)
    );
  }

  function utilization(total, trips = 1) {
    return Math.max(
      total.pallets / (LIMITS.pallets * trips),
      total.weight / (LIMITS.weight * trips),
      total.cube / (LIMITS.cube * trips),
      total.linearFeet / (LIMITS.linearFeet * trips)
    ) * 100;
  }

  function modeFor(total, trips) {
    const use = utilization(total, trips);
    if (trips > 1 || use >= 70 || total.weight >= 30000 || total.pallets >= 18) return "FTL";
    if (use >= 35 || total.weight >= 10000 || total.pallets >= 8) return "Volume LTL / partial";
    return "LTL";
  }

  function makeGroup(loads, strategy) {
    const total = totals(loads);
    const trips = tripCount(total);
    const origins = [...new Set(loads.map(load => load.origin))];
    const destinations = [...new Set(loads.map(load => load.destination))];
    return {
      id: `group-${loads.map(load => load.id).join("-")}`,
      loads,
      strategy,
      total,
      trips,
      utilization: utilization(total, trips),
      mode: modeFor(total, trips),
      lane: origins.length === 1 && destinations.length === 1
        ? `${origins[0]} → ${destinations[0]}`
        : origins.length > 1 && destinations.length === 1
          ? `${origins.length} pickups → ${destinations[0]}`
          : origins.length === 1 && destinations.length > 1
            ? `${origins[0]} → ${destinations.length} stops`
            : "Separate lane"
    };
  }

  function partitionLoads() {
    const remaining = new Set(state.loads.map(load => load.id));
    const groups = [];
    const tryGrouping = (keyFor, strategy) => {
      const map = new Map();
      state.loads.filter(load => remaining.has(load.id)).forEach(load => {
        const key = keyFor(load);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(load);
      });
      [...map.values()].filter(loads => loads.length > 1 && scheduleCompatible(loads)).forEach(loads => {
        groups.push(makeGroup(loads, strategy));
        loads.forEach(load => remaining.delete(load.id));
      });
    };
    tryGrouping(load => `${load.origin}|${load.destination}`, "Direct lane consolidation");
    tryGrouping(load => load.destination, "Multi-pick consolidation candidate");
    tryGrouping(load => load.origin, "Multi-stop consolidation candidate");
    state.loads.filter(load => remaining.has(load.id)).forEach(load => groups.push(makeGroup([load], "Keep separate")));
    return groups;
  }

  function analyze() {
    if (state.loads.length < 2) {
      toast("Add at least two freight loads");
      return;
    }
    const groups = partitionLoads();
    const total = totals(state.loads);
    const baselineTrips = state.loads.reduce((sum, load) => sum + tripCount(totals([load])), 0);
    const consolidatedTrips = groups.reduce((sum, group) => sum + group.trips, 0);
    const tripsSaved = Math.max(0, baselineTrips - consolidatedTrips);
    const combinedGroups = groups.filter(group => group.loads.length > 1);
    const overallUse = utilization(total, Math.max(1, consolidatedTrips));
    state.plan = { groups, total, baselineTrips, consolidatedTrips, tripsSaved, combinedGroups, overallUse };
    renderPlan();
    toast("Consolidation plan calculated");
  }

  function resetResults() {
    $("con-results-empty").classList.remove("hidden");
    $("con-results").classList.add("hidden");
    $("con-copy").disabled = true;
  }

  function renderPlan() {
    const { groups, total, baselineTrips, consolidatedTrips, tripsSaved, combinedGroups, overallUse } = state.plan;
    const title = tripsSaved > 0
      ? `Consolidate into ${consolidatedTrips} planned ${consolidatedTrips === 1 ? "shipment" : "shipments"}`
      : combinedGroups.length
        ? "Consolidation improves load utilization"
        : "Keep incompatible lanes separate";
    const reason = tripsSaved > 0
      ? `${tripsSaved} shipment ${tripsSaved === 1 ? "movement" : "movements"} can be removed based on matching lanes, dates and trailer capacity.`
      : combinedGroups.length
        ? "Compatible loads can move together, but current capacity still requires the same number of shipment movements."
        : "The entered origins, destinations or timing windows do not form a safe consolidation group.";

    $("con-plan-title").textContent = title;
    $("con-plan-reason").textContent = reason;
    $("con-plan-chip").textContent = tripsSaved > 0 ? `${tripsSaved} trip${tripsSaved === 1 ? "" : "s"} saved` : "Lane review";
    $("con-kpis").innerHTML = [
      ["Freight loads", format(state.loads.length), `${combinedGroups.length} compatible group${combinedGroups.length === 1 ? "" : "s"}`],
      ["Planned shipments", format(consolidatedTrips), `From ${format(baselineTrips)} separate movements`],
      ["Total pallets", format(total.pallets), `${format(total.linearFeet, 1)} linear ft`],
      ["Cargo weight", `${format(total.weight, 1)} lb`, `${format(total.weight / Math.max(1, consolidatedTrips), 1)} lb / shipment`],
      ["Palletized cube", `${format(total.cube, 1)} ft³`, `${format(total.cube / Math.max(1, consolidatedTrips), 1)} ft³ / shipment`],
      ["Average trailer use", `${format(overallUse, 1)}%`, "Highest capacity constraint"]
    ].map(kpi => `<article class="kpi"><span>${kpi[0]}</span><strong>${kpi[1]}</strong><small>${kpi[2]}</small></article>`).join("");

    $("con-group-table").innerHTML = groups.map((group, index) => `
      <tr>
        <td>${String(index + 1).padStart(2, "0")}</td>
        <td>${escapeHtml(group.strategy)}</td>
        <td>${escapeHtml(group.lane)}</td>
        <td>${group.loads.map(load => escapeHtml(load.reference)).join("<br>")}</td>
        <td>${format(group.total.pallets)}</td>
        <td>${format(group.total.weight, 1)} lb</td>
        <td>${format(group.total.cube, 1)} ft³</td>
        <td>${format(group.total.linearFeet, 1)} ft</td>
        <td>${format(group.trips)}</td>
        <td><span class="con-mode">${escapeHtml(group.mode)}</span></td>
        <td>${format(group.utilization, 1)}%</td>
      </tr>`).join("");

    $("con-detail-table").innerHTML = state.loads.map(load => `
      <tr>
        <td>${escapeHtml(load.reference)}</td>
        <td>${escapeHtml(load.origin)}</td>
        <td>${escapeHtml(load.destination)}</td>
        <td>${dateText(load.ready)}</td>
        <td>${dateText(load.delivery)}</td>
        <td>${format(load.pallets)}</td>
        <td>${format(load.weight, 1)} lb</td>
        <td>${format(load.cube, 1)} ft³</td>
        <td>${format(load.linearFeet, 1)} ft</td>
        <td>${load.stackable ? "Stackable" : "Non-stackable"}</td>
      </tr>`).join("");

    const alerts = [];
    if (tripsSaved > 0) alerts.push([`${tripsSaved} shipment movement${tripsSaved === 1 ? "" : "s"} can be consolidated under the entered capacity and schedule constraints.`, "good"]);
    groups.filter(group => group.strategy.includes("candidate")).forEach(group => alerts.push([`${group.strategy}: ${group.lane}. Confirm stop order, pickup appointments and the final carrier quote.`, ""]));
    state.loads.filter(load => !load.ready || !load.delivery).forEach(load => alerts.push([`${load.reference}: add both ready and required-delivery dates before tendering the consolidated route.`, ""]));
    state.loads.filter(load => !load.stackable).forEach(load => alerts.push([`${load.reference} is non-stackable. Confirm usable trailer floor positions and accessorial charges.`, "critical"]));
    groups.filter(group => group.trips > 1).forEach(group => alerts.push([`${group.lane} exceeds one trailer capacity and is split into ${group.trips} planned shipments.`, "critical"]));
    if (!combinedGroups.length) alerts.push(["No loads share a compatible direct lane, destination pickup cluster or origin delivery cluster within the timing rules.", "critical"]);
    $("con-alerts").innerHTML = alerts.map(([copy, tone]) => `<div class="warning ${tone}">${escapeHtml(copy)}</div>`).join("");

    $("con-results-empty").classList.add("hidden");
    $("con-results").classList.remove("hidden");
    $("con-copy").disabled = false;
    $("con-results").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function copyPlan() {
    if (!state.plan) return;
    const { groups, total, baselineTrips, consolidatedTrips, tripsSaved } = state.plan;
    const text = [
      "Freight consolidation plan",
      `Loads: ${state.loads.length}`,
      `Planned shipments: ${consolidatedTrips} (from ${baselineTrips})`,
      `Trips saved: ${tripsSaved}`,
      `Total pallets: ${total.pallets}`,
      `Cargo weight: ${format(total.weight, 1)} lb`,
      `Palletized cube: ${format(total.cube, 1)} ft³`,
      `Linear feet: ${format(total.linearFeet, 1)} ft`,
      "",
      ...groups.map((group, index) => `${index + 1}. ${group.strategy} | ${group.lane} | ${group.loads.map(load => load.reference).join(", ")} | ${group.trips} shipment(s) | ${group.mode} | ${format(group.utilization, 1)}% use`)
    ].join("\n");
    navigator.clipboard.writeText(text).then(() => toast("Consolidation summary copied")).catch(() => toast("Clipboard access was blocked"));
  }

  $("con-add").addEventListener("click", () => addLoad(readForm()));
  $("con-analyze").addEventListener("click", analyze);
  $("con-copy").addEventListener("click", copyPlan);
  $("con-clear").addEventListener("click", () => {
    state.loads = [];
    state.plan = null;
    save();
    renderLoads();
    resetResults();
    toast("Consolidation queue cleared");
  });
  $("con-load-sample").addEventListener("click", () => {
    const today = new Date();
    const iso = offset => {
      const date = new Date(today);
      date.setDate(date.getDate() + offset);
      return date.toISOString().slice(0, 10);
    };
    state.loads = [
      { id: `sample-${Date.now()}-1`, reference: "PO 86120", origin: "75244", destination: "33073", ready: iso(1), delivery: iso(5), pallets: 5, weight: 6200, cube: 710, linearFeet: 12, stackable: true },
      { id: `sample-${Date.now()}-2`, reference: "PO 86134", origin: "75244", destination: "33073", ready: iso(2), delivery: iso(5), pallets: 4, weight: 4800, cube: 560, linearFeet: 8, stackable: true },
      { id: `sample-${Date.now()}-3`, reference: "PO 86151", origin: "75244", destination: "33073", ready: iso(2), delivery: iso(6), pallets: 6, weight: 7900, cube: 860, linearFeet: 12, stackable: true }
    ];
    state.plan = null;
    save();
    renderLoads();
    resetResults();
    toast("Sample consolidation queue loaded");
  });
  $("con-load-list").addEventListener("click", event => {
    const button = event.target.closest("[data-remove-load]");
    if (!button) return;
    state.loads = state.loads.filter(load => load.id !== button.dataset.removeLoad);
    state.plan = null;
    save();
    renderLoads();
    resetResults();
    toast("Freight load removed");
  });

  restore();
  renderLoads();
  resetResults();
})();
