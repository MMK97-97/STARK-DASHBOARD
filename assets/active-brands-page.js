(() => {
  "use strict";

  const body = document.body;
  const REGION = body.dataset.region || "US";
  const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const el = id => document.getElementById(id);
  let SI;
  let dataset = null;
  let currentPage = 1;
  let pageSize = 10;

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    SI = window.StarkInventory;
    SI.initFrame("brands");
    dataset = await SI.loadDataset(REGION);
    if (dataset) SI.ensureBrandSettings(REGION, rows());
    renderFileStatus();
    bindEvents();
    renderBrands();
  }

  function rows() {
    return dataset?.rows || [];
  }

  function settings() {
    return SI.loadBrandSettings(REGION);
  }

  function allNames() {
    return SI.unique([...rows().map(row => row.brand), ...Object.keys(settings())])
      .filter(Boolean)
      .sort((a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: "base", numeric: true }));
  }

  function displayed() {
    const saved = settings();
    const search = el("brand-search").value.trim().toLowerCase();
    return allNames()
      .filter(brand => !search || brand.toLowerCase().includes(search))
      .map(brand => {
        const itemCount = rows().filter(row => String(row.brand).toLowerCase() === brand.toLowerCase()).length;
        return {
          brand,
          ...(saved[brand] || { active: true, leadTime: "" }),
          items: itemCount,
          source: itemCount > 0 ? "System" : "Manual"
        };
      });
  }

  function bindEvents() {
    el("brand-search").addEventListener("input", () => {
      currentPage = 1;
      renderBrands();
    });
    el("add-brand").addEventListener("click", addBrand);
    el("activate-all").addEventListener("click", () => setAll(true));
    el("deactivate-all").addEventListener("click", () => setAll(false));
    el("save-lead-times").addEventListener("click", saveLeadTimes);
    el("export-brands").addEventListener("click", exportBrands);
    el("brand-page-size").addEventListener("change", event => {
      pageSize = Number(event.target.value) || 10;
      currentPage = 1;
      renderBrands();
    });
  }

  function renderFileStatus() {
    const status = el("brand-file-status");
    const title = status.querySelector("strong");
    const detail = status.querySelector("small");
    title.textContent = dataset ? "Live Data Active" : "Waiting for report";
    detail.textContent = dataset
      ? `${dataset.fileName} • ${number.format(rows().length)} items`
      : "Upload an Item Sales Report to begin";
    status.classList.toggle("ready", Boolean(dataset));
  }

  function renderBrands() {
    const list = displayed();
    const pageCount = Math.max(1, Math.ceil(list.length / pageSize));
    currentPage = Math.min(currentPage, pageCount);
    const start = (currentPage - 1) * pageSize;
    const visible = list.slice(start, start + pageSize);
    const tbody = el("brands-table");

    tbody.innerHTML = visible.length
      ? visible.map(row => {
          const safeBrand = SI.escapeHtml(row.brand);
          const active = row.active !== false;
          const manual = row.source === "Manual";
          return `<tr>
            <td><label class="brand-check" title="Include ${safeBrand} in reorder analysis"><input type="checkbox" aria-label="Include ${safeBrand}" data-brand-active="${safeBrand}" ${active ? "checked" : ""}></label></td>
            <td><strong>${safeBrand}</strong></td>
            <td>${number.format(row.items)}</td>
            <td><input class="lead-time-input" data-brand-lead="${safeBrand}" value="${SI.escapeHtml(row.leadTime)}" placeholder="e.g. 2 weeks" aria-label="Lead time for ${safeBrand}"></td>
            <td><span class="brand-status ${active ? "is-active" : "is-inactive"}" data-brand-status="${safeBrand}">${active ? "Active" : "Inactive"}</span></td>
            <td><span class="brand-source ${manual ? "is-manual" : ""}">${row.source}</span></td>
            <td><button class="brand-save" type="button" data-brand-save="${safeBrand}">Save</button></td>
          </tr>`;
        }).join("")
      : `<tr><td class="brand-empty" colspan="7">No brands match the current search. Select Add brand to create one.</td></tr>`;

    const end = Math.min(start + visible.length, list.length);
    el("brand-result-count").textContent = list.length
      ? `Showing ${number.format(start + 1)}–${number.format(end)} of ${number.format(list.length)} brands`
      : "Showing 0 brands";
    bindRowEvents();
    renderPagination(pageCount);
  }

  function bindRowEvents() {
    document.querySelectorAll("[data-brand-active]").forEach(input => input.addEventListener("change", saveActive));
    document.querySelectorAll("[data-brand-lead]").forEach(input => input.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        saveRow(input.dataset.brandLead);
      }
    }));
    document.querySelectorAll("[data-brand-save]").forEach(button => button.addEventListener("click", () => saveRow(button.dataset.brandSave)));
  }

  function renderPagination(pageCount) {
    const container = el("brand-page-buttons");
    const pages = paginationRange(currentPage, pageCount);
    container.innerHTML = `
      <button type="button" data-page="${currentPage - 1}" ${currentPage === 1 ? "disabled" : ""} aria-label="Previous page">‹</button>
      ${pages.map(page => page === "…"
        ? `<button type="button" disabled aria-hidden="true">…</button>`
        : `<button type="button" data-page="${page}" class="${page === currentPage ? "active" : ""}" ${page === currentPage ? 'aria-current="page"' : ""}>${page}</button>`).join("")}
      <button type="button" data-page="${currentPage + 1}" ${currentPage === pageCount ? "disabled" : ""} aria-label="Next page">›</button>`;
    container.querySelectorAll("button[data-page]:not(:disabled)").forEach(button => button.addEventListener("click", () => {
      currentPage = Number(button.dataset.page);
      renderBrands();
      document.querySelector(".brand-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
  }

  function paginationRange(page, count) {
    if (count <= 7) return Array.from({ length: count }, (_, index) => index + 1);
    if (page <= 4) return [1, 2, 3, 4, 5, "…", count];
    if (page >= count - 3) return [1, "…", count - 4, count - 3, count - 2, count - 1, count];
    return [1, "…", page - 1, page, page + 1, "…", count];
  }

  function addBrand() {
    const value = window.prompt("Enter the new brand name:");
    const brand = SI.cleanText(value);
    if (!brand) return;
    const existing = allNames().find(name => name.toLowerCase() === brand.toLowerCase());
    if (existing) {
      el("brand-search").value = existing;
      currentPage = 1;
      renderBrands();
      window.alert(`${existing} is already in the ${SI.regionName(REGION)} brand list.`);
      return;
    }
    const saved = settings();
    saved[brand] = { active: true, leadTime: "" };
    SI.saveBrandSettings(REGION, saved);
    el("brand-search").value = brand;
    currentPage = 1;
    renderBrands();
    const input = document.querySelector(`[data-brand-lead="${CSS.escape(brand)}"]`);
    input?.focus();
  }

  function saveActive(event) {
    const saved = settings();
    const brand = event.target.dataset.brandActive;
    saved[brand] = saved[brand] || { active: true, leadTime: "" };
    saved[brand].active = event.target.checked;
    SI.saveBrandSettings(REGION, saved);
    const status = Array.from(document.querySelectorAll("[data-brand-status]")).find(node => node.dataset.brandStatus === brand);
    if (status) {
      status.textContent = event.target.checked ? "Active" : "Inactive";
      status.className = `brand-status ${event.target.checked ? "is-active" : "is-inactive"}`;
    }
  }

  function saveRow(brand) {
    const saved = settings();
    const lead = Array.from(document.querySelectorAll("[data-brand-lead]")).find(input => input.dataset.brandLead === brand);
    const active = Array.from(document.querySelectorAll("[data-brand-active]")).find(input => input.dataset.brandActive === brand);
    saved[brand] = saved[brand] || { active: true, leadTime: "" };
    if (lead) saved[brand].leadTime = lead.value.trim();
    if (active) saved[brand].active = active.checked;
    SI.saveBrandSettings(REGION, saved);
    const button = Array.from(document.querySelectorAll("[data-brand-save]")).find(node => node.dataset.brandSave === brand);
    flashSaved(button);
  }

  function saveLeadTimes() {
    const saved = settings();
    document.querySelectorAll("[data-brand-lead]").forEach(input => {
      const brand = input.dataset.brandLead;
      saved[brand] = saved[brand] || { active: true, leadTime: "" };
      saved[brand].leadTime = input.value.trim();
    });
    SI.saveBrandSettings(REGION, saved);
    flashSaved(el("save-lead-times"), "Saved ✓", "Save lead times");
  }

  function flashSaved(button, savedText = "Saved ✓", defaultText = "Save") {
    if (!button) return;
    button.textContent = savedText;
    button.disabled = true;
    window.setTimeout(() => {
      button.textContent = defaultText;
      button.disabled = false;
    }, 1200);
  }

  function setAll(active) {
    const saved = settings();
    allNames().forEach(brand => {
      saved[brand] = saved[brand] || { active: true, leadTime: "" };
      saved[brand].active = active;
    });
    SI.saveBrandSettings(REGION, saved);
    renderBrands();
  }

  function exportBrands() {
    const list = displayed();
    SI.downloadCsv([
      ["Active Brand", "Included", "Lead Time", "Item Count", "Status", "Source"],
      ...list.map(row => [row.brand, row.active !== false ? "Yes" : "No", row.leadTime, row.items, row.active !== false ? "Active" : "Inactive", row.source])
    ], `Active Brands ${SI.regionCode(REGION)}.csv`);
  }
})();
