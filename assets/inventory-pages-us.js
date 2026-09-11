(function () {
  "use strict";

  const SI = window.StarkInventory;
  const page = document.body.dataset.page || "inventory";
  const region = "US";
  SI.initFrame(page);
  let dataset = null, items = [];
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
    clearButton.addEventListener("click", async () => { if (!confirm(`Clear the ${SI.regionName(region)} inventory report stored in this browser?`)) return; await SI.clearDataset(region); dataset = null; items = []; renderDataNote(); renderDashboard(); });
    el("save-inventory-settings").addEventListener("click", () => {
      const next = {}; ["critical", "coverage", "delay", "a", "b"].forEach(key => next[key] = Number(el(`setting-${key}`).value));
      if (next.a <= 0 || next.a >= next.b || next.b > 100) return alert("ABC thresholds must satisfy A < B and B ≤ 100.");
      SI.saveSettings(region, next); items = dataset ? SI.analyze(dataset.rows, region) : []; renderDashboard();
    });
    renderDashboard();
  }

  function renderDashboard() {
    const active = items.filter(item => item.activeBrand), reorders = active.filter(item => item.reorderRequired), totalAvailable = sum(active, item => item.available), totalDemand = sum(active, item => item.avg3), reorderUnits = sum(reorders, item => item.recommended);
    renderKpis("dashboard-kpis", [
      ["Items", number.format(active.length), `${SI.unique(active.map(item => item.brand)).length} active brands`],
      ["Stock available", number.format(totalAvailable), "Current available inventory"],
      ["Average monthly demand", number.format(totalDemand), "Past three-month run rate"],
      ["Reorder items", number.format(reorders.length), "Live, Fashion and Backorder"],
      ["Recommended units", number.format(reorderUnits), "Based on average monthly sales"],
      ["Inactive-brand items", number.format(items.filter(item => !item.activeBrand).length), "Excluded from reorder"]
    ]);
    renderAbcSummary(active);
    const byBrand = rollup(reorders, item => item.brand, item => item.recommended, 10);
    renderBarList("reorder-brand-bars", byBrand, value => number.format(value));
    const attention = reorders.slice().sort((a, b) => b.recommended - a.recommended).slice(0, 8);
    el("attention-table").innerHTML = attention.map(item => `<tr><td>${SI.escapeHtml(item.model)}</td><td>${SI.escapeHtml(item.brand)}</td><td>${SI.escapeHtml(item.product)}</td><td class="num">${number.format(item.available)}</td><td class="num">${decimal.format(item.avg3)}</td><td class="num">${number.format(item.recommended)}</td><td>${SI.escapeHtml(item.reorderReason)}</td></tr>`).join("") || emptyRow(7);
  }

  function renderAbcSummary(rows) {
    const counts = ["A", "B", "C"].map(code => ({ code, value: rows.filter(item => item.abc === code).length })), total = counts.reduce((sumValue, item) => sumValue + item.value, 0) || 1;
    el("abc-summary").innerHTML = counts.map(item => `<div class="abc-summary-row"><span class="class-badge class-${item.code.toLowerCase()}">${item.code}</span><div><strong>${number.format(item.value)} items</strong><small>${percent.format(item.value / total)} of active items</small></div></div>`).join("");
    el("abc-donut-css").style.background = `conic-gradient(#0b8f87 0 ${counts[0].value / total * 100}%, #f59e0b ${counts[0].value / total * 100}% ${(counts[0].value + counts[1].value) / total * 100}%, #dc5a64 ${(counts[0].value + counts[1].value) / total * 100}% 100%)`;
    el("abc-donut-total").textContent = number.format(total === 1 && !rows.length ? 0 : total);
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

  function renderKpis(id, cards) { el(id).innerHTML = cards.map(card => `<article class="inventory-kpi"><span>${card[0]}</span><strong>${card[1]}</strong><small>${card[2]}</small></article>`).join(""); }
  function renderBarList(id, rows, formatter) { const max = Math.max(1, ...rows.map(row => row.value)); el(id).innerHTML = rows.map(row => `<div class="bar-list-row"><span>${SI.escapeHtml(row.key)}</span><div><i style="width:${row.value / max * 100}%"></i></div><strong>${formatter(row.value)}</strong></div>`).join("") || '<div class="empty-box">No reorder units to display.</div>'; }
  function rollup(rows, keyFn, valueFn, limit) { const map = new Map(); rows.forEach(row => map.set(keyFn(row), (map.get(keyFn(row)) || 0) + valueFn(row))); return Array.from(map, ([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value).slice(0, limit); }
  function sum(rows, accessor) { return rows.reduce((total, row) => total + (Number(accessor(row)) || 0), 0); }
  function fillSelect(id, values, label) { el(id).innerHTML = `<option value="">${label}</option>` + values.map(value => `<option value="${SI.escapeHtml(value)}">${SI.escapeHtml(value)}</option>`).join(""); }
  function emptyRow(columns, message) { return `<tr><td colspan="${columns}">${message || "No data matches the current filters."}</td></tr>`; }

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
