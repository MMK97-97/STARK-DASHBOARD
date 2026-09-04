(function () {
  "use strict";

  const SI = window.StarkInventory;
  const region = "EU";
  const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const el = id => document.getElementById(id);
  let rows = [];

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    SI.initFrame("ats");
    rows = Object.entries(SI.loadAtsSettings(region)).map(([model, quantity]) => ({ model, quantity: Number(quantity) || 0 }));
    bindEvents();
    render();
    initPageTransitions();
  }

  function bindEvents() {
    el("ats-entry-form").addEventListener("submit", addOrUpdate);
    el("ats-search").addEventListener("input", render);
    el("save-ats").addEventListener("click", saveRows);
    el("export-ats").addEventListener("click", exportRows);
    el("ats-file").addEventListener("change", importFile);
    el("clear-ats").addEventListener("click", clearRows);
  }

  function normalizeModel(value) {
    return SI.cleanText(value).toUpperCase();
  }

  function addOrUpdate(event) {
    event.preventDefault();
    const model = normalizeModel(el("ats-model").value);
    const quantity = Math.max(0, Math.floor(Number(el("ats-quantity").value)));
    if (!model) return el("ats-model").focus();
    if (!Number.isFinite(quantity)) return el("ats-quantity").focus();
    const existing = rows.find(row => row.model === model);
    if (existing) existing.quantity = quantity;
    else rows.push({ model, quantity });
    rows.sort((a, b) => a.model.localeCompare(b.model));
    el("ats-entry-form").reset();
    el("ats-model").focus();
    render();
    setDirty(true);
  }

  function visibleRows() {
    const search = el("ats-search").value.trim().toLowerCase();
    return rows.filter(row => !search || row.model.toLowerCase().includes(search));
  }

  function render() {
    const visible = visibleRows();
    el("ats-result-count").textContent = `${number.format(visible.length)} of ${number.format(rows.length)} models`;
    el("ats-file-status").textContent = rows.length ? `${number.format(rows.length)} ATS models saved for ${SI.regionName(region)}` : `No ATS quantities saved for ${SI.regionName(region)}`;
    el("ats-file-status").classList.toggle("ready", rows.length > 0);
    el("ats-table").innerHTML = visible.length ? visible.map(row => `
      <tr data-ats-row="${SI.escapeHtml(row.model)}">
        <td><strong>${SI.escapeHtml(row.model)}</strong></td>
        <td class="num"><input class="ats-quantity-input" type="number" min="0" step="1" value="${row.quantity}" data-ats-quantity="${SI.escapeHtml(row.model)}" aria-label="Quantity for ${SI.escapeHtml(row.model)}"></td>
        <td class="ats-action-cell"><button class="button button-ghost ats-remove" type="button" data-remove-ats="${SI.escapeHtml(row.model)}">Remove</button></td>
      </tr>`).join("") : `<tr><td colspan="3" class="ats-empty-row">No ATS models match the current search.</td></tr>`;
    document.querySelectorAll("[data-ats-quantity]").forEach(input => input.addEventListener("input", updateQuantity));
    document.querySelectorAll("[data-remove-ats]").forEach(button => button.addEventListener("click", removeRow));
  }

  function updateQuantity(event) {
    const model = event.target.dataset.atsQuantity;
    const row = rows.find(item => item.model === model);
    if (row) row.quantity = Math.max(0, Math.floor(Number(event.target.value) || 0));
    setDirty(true);
  }

  function removeRow(event) {
    const model = event.currentTarget.dataset.removeAts;
    rows = rows.filter(row => row.model !== model);
    render();
    setDirty(true);
  }

  function saveRows() {
    const values = {};
    rows.forEach(row => { values[row.model] = Math.max(0, Math.floor(Number(row.quantity) || 0)); });
    SI.saveAtsSettings(region, values);
    setDirty(false);
    const button = el("save-ats");
    button.textContent = "Saved ✓";
    button.disabled = true;
    window.setTimeout(() => { button.textContent = "Save ATS"; button.disabled = false; }, 1400);
    render();
  }

  function clearRows() {
    if (!rows.length || !confirm(`Clear every ATS model saved for ${SI.regionName(region)}?`)) return;
    rows = [];
    SI.saveAtsSettings(region, {});
    render();
    setDirty(false);
  }

  function exportRows() {
    SI.downloadCsv([["Model#", "Quantity"], ...rows.map(row => [row.model, row.quantity])], `ATS ${SI.regionCode(region)}.csv`);
  }

  async function importFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const imported = await readTwoColumnFile(file);
      if (!imported.length) throw new Error("No Model# and Quantity rows were found.");
      const merged = new Map(rows.map(row => [row.model, row.quantity]));
      imported.forEach(row => merged.set(row.model, row.quantity));
      rows = Array.from(merged, ([model, quantity]) => ({ model, quantity })).sort((a, b) => a.model.localeCompare(b.model));
      render();
      setDirty(true);
    } catch (error) {
      alert(`ATS import: ${error.message}`);
    } finally {
      event.target.value = "";
    }
  }

  async function readTwoColumnFile(file) {
    const extension = String(file.name || "").split(".").pop().toLowerCase();
    let source = [];
    if (["csv", "tsv"].includes(extension)) {
      const delimiter = extension === "tsv" ? "\t" : ",";
      source = parseDelimited(await file.text(), delimiter);
    } else {
      if (!window.XLSX) throw new Error("The Excel reader is still loading. Please try again in a moment.");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      source = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    }
    return normalizeImportedRows(source);
  }

  function parseDelimited(text, delimiter) {
    const lines = String(text).replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim());
    if (!lines.length) return [];
    const split = line => line.split(delimiter).map(cell => cell.trim().replace(/^"|"$/g, "").replace(/""/g, '"'));
    const headers = split(lines.shift());
    return lines.map(line => Object.fromEntries(headers.map((header, index) => [header, split(line)[index] || ""])));
  }

  function normalizeImportedRows(source) {
    if (!source.length) return [];
    const headers = Object.keys(source[0]);
    const modelHeader = headers.find(header => /^(model\s*#?|sku|item\s*#?)$/i.test(header.trim())) || headers[0];
    const quantityHeader = headers.find(header => /^(quantity|qty|ats)$/i.test(header.trim())) || headers[1];
    return source.map(item => ({
      model: normalizeModel(item[modelHeader]),
      quantity: Math.max(0, Math.floor(Number(String(item[quantityHeader]).replace(/,/g, "")) || 0))
    })).filter(item => item.model);
  }

  function setDirty(dirty) {
    el("ats-save-state").textContent = dirty ? "Unsaved changes" : "All changes saved";
    el("ats-save-state").classList.toggle("is-dirty", dirty);
  }

  function initPageTransitions() {
    document.querySelectorAll(".inventory-nav a, .inventory-brand").forEach(link => link.addEventListener("click", event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
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
    }));
  }
})();
