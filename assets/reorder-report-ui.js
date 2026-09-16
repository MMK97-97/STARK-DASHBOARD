(() => {
  "use strict";

  const tableBody = document.getElementById("reorder-table");
  const table = tableBody?.closest("table");
  const pagination = document.getElementById("reorder-pagination");
  if (!tableBody || !table || !pagination) return;

  const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
  let page = 1;
  let pageSize = 8;

  const normalize = value => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  const numericValue = value => {
    const parsed = Number(String(value || "").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const headings = () => Array.from(table.tHead?.rows[0]?.cells || []).map(cell => normalize(cell.textContent));
  const columnIndex = (headers, tests) => headers.findIndex(header => tests.some(test => header.includes(test)));
  const rows = () => Array.from(tableBody.rows).filter(row => !row.cells[0]?.hasAttribute("colspan"));
  const setText = (id, value) => {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  };

  function summary(dataRows) {
    const headers = headings();
    const brandIndex = columnIndex(headers, ["brand"]);
    const supplierIndex = columnIndex(headers, ["open supplier qty"]);
    const recommendedIndex = columnIndex(headers, ["recommended reorder qty"]);
    const brands = new Set();
    let recommended = 0;
    let inTransit = 0;

    dataRows.forEach(row => {
      if (brandIndex >= 0) {
        const brand = row.cells[brandIndex]?.textContent.trim();
        if (brand) brands.add(brand.toLocaleLowerCase());
      }
      if (recommendedIndex >= 0) recommended += numericValue(row.cells[recommendedIndex]?.textContent);
      if (supplierIndex >= 0 && numericValue(row.cells[supplierIndex]?.textContent) > 0) inTransit += 1;
    });

    setText("reorder-kpi-items", number.format(dataRows.length));
    setText("reorder-kpi-units", number.format(recommended));
    setText("reorder-kpi-brands", number.format(brands.size));
    setText("reorder-kpi-transit", number.format(inTransit));
  }

  function pageButtons(totalPages) {
    const candidates = new Set([1, totalPages, page - 1, page, page + 1]);
    const visible = Array.from(candidates).filter(value => value >= 1 && value <= totalPages).sort((a, b) => a - b);
    const parts = [];
    visible.forEach((value, index) => {
      if (index && value - visible[index - 1] > 1) parts.push('<span class="reorder-page-gap" aria-hidden="true">…</span>');
      parts.push(`<button type="button" class="reorder-page-number${value === page ? " is-current" : ""}" data-page="${value}" ${value === page ? 'aria-current="page"' : ""}>${value}</button>`);
    });
    return parts.join("");
  }

  function renderPagination(dataRows) {
    const total = dataRows.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    page = Math.min(page, totalPages);
    const first = total ? (page - 1) * pageSize : 0;
    const last = Math.min(first + pageSize, total);

    dataRows.forEach((row, index) => {
      row.hidden = index < first || index >= last;
    });

    pagination.innerHTML = `
      <p>Showing <strong>${total ? first + 1 : 0}–${last}</strong> of <strong>${total}</strong> reorder items</p>
      <div class="reorder-pagination-controls">
        <label>Rows per page
          <select aria-label="Rows per page">
            ${[8, 12, 20, 50].map(value => `<option value="${value}"${value === pageSize ? " selected" : ""}>${value}</option>`).join("")}
          </select>
        </label>
        <button type="button" class="reorder-page-arrow" data-step="-1" aria-label="Previous page" ${page === 1 ? "disabled" : ""}>‹</button>
        ${pageButtons(totalPages)}
        <button type="button" class="reorder-page-arrow" data-step="1" aria-label="Next page" ${page === totalPages ? "disabled" : ""}>›</button>
      </div>`;

    pagination.querySelector("select")?.addEventListener("change", event => {
      pageSize = Number(event.target.value) || 8;
      page = 1;
      render();
    });
    pagination.querySelectorAll("[data-page]").forEach(button => button.addEventListener("click", () => {
      page = Number(button.dataset.page);
      render();
      table.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
    pagination.querySelectorAll("[data-step]").forEach(button => button.addEventListener("click", () => {
      page = Math.max(1, Math.min(totalPages, page + Number(button.dataset.step)));
      render();
      table.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
  }

  function render(resetPage = false) {
    if (resetPage) page = 1;
    const dataRows = rows();
    summary(dataRows);
    renderPagination(dataRows);
  }

  new MutationObserver(() => render(true)).observe(tableBody, { childList: true });
  window.addEventListener("pageshow", () => render(false));
  render(false);
})();
