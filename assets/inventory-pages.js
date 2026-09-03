function initReorder() {
  if (!dataset) return;

  const reorders = items.filter(
    item => item.reorderRequired
  );

  /*
   * Only EU is allowed to replace the static
   * US report headings and note.
   */
  if (region === "EU") {
    renderEuReorderView();
  }

  fillSelect(
    "reorder-brand",
    SI.unique(
      reorders.map(item => item.brand)
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

const standardReorderHeaders = [
  "Model#",
  "Brand",
  "Item Title",
  "Status",
  "Open Orders From Client",
  "On Hand",
  "Stock Available",
  "Open Supplier Qty",
  "Supplier Delivery Window",
  "Days Until Supplier Delivery",
  "Recommended Reorder Qty",
  "Reorder Status"
];

const euReorderHeaders = [
  "Model#",
  "Brand",
  "Item Title",
  "Status",
  "Avg Sales/Month (3M)",
  "Open Orders From Client",
  "On Hand",
  "ATS",
  "Actual Available",
  "Upcoming Availability",
  "Open Supplier Qty <=30 Days",
  "Total Open Supplier Qty",
  "Supplier Delivery Window",
  "Days Until Supplier Delivery",
  "Recommended Reorder Qty",
  "Reorder Status",
  "PO#"
];

function currentReorderHeaders() {
  return region === "EU"
    ? euReorderHeaders
    : standardReorderHeaders;
}

function renderEuReorderView() {
  /*
   * This function is called only for region=EU.
   * It never runs on US or Canada.
   */
  const head = document.querySelector(
    ".wide-reorder-table thead tr"
  );

  if (head) {
    head.innerHTML = euReorderHeaders
      .map(
        header =>
          `<th>${SI.escapeHtml(header)}</th>`
      )
      .join("");
  }

  const title = document.querySelector(
    ".reorder-title"
  );

  const note = document.querySelector(
    ".reorder-note"
  );

  if (title) {
    title.textContent =
      "Reorder Report — EU Active Brands / Status: LIVE, FASHION, BACKORDER / Reorder Required Only";
  }

  if (note) {
    note.textContent =
      "Lead time is maintained on Active Brands and used in the recommended quantity calculation, but is hidden from the EU report. Reorder Reason, Raw Row and Sort Rank are also hidden.";
  }
}

function filteredReorders() {
  const brand =
    el("reorder-brand").value;

  const search = el("reorder-search")
    .value
    .trim()
    .toLowerCase();

  return items
    .filter(
      item => item.reorderRequired
    )
    .filter(
      item =>
        (!brand ||
          item.brand === brand) &&
        (
          !search ||
          `${item.model} ${item.product}`
            .toLowerCase()
            .includes(search)
        )
    )
    .sort(
      (a, b) =>
        b.recommended -
          a.recommended ||
        a.rawRow -
          b.rawRow
    );
}

function reorderArray(rows) {
  /*
   * EU receives the expanded workbook layout.
   * US and Canada retain the original 12 fields.
   */
  if (region === "EU") {
    return rows.map(item => [
      item.model,
      item.brand,
      item.product,
      item.status,
      item.avg3,
      item.openClient,
      item.stockQty,
      item.ats,
      item.actualAvailable,
      item.upcomingAvailability,
      item.supplierDueQty,
      item.openSupplier,
      item.supplierWindow,
      item.daysUntil == null
        ? ""
        : item.daysUntil,
      item.recommended,
      "REORDER",
      item.supplierPOs
    ]);
  }

  return rows.map(item => [
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
    "REORDER"
  ]);
}

function renderReorder() {
  const rows = filteredReorders();
  const data = reorderArray(rows);

  const numericColumns =
    region === "EU"
      ? [
          4, 5, 6, 7, 8,
          9, 10, 11, 13, 14
        ]
      : [
          4, 5, 6, 7, 9, 10
        ];

  const statusIndex =
    region === "EU" ? 15 : 11;

  el("reorder-result-count")
    .textContent =
      `${number.format(rows.length)} reorder items • ` +
      `${number.format(
        sum(
          rows,
          item => item.recommended
        )
      )} recommended units`;

  el("reorder-table").innerHTML =
    data.map(row => `
      <tr>
        ${row.map((value, index) => `
          <td${
            numericColumns.includes(index)
              ? ' class="num"'
              : ""
          }>
            ${
              index === statusIndex
                ? '<span class="status status-risk">REORDER</span>'
                : SI.escapeHtml(value)
            }
          </td>
        `).join("")}
      </tr>
    `).join("") ||
    emptyRow(
      currentReorderHeaders().length,
      "No reorder-required items match the filters."
    );
}

function exportReorderCsv() {
  SI.downloadCsv(
    [
      currentReorderHeaders(),
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
      "The Excel exporter did not load."
    );

    return;
  }

  const workbook =
    XLSX.utils.book_new();

  const data = reorderArray(
    filteredReorders()
  );

  const headers =
    currentReorderHeaders();

  const reportNote =
    region === "EU"
      ? "EU lead time is maintained on the Active Brands page and is used in the recommended reorder calculation."
      : "Recommended quantity = ((On Hand + Open Supplier Qty - Open Orders From Client) × Lead Time from Active Brands) + Avg/Month.";

  const rows = [
    [
      "Reorder Report - Active Brands / Status: LIVE, FASHION, BACKORDER / Reorder Required Only"
    ],
    [reportNote],
    headers,
    ...data
  ];

  const sheet =
    XLSX.utils.aoa_to_sheet(rows);

  const lastColumn =
    XLSX.utils.encode_col(
      headers.length - 1
    );

  sheet["!cols"] = headers.map(
    (header, index) => ({
      wch:
        index === 2
          ? 48
          : Math.max(
              12,
              Math.min(
                28,
                header.length + 3
              )
            )
    })
  );

  sheet["!merges"] = [
    {
      s: { r: 0, c: 0 },
      e: {
        r: 0,
        c: headers.length - 1
      }
    },
    {
      s: { r: 1, c: 0 },
      e: {
        r: 1,
        c: headers.length - 1
      }
    }
  ];

  sheet["!autofilter"] = {
    ref:
      `A3:${lastColumn}` +
      `${Math.max(
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
