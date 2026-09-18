(() => {
  "use strict";

  if (window.StarkReportExport) return;

  const path = location.pathname.split("/").pop() || "index.html";
  const reportPages = /^(inventory-dashboard|inventory-analysis-report|raw-report|reorder-report|active-brands|instructions)-(us|eu|ca)\.html$/i.test(path)
    || ["ats-eu.html", "sales-analysis.html", "events.html", "freight-estimator.html", "freight-consolidate.html", "shipment-tracking.html"].includes(path);
  if (!reportPages || document.querySelector(".tv-app")) return;

  const region = (() => {
    const suffix = path.match(/-(us|eu|ca)\.html$/i)?.[1]?.toUpperCase();
    const query = new URLSearchParams(location.search).get("region");
    return suffix || String(query || document.body.dataset.region || localStorage.getItem("stark-selected-region") || "US").toUpperCase();
  })();
  const pageTitle = () => document.querySelector("main h1, .hero h1, .inventory-page-heading h1, h1")?.textContent?.trim()
    || document.title.split("|")[0].trim()
    || "Stark Report";
  const safeName = value => String(value || "Stark Report").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
  const visible = node => Boolean(node && node.getClientRects().length && getComputedStyle(node).visibility !== "hidden");
  const text = node => String(node?.textContent || "").replace(/\s+/g, " ").trim();

  function ensureDependency(globalName, source) {
    if (window[globalName]) return Promise.resolve(window[globalName]);
    return new Promise((resolve, reject) => {
      let script = document.querySelector(`script[src^="${source.split("?")[0]}"]`);
      if (!script) {
        script = document.createElement("script");
        script.src = source;
        script.defer = true;
        document.head.appendChild(script);
      }
      const started = Date.now();
      const timer = window.setInterval(() => {
        if (window[globalName]) {
          clearInterval(timer);
          resolve(window[globalName]);
        } else if (Date.now() - started > 15000) {
          clearInterval(timer);
          reject(new Error(`${globalName} could not be loaded.`));
        }
      }, 50);
      script.addEventListener("error", () => {
        clearInterval(timer);
        reject(new Error(`${globalName} could not be loaded.`));
      }, { once: true });
    });
  }

  function collectKpis() {
    const selectors = [".iar-kpi", ".inventory-kpi", ".kpi-card", ".reorder-kpi-card", ".metric-card", ".stat-card"];
    const seen = new Set();
    return Array.from(document.querySelectorAll(selectors.join(","))).filter(visible).map(card => {
      const label = text(card.querySelector("small, .kpi-label, span"));
      const value = text(card.querySelector("strong, .kpi-value, b"));
      const detail = text(card.querySelector("p, em, span:last-child"));
      const key = `${label}|${value}|${detail}`;
      if (!label || seen.has(key)) return null;
      seen.add(key);
      return [label, value, detail];
    }).filter(Boolean);
  }

  function collectFilters() {
    return Array.from(document.querySelectorAll("input, select, textarea")).filter(field => visible(field) && field.type !== "file" && field.type !== "hidden").map(field => {
      const label = field.closest("label")?.querySelector("span")?.textContent || field.closest("label")?.childNodes?.[0]?.textContent || field.getAttribute("aria-label") || field.name || field.id;
      const value = field instanceof HTMLSelectElement ? field.options[field.selectedIndex]?.textContent : field.value;
      return [String(label || "Filter").trim(), String(value || "All")];
    });
  }

  function collectTables() {
    return Array.from(document.querySelectorAll("table")).filter(visible).map((table, index) => {
      const heading = table.closest("article, section")?.querySelector("h2, h3")?.textContent?.trim() || `Report Data ${index + 1}`;
      const rows = Array.from(table.rows).filter(row => !row.hidden && visible(row)).map(row => Array.from(row.cells).map(cell => text(cell)));
      return { name: heading, rows };
    }).filter(table => table.rows.length);
  }

  function collectChartData() {
    const rows = [["Chart", "Category", "Displayed value"]];
    chartPanels().forEach((panel, index) => {
      const name = text(panel.querySelector("h2, h3")) || `Chart ${index + 1}`;
      const controls = Array.from(panel.querySelectorAll("button, .legend-item, .bar-row, .coverage-row, .position-row")).filter(visible);
      if (controls.length) {
        controls.forEach(control => {
          const parts = Array.from(control.querySelectorAll(":scope > span, :scope > strong, :scope > b, :scope > div > strong")).map(text).filter(Boolean);
          rows.push([name, parts[0] || text(control), parts.slice(1).join(" · ")]);
        });
      } else {
        const labels = Array.from(panel.querySelectorAll("svg text")).map(text).filter(Boolean);
        labels.forEach(label => rows.push([name, label, ""]));
      }
    });
    return rows;
  }

  function chartPanels() {
    const candidates = Array.from(document.querySelectorAll(".analysis-card, .inventory-panel, .panel, .chart, [id$='-chart']"))
      .filter(node => visible(node) && node.querySelector("svg, canvas, .donut, .bar-list, .bar-chart, .coverage-bars, .position-bars, .abc-donut-css"));
    return candidates.filter(node => !candidates.some(other => other !== node && other.contains(node))).slice(0, 8);
  }

  function copyStyles(source, clone) {
    const properties = ["color", "background", "background-color", "background-image", "background-size", "border", "border-radius", "box-shadow", "font", "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "text-align", "display", "grid-template-columns", "grid-template-rows", "align-items", "justify-content", "gap", "padding", "margin", "width", "height", "min-width", "max-width", "min-height", "overflow", "opacity", "transform"];
    const sources = [source, ...source.querySelectorAll("*")];
    const clones = [clone, ...clone.querySelectorAll("*")];
    sources.forEach((node, index) => {
      const target = clones[index];
      if (!target) return;
      const computed = getComputedStyle(node);
      properties.forEach(property => target.style.setProperty(property, computed.getPropertyValue(property)));
    });
  }

  async function elementToPng(element) {
    const rect = element.getBoundingClientRect();
    const width = Math.max(420, Math.min(1000, Math.ceil(rect.width || 760)));
    const height = Math.max(240, Math.min(620, Math.ceil(rect.height || 360)));
    const clone = element.cloneNode(true);
    copyStyles(element, clone);
    clone.querySelectorAll("button").forEach(button => button.style.pointerEvents = "none");
    const serialized = new XMLSerializer().serializeToString(clone);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#ffffff"/><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;overflow:hidden;background:#fff">${serialized}</div></foreignObject></svg>`;
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
      const canvas = document.createElement("canvas");
      canvas.width = width * 1.5;
      canvas.height = height * 1.5;
      const context = canvas.getContext("2d");
      context.scale(1.5, 1.5);
      context.drawImage(image, 0, 0, width, height);
      return canvas.toDataURL("image/png").split(",")[1];
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function xmlEscape(value) {
    return String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[character]));
  }

  function pictureAnchor(index, fromCol, fromRow, toCol, toRow) {
    return `<xdr:twoCellAnchor><xdr:from><xdr:col>${fromCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${toCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${index + 1}" name="Report chart ${index + 1}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rIdImage${index + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm/><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>`;
  }

  async function embedCharts(workbookBytes, images) {
    if (!images.length) return new Blob([workbookBytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const zip = await JSZip.loadAsync(workbookBytes);
    const sheetPath = "xl/worksheets/sheet1.xml";
    let sheetXml = await zip.file(sheetPath).async("string");
    if (!/xmlns:r=/.test(sheetXml)) sheetXml = sheetXml.replace("<worksheet ", '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
    sheetXml = sheetXml.replace("</worksheet>", '<drawing r:id="rIdReportCharts"/></worksheet>');
    zip.file(sheetPath, sheetXml);

    const relPath = "xl/worksheets/_rels/sheet1.xml.rels";
    const existing = zip.file(relPath);
    let relationships = existing ? await existing.async("string") : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    relationships = relationships.replace("</Relationships>", '<Relationship Id="rIdReportCharts" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>');
    zip.file(relPath, relationships);

    const anchors = images.map((_, index) => {
      const column = index % 2 ? 8 : 0;
      const row = 15 + Math.floor(index / 2) * 23;
      return pictureAnchor(index, column, row, column + 8, row + 21);
    });
    zip.file("xl/drawings/drawing1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors.join("")}</xdr:wsDr>`);
    zip.file("xl/drawings/_rels/drawing1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${images.map((_, index) => `<Relationship Id="rIdImage${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/report-chart-${index + 1}.png"/>`).join("")}</Relationships>`);
    images.forEach((image, index) => zip.file(`xl/media/report-chart-${index + 1}.png`, image, { base64: true }));

    let contentTypes = await zip.file("[Content_Types].xml").async("string");
    if (!/Extension="png"/.test(contentTypes)) contentTypes = contentTypes.replace("</Types>", '<Default Extension="png" ContentType="image/png"/></Types>');
    if (!/PartName="\/xl\/drawings\/drawing1.xml"/.test(contentTypes)) contentTypes = contentTypes.replace("</Types>", '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>');
    zip.file("[Content_Types].xml", contentTypes);
    return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", compression: "DEFLATE" });
  }

  function appendSheet(workbook, name, rows) {
    const safe = safeName(name).slice(0, 31) || "Report Data";
    const unique = workbook.SheetNames.includes(safe) ? `${safe.slice(0, 27)} ${workbook.SheetNames.length + 1}` : safe;
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const maxColumns = Math.max(1, ...rows.map(row => row.length));
    sheet["!cols"] = Array.from({ length: maxColumns }, (_, index) => ({ wch: index === 2 ? 45 : 20 }));
    XLSX.utils.book_append_sheet(workbook, sheet, unique);
  }

  function downloadBlob(blob, name) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1600);
  }

  async function buildWorkbook() {
    await Promise.all([
      ensureDependency("XLSX", "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"),
      ensureDependency("JSZip", "assets/jszip.min.js")
    ]);
    const exportedAt = new Date();
    const title = pageTitle();
    const kpis = collectKpis();
    const filters = collectFilters();
    const tables = collectTables();
    const dashboardRows = [
      ["STARK PREMIUM — SUPPLY CHAIN INTELLIGENCE"],
      [title],
      [`${region} market`, `Exported ${exportedAt.toLocaleString()}`],
      [],
      ["KPI", "Value", "Definition"],
      ...kpis,
      [],
      ["Charts below reflect the current report filters and displayed analysis."]
    ];
    const workbook = XLSX.utils.book_new();
    appendSheet(workbook, "Dashboard", dashboardRows);
    if (filters.length) appendSheet(workbook, "Filters", [["Filter", "Selected value"], ...filters]);
    tables.forEach(table => appendSheet(workbook, table.name, table.rows));
    const chartData = collectChartData();
    if (chartData.length > 1) appendSheet(workbook, "Chart Data", chartData);
    if (!tables.length) appendSheet(workbook, "Visible Report", [["Section", "Displayed content"], ...Array.from(document.querySelectorAll("main h2, main h3, main p")).filter(visible).map(node => [node.tagName, text(node)])]);

    const images = [];
    for (const panel of chartPanels()) {
      try { images.push(await elementToPng(panel)); } catch (error) { console.warn("Chart capture skipped", error); }
    }
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const blob = await embedCharts(bytes, images);
    downloadBlob(blob, `${safeName(title)} ${region} ${exportedAt.toISOString().slice(0, 10)}.xlsx`);
  }

  async function exportReport(trigger) {
    const original = trigger.innerHTML;
    trigger.disabled = true;
    trigger.innerHTML = '<span class="report-export-spinner" aria-hidden="true"></span><span>Preparing Excel…</span>';
    try {
      if (/^reorder-report-/.test(path) && document.getElementById("export-reorder-xlsx")) {
        document.getElementById("export-reorder-xlsx").click();
        return;
      }
      if (/^inventory-analysis-report-/.test(path) && document.getElementById("export-analysis")) {
        document.getElementById("export-analysis").click();
        return;
      }
      await buildWorkbook();
    } catch (error) {
      console.error("Excel report export failed", error);
      alert(`The Excel report could not be exported: ${error.message}`);
    } finally {
      trigger.disabled = false;
      trigger.innerHTML = original;
    }
  }

  const button = document.querySelector(".report-export-action") || document.createElement("button");
  button.type = "button";
  button.className = "report-export-action";
  button.title = "Export the current report to Excel with KPIs, charts and visible tables";
  button.setAttribute("aria-label", "Export current report to Excel with charts");
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 18v3h14v-3"/></svg><span>Export report</span>';
  if (!button.isConnected) document.body.appendChild(button);
  button.addEventListener("click", () => exportReport(button));

  window.StarkReportExport = { exportReport: () => exportReport(button) };
})();
