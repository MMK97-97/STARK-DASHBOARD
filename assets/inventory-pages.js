(function () {
  "use strict";

  const SI = window.StarkInventory;
  const page = document.body.dataset.page || "inventory";
  const region = SI.initFrame(page);
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
    const fileInput = el("item-file"), uploadButton = el("upload-item-report"), clearButton = el("clear-inventory-data"), settings = SI.loadSettings(region);
    ["critical", "coverage", "delay", "a", "b"].forEach(key => { const input = el(`setting-${key}`); if (input) input.value = settings[key]; });
    uploadButton.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async event => {
      const file = event.target.files[0]; if (!file) return;
      uploadButton.disabled = true; uploadButton.textContent = "Reading report…";
      try {
        const sourceRows = await SI.readReportFile(file), normalized = SI.normalizeItemRows(sourceRows);
        if (!normalized.length) throw new Error("No usable inventory rows were found.");
        dataset = { fileName: file.name, importedAt: new Date().toISOString(), rows: normalized };
        await SI.saveDataset(region, dataset); SI.ensureBrandSettings(region, normalized); items = SI.analyze(normalized, region); renderDataNote(); renderDashboard();
      } catch (error) { alert(`Item Sales Report: ${error.message}`); }
      finally { uploadButton.disabled = false; uploadButton.textContent = "Upload Item Sales Report"; fileInput.value = ""; }
    });
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
    if (!dataset) return;
    fillSelect("raw-brand", SI.unique(items.map(item => item.brand)), "All brands"); fillSelect("raw-status", SI.unique(items.map(item => item.status)), "All statuses");
    ["raw-brand", "raw-status", "raw-abc"].forEach(id => el(id).addEventListener("change", renderRaw)); el("raw-search").addEventListener("input", renderRaw); el("export-raw").addEventListener("click", exportRaw); renderRaw();
  }

  function filteredRaw() { const brand = el("raw-brand").value, status = el("raw-status").value, abc = el("raw-abc").value, search = el("raw-search").value.trim().toLowerCase(); return items.filter(item => (!brand || item.brand === brand) && (!status || item.status === status) && (!abc || item.abc === abc) && (!search || `${item.model} ${item.product} ${item.itemid}`.toLowerCase().includes(search))); }
  function renderRaw() { const rows = filteredRaw(); el("raw-result-count").textContent = `${number.format(rows.length)} of ${number.format(items.length)} items`; el("raw-table").innerHTML = rows.map(item => `<tr><td>${SI.escapeHtml(item.brand)}</td><td>${SI.escapeHtml(item.itemid)}</td><td>${SI.escapeHtml(item.model)}</td><td>${SI.escapeHtml(item.product)}</td><td>${SI.escapeHtml(item.status)}</td><td>${SI.dateText(item.eta)}</td><td class="num">${number.format(item.vol3)}</td><td class="num">${number.format(item.last30)}</td><td class="num">${decimal.format(item.avg3)}</td><td class="num">${number.format(item.stockQty)}</td><td class="num">${number.format(item.available)}</td><td class="num">${number.format(item.openClient)}</td><td class="num">${number.format(item.openSupplier)}</td><td>${SI.escapeHtml(item.supplierWindow)}</td><td><span class="class-badge class-${item.abc.toLowerCase()}">${item.abc}</span></td></tr>`).join("") || emptyRow(15); }
  function exportRaw() { const rows = filteredRaw(), headers = ["Brand", "Item ID", "Model#", "Item Title", "Status", "ETA", "Vol Past 3M", "Vol Last 30 Days", "Avg/PerM Past 3M", "Stock Qty", "Stock Available", "Open Client", "Open Supplier", "Supplier Window", "ABC Class"]; SI.downloadCsv([headers, ...rows.map(item => [item.brand, item.itemid, item.model, item.product, item.status, SI.dateText(item.eta), item.vol3, item.last30, item.avg3, item.stockQty, item.available, item.openClient, item.openSupplier, item.supplierWindow, item.abc])], `Raw Report ${SI.regionCode(region)}.csv`); }

  function initReorder() {
    if (!dataset) return;
    const reorders = items.filter(item => item.reorderRequired); fillSelect("reorder-brand", SI.unique(reorders.map(item => item.brand)), "All brands"); el("reorder-brand").addEventListener("change", renderReorder); el("reorder-search").addEventListener("input", renderReorder); el("export-reorder-csv").addEventListener("click", exportReorderCsv); el("export-reorder-xlsx").addEventListener("click", exportReorderXlsx); renderReorder();
  }
  function filteredReorders() { const brand = el("reorder-brand").value, search = el("reorder-search").value.trim().toLowerCase(); return items.filter(item => item.reorderRequired && (!brand || item.brand === brand) && (!search || `${item.model} ${item.product}`.toLowerCase().includes(search))).sort((a, b) => b.recommended - a.recommended); }
  function reorderArray(rows) { return rows.map(item => [item.model, item.brand, item.product, item.status, item.openClient, item.stockQty, item.available, item.openSupplier, item.supplierWindow, item.daysUntil == null ? "" : item.daysUntil, item.recommended, "REORDER", SI.dateText(item.supplierStart), SI.dateText(item.supplierEnd), item.reorderReason]); }
  const reorderHeaders = ["Model#", "Brand", "Item Title", "Status", "OPEN ORDERS FROM CLIENT", "ON HAND", "Stock Available", "Open Supplier Qty", "Supplier Delivery Window", "Days Until Supplier Delivery", "Recommended Reorder Qty", "Reorder Status", "Earlier Start Date", "Latest End Date", "Reorder Reason"];
  function renderReorder() { const rows = filteredReorders(); el("reorder-result-count").textContent = `${number.format(rows.length)} reorder items • ${number.format(sum(rows, item => item.recommended))} recommended units`; el("reorder-table").innerHTML = reorderArray(rows).map(row => `<tr>${row.map((value, index) => `<td${[4,5,6,7,9,10].includes(index) ? ' class="num"' : ""}>${index === 11 ? '<span class="status status-risk">REORDER</span>' : SI.escapeHtml(value)}</td>`).join("")}</tr>`).join("") || emptyRow(15, "No reorder-required items match the filters."); }
  function exportReorderCsv() { SI.downloadCsv([reorderHeaders, ...reorderArray(filteredReorders())], `Reorder Report ${SI.regionCode(region)}.csv`); }
  function exportReorderXlsx() { if (!window.XLSX) return alert("The Excel exporter did not load."); const workbook = XLSX.utils.book_new(), rows = [[`Reorder Report - ${SI.regionName(region)} / Active Brands / LIVE, FASHION, BACKORDER`], [], reorderHeaders, ...reorderArray(filteredReorders())], sheet = XLSX.utils.aoa_to_sheet(rows); sheet["!cols"] = [20,20,55,14,20,12,16,18,28,18,22,15,17,17,65].map(wch => ({ wch })); XLSX.utils.book_append_sheet(workbook, sheet, "REORDER REPORT"); XLSX.writeFile(workbook, `Reorder Report ${SI.regionCode(region)}.xlsx`, { compression: true }); }

  function initBrands() {
    if (!dataset) return;
    ensureBrands(); el("brand-search").addEventListener("input", renderBrands); el("activate-all").addEventListener("click", () => setAllBrands(true)); el("deactivate-all").addEventListener("click", () => setAllBrands(false)); el("export-brands").addEventListener("click", exportBrands); renderBrands();
  }
  function ensureBrands() { SI.ensureBrandSettings(region, dataset.rows); }
  function brandRows() { const settings = SI.loadBrandSettings(region), search = el("brand-search").value.trim().toLowerCase(); return SI.unique(dataset.rows.map(row => row.brand)).filter(brand => !search || brand.toLowerCase().includes(search)).map(brand => ({ brand, ...(settings[brand] || { active: true, leadTime: "" }), items: dataset.rows.filter(row => row.brand === brand).length })); }
  function renderBrands() { const rows = brandRows(); el("brand-result-count").textContent = `${number.format(rows.filter(row => row.active !== false).length)} active of ${number.format(rows.length)} displayed brands`; el("brands-table").innerHTML = rows.map(row => `<tr><td><label class="switch-label"><input type="checkbox" data-brand-active="${SI.escapeHtml(row.brand)}" ${row.active !== false ? "checked" : ""}><span>Active</span></label></td><td><strong>${SI.escapeHtml(row.brand)}</strong></td><td class="num">${number.format(row.items)}</td><td><input class="lead-time-input" data-brand-lead="${SI.escapeHtml(row.brand)}" value="${SI.escapeHtml(row.leadTime)}" placeholder="e.g. 2 weeks"></td></tr>`).join("") || emptyRow(4); document.querySelectorAll("[data-brand-active]").forEach(input => input.addEventListener("change", saveBrandRow)); document.querySelectorAll("[data-brand-lead]").forEach(input => input.addEventListener("change", saveBrandRow)); }
  function saveBrandRow(event) { const settings = SI.loadBrandSettings(region), brand = event.target.dataset.brandActive || event.target.dataset.brandLead; settings[brand] = settings[brand] || { active: true, leadTime: "" }; if (event.target.dataset.brandActive) settings[brand].active = event.target.checked; else settings[brand].leadTime = event.target.value.trim(); SI.saveBrandSettings(region, settings); items = SI.analyze(dataset.rows, region); renderBrands(); }
  function setAllBrands(active) { const settings = SI.loadBrandSettings(region); SI.unique(dataset.rows.map(row => row.brand)).forEach(brand => { settings[brand] = settings[brand] || { active: true, leadTime: "" }; settings[brand].active = active; }); SI.saveBrandSettings(region, settings); items = SI.analyze(dataset.rows, region); renderBrands(); }
  function exportBrands() { const rows = brandRows(); SI.downloadCsv([["Active Brand", "Included", "Lead Time", "Item Count"], ...rows.map(row => [row.brand, row.active !== false ? "Yes" : "No", row.leadTime, row.items])], `Active Brands ${SI.regionCode(region)}.csv`); }

  function renderKpis(id, cards) { el(id).innerHTML = cards.map(card => `<article class="inventory-kpi"><span>${card[0]}</span><strong>${card[1]}</strong><small>${card[2]}</small></article>`).join(""); }
  function renderBarList(id, rows, formatter) { const max = Math.max(1, ...rows.map(row => row.value)); el(id).innerHTML = rows.map(row => `<div class="bar-list-row"><span>${SI.escapeHtml(row.key)}</span><div><i style="width:${row.value / max * 100}%"></i></div><strong>${formatter(row.value)}</strong></div>`).join("") || '<div class="empty-box">No reorder units to display.</div>'; }
  function rollup(rows, keyFn, valueFn, limit) { const map = new Map(); rows.forEach(row => map.set(keyFn(row), (map.get(keyFn(row)) || 0) + valueFn(row))); return Array.from(map, ([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value).slice(0, limit); }
  function sum(rows, accessor) { return rows.reduce((total, row) => total + (Number(accessor(row)) || 0), 0); }
  function fillSelect(id, values, label) { el(id).innerHTML = `<option value="">${label}</option>` + values.map(value => `<option value="${SI.escapeHtml(value)}">${SI.escapeHtml(value)}</option>`).join(""); }
  function emptyRow(columns, message) { return `<tr><td colspan="${columns}">${message || "No data matches the current filters."}</td></tr>`; }
})();
