(function () {
  "use strict";

  const SI =
    window.StarkInventory;

  const page =
    document.body.dataset.page ||
    "inventory";

  const region =
    SI.initFrame(page);

  let dataset = null;
  let items = [];

  const number =
    new Intl.NumberFormat(
      "en-US",
      {
        maximumFractionDigits: 0
      }
    );

  const decimal =
    new Intl.NumberFormat(
      "en-US",
      {
        maximumFractionDigits: 1
      }
    );

  const percent =
    new Intl.NumberFormat(
      "en-US",
      {
        style: "percent",
        maximumFractionDigits: 1
      }
    );

  const el = id =>
    document.getElementById(id);

  configureInventoryNavigation();

  if (
    document.readyState === "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init
    );
  } else {
    init();
  }

  /*
   * Replace the Inventory Analysis link in the top navigation
   * with a Back button.
   */
  function configureInventoryNavigation() {
    const backLink =
      document.querySelector(
        ".inventory-overview-link"
      );

    if (!backLink) return;

    backLink.textContent =
      "← Back";

    backLink.setAttribute(
      "href",
      "index.html?region=" +
      encodeURIComponent(region)
    );

    backLink.setAttribute(
      "aria-label",
      "Back to regional modules"
    );

    backLink.classList.remove(
      "inventory-overview-link"
    );

    backLink.classList.add(
      "inventory-back-button"
    );

    backLink.style.display =
      "inline-flex";

    backLink.style.alignItems =
      "center";

    backLink.style.justifyContent =
      "center";

    backLink.style.minHeight =
      "40px";

    backLink.style.padding =
      "8px 14px";

    backLink.style.marginRight =
      "12px";

    backLink.style.border =
      "1px solid #b8c8d8";

    backLink.style.borderRadius =
      "8px";

    backLink.style.color =
      "#10233f";

    backLink.style.background =
      "#ffffff";

    backLink.style.fontWeight =
      "700";

    backLink.style.textDecoration =
      "none";

    backLink.style.whiteSpace =
      "nowrap";
  }

  async function init() {
    dataset =
      await SI.loadDataset(region);

    items = dataset
      ? SI.analyze(
          dataset.rows,
          region
        )
      : [];

    renderDataNote();

    if (page === "dashboard") {
      initDashboard();
    }

    if (page === "raw") {
      initRaw();
    }

    if (page === "reorder") {
      initReorder();
    }

    if (page === "brands") {
      initBrands();
    }
  }

  function renderDataNote() {
    document
      .querySelectorAll(
        "[data-file-status]"
      )
      .forEach(node => {
        node.textContent = dataset
          ? `${dataset.fileName} • ${number.format(dataset.rows.length)} items`
          : "No Item Sales Report uploaded";

        node.classList.toggle(
          "ready",
          Boolean(dataset)
        );
      });

    document
      .querySelectorAll(
        "[data-requires-data]"
      )
      .forEach(node => {
        node.classList.toggle(
          "hidden",
          !dataset
        );
      });

    document
      .querySelectorAll(
        "[data-empty-data]"
      )
      .forEach(node => {
        node.classList.toggle(
          "hidden",
          Boolean(dataset)
        );
      });
  }

  function initDashboard() {
    const clearButton =
      el("clear-inventory-data");

    const settings =
      SI.loadSettings(region);

    [
      "critical",
      "coverage",
      "delay",
      "a",
      "b"
    ].forEach(key => {
      const input =
        el(`setting-${key}`);

      if (input) {
        input.value =
          settings[key];
      }
    });

    if (clearButton) {
      clearButton.addEventListener(
        "click",
        async () => {
          const approved =
            confirm(
              `Clear the ${SI.regionName(region)} inventory report stored in this browser?`
            );

          if (!approved) return;

          await SI.clearDataset(
            region
          );

          dataset = null;
          items = [];

          renderDataNote();
          renderDashboard();
        }
      );
    }

    const saveButton =
      el(
        "save-inventory-settings"
      );

    if (saveButton) {
      saveButton.addEventListener(
        "click",
        () => {
          const next = {};

          [
            "critical",
            "coverage",
            "delay",
            "a",
            "b"
          ].forEach(key => {
            next[key] = Number(
              el(
                `setting-${key}`
              ).value
            );
          });

          if (
            next.a <= 0 ||
            next.a >= next.b ||
            next.b > 100
          ) {
            alert(
              "ABC thresholds must satisfy A < B and B ≤ 100."
            );

            return;
          }

          SI.saveSettings(
            region,
            next
          );

          items = dataset
            ? SI.analyze(
                dataset.rows,
                region
              )
            : [];

          renderDashboard();
        }
      );
    }

    renderDashboard();
  }

  function renderDashboard() {
    if (
      !el("dashboard-kpis")
    ) {
      return;
    }

    const active =
      items.filter(
        item => item.activeBrand
      );

    const reorders =
      active.filter(
        item =>
          item.reorderRequired
      );

    const totalAvailable =
      sum(
        active,
        item => item.available
      );

    const totalDemand =
      sum(
        active,
        item => item.avg3
      );

    const reorderUnits =
      sum(
        reorders,
        item => item.recommended
      );

    renderKpis(
      "dashboard-kpis",
      [
        [
          "Items",
          number.format(
            active.length
          ),
          `${SI.unique(
            active.map(
              item => item.brand
            )
          ).length} active brands`
        ],
        [
          "Stock available",
          number.format(
            totalAvailable
          ),
          "Current available inventory"
        ],
        [
          "Average monthly demand",
          number.format(
            totalDemand
          ),
          "Past three-month run rate"
        ],
        [
          "Reorder items",
          number.format(
            reorders.length
          ),
          "Live, Fashion and Backorder"
        ],
        [
          "Recommended units",
          number.format(
            reorderUnits
          ),
          "Based on average monthly sales"
        ],
        [
          "Inactive-brand items",
          number.format(
            items.filter(
              item =>
                !item.activeBrand
            ).length
          ),
          "Excluded from reorder"
        ]
      ]
    );

    renderAbcSummary(active);

    const byBrand =
      rollup(
        reorders,
        item => item.brand,
        item =>
          item.recommended,
        10
      );

    renderBarList(
      "reorder-brand-bars",
      byBrand,
      value =>
        number.format(value)
    );

    const attention =
      reorders
        .slice()
        .sort(
          (a, b) =>
            b.recommended -
            a.recommended
        )
        .slice(0, 8);

    const attentionTable =
      el("attention-table");

    if (attentionTable) {
      attentionTable.innerHTML =
        attention
          .map(item => `
            <tr>
              <td>
                ${SI.escapeHtml(item.model)}
              </td>

              <td>
                ${SI.escapeHtml(item.brand)}
              </td>

              <td>
                ${SI.escapeHtml(item.product)}
              </td>

              <td class="num">
                ${number.format(item.available)}
              </td>

              <td class="num">
                ${decimal.format(item.avg3)}
              </td>

              <td class="num">
                ${number.format(item.recommended)}
              </td>

              <td>
                ${SI.escapeHtml(item.reorderReason)}
              </td>
            </tr>
          `)
          .join("") ||
        emptyRow(7);
    }
  }

  function renderAbcSummary(rows) {
    const summary =
      el("abc-summary");

    const donut =
      el("abc-donut-css");

    const totalNode =
      el("abc-donut-total");

    if (
      !summary ||
      !donut ||
      !totalNode
    ) {
      return;
    }

    const counts =
      ["A", "B", "C"].map(
        code => ({
          code,
          value:
            rows.filter(
              item =>
                item.abc === code
            ).length
        })
      );

    const total =
      counts.reduce(
        (sumValue, item) =>
          sumValue +
          item.value,
        0
      ) || 1;

    summary.innerHTML =
      counts
        .map(item => `
          <div class="abc-summary-row">
            <span class="class-badge class-${item.code.toLowerCase()}">
              ${item.code}
            </span>

            <div>
              <strong>
                ${number.format(item.value)} items
              </strong>

              <small>
                ${percent.format(item.value / total)}
                of active items
              </small>
            </div>
          </div>
        `)
        .join("");

    donut.style.background =
      `conic-gradient(
        #0b8f87 0 ${counts[0].value / total * 100}%,
        #f59e0b ${counts[0].value / total * 100}% ${(counts[0].value + counts[1].value) / total * 100}%,
        #dc5a64 ${(counts[0].value + counts[1].value) / total * 100}% 100%
      )`;

    totalNode.textContent =
      number.format(
        total === 1 &&
        !rows.length
          ? 0
          : total
      );
  }

  function initRaw() {
    const fileInput =
      el("raw-file");

    const uploadButton =
      el("upload-raw-report");

    if (
      !fileInput ||
      !uploadButton
    ) {
      return;
    }

    fileInput.addEventListener(
      "change",
      async event => {
        const file =
          event.target.files[0];

        if (!file) return;

        uploadButton.setAttribute(
          "aria-disabled",
          "true"
        );

        uploadButton.textContent =
          "Reading report…";

        try {
          const sourceRows =
            await SI.readReportFile(
              file
            );

          const normalized =
            SI.normalizeItemRows(
              sourceRows
            );

          if (!normalized.length) {
            throw new Error(
              "No usable inventory rows were found."
            );
          }

          dataset = {
            fileName: file.name,
            importedAt:
              new Date()
                .toISOString(),
            rows: normalized
          };

          await SI.saveDataset(
            region,
            dataset
          );

          SI.ensureBrandSettings(
            region,
            normalized
          );

          location.reload();
        } catch (error) {
          console.error(error);

          alert(
            `Raw Report: ${error.message}`
          );
        } finally {
          uploadButton
            .removeAttribute(
              "aria-disabled"
            );

          uploadButton.textContent =
            "Upload Raw Report";

          fileInput.value = "";
        }
      }
    );

    if (!dataset) return;

    fillSelect(
      "raw-brand",
      SI.unique(
        items.map(
          item => item.brand
        )
      ),
      "All brands"
    );

    fillSelect(
      "raw-status",
      SI.unique(
        items.map(
          item => item.status
        )
      ),
      "All statuses"
    );

    [
      "raw-brand",
      "raw-status",
      "raw-abc"
    ].forEach(id => {
      const control = el(id);

      if (control) {
        control.addEventListener(
          "change",
          renderRaw
        );
      }
    });

    const search =
      el("raw-search");

    if (search) {
      search.addEventListener(
        "input",
        renderRaw
      );
    }

    const exportButton =
      el("export-raw");

    if (exportButton) {
      exportButton.addEventListener(
        "click",
        exportRaw
      );
    }

    renderRaw();
  }

  function filteredRaw() {
    const brand =
      el("raw-brand").value;

    const status =
      el("raw-status").value;

    const abc =
      el("raw-abc").value;

    const search =
      el("raw-search")
        .value
        .trim()
        .toLowerCase();

    return items.filter(
      item =>
        (
          !brand ||
          item.brand === brand
        ) &&
        (
          !status ||
          item.status === status
        ) &&
        (
          !abc ||
          item.abc === abc
        ) &&
        (
          !search ||
          `${item.model} ${item.product} ${item.itemid}`
            .toLowerCase()
            .includes(search)
        )
    );
  }

  function renderRaw() {
    const rows =
      filteredRaw();

    el("raw-result-count")
      .textContent =
        `${number.format(rows.length)} of ${number.format(items.length)} items`;

    el("raw-table").innerHTML =
      rows
        .map(item => `
          <tr>
            <td>
              ${SI.escapeHtml(item.brand)}
            </td>

            <td>
              ${SI.escapeHtml(item.itemid)}
            </td>

            <td>
              ${SI.escapeHtml(item.model)}
            </td>

            <td>
              ${SI.escapeHtml(item.product)}
            </td>

            <td>
              ${SI.escapeHtml(item.status)}
            </td>

            <td>
              ${SI.dateText(item.eta)}
            </td>

            <td class="num">
              ${number.format(item.vol3)}
            </td>

            <td class="num">
              ${number.format(item.last30)}
            </td>

            <td class="num">
              ${decimal.format(item.avg3)}
            </td>

            <td class="num">
              ${number.format(item.stockQty)}
            </td>

            <td class="num">
              ${number.format(item.available)}
            </td>

            <td class="num">
              ${number.format(item.openClient)}
            </td>

            <td class="num">
              ${number.format(item.openSupplier)}
            </td>

            <td>
              ${SI.escapeHtml(item.supplierWindow)}
            </td>

            <td>
              <span class="class-badge class-${item.abc.toLowerCase()}">
                ${item.abc}
              </span>
            </td>
          </tr>
        `)
        .join("") ||
      emptyRow(15);
  }

  function exportRaw() {
    const rows =
      filteredRaw();

    const headers = [
      "Brand",
      "Item ID",
      "Model#",
      "Item Title",
      "Status",
      "ETA",
      "Vol Past 3M",
      "Vol Last 30 Days",
      "Avg/PerM Past 3M",
      "Stock Qty",
      "Stock Available",
      "Open Client",
      "Open Supplier",
      "Supplier Window",
      "ABC Class"
    ];

    SI.downloadCsv(
      [
        headers,
        ...rows.map(
          item => [
            item.brand,
            item.itemid,
            item.model,
            item.product,
            item.status,
            SI.dateText(item.eta),
            item.vol3,
            item.last30,
            item.avg3,
            item.stockQty,
            item.available,
            item.openClient,
            item.openSupplier,
            item.supplierWindow,
            item.abc
          ]
        )
      ],
      `Raw Report ${SI.regionCode(region)}.csv`
    );
  }

  function initReorder() {
    if (!dataset) return;

    const reorders =
      items.filter(
        item =>
          item.reorderRequired
      );

    fillSelect(
      "reorder-brand",
      SI.unique(
        reorders.map(
          item => item.brand
        )
      ),
      "All brands"
    );

    el("reorder-brand")
      .addEventListener(
        "change",
        renderReorder
      );

    el("reorder-search")
      .addEventListener(
        "input",
        renderReorder
      );

    el("export-reorder-csv")
      .addEventListener(
        "click",
        exportReorderCsv
      );

    el("export-reorder-xlsx")
      .addEventListener(
        "click",
        exportReorderXlsx
      );

    renderReorder();
  }

  function rankedReorders() {
    const rows =
      items.filter(
        item =>
          item.reorderRequired
      );

    const ranked =
      rows
        .slice()
        .sort(
          (a, b) =>
            b.recommended -
            a.recommended ||
            a.rawRow -
            b.rawRow
        );

    const ranks =
      new Map(
        ranked.map(
          (item, index) => [
            item.id,
            index + 1
          ]
        )
      );

    return rows.map(
      item => ({
        ...item,
        sortRank:
          ranks.get(item.id)
      })
    );
  }

  function filteredReorders() {
    const brand =
      el("reorder-brand").value;

    const search =
      el("reorder-search")
        .value
        .trim()
        .toLowerCase();

    return rankedReorders()
      .filter(
        item =>
          (
            !brand ||
            item.brand === brand
          ) &&
          (
            !search ||
            `${item.model} ${item.product}`
              .toLowerCase()
              .includes(search)
          )
      );
  }

  function reorderArray(rows) {
    return rows.map(
      item => [
        item.model,
        item.brand,
        item.product,
        item.status,
        item.openClient,
        item.stockQty,
        item.available,
        item.openSupplier,
        item.supplierWindow,
        item.daysUntil == null
          ? ""
          : item.daysUntil,
        item.recommended,
        "REORDER",
        SI.dateText(
          item.supplierStart
        ),
        SI.dateText(
          item.supplierEnd
        ),
        item.reorderReason,
        item.rawRow ||
          item.id + 1,
        item.sortRank
      ]
    );
  }

  const reorderHeaders = [
    "Model#",
    "Brand",
    "Item Title",
    "Status",
    "OPEN ORDERS FROM CLIENT",
    "ON HAND",
    "Stock Available",
    "Open Supplier Qty",
    "Supplier Delivery Window",
    "Days Until Supplier Delivery",
    "Recommended Reorder Qty",
    "Reorder Status",
    "Earlier start date",
    "Latest End Date",
    "Reorder Reason",
    "Raw Row",
    "Sort Rank"
  ];

  function renderReorder() {
    const rows =
      filteredReorders();

    el("reorder-result-count")
      .textContent =
        `${number.format(rows.length)} reorder items • ${number.format(sum(rows, item => item.recommended))} recommended units`;

    el("reorder-table")
      .innerHTML =
        reorderArray(rows)
          .map(row => `
            <tr>
              ${row.map(
                (value, index) => `
                  <td${
                    [
                      4,
                      5,
                      6,
                      7,
                      9,
                      10,
                      15,
                      16
                    ].includes(index)
                      ? ' class="num"'
                      : ""
                  }>
                    ${
                      index === 11
                        ? '<span class="status status-risk">REORDER</span>'
                        : SI.escapeHtml(value)
                    }
                  </td>
                `
              ).join("")}
            </tr>
          `)
          .join("") ||
        emptyRow(
          17,
          "No reorder-required items match the filters."
        );
  }

  function exportReorderCsv() {
    SI.downloadCsv(
      [
        reorderHeaders,
        ...reorderArray(
          filteredReorders()
        )
      ],
      `Reorder Report ${SI.regionCode(region)}.csv`
    );
  }

  function exportReorderXlsx() {
    if (!window.XLSX) {
      alert(
        "The Excel exporter did not load. Refresh the page and try again."
      );

      return;
    }

    const workbook =
      XLSX.utils.book_new();

    const data =
      reorderArray(
        filteredReorders()
      );

    const rows = [
      [
        "Reorder Report - Dynamic Active Brands / Status: LIVE, FASHION, BACKORDER / Reorder Required Only"
      ],
      [
        "Add brands in ACTIVE BRANDS column A. Report updates dynamically from RAW REPORT after recalculation."
      ],
      reorderHeaders,
      ...data
    ];

    const sheet =
      XLSX.utils.aoa_to_sheet(
        rows
      );

    sheet["!cols"] = [
      18,
      20,
      53,
      12,
      11,
      11,
      14,
      16,
      24,
      16,
      18,
      14,
      14,
      14,
      55,
      9,
      9
    ].map(
      wch => ({ wch })
    );

    sheet["!merges"] = [
      {
        s: { r: 0, c: 0 },
        e: { r: 0, c: 14 }
      },
      {
        s: { r: 1, c: 0 },
        e: { r: 1, c: 14 }
      }
    ];

    sheet["!autofilter"] = {
      ref:
        `A3:O${Math.max(
          3,
          data.length + 3
        )}`
    };

    XLSX.utils.book_append_sheet(
      workbook,
      sheet,
      "REORDER REPORT"
    );

    XLSX.writeFile(
      workbook,
      `Reorder Report ${SI.regionCode(region)}.xlsx`,
      {
        compression: true
      }
    );
  }

  function initBrands() {
    if (!dataset) return;

    ensureBrands();

    el("brand-search")
      .addEventListener(
        "input",
        renderBrands
      );

    el("activate-all")
      .addEventListener(
        "click",
        () => setAllBrands(true)
      );

    el("deactivate-all")
      .addEventListener(
        "click",
        () => setAllBrands(false)
      );

    el("export-brands")
      .addEventListener(
        "click",
        exportBrands
      );

    renderBrands();
  }

  function ensureBrands() {
    SI.ensureBrandSettings(
      region,
      dataset.rows
    );
  }

  function brandRows() {
    const settings =
      SI.loadBrandSettings(region);

    const search =
      el("brand-search")
        .value
        .trim()
        .toLowerCase();

    return SI.unique(
      dataset.rows.map(
        row => row.brand
      )
    )
      .filter(
        brand =>
          !search ||
          brand
            .toLowerCase()
            .includes(search)
      )
      .map(
        brand => ({
          brand,
          ...(
            settings[brand] || {
              active: true,
              leadTime: ""
            }
          ),
          items:
            dataset.rows.filter(
              row =>
                row.brand === brand
            ).length
        })
      );
  }

  function renderBrands() {
    const rows =
      brandRows();

    el("brand-result-count")
      .textContent =
        `${number.format(rows.filter(row => row.active !== false).length)} active of ${number.format(rows.length)} displayed brands`;

    el("brands-table")
      .innerHTML =
        rows
          .map(row => `
            <tr>
              <td>
                <label class="switch-label">
                  <input
                    type="checkbox"
                    data-brand-active="${SI.escapeHtml(row.brand)}"
                    ${row.active !== false ? "checked" : ""}
                  >

                  <span>Active</span>
                </label>
              </td>

              <td>
                <strong>
                  ${SI.escapeHtml(row.brand)}
                </strong>
              </td>

              <td class="num">
                ${number.format(row.items)}
              </td>

              <td>
                <input
                  class="lead-time-input"
                  data-brand-lead="${SI.escapeHtml(row.brand)}"
                  value="${SI.escapeHtml(row.leadTime)}"
                  placeholder="e.g. 2 weeks"
                >
              </td>
            </tr>
          `)
          .join("") ||
        emptyRow(4);

    document
      .querySelectorAll(
        "[data-brand-active]"
      )
      .forEach(input => {
        input.addEventListener(
          "change",
          saveBrandRow
        );
      });

    document
      .querySelectorAll(
        "[data-brand-lead]"
      )
      .forEach(input => {
        input.addEventListener(
          "change",
          saveBrandRow
        );
      });
  }

  function saveBrandRow(event) {
    const settings =
      SI.loadBrandSettings(region);

    const brand =
      event.target
        .dataset.brandActive ||
      event.target
        .dataset.brandLead;

    settings[brand] =
      settings[brand] || {
        active: true,
        leadTime: ""
      };

    if (
      event.target
        .dataset.brandActive
    ) {
      settings[brand].active =
        event.target.checked;
    } else {
      settings[brand].leadTime =
        event.target.value.trim();
    }

    SI.saveBrandSettings(
      region,
      settings
    );

    items =
      SI.analyze(
        dataset.rows,
        region
      );

    renderBrands();
  }

  function setAllBrands(active) {
    const settings =
      SI.loadBrandSettings(region);

    SI.unique(
      dataset.rows.map(
        row => row.brand
      )
    ).forEach(brand => {
      settings[brand] =
        settings[brand] || {
          active: true,
          leadTime: ""
        };

      settings[brand].active =
        active;
    });

    SI.saveBrandSettings(
      region,
      settings
    );

    items =
      SI.analyze(
        dataset.rows,
        region
      );

    renderBrands();
  }

  function exportBrands() {
    const rows =
      brandRows();

    SI.downloadCsv(
      [
        [
          "Active Brand",
          "Included",
          "Lead Time",
          "Item Count"
        ],
        ...rows.map(
          row => [
            row.brand,
            row.active !== false
              ? "Yes"
              : "No",
            row.leadTime,
            row.items
          ]
        )
      ],
      `Active Brands ${SI.regionCode(region)}.csv`
    );
  }

  function renderKpis(
    id,
    cards
  ) {
    const container =
      el(id);

    if (!container) return;

    container.innerHTML =
      cards
        .map(card => `
          <article class="inventory-kpi">
            <span>${card[0]}</span>
            <strong>${card[1]}</strong>
            <small>${card[2]}</small>
          </article>
        `)
        .join("");
  }

  function renderBarList(
    id,
    rows,
    formatter
  ) {
    const container =
      el(id);

    if (!container) return;

    const max =
      Math.max(
        1,
        ...rows.map(
          row => row.value
        )
      );

    container.innerHTML =
      rows
        .map(row => `
          <div class="bar-list-row">
            <span>
              ${SI.escapeHtml(row.key)}
            </span>

            <div>
              <i style="width:${row.value / max * 100}%"></i>
            </div>

            <strong>
              ${formatter(row.value)}
            </strong>
          </div>
        `)
        .join("") ||
      '<div class="empty-box">No reorder units to display.</div>';
  }

  function rollup(
    rows,
    keyFunction,
    valueFunction,
    limit
  ) {
    const map =
      new Map();

    rows.forEach(row => {
      const key =
        keyFunction(row);

      map.set(
        key,
        (
          map.get(key) ||
          0
        ) +
        valueFunction(row)
      );
    });

    return Array.from(
      map,
      ([key, value]) => ({
        key,
        value
      })
    )
      .sort(
        (a, b) =>
          b.value -
          a.value
      )
      .slice(0, limit);
  }

  function sum(
    rows,
    accessor
  ) {
    return rows.reduce(
      (total, row) =>
        total +
        (
          Number(
            accessor(row)
          ) ||
          0
        ),
      0
    );
  }

  function fillSelect(
    id,
    values,
    label
  ) {
    const select =
      el(id);

    if (!select) return;

    select.innerHTML =
      `<option value="">${label}</option>` +
      values
        .map(
          value =>
            `<option value="${SI.escapeHtml(value)}">${SI.escapeHtml(value)}</option>`
        )
        .join("");
  }

  function emptyRow(
    columns,
    message
  ) {
    return `
      <tr>
        <td colspan="${columns}">
          ${message || "No data matches the current filters."}
        </td>
      </tr>
    `;
  }
})();
