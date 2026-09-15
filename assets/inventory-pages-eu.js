(function () {
  "use strict";

  const SI = window.StarkInventory;
  const page = document.body.dataset.page || "inventory";
  const region = "EU";
  SI.initFrame(page);
  let dataset = null, items = [], dashboardFilter = "all", dashboardCrossFilter = null;
  let syncChannel = null, syncTimer = 0, lastSyncNonce = "";
  const SYNC_CHANNEL = "stark-analytics-sync-v1";
  const SYNC_PULSE_KEY = "stark-analytics-sync-pulse";
  const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
  const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
  const el = id => document.getElementById(id);

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    dataset = await SI.loadDataset(region);
    items = dataset ? SI.analyze(dataset.rows, region) : [];
    renderDataNote();
    initPageTransitions();
    initLiveSync();
    if (page === "dashboard") initDashboard();
    if (page === "raw") initRaw();
    if (page === "reorder") initReorder();
    if (page === "brands") initBrands();
  }

  function renderDataNote() {
    document.querySelectorAll("[data-file-status]").forEach(node => {
      node.textContent = dataset ? `${dataset.fileName} • ${number.format(dataset.rows.length)} items` : "No Item Sales Report uploaded";
      node.classList.toggle("ready", Boolean(dataset));
    });
    document.querySelectorAll("[data-requires-data]").forEach(node => node.classList.toggle("hidden", !dataset));
    document.querySelectorAll("[data-empty-data]").forEach(node => node.classList.toggle("hidden", Boolean(dataset)));
  }

  function initDashboard() {
    const clearButton = el("clear-inventory-data"), settings = SI.loadSettings(region);
    ["critical", "coverage", "delay", "a", "b"].forEach(key => { const input = el(`setting-${key}`); if (input) input.value = settings[key]; });
    clearButton.addEventListener("click", async () => { if (!confirm(`Clear the ${SI.regionName(region)} inventory report stored in this browser?`)) return; await SI.clearDataset(region); dataset = null; items = []; dashboardCrossFilter = null; renderDataNote(); renderDashboard(); });
    el("save-inventory-settings").addEventListener("click", () => {
      const next = {}; ["critical", "coverage", "delay", "a", "b"].forEach(key => next[key] = Number(el(`setting-${key}`).value));
      if (next.a <= 0 || next.a >= next.b || next.b > 100) return alert("ABC thresholds must satisfy A < B and B ≤ 100.");
      SI.saveSettings(region, next); items = dataset ? SI.analyze(dataset.rows, region) : []; renderDashboard();
    });
    renderDashboard();
    refreshSalesSnapshot();
  }

  function renderDashboard() {
    const active = items.filter(item => item.activeBrand && item.eligible && !item.excluded), inactive = items.filter(item => !item.activeBrand && item.eligible && !item.excluded), reorders = active.filter(item => item.reorderRequired), totalAvailable = sum(active, item => item.available), totalDemand = sum(active, item => item.avg3), reorderUnits = sum(reorders, item => item.recommended);
    assignDashboardAbc(active);
    assignDashboardAbc(inactive);
    renderKpis("dashboard-kpis", [
      ["Items", number.format(active.length), `${SI.unique(active.map(item => item.brand)).length} active brands`, "all"],
      ["Stock available", number.format(totalAvailable), "Current available inventory", "stock"],
      ["Average monthly demand", decimal.format(totalDemand), "Past three-month run rate", "demand"],
      ["Reorder items", number.format(reorders.length), "Live, Fashion and Backorder", "reorder"],
      ["Recommended units", number.format(reorderUnits), "Based on average monthly sales", "recommended"],
      ["Inactive-brand items", number.format(inactive.length), "Excluded from reorder", "inactive"]
    ]);
    const kpiRows = dashboardRows(active, inactive), filtered = applyDashboardCrossFilter(kpiRows), filteredReorders = filtered.filter(item => item.reorderRequired);
    renderDashboardFilterStatus(filtered.length, kpiRows.length);
    renderAbcSummary(dashboardCrossFilter?.type === "abc" ? kpiRows : filtered);
    const brandChartRows = dashboardCrossFilter?.type === "brand" ? kpiRows : filtered;
    const byBrand = rollup(brandChartRows.filter(item => item.reorderRequired), item => item.brand, item => item.recommended, 10);
    renderBarList("reorder-brand-bars", byBrand, value => number.format(value));
    renderCoverageChart(dashboardCrossFilter?.type === "coverage" ? kpiRows : filtered);
    renderInventoryPositionChart(brandChartRows);
    const attention = filteredReorders.slice().sort((a, b) => b.recommended - a.recommended || String(a.brand).localeCompare(String(b.brand)) || String(a.model).localeCompare(String(b.model))).slice(0, 8);
    el("attention-table").innerHTML = attention.map(item => `<tr><td>${SI.escapeHtml(item.model)}</td><td>${SI.escapeHtml(item.brand)}</td><td>${SI.escapeHtml(item.product)}</td><td class="num">${number.format(item.available)}</td><td class="num">${decimal.format(item.avg3)}</td><td class="num">${number.format(item.recommended)}</td><td>${SI.escapeHtml(item.reorderReason)}</td></tr>`).join("") || emptyRow(7);
  }

  function dashboardRows(active, inactive) {
    if (dashboardFilter === "stock") return active.filter(item => item.available > 0);
    if (dashboardFilter === "demand") return active.filter(item => item.avg3 > 0);
    if (dashboardFilter === "reorder") return active.filter(item => item.reorderRequired);
    if (dashboardFilter === "recommended") return active.filter(item => item.recommended > 0);
    if (dashboardFilter === "inactive") return inactive;
    return active;
  }

  function applyDashboardCrossFilter(rows) {
    if (!dashboardCrossFilter) return rows;
    if (dashboardCrossFilter.type === "abc") return rows.filter(item => (item.dashboardAbc || item.abc) === dashboardCrossFilter.value);
    if (dashboardCrossFilter.type === "brand") return rows.filter(item => item.brand === dashboardCrossFilter.value);
    if (dashboardCrossFilter.type === "coverage") return rows.filter(item => coverageBucket(item).key === dashboardCrossFilter.value);
    return rows;
  }

  function setDashboardCrossFilter(type, value) {
    dashboardCrossFilter = dashboardCrossFilter?.type === type && dashboardCrossFilter.value === value ? null : { type, value };
    renderDashboard();
  }

  function renderDashboardFilterStatus(visible, total) {
    const node = el("dashboard-filter-status");
    if (!node) return;
    const kpiLabel = { all: "All active items", stock: "Items with stock", demand: "Items with demand", reorder: "Reorder items", recommended: "Items with recommended units", inactive: "Inactive-brand items" }[dashboardFilter];
    const chartLabel = dashboardCrossFilter ? `${dashboardCrossFilter.type === "abc" ? "ABC class" : dashboardCrossFilter.type === "brand" ? "Brand" : "Coverage"}: ${dashboardCrossFilter.value}` : "";
    node.innerHTML = `<span><i></i><strong>${SI.escapeHtml(kpiLabel)}</strong>${chartLabel ? ` <b>+</b> ${SI.escapeHtml(chartLabel)}` : ""} <small>${number.format(visible)} of ${number.format(total)} models shown</small></span>${dashboardCrossFilter ? '<button type="button" id="clear-dashboard-chart-filter">Clear chart filter</button>' : ""}`;
    el("clear-dashboard-chart-filter")?.addEventListener("click", () => { dashboardCrossFilter = null; renderDashboard(); });
  }

  function assignDashboardAbc(rows) {
    const stored = SI.loadSettings(region), a = Number.isFinite(Number(stored.a)) ? Math.min(98, Math.max(1, Number(stored.a))) : 80, b = Number.isFinite(Number(stored.b)) ? Math.min(100, Math.max(a + 1, Number(stored.b))) : 95, ranked = rows.slice().sort((left, right) => right.vol3 - left.vol3 || String(left.brand).localeCompare(String(right.brand)) || String(left.model).localeCompare(String(right.model))), total = sum(ranked, item => Math.max(0, item.vol3));
    let cumulative = 0;
    ranked.forEach(item => {
      const prior = cumulative, contribution = total > 0 ? Math.max(0, item.vol3) / total : 0;
      cumulative += contribution;
      item.dashboardAbc = prior < a / 100 ? "A" : prior < b / 100 ? "B" : "C";
    });
  }

  function renderAbcSummary(rows) {
    const counts = ["A", "B", "C"].map(code => ({ code, value: rows.filter(item => (item.dashboardAbc || item.abc) === code).length })), total = counts.reduce((sumValue, item) => sumValue + item.value, 0) || 1;
    el("abc-summary").innerHTML = counts.map(item => `<button type="button" class="abc-summary-row${dashboardCrossFilter?.type === "abc" && dashboardCrossFilter.value === item.code ? " is-selected" : ""}" data-abc-filter="${item.code}" aria-pressed="${dashboardCrossFilter?.type === "abc" && dashboardCrossFilter.value === item.code}"><span class="class-badge class-${item.code.toLowerCase()}">${item.code}</span><div><strong>${number.format(item.value)} items</strong><small>${percent.format(item.value / total)} of visible items</small></div></button>`).join("");
    el("abc-summary").querySelectorAll("[data-abc-filter]").forEach(button => button.addEventListener("click", () => setDashboardCrossFilter("abc", button.dataset.abcFilter)));
    el("abc-donut-css").style.background = `conic-gradient(#0b8f87 0 ${counts[0].value / total * 100}%, #f59e0b ${counts[0].value / total * 100}% ${(counts[0].value + counts[1].value) / total * 100}%, #dc5a64 ${(counts[0].value + counts[1].value) / total * 100}% 100%)`;
    el("abc-donut-total").textContent = number.format(total === 1 && !rows.length ? 0 : total);
  }

  function coverageBucket(item) {
    const demand = Math.max(0, Number(item.avg3) || 0), available = Math.max(0, Number(item.available) || 0), months = demand > 0 ? available / demand : available > 0 ? Infinity : 0;
    if (demand <= 0 && available > 0) return { key: "No demand", order: 4 };
    if (months < 1) return { key: "Under 1 month", order: 0 };
    if (months < 2) return { key: "1–2 months", order: 1 };
    if (months <= 4) return { key: "2–4 months", order: 2 };
    return { key: "Over 4 months", order: 3 };
  }

  function renderCoverageChart(rows) {
    const buckets = ["Under 1 month", "1–2 months", "2–4 months", "Over 4 months", "No demand"].map(key => ({ key, value: rows.filter(item => coverageBucket(item).key === key).length }));
    const max = Math.max(1, ...buckets.map(bucket => bucket.value));
    el("coverage-bars").innerHTML = buckets.map(bucket => `<button type="button" class="coverage-row${dashboardCrossFilter?.type === "coverage" && dashboardCrossFilter.value === bucket.key ? " is-selected" : ""}" data-coverage-filter="${bucket.key}" aria-pressed="${dashboardCrossFilter?.type === "coverage" && dashboardCrossFilter.value === bucket.key}"><span>${bucket.key}</span><div><i style="width:${bucket.value / max * 100}%"></i></div><strong>${number.format(bucket.value)}</strong></button>`).join("");
    el("coverage-bars").querySelectorAll("[data-coverage-filter]").forEach(button => button.addEventListener("click", () => setDashboardCrossFilter("coverage", button.dataset.coverageFilter)));
  }

  function renderInventoryPositionChart(rows) {
    const byBrand = new Map();
    rows.forEach(item => {
      const current = byBrand.get(item.brand) || { key: item.brand, available: 0, demand: 0 };
      current.available += Math.max(0, Number(item.available) || 0);
      current.demand += Math.max(0, Number(item.avg3) || 0);
      byBrand.set(item.brand, current);
    });
    const values = Array.from(byBrand.values()).sort((a, b) => b.demand - a.demand || b.available - a.available || a.key.localeCompare(b.key)).slice(0, 8);
    const max = Math.max(1, ...values.flatMap(row => [row.available, row.demand]));
    el("inventory-position-bars").innerHTML = values.map(row => `<button type="button" class="position-row${dashboardCrossFilter?.type === "brand" && dashboardCrossFilter.value === row.key ? " is-selected" : ""}" data-brand-filter="${SI.escapeHtml(row.key)}" aria-pressed="${dashboardCrossFilter?.type === "brand" && dashboardCrossFilter.value === row.key}"><span>${SI.escapeHtml(row.key)}</span><div class="position-track"><i class="stock" style="width:${row.available / max * 100}%"></i><em>${number.format(row.available)} available</em></div><div class="position-track"><i class="demand" style="width:${row.demand / max * 100}%"></i><em>${decimal.format(row.demand)} demand/mo</em></div></button>`).join("") || '<div class="empty-box">No supply and demand data to display.</div>';
    el("inventory-position-bars").querySelectorAll("[data-brand-filter]").forEach(button => button.addEventListener("click", () => setDashboardCrossFilter("brand", button.dataset.brandFilter)));
  }

  function initRaw() {
    const fileInput = el("raw-file"), uploadButton = el("upload-raw-report");
    fileInput.addEventListener("change", async event => {
      const file = event.target.files[0]; if (!file) return;
      uploadButton.setAttribute("aria-disabled", "true"); uploadButton.textContent = "Reading report…";
      try {
        const sourceRows = await SI.readReportFile(file, region), normalized = SI.normalizeItemRows(sourceRows, region);
        if (!normalized.length) throw new Error("No usable inventory rows were found.");
        dataset = { fileName: file.name, importedAt: new Date().toISOString(), rows: normalized };
        await SI.saveDataset(region, dataset); SI.ensureBrandSettings(region, normalized); location.reload();
      } catch (error) { alert(`Raw Report: ${error.message}`); }
      finally { uploadButton.removeAttribute("aria-disabled"); uploadButton.textContent = "Upload Raw Report"; fileInput.value = ""; }
    });
    if (!dataset) return;
    fillSelect("raw-brand", SI.unique(items.map(item => item.brand)), "All brands"); fillSelect("raw-status", SI.unique(items.map(item => item.status)), "All statuses");
    ["raw-brand", "raw-status", "raw-abc"].forEach(id => el(id).addEventListener("change", renderRaw)); el("raw-search").addEventListener("input", renderRaw); el("export-raw").addEventListener("click", exportRaw); renderRaw();
  }

  function filteredRaw() { const brand = el("raw-brand").value, status = el("raw-status").value, abc = el("raw-abc").value, search = el("raw-search").value.trim().toLowerCase(); return items.filter(item => (!brand || item.brand === brand) && (!status || item.status === status) && (!abc || item.abc === abc) && (!search || `${item.model} ${item.product} ${item.itemid}`.toLowerCase().includes(search))); }
  function renderRaw() { const rows = filteredRaw(); el("raw-result-count").textContent = `${number.format(rows.length)} of ${number.format(items.length)} items`; el("raw-table").innerHTML = rows.map(item => `<tr><td>${SI.escapeHtml(item.brand)}</td><td>${SI.escapeHtml(item.itemid)}</td><td>${SI.escapeHtml(item.model)}</td><td>${SI.escapeHtml(item.product)}</td><td>${SI.escapeHtml(item.status)}</td><td>${SI.dateText(item.eta)}</td><td class="num">${number.format(item.vol3)}</td><td class="num">${number.format(item.last30)}</td><td class="num">${decimal.format(item.avg3)}</td><td class="num">${number.format(item.stockQty)}</td><td class="num">${number.format(item.available)}</td><td class="num">${number.format(item.openClient)}</td><td class="num">${number.format(item.openSupplier)}</td><td>${SI.escapeHtml(item.supplierWindow)}</td><td><span class="class-badge class-${item.abc.toLowerCase()}">${item.abc}</span></td></tr>`).join("") || emptyRow(15); }
  function exportRaw() { const rows = filteredRaw(), headers = ["Brand", "Item ID", "Model#", "Item Title", "Status", "ETA", "Vol Past 3M", "Vol Last 30 Days", "Avg/PerM Past 3M", "Stock Qty", "Stock Available", "Open Client", "Open Supplier", "Supplier Window", "ABC Class"]; SI.downloadCsv([headers, ...rows.map(item => [item.brand, item.itemid, item.model, item.product, item.status, SI.dateText(item.eta), item.vol3, item.last30, item.avg3, item.stockQty, item.available, item.openClient, item.openSupplier, item.supplierWindow, item.abc])], `Raw Report ${SI.regionCode(region)}.csv`); }

  function initReorder() {
    if (!dataset) return;
    const reorders = items.filter(item => item.reorderRequired);
    if (region === "EU") renderEuReorderView();
    fillSelect("reorder-brand", SI.unique(reorders.map(item => item.brand)), "All brands"); el("reorder-brand").addEventListener("change", renderReorder); el("reorder-search").addEventListener("input", renderReorder); el("export-reorder-csv").addEventListener("click", exportReorderCsv); el("export-reorder-xlsx").addEventListener("click", exportReorderXlsx); renderReorder();
  }
  const standardReorderHeaders = ["Model#", "Brand", "Item Title", "Status", "Open Orders From Client", "On Hand", "Stock Available", "Open Supplier Qty", "Supplier Delivery Window", "Days Until Supplier Delivery", "Recommended Reorder Qty", "Reorder Status"];
  const euReorderHeaders = ["Model#", "Brand", "Item Title", "Status", "Avg Sales/Month (3M)", "Open Orders From Client", "On Hand", "ATS", "Actual Available", "Upcoming Availability", "Open Supplier Qty <=30 Days", "Total Open Supplier Qty", "Supplier Delivery Window", "Days Until Supplier Delivery", "Recommended Reorder Qty", "Reorder Status", "PO#"];
  function currentReorderHeaders() { return region === "EU" ? euReorderHeaders : standardReorderHeaders; }
  function renderEuReorderView() {
    const head = document.querySelector(".wide-reorder-table thead tr");
    if (head) head.innerHTML = euReorderHeaders.map(header => `<th>${SI.escapeHtml(header)}</th>`).join("");
    const title = document.querySelector(".reorder-title");
    const note = document.querySelector(".reorder-note");
    if (title) title.textContent = "Reorder Report — EU Active Brands / Status: LIVE, FASHION, BACKORDER / Reorder Required Only";
    if (note) note.textContent = "Lead time is maintained on Active Brands and used in the recommended quantity calculation, but is hidden from the EU report. Reorder Reason, Raw Row and Sort Rank are also hidden.";
  }
  function filteredReorders() { const brand = el("reorder-brand").value, search = el("reorder-search").value.trim().toLowerCase(); return items.filter(item => item.reorderRequired).filter(item => (!brand || item.brand === brand) && (!search || `${item.model} ${item.product}`.toLowerCase().includes(search))).sort((a, b) => b.recommended - a.recommended || a.rawRow - b.rawRow); }
  function reorderArray(rows) {
    return rows.map(item => region === "EU"
      ? [item.model, item.brand, item.product, item.status, item.avg3, item.openClient, item.stockQty, item.ats, item.actualAvailable, item.upcomingAvailability, item.supplierDueQty, item.openSupplier, item.supplierWindow, item.daysUntil == null ? "" : item.daysUntil, item.recommended, "REORDER", item.supplierPOs]
      : [item.model, item.brand, item.product, item.status, item.openClient, item.stockQty, item.available, item.openSupplier, item.supplierWindow, item.daysUntil == null ? "" : item.daysUntil, item.recommended, "REORDER"]);
  }
  function renderReorder() { const rows = filteredReorders(), data = reorderArray(rows), numeric = region === "EU" ? [4,5,6,7,8,9,10,11,13,14] : [4,5,6,7,9,10], statusIndex = region === "EU" ? 15 : 11; el("reorder-result-count").textContent = `${number.format(rows.length)} reorder items • ${number.format(sum(rows, item => item.recommended))} recommended units`; el("reorder-table").innerHTML = data.map(row => `<tr>${row.map((value, index) => `<td${numeric.includes(index) ? ' class="num"' : ""}>${index === statusIndex ? '<span class="status status-risk">REORDER</span>' : SI.escapeHtml(value)}</td>`).join("")}</tr>`).join("") || emptyRow(currentReorderHeaders().length, "No reorder-required items match the filters."); }
  function exportReorderCsv() { SI.downloadCsv([currentReorderHeaders(), ...reorderArray(filteredReorders())], `Reorder Report ${SI.regionCode(region)}.csv`); }
  function exportReorderXlsx() { if (!window.XLSX) return alert("The Excel exporter did not load."); const workbook = XLSX.utils.book_new(), data = reorderArray(filteredReorders()), headers = currentReorderHeaders(), rows = [["Reorder Report - Active Brands / Status: LIVE, FASHION, BACKORDER / Reorder Required Only"], ["Lead time is maintained on the Active Brands page and is used in the recommended reorder calculation."], headers, ...data], sheet = XLSX.utils.aoa_to_sheet(rows), lastColumn = XLSX.utils.encode_col(headers.length - 1); sheet["!cols"] = headers.map((header, index) => ({ wch: index === 2 ? 48 : Math.max(12, Math.min(28, header.length + 3)) })); sheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: headers.length - 1 } }]; sheet["!autofilter"] = { ref: `A3:${lastColumn}${Math.max(3, data.length + 3)}` }; XLSX.utils.book_append_sheet(workbook, sheet, "REORDER REPORT"); XLSX.writeFile(workbook, `Reorder Report ${SI.regionCode(region)}.xlsx`, { compression: true }); }

  function initBrands() {
    if (!dataset) return;
    ensureBrands(); el("brand-search").addEventListener("input", renderBrands); el("add-brand").addEventListener("click", addBrand); el("activate-all").addEventListener("click", () => setAllBrands(true)); el("deactivate-all").addEventListener("click", () => setAllBrands(false)); el("save-lead-times").addEventListener("click", saveAllLeadTimes); el("export-brands").addEventListener("click", exportBrands); renderBrands();
  }
  function ensureBrands() { SI.ensureBrandSettings(region, dataset.rows); }
  function allBrandNames() { return SI.unique([...dataset.rows.map(row => row.brand), ...Object.keys(SI.loadBrandSettings(region))]); }
  function brandRows() { const settings = SI.loadBrandSettings(region), search = el("brand-search").value.trim().toLowerCase(); return allBrandNames().filter(brand => !search || brand.toLowerCase().includes(search)).map(brand => ({ brand, ...(settings[brand] || { active: true, leadTime: "" }), items: dataset.rows.filter(row => row.brand.toLowerCase() === brand.toLowerCase()).length })); }
  function addBrand() { const entered = prompt("Enter the new brand name:"); const brand = SI.cleanText(entered); if (!brand) return; const settings = SI.loadBrandSettings(region), existing = allBrandNames().find(name => name.toLowerCase() === brand.toLowerCase()); if (existing) { el("brand-search").value = existing; renderBrands(); alert(`${existing} is already in the ${SI.regionName(region)} brand list.`); return; } settings[brand] = { active: true, leadTime: "" }; SI.saveBrandSettings(region, settings); el("brand-search").value = ""; renderBrands(); const input = Array.from(document.querySelectorAll("[data-brand-lead]")).find(node => node.dataset.brandLead === brand); if (input) { input.focus(); input.scrollIntoView({ behavior: "smooth", block: "center" }); } }
  function renderBrands() { const rows = brandRows(); el("brand-result-count").textContent = `${number.format(rows.filter(row => row.active !== false).length)} active of ${number.format(rows.length)} displayed brands`; el("brands-table").innerHTML = rows.map(row => `<tr><td><label class="switch-label"><input type="checkbox" data-brand-active="${SI.escapeHtml(row.brand)}" ${row.active !== false ? "checked" : ""}><span>Active</span></label></td><td><strong>${SI.escapeHtml(row.brand)}</strong></td><td class="num">${number.format(row.items)}</td><td><input class="lead-time-input" data-brand-lead="${SI.escapeHtml(row.brand)}" value="${SI.escapeHtml(row.leadTime)}" placeholder="e.g. 2 weeks"></td></tr>`).join("") || emptyRow(4); document.querySelectorAll("[data-brand-active]").forEach(input => input.addEventListener("change", saveBrandActive)); document.querySelectorAll("[data-brand-lead]").forEach(input => input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); saveAllLeadTimes(); } })); }
  function saveBrandActive(event) { const settings = SI.loadBrandSettings(region), brand = event.target.dataset.brandActive; settings[brand] = settings[brand] || { active: true, leadTime: "" }; settings[brand].active = event.target.checked; SI.saveBrandSettings(region, settings); items = SI.analyze(dataset.rows, region); const displayed = document.querySelectorAll("[data-brand-active]"); el("brand-result-count").textContent = `${number.format(Array.from(displayed).filter(input => input.checked).length)} active of ${number.format(displayed.length)} displayed brands`; }
  function saveAllLeadTimes() { const settings = SI.loadBrandSettings(region); document.querySelectorAll("[data-brand-lead]").forEach(input => { const brand = input.dataset.brandLead; settings[brand] = settings[brand] || { active: true, leadTime: "" }; settings[brand].leadTime = input.value.trim(); }); SI.saveBrandSettings(region, settings); items = SI.analyze(dataset.rows, region); const button = el("save-lead-times"); button.textContent = "Saved ✓"; button.disabled = true; window.setTimeout(() => { button.textContent = "Save lead times"; button.disabled = false; }, 1600); }
  function setAllBrands(active) { const settings = SI.loadBrandSettings(region); allBrandNames().forEach(brand => { settings[brand] = settings[brand] || { active: true, leadTime: "" }; settings[brand].active = active; }); SI.saveBrandSettings(region, settings); items = SI.analyze(dataset.rows, region); renderBrands(); }
  function exportBrands() { const rows = brandRows(); SI.downloadCsv([["Active Brand", "Included", "Lead Time", "Item Count"], ...rows.map(row => [row.brand, row.active !== false ? "Yes" : "No", row.leadTime, row.items])], `Active Brands ${SI.regionCode(region)}.csv`); }

  function renderKpis(id, cards) {
    el(id).innerHTML = cards.map(card => `<button class="inventory-kpi${dashboardFilter === card[3] ? " is-active" : ""}" type="button" data-dashboard-filter="${card[3]}" aria-pressed="${dashboardFilter === card[3]}" title="Filter all dashboard visuals by ${SI.escapeHtml(card[0])}"><span>${card[0]}</span><strong>${card[1]}</strong><small>${card[2]}</small><em>${dashboardFilter === card[3] ? "Filtering dashboard" : "Use as filter"}</em></button>`).join("");
    el(id).querySelectorAll("[data-dashboard-filter]").forEach(button => button.addEventListener("click", () => {
      const next = button.dataset.dashboardFilter;
      dashboardFilter = next !== "all" && dashboardFilter === next ? "all" : next;
      dashboardCrossFilter = null;
      renderDashboard();
    }));
  }
  function renderBarList(id, rows, formatter) { const max = Math.max(1, ...rows.map(row => row.value)); el(id).innerHTML = rows.map(row => `<button type="button" class="bar-list-row${dashboardCrossFilter?.type === "brand" && dashboardCrossFilter.value === row.key ? " is-selected" : ""}" data-brand-filter="${SI.escapeHtml(row.key)}" aria-pressed="${dashboardCrossFilter?.type === "brand" && dashboardCrossFilter.value === row.key}"><span>${SI.escapeHtml(row.key)}</span><div><i style="width:${row.value / max * 100}%"></i></div><strong>${formatter(row.value)}</strong></button>`).join("") || '<div class="empty-box">No reorder units to display.</div>'; el(id).querySelectorAll("[data-brand-filter]").forEach(button => button.addEventListener("click", () => setDashboardCrossFilter("brand", button.dataset.brandFilter))); }
  function rollup(rows, keyFn, valueFn, limit) { const map = new Map(); rows.forEach(row => map.set(keyFn(row), (map.get(keyFn(row)) || 0) + valueFn(row))); return Array.from(map, ([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value || String(a.key).localeCompare(String(b.key))).slice(0, limit); }
  function sum(rows, accessor) { return rows.reduce((total, row) => total + (Number(accessor(row)) || 0), 0); }
  function fillSelect(id, values, label) { el(id).innerHTML = `<option value="">${label}</option>` + values.map(value => `<option value="${SI.escapeHtml(value)}">${SI.escapeHtml(value)}</option>`).join(""); }
  function emptyRow(columns, message) { return `<tr><td colspan="${columns}">${message || "No data matches the current filters."}</td></tr>`; }

  async function refreshSalesSnapshot() {
    if (page !== "dashboard" || !el("sales-sync-detail")) return;
    const snapshot = await loadSalesSnapshot(SI.regionCode(region));
    const analysis = snapshot?.analysis;
    const bridge = el("sales-sync-card");
    bridge?.classList.toggle("is-connected", Boolean(analysis));
    el("bridge-sales-units").textContent = analysis ? number.format(sum(analysis.items || [], item => item.demand9)) : "—";
    el("bridge-forecast").textContent = analysis ? decimal.format(sum(analysis.items || [], item => item.forecast?.next)) : "—";
    el("bridge-replenishment").textContent = analysis ? decimal.format(sum(analysis.items || [], item => item.suggestedQty)) : "—";
    el("sales-sync-detail").textContent = analysis
      ? `${snapshot.sales?.fileName || "Sales report"} • ${number.format((analysis.items || []).length)} active-brand models • Live sync on`
      : "No linked Sales Analysis is available for this region yet.";
  }

  async function loadSalesSnapshot(regionCode) {
    if (!window.indexedDB) return null;
    return new Promise(resolve => {
      const request = indexedDB.open("stark-sales-intelligence-v1", 1);
      request.onerror = () => resolve(null);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("regional-sales")) request.result.createObjectStore("regional-sales"); };
      request.onsuccess = () => {
        const db = request.result;
        try {
          const tx = db.transaction("regional-sales", "readonly"), get = tx.objectStore("regional-sales").get(regionCode);
          get.onsuccess = () => { resolve(get.result || null); db.close(); };
          get.onerror = () => { resolve(null); db.close(); };
        } catch (_) { resolve(null); db.close(); }
      };
    });
  }

  function initLiveSync() {
    const receive = message => {
      if (!message || message.nonce === lastSyncNonce || message.region !== SI.regionCode(region)) return;
      lastSyncNonce = message.nonce || "";
      clearTimeout(syncTimer);
      syncTimer = window.setTimeout(() => refreshLinkedData(message), 80);
    };
    try {
      if ("BroadcastChannel" in window) {
        syncChannel = new BroadcastChannel(SYNC_CHANNEL);
        syncChannel.addEventListener("message", event => receive(event.data));
      }
    } catch (_) {}
    window.addEventListener("storage", event => {
      if (event.key !== SYNC_PULSE_KEY || !event.newValue) return;
      try { receive(JSON.parse(event.newValue)); } catch (_) {}
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && page === "dashboard") refreshLinkedData({ source: "visibility", region: SI.regionCode(region) });
    });
  }

  async function refreshLinkedData(message) {
    if (page !== "dashboard") return;
    if (message.source === "sales") { await refreshSalesSnapshot(); return; }
    dataset = await SI.loadDataset(region);
    items = dataset ? SI.analyze(dataset.rows, region) : [];
    renderDataNote();
    renderDashboard();
    await refreshSalesSnapshot();
  }

  function initPageTransitions() {
    document.querySelectorAll(".inventory-nav a, .workspace-back").forEach(link => {
      link.addEventListener("click", event => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target === "_blank") return;
        const destination = new URL(link.href, location.href);
        if (destination.origin !== location.origin) return;
        event.preventDefault();
        link.classList.add("tab-pressed");
        const supportsNavigationTransition = typeof document.startViewTransition === "function" && CSS.supports("view-transition-name: inventory-active-tab");
        if (supportsNavigationTransition) {
          location.href = destination.href;
          return;
        }
        document.body.classList.add("page-leaving");
        window.setTimeout(() => { location.href = destination.href; }, 120);
      });
    });
  }
})();
