(function () {
  "use strict";

  const REGION_NAMES = { US: "United States", EU: "European Union", Canada: "Canada" };
  const DEFAULT_SETTINGS = { coverage: 1, safety: 0, critical: 3, delay: 15, a: 80, b: 95, abcMetric: "sales", forecastMethod: "weighted" };
  const COLORS = { navy: "#10233f", teal: "#0b8f87", blue: "#3b82f6", orange: "#f59e0b", red: "#dc5a64", green: "#17865f", purple: "#7c5ce4", muted: "#617087", line: "#dce4ee", soft: "#eef3f8" };
  const regions = Object.fromEntries(["US", "EU", "Canada"].map(code => [code, {
    salesFile: null, itemFile: null, eventFile: null, salesRows: [], itemRows: [], eventRows: [], filteredEvents: [], analysis: [], filtered: [], settings: { ...DEFAULT_SETTINGS }, analyzed: false
  }]));
  const state = { region: "US", module: "inventory", tab: "overview" };
  const el = id => document.getElementById(id);
  const currency = { format(value) { const code = state.region === "EU" ? "EUR" : state.region === "Canada" ? "CAD" : "USD"; return new Intl.NumberFormat(state.region === "EU" ? "en-IE" : "en-US", { style: "currency", currency: code, maximumFractionDigits: 0 }).format(value); } };
  const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
  const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
  const monthLabel = d3.timeFormat("%b %Y");

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    bindEvents();
    const query = new URLSearchParams(location.search);
    const requestedWorkspace = query.get("workspace");
    const requestedModule = query.get("module");
    if (["US", "EU", "Canada"].includes(requestedWorkspace)) {
      state.region = requestedWorkspace;
      el("home-screen").classList.add("hidden");
      if (requestedModule === "sales") {
        openModule("sales");
        return;
      } else {
        el("regional-app").classList.add("hidden");
        el("module-screen").classList.remove("hidden");
        updateModuleScreen();
      }
    } else {
      updateRegionUI();
    }
    setHeaderWorkspaceActions(false);
  }

  function bindEvents() {
    document.querySelectorAll(".country-button").forEach(button => button.addEventListener("click", () => openRegion(button.dataset.country)));
    document.querySelectorAll(".module-button").forEach(button => button.addEventListener("click", () => openModule(button.dataset.module)));
    document.querySelectorAll(".region-tab").forEach(button => button.addEventListener("click", () => selectRegion(button.dataset.region)));
    el("module-home").addEventListener("click", showHome);
    el("back-modules").addEventListener("click", showModules);
    el("back-home").addEventListener("click", showHome);
    document.querySelectorAll(".upload-report").forEach(button => button.addEventListener("click", () => el(`${button.dataset.type}-file`).click()));
    el("sales-file").addEventListener("change", event => handleUpload("sales", event.target.files[0]));
    el("item-file").addEventListener("change", event => handleUpload("item", event.target.files[0]));
    el("analyze-button").addEventListener("click", analyzeRegion);
    el("export-workbook").addEventListener("click", exportActiveWorkbook);
    el("export-table").addEventListener("click", exportCurrentCsv);
    el("clear-region").addEventListener("click", clearRegion);
    el("settings-button").addEventListener("click", openSettings);
    el("settings-form").addEventListener("submit", saveSettings);
    el("upload-events").addEventListener("click", () => el("events-file").click());
    el("events-file").addEventListener("change", event => handleEventUpload(event.target.files[0]));
    el("export-events-csv").addEventListener("click", exportEventsCsv);
    el("clear-events").addEventListener("click", clearEvents);
    ["event-status-filter", "event-brand-filter"].forEach(id => el(id).addEventListener("change", applyEventFilters));
    el("event-search-filter").addEventListener("input", debounce(applyEventFilters, 160));
    el("reset-event-filters").addEventListener("click", resetEventFilters);
    document.querySelectorAll(".tab").forEach(button => button.addEventListener("click", () => activateTab(button.dataset.tab)));
    ["brand-filter", "status-filter", "abc-filter"].forEach(id => el(id).addEventListener("change", applyFilters));
    el("search-filter").addEventListener("input", debounce(applyFilters, 160));
    el("reset-filters").addEventListener("click", resetFilters);
    window.addEventListener("resize", debounce(() => { if (state.module === "events") renderEventCharts(); else if (current().analyzed) renderCharts(); }, 220));
  }

  function current() { return regions[state.region]; }

  function openRegion(code) {
    state.region = code;
    el("home-screen").classList.add("hidden");
    el("regional-app").classList.add("hidden");
    el("module-screen").classList.remove("hidden");
    setHeaderWorkspaceActions(false);
    updateModuleScreen();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openModule(module) {
    if (module === "inventory") {
      const inventoryRoutes = { US: "inventory-dashboard-us.html", EU: "inventory-dashboard-eu.html", Canada: "inventory-dashboard-ca.html" };
      navigateWithTransition(inventoryRoutes[state.region]);
      return;
    }
    if (module === "events") {
      const eventRegion = state.region === "Canada" ? "CA" : state.region;
      navigateWithTransition(`events.html?region=${eventRegion}`);
      return;
    }
    state.module = module;
    state.tab = module === "sales" ? "sales" : "overview";
    el("module-screen").classList.add("hidden");
    el("regional-app").classList.remove("hidden");
    setHeaderWorkspaceActions(true);
    updateRegionUI();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showModules() {
    el("regional-app").classList.add("hidden");
    el("home-screen").classList.add("hidden");
    el("module-screen").classList.remove("hidden");
    setHeaderWorkspaceActions(false);
    updateModuleScreen();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateModuleScreen() {
    document.documentElement.dataset.region = state.region === "Canada" ? "CA" : state.region;
    el("module-title").textContent = `${REGION_NAMES[state.region]} workspace`;
    el("module-region-pill").textContent = state.region === "Canada" ? "CA" : state.region;
  }

  function showHome() {
    el("regional-app").classList.add("hidden");
    el("module-screen").classList.add("hidden");
    el("home-screen").classList.remove("hidden");
    setHeaderWorkspaceActions(false);
    history.replaceState(null, "", "index.html");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function navigateWithTransition(url) {
    document.body.classList.add("page-leaving");
    window.setTimeout(() => { window.location.href = url; }, 145);
  }

  function setHeaderWorkspaceActions(show) {
    el("settings-button").classList.toggle("hidden", !show);
    el("export-workbook").classList.toggle("hidden", !show);
  }

  function selectRegion(code) {
    state.region = code;
    updateModuleScreen();
    updateRegionUI();
  }

  function updateRegionUI() {
    document.documentElement.dataset.region = state.region === "Canada" ? "CA" : state.region;
    const region = current();
    document.querySelectorAll(".region-tab").forEach(button => {
      const active = button.dataset.region === state.region;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    ["US", "EU", "Canada"].forEach(code => {
      const r = regions[code];
      const count = Number(Boolean(r.salesFile)) + Number(Boolean(r.itemFile)) + Number(Boolean(r.eventFile));
      el(`region-status-${code}`).textContent = count ? `${count} data file${count === 1 ? "" : "s"}` : "No files";
    });
    el("upload-region-name").textContent = REGION_NAMES[state.region];
    el("source-label").textContent = `${REGION_NAMES[state.region]} analysis`;
    el("reorder-report-region").textContent = state.region === "Canada" ? "CA" : state.region;
    setUploadCard("sales", region.salesFile, region.salesRows.length);
    setUploadCard("item", region.itemFile, region.itemRows.length);
    el("analyze-button").disabled = !region.salesFile && !region.itemFile;
    el("analysis-status").textContent = region.analyzed ? "Analysis ready" : (region.salesFile || region.itemFile) ? "Ready to generate" : "Waiting for data";
    const reportParts = [region.salesFile ? "Sales Report loaded" : "Sales Report missing", region.itemFile ? "Item Sales Report loaded" : "Item Sales Report missing", region.eventFile ? "Events Report loaded" : "Events Report missing"];
    el("region-summary").textContent = `${REGION_NAMES[state.region]}: ${reportParts.join(" • ")}.`;
    if (region.analyzed) {
      populateFilters();
      applyFilters();
    }
    updateModuleUI();
  }

  function updateModuleUI() {
    const region = current(), eventsMode = state.module === "events";
    const moduleNames = { inventory: "Inventory Analysis", sales: "Sales Analysis", events: "Events" };
    el("active-module-badge").textContent = moduleNames[state.module];
    el("upload-center").classList.toggle("hidden", eventsMode);
    el("events-center").classList.toggle("hidden", !eventsMode);
    el("events-workspace").classList.toggle("hidden", !eventsMode || !region.eventRows.length);
    el("workspace").classList.toggle("hidden", eventsMode || !region.analyzed);
    el("settings-button").classList.toggle("hidden", eventsMode || state.module === "sales");
    el("export-workbook").textContent = eventsMode ? "Export events report" : state.module === "sales" ? "Export sales workbook" : "Export inventory report";
    el("export-workbook").disabled = eventsMode ? !region.eventRows.length : !region.analyzed;
    document.querySelector(".module-upload-sales").classList.toggle("hidden", state.module === "inventory");
    document.querySelector(".module-upload-inventory").classList.toggle("hidden", state.module === "sales");
    document.querySelector(".module-upload-generated").classList.toggle("hidden", eventsMode);
    el("upload-center").querySelector(".upload-grid").classList.toggle("two-card-grid", !eventsMode);
    document.querySelectorAll(".tab").forEach(button => {
      const inventoryTabs = ["overview", "forecast", "abc", "reorder", "raw"];
      const salesTabs = ["overview", "sales", "abc"];
      const visible = state.module === "inventory" ? inventoryTabs.includes(button.dataset.tab) : salesTabs.includes(button.dataset.tab);
      button.classList.toggle("hidden", eventsMode || !visible);
    });
    if (!eventsMode && region.analyzed) {
      const allowed = state.module === "sales" ? ["overview", "sales", "abc"] : ["overview", "forecast", "abc", "reorder", "raw"];
      if (!allowed.includes(state.tab)) state.tab = state.module === "sales" ? "sales" : "overview";
      activateTab(state.tab);
    }
    el("upload-title").innerHTML = `<span id="upload-region-name">${escapeHtml(REGION_NAMES[state.region])}</span> ${state.module === "sales" ? "sales report" : "inventory report"} upload`;
    el("source-label").textContent = `${REGION_NAMES[state.region]} ${state.module === "sales" ? "sales" : "inventory"} analysis`;
    updateEventsUI();
  }

  function setUploadCard(type, file, rowCount) {
    const card = document.querySelector(`.upload-card[data-report="${type}"]`);
    const status = el(`${type}-status`);
    card.classList.toggle("loaded", Boolean(file));
    status.className = `upload-status${file ? " ready" : ""}`;
    status.textContent = file ? "Uploaded" : "Not uploaded";
    el(`${type}-file-detail`).textContent = file ? `${file.name} • ${number.format(rowCount)} rows` : "";
  }

  async function handleUpload(type, file) {
    if (!file) return;
    const targetRegion = state.region;
    const status = el(`${type}-status`);
    status.className = "upload-status";
    status.textContent = "Reading file…";
    try {
      const rows = await readReportFile(file, type);
      if (!rows.length) throw new Error("No usable rows were found.");
      const region = regions[targetRegion];
      if (type === "sales") { region.salesFile = file; region.salesRows = normalizeSalesRows(rows); }
      else { region.itemFile = file; region.itemRows = normalizeItemRows(rows); }
      if (type === "sales" && !region.salesRows.length) throw new Error("The Sales Report needs a model or item field plus Sales or Units.");
      if (type === "item" && !region.itemRows.length) throw new Error("The Item Sales Report needs Model#, Item Title, or Brand fields.");
      region.analyzed = false;
      if (state.region === targetRegion) updateRegionUI();
    } catch (error) {
      status.className = "upload-status error";
      status.textContent = "Upload error";
      window.alert(`${type === "sales" ? "Sales" : "Item Sales"} Report: ${error.message}`);
    } finally {
      el(`${type}-file`).value = "";
    }
  }

  async function readReportFile(file, type) {
    const bytes = await file.arrayBuffer();
    const prefix = new TextDecoder("utf-8").decode(bytes.slice(0, 5000)).trim().toLowerCase();
    if (prefix.includes("<table") || prefix.startsWith("<div") || prefix.startsWith("<html")) {
      const text = new TextDecoder("utf-8").decode(bytes);
      return parseHtmlReport(text, type);
    }
    if (!window.XLSX) throw new Error("The Excel reader did not load. Refresh the page and try again.");
    const workbook = XLSX.read(bytes, { type: "array", cellDates: true });
    let best = [];
    workbook.SheetNames.forEach(name => {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: "", raw: false });
      if (rows.length > best.length) best = rows;
    });
    return best;
  }

  function parseHtmlReport(text, type) {
    const doc = new DOMParser().parseFromString(text, "text/html");
    const table = doc.querySelector("#gvreport") || doc.querySelector("table");
    if (!table) return [];
    const rows = Array.from(table.querySelectorAll("tr")).filter(row => row.closest("table") === table);
    if (!rows.length) return [];
    const headers = directCells(rows[0]).map(cell => cleanText(cell.textContent));
    return rows.slice(1).map(row => {
      const cells = directCells(row);
      const result = {};
      headers.forEach((header, index) => {
        const cell = cells[index];
        if (!cell) { result[header] = ""; return; }
        if (normalizeHeader(header) === "open orders to supplier") {
          const supplier = parseSupplierCell(cell);
          result[header] = supplier.windowText;
          result.__supplierQty = supplier.qty;
          result.__supplierWindow = supplier.windowText;
          result.__supplierPOs = supplier.pos;
          result.__supplierStart = supplier.start;
          result.__supplierEnd = supplier.end;
        } else {
          const clone = cell.cloneNode(true);
          clone.querySelectorAll("table").forEach(nested => nested.remove());
          result[header] = cleanText(clone.textContent);
        }
      });
      return result;
    }).filter(row => Object.values(row).some(value => value !== ""));
  }

  function directCells(row) { return Array.from(row.children).filter(child => child.tagName === "TD" || child.tagName === "TH"); }

  function parseSupplierCell(cell) {
    const nested = cell.querySelector("table");
    if (!nested) return parseSupplierText(cleanText(cell.textContent));
    const nestedRows = Array.from(nested.querySelectorAll("tr")).map(directCells).filter(cells => cells.length);
    const headers = (nestedRows.shift() || []).map(c => normalizeHeader(c.textContent));
    let qty = 0;
    const windows = [], pos = [];
    nestedRows.forEach(cells => {
      const values = cells.map(c => cleanText(c.textContent));
      const poIndex = headers.findIndex(h => h === "po" || h === "po#" || h.includes("po"));
      const qtyIndex = headers.findIndex(h => h === "qty" || h.includes("quantity"));
      const windowIndex = headers.findIndex(h => h.includes("delivery window"));
      if (poIndex >= 0 && values[poIndex]) pos.push(values[poIndex]);
      if (qtyIndex >= 0) qty += finite(toNumber(values[qtyIndex]));
      if (windowIndex >= 0 && values[windowIndex]) windows.push(values[windowIndex]);
    });
    const range = windowRange(windows);
    return { qty, windowText: windows.join(" | "), pos: pos.join(", "), start: range.start, end: range.end };
  }

  function parseSupplierText(text) {
    const windows = String(text || "").match(/\d{1,2}\/\d{1,2}\/\d{4}\s*-\s*\d{1,2}\/\d{1,2}\/\d{4}/g) || [];
    const range = windowRange(windows);
    return { qty: 0, windowText: windows.join(" | ") || text || "", pos: "", start: range.start, end: range.end };
  }

  function windowRange(windows) {
    const dates = windows.flatMap(value => String(value).split(/\s*-\s*/).map(parseDate).filter(Boolean)).sort((a, b) => a - b);
    return { start: dates[0] || null, end: dates[dates.length - 1] || null };
  }

  const SALES_ALIASES = {
    date: ["date", "order date", "invoice date", "month", "period", "sales date"],
    model: ["model", "model#", "model number", "sku", "style", "item number", "item#"],
    product: ["product", "product name", "item", "item title", "item name", "description"],
    brand: ["brand", "vendor", "manufacturer"], category: ["category", "product category", "department", "class"],
    customer: ["customer", "customer name", "account", "client", "sold to"], region: ["region", "sales region", "territory", "state", "market"],
    units: ["units", "units sold", "quantity", "qty", "sales qty", "order qty"], sales: ["sales", "revenue", "net sales", "sales amount", "extended price", "amount"],
    cost: ["cost", "cogs", "total cost", "landed cost", "extended cost"], margin: ["margin", "gross margin", "gross profit", "profit", "margin %", "margin percent"]
  };

  function normalizeSalesRows(rows) {
    if (!rows.length) return [];
    const mapping = detectMapping(Object.keys(rows[0]), SALES_ALIASES);
    return rows.map((row, index) => {
      const get = key => mapping[key] ? row[mapping[key]] : "";
      const units = finite(toNumber(get("units"))), sales = finite(toNumber(get("sales"))), cost = finite(toNumber(get("cost")));
      const rawMargin = toNumber(get("margin"));
      let margin = Number.isFinite(rawMargin) ? rawMargin : sales - cost;
      if (Number.isFinite(rawMargin) && Math.abs(rawMargin) <= 1 && sales) margin = sales * rawMargin;
      return { id: index + 1, date: parseDate(get("date")), model: textValue(get("model")), product: textValue(get("product"), textValue(get("model"), `Item ${index + 1}`)), brand: textValue(get("brand"), "Unspecified"), category: textValue(get("category"), "Unspecified"), customer: textValue(get("customer"), "Unspecified"), salesRegion: textValue(get("region"), state.region), units, sales, cost, margin };
    }).filter(row => (row.model || row.product) && (row.units !== 0 || row.sales !== 0));
  }

  const ITEM_ALIASES = {
    brand: ["brand"], itemid: ["itemid", "item id"], model: ["model#", "model", "model number", "sku"], product: ["item title", "product", "item name", "description"], status: ["status"], eta: ["eta"],
    vol3: ["vol past 3m", "volume past 3m", "past 3 months", "3 month sales", "3m units"], last30: ["vol last 30 days", "last 30 days", "30 day sales", "30d units"], avg3: ["avg/perm past 3m", "avg per m past 3m", "average per month past 3m", "avg monthly sales"],
    stockQty: ["stock qty", "on hand", "stock quantity"], available: ["stock available", "available", "ats", "available to sell"], stockDifference: ["stock difference"], openClient: ["open orders from client", "open client orders"], openSupplier: ["open supplier qty", "open orders to supplier", "open supplier orders"], supplierWindow: ["supplier delivery window", "delivery window"]
  };

  function normalizeItemRows(rows) {
    if (!rows.length) return [];
    const mapping = detectMapping(Object.keys(rows[0]), ITEM_ALIASES);
    const normalized = [];
    let currentItem = null;
    rows.forEach((row, index) => {
      const get = key => mapping[key] ? row[mapping[key]] : "";
      const model = textValue(get("model")), product = textValue(get("product")), brand = textValue(get("brand"));
      if (!model && !product && !brand) {
        if (currentItem) {
          const poQty = toNumber(row.Qty ?? row.QTY ?? row.qty);
          if (Number.isFinite(poQty)) currentItem.openSupplier += poQty;
          const poWindow = row["Delivery Window"] || row["Supplier Delivery Window"];
          if (poWindow) currentItem.supplierWindows.push(String(poWindow));
        }
        return;
      }
      const supplierText = textValue(get("supplierWindow"), textValue(get("openSupplier")));
      const parsedSupplier = parseSupplierText(supplierText);
      const openSupplier = Number.isFinite(toNumber(row.__supplierQty)) ? toNumber(row.__supplierQty) : finite(toNumber(get("openSupplier")));
      const item = {
        id: index + 1, brand: brand || "Unspecified", itemid: textValue(get("itemid")), model: model || product, product: product || model, status: textValue(get("status"), "Unspecified"), eta: parseDate(get("eta")),
        vol3: finite(toNumber(get("vol3"))), last30: finite(toNumber(get("last30"))), avg3: finite(toNumber(get("avg3"))), stockQty: finite(toNumber(get("stockQty"))), available: finite(toNumber(get("available"))), stockDifference: finite(toNumber(get("stockDifference"))), openClient: finite(toNumber(get("openClient"))),
        openSupplier, supplierWindows: supplierText ? [supplierText] : [], supplierPOs: textValue(row.__supplierPOs), supplierStart: row.__supplierStart || parsedSupplier.start, supplierEnd: row.__supplierEnd || parsedSupplier.end
      };
      if (!item.avg3 && item.vol3) item.avg3 = item.vol3 / 3;
      normalized.push(item);
      currentItem = item;
    });
    normalized.forEach(item => {
      const range = windowRange(item.supplierWindows);
      item.supplierWindow = item.supplierWindows.filter(Boolean).join(" | ");
      item.supplierStart = item.supplierStart || range.start;
      item.supplierEnd = item.supplierEnd || range.end;
    });
    return normalized;
  }

  const EVENT_ALIASES = {
    event: ["event", "event name", "program", "campaign", "show"],
    date: ["event date", "date", "in hands date", "ship date", "start date"],
    customer: ["customer", "customer name", "client", "account"],
    model: ["model#", "model", "model number", "sku", "style", "item number", "item#"],
    product: ["item title", "product", "product name", "item", "description"],
    brand: ["brand", "vendor", "manufacturer"],
    planned: ["planned qty", "planned quantity", "event qty", "required qty", "quantity", "qty"],
    allocated: ["allocated qty", "allocated quantity", "reserved qty", "committed qty"],
    shipped: ["shipped qty", "shipped quantity", "fulfilled qty", "delivered qty"],
    sales: ["sales", "revenue", "event sales", "sales amount", "amount"],
    status: ["status", "event status", "order status"]
  };

  function normalizeEventRows(rows) {
    if (!rows.length) return [];
    const mapping = detectMapping(Object.keys(rows[0]), EVENT_ALIASES);
    return rows.map((row, index) => {
      const get = key => mapping[key] ? row[mapping[key]] : "";
      const eventName = textValue(get("event"), `Event ${index + 1}`);
      const model = textValue(get("model"));
      const product = textValue(get("product"), model || "Unspecified item");
      const planned = finite(toNumber(get("planned"))), allocated = finite(toNumber(get("allocated"))), shipped = finite(toNumber(get("shipped")));
      const status = textValue(get("status"), shipped >= planned && planned > 0 ? "Complete" : shipped > 0 ? "In progress" : "Planned");
      return { id: index + 1, event: eventName, date: parseDate(get("date")), customer: textValue(get("customer"), "Unspecified"), model, product, brand: textValue(get("brand"), "Unspecified"), planned, allocated, shipped, remaining: Math.max(0, planned - shipped), sales: finite(toNumber(get("sales"))), status };
    }).filter(row => row.event || row.model || row.product);
  }

  async function handleEventUpload(file) {
    if (!file) return;
    const targetRegion = state.region, status = el("events-status");
    status.className = "upload-status";
    status.textContent = "Reading file…";
    try {
      const rows = await readReportFile(file, "events");
      const normalized = normalizeEventRows(rows);
      if (!normalized.length) throw new Error("The Events Report needs an Event, Model#, Product or quantity field.");
      const region = regions[targetRegion];
      region.eventFile = file;
      region.eventRows = normalized;
      region.filteredEvents = normalized.slice();
      if (state.region === targetRegion) updateRegionUI();
    } catch (error) {
      status.className = "upload-status error";
      status.textContent = "Upload error";
      window.alert(`Events Report: ${error.message}`);
    } finally {
      el("events-file").value = "";
    }
  }

  function detectMapping(headers, aliases) {
    const normalized = headers.map(original => ({ original, normalized: normalizeHeader(original) }));
    const result = {};
    Object.entries(aliases).forEach(([key, values]) => {
      const targets = values.map(normalizeHeader);
      const exact = normalized.find(header => targets.includes(header.normalized));
      const fuzzy = normalized.find(header => targets.some(target => header.normalized.includes(target) || target.includes(header.normalized)));
      result[key] = (exact || fuzzy || {}).original || "";
    });
    return result;
  }

  function analyzeRegion() {
    const region = current();
    region.analysis = buildAnalysis(region);
    if (!region.analysis.length) { window.alert("No analyzable item or sales rows were found."); return; }
    region.analyzed = true;
    updateRegionUI();
    el("workspace").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function buildAnalysis(region) {
    const salesMap = new Map();
    region.salesRows.forEach(row => {
      const key = itemKey(row.model, row.product);
      if (!salesMap.has(key)) salesMap.set(key, { model: row.model || row.product, product: row.product, brand: row.brand, category: row.category, units: 0, sales: 0, cost: 0, margin: 0, rows: [] });
      const agg = salesMap.get(key);
      agg.units += row.units; agg.sales += row.sales; agg.cost += row.cost; agg.margin += row.margin; agg.rows.push(row);
      if (agg.brand === "Unspecified" && row.brand !== "Unspecified") agg.brand = row.brand;
    });
    const analysisMap = new Map();
    region.itemRows.forEach(item => {
      const key = itemKey(item.model, item.product);
      const sales = salesMap.get(key) || { model: item.model, product: item.product, brand: item.brand, category: "Unspecified", units: item.vol3, sales: 0, cost: 0, margin: 0, rows: [] };
      analysisMap.set(key, calculateItem({ ...item, salesUnits: sales.units, sales: sales.sales, cost: sales.cost, margin: sales.margin, category: sales.category, salesRows: sales.rows }, region.settings));
    });
    salesMap.forEach((sales, key) => {
      if (!analysisMap.has(key)) analysisMap.set(key, calculateItem({ id: key, brand: sales.brand, itemid: "", model: sales.model, product: sales.product, status: "Sales only", eta: null, vol3: sales.units, last30: 0, avg3: sales.units / Math.max(1, uniqueMonths(sales.rows)), stockQty: 0, available: 0, stockDifference: 0, openClient: 0, openSupplier: 0, supplierWindow: "", supplierStart: null, supplierEnd: null, supplierPOs: "", salesUnits: sales.units, sales: sales.sales, cost: sales.cost, margin: sales.margin, category: sales.category, salesRows: sales.rows }, region.settings));
    });
    const items = Array.from(analysisMap.values());
    assignAbc(items, region.settings);
    return items;
  }

  function calculateItem(item, settings) {
    const avg = finite(item.avg3 || item.vol3 / 3);
    const forecastMonthly = settings.forecastMethod === "weighted" && item.last30 > 0 ? item.last30 * .6 + avg * .4 : avg;
    const threeMonthForecast = forecastMonthly * 3;
    const monthsCover = avg > 0 ? item.available / avg : Infinity;
    const daysUntil = item.supplierEnd ? Math.ceil((item.supplierEnd - startOfToday()) / 86400000) : null;
    const statusUpper = String(item.status).trim().toUpperCase();
    const excluded = ["FEEDS ONLY", "INTERNAL USE", "PRESENTATION"].some(text => statusUpper.includes(text));
    const eligible = ["LIVE", "FASHION", "BACKORDER"].includes(statusUpper);
    const reasons = [];
    if (!excluded && eligible) {
      if (item.available + item.openSupplier <= settings.critical) reasons.push(`Stock Available + Open Supplier Qty <= ${settings.critical}`);
      if (item.openClient > item.available) reasons.push("Open client orders are greater than stock available");
      if (Number.isFinite(daysUntil) && daysUntil > settings.delay) reasons.push(`Supplier delivery window is over ${settings.delay} days`);
      if (avg > item.available + item.openSupplier) reasons.push("Avg/PerM Past 3M is greater than available + open supplier qty");
    }
    const reorderRequired = reasons.length > 0;
    const recommended = reorderRequired ? Math.ceil(avg * Math.max(0, settings.coverage + settings.safety)) : 0;
    return { ...item, avg3: avg, forecastMonthly, threeMonthForecast, monthsCover, daysUntil, eligible, excluded, reorderRequired, recommended, reorderReason: reasons.join(" | "), marginRate: item.sales ? item.margin / item.sales : 0, trend: avg ? item.last30 / avg - 1 : 0, abc: "C", contribution: 0, cumulative: 0, rank: 0 };
  }

  function assignAbc(items, settings) {
    const hasSales = items.some(item => item.sales > 0);
    const metricName = settings.abcMetric === "sales" && hasSales ? "sales" : "salesUnits";
    const sorted = items.slice().sort((a, b) => finite(b[metricName]) - finite(a[metricName]));
    const total = d3.sum(sorted, item => Math.max(0, finite(item[metricName])));
    let cumulative = 0;
    sorted.forEach((item, index) => {
      const contribution = total ? Math.max(0, finite(item[metricName])) / total : 0;
      const previousCumulative = cumulative;
      cumulative += contribution;
      item.rank = index + 1; item.contribution = contribution; item.cumulative = cumulative;
      item.abc = previousCumulative < settings.a / 100 ? "A" : previousCumulative < settings.b / 100 ? "B" : "C";
      item.abcMetricUsed = metricName;
    });
  }

  function populateFilters() {
    const items = current().analysis;
    populateSelect("brand-filter", unique(items.map(item => item.brand)), "All brands");
    populateSelect("status-filter", unique(items.map(item => item.status)), "All statuses");
  }

  function populateSelect(id, values, label) {
    const selected = el(id).value;
    el(id).innerHTML = `<option value="">${label}</option>` + values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
    if (values.includes(selected)) el(id).value = selected;
  }

  function updateEventsUI() {
    const region = current(), hasEvents = region.eventRows.length > 0;
    el("events-region-name").textContent = REGION_NAMES[state.region];
    el("events-source-label").textContent = `${REGION_NAMES[state.region]} events`;
    const card = document.querySelector('.upload-card[data-report="events"]');
    card.classList.toggle("loaded", Boolean(region.eventFile));
    el("events-status").className = `upload-status${region.eventFile ? " ready" : ""}`;
    el("events-status").textContent = region.eventFile ? "Uploaded" : "Not uploaded";
    el("events-file-detail").textContent = region.eventFile ? `${region.eventFile.name} • ${number.format(region.eventRows.length)} rows` : "";
    el("events-analysis-status").textContent = hasEvents ? "Analysis ready" : "Waiting for data";
    el("export-events-csv").disabled = !hasEvents;
    el("events-data-status").textContent = region.eventFile ? `${region.eventFile.name} • ${number.format(region.eventRows.length)} event item rows` : "No Events Report";
    if (hasEvents) {
      populateSelect("event-status-filter", unique(region.eventRows.map(row => row.status)), "All statuses");
      populateSelect("event-brand-filter", unique(region.eventRows.map(row => row.brand)), "All brands");
      applyEventFilters();
    } else {
      region.filteredEvents = [];
      el("event-filter-result").textContent = "Upload an Events Report to begin.";
      el("events-kpis").innerHTML = "";
      el("events-table").innerHTML = emptyRow(12, "No Events Report uploaded for this region.");
      ["events-fulfillment-chart", "events-status-chart"].forEach(id => emptyChart(el(id)));
    }
  }

  function resetEventFilters() {
    ["event-status-filter", "event-brand-filter", "event-search-filter"].forEach(id => { el(id).value = ""; });
    applyEventFilters();
  }

  function applyEventFilters() {
    const region = current();
    const status = el("event-status-filter").value, brand = el("event-brand-filter").value, search = el("event-search-filter").value.trim().toLowerCase();
    region.filteredEvents = region.eventRows.filter(row => (!status || row.status === status) && (!brand || row.brand === brand) && (!search || `${row.event} ${row.customer} ${row.model} ${row.product}`.toLowerCase().includes(search)));
    el("event-filter-result").textContent = `${number.format(region.filteredEvents.length)} of ${number.format(region.eventRows.length)} event item rows • ${number.format(unique(region.filteredEvents.map(row => row.event)).length)} events`;
    renderEvents();
  }

  function renderEvents() {
    const rows = current().filteredEvents;
    const planned = d3.sum(rows, row => row.planned), allocated = d3.sum(rows, row => row.allocated), shipped = d3.sum(rows, row => row.shipped), sales = d3.sum(rows, row => row.sales);
    const today = startOfToday(), upcoming = unique(rows.filter(row => row.date && row.date >= today).map(row => row.event)).length;
    renderKpiCards("events-kpis", [
      ["Events", number.format(unique(rows.map(row => row.event)).length), `${upcoming} upcoming`],
      ["Planned units", number.format(planned), "Regional event demand"],
      ["Allocated units", number.format(allocated), planned ? `${percent.format(allocated / planned)} of plan` : "No planned quantity"],
      ["Shipped units", number.format(shipped), planned ? `${percent.format(shipped / planned)} fulfillment` : "No planned quantity"],
      ["Event sales", sales ? currency.format(sales) : "—", "Uploaded event revenue"]
    ]);
    el("events-table").innerHTML = rows.slice().sort((a, b) => (a.date || new Date(8640000000000000)) - (b.date || new Date(8640000000000000))).map(row => `<tr><td>${dateText(row.date)}</td><td>${escapeHtml(row.event)}</td><td>${escapeHtml(row.customer)}</td><td>${escapeHtml(row.model)}</td><td>${escapeHtml(row.brand)}</td><td>${escapeHtml(row.product)}</td><td><span class="status ${eventStatusClass(row.status)}">${escapeHtml(row.status)}</span></td><td class="num">${number.format(row.planned)}</td><td class="num">${number.format(row.allocated)}</td><td class="num">${number.format(row.shipped)}</td><td class="num">${number.format(row.remaining)}</td><td class="num">${row.sales ? currency.format(row.sales) : "—"}</td></tr>`).join("") || emptyRow(12);
    el("events-row-count").textContent = `${number.format(rows.length)} rows`;
    requestAnimationFrame(renderEventCharts);
  }

  function renderEventCharts() {
    if (state.module !== "events") return;
    const rows = current().filteredEvents;
    const eventMap = d3.rollup(rows, group => ({ planned: d3.sum(group, row => row.planned), shipped: d3.sum(group, row => row.shipped) }), row => row.event);
    const eventData = Array.from(eventMap, ([key, value]) => ({ key, ...value })).sort((a, b) => b.planned - a.planned).slice(0, 10);
    drawEventFulfillment("events-fulfillment-chart", eventData);
    drawDonut("events-status-chart", rollup(rows, row => row.status, () => 1, 3), "Rows", value => number.format(value));
  }

  function drawEventFulfillment(id, data) {
    const container = el(id); container.innerHTML = "";
    if (!data.length || !data.some(item => item.planned || item.shipped)) return emptyChart(container);
    const width = Math.max(320, container.clientWidth), height = 350, margin = { top: 34, right: 18, bottom: 100, left: 58 };
    const innerWidth = width - margin.left - margin.right, innerHeight = height - margin.top - margin.bottom;
    const svg = d3.select(container).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", "Planned and shipped event quantities");
    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    const x0 = d3.scaleBand().domain(data.map(item => item.key)).range([0, innerWidth]).padding(.22), x1 = d3.scaleBand().domain(["planned", "shipped"]).range([0, x0.bandwidth()]).padding(.08);
    const y = d3.scaleLinear().domain([0, (d3.max(data, item => Math.max(item.planned, item.shipped)) || 1) * 1.12]).nice().range([innerHeight, 0]);
    const series = [{ key: "planned", label: "Planned", color: COLORS.blue }, { key: "shipped", label: "Shipped", color: COLORS.green }];
    g.append("g").attr("class", "grid").call(d3.axisLeft(y).ticks(5).tickSize(-innerWidth).tickFormat(""));
    g.selectAll("g.event-item").data(data).join("g").attr("class", "event-item").attr("transform", item => `translate(${x0(item.key)},0)`).selectAll("rect").data(item => series.map(s => ({ item, ...s }))).join("rect").attr("x", d => x1(d.key)).attr("y", d => y(d.item[d.key])).attr("width", x1.bandwidth()).attr("height", d => innerHeight - y(d.item[d.key])).attr("fill", d => d.color).on("pointerenter", (event, d) => showTooltip(event, `<strong>${escapeHtml(d.item.key)}</strong>${d.label}: ${number.format(d.item[d.key])}`)).on("pointermove", moveTooltip).on("pointerleave", hideTooltip);
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${innerHeight})`).call(d3.axisBottom(x0).tickFormat(value => truncate(value, 14))).selectAll("text").attr("transform", "rotate(-35)").attr("text-anchor", "end");
    g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(5));
    const legend = svg.append("g").attr("transform", `translate(${margin.left},10)`);
    series.forEach((s, index) => { const item = legend.append("g").attr("transform", `translate(${index * 100},0)`); item.append("rect").attr("width", 11).attr("height", 11).attr("rx", 2).attr("fill", s.color); item.append("text").attr("x", 17).attr("y", 10).attr("fill", COLORS.muted).attr("font-size", 10).text(s.label); });
  }

  function eventStatusClass(status) {
    const normalized = normalizeHeader(status);
    if (normalized.includes("complete") || normalized.includes("delivered") || normalized.includes("closed")) return "status-good";
    if (normalized.includes("cancel") || normalized.includes("late") || normalized.includes("risk")) return "status-risk";
    return "status-watch";
  }

  function resetFilters() {
    ["brand-filter", "status-filter", "abc-filter", "search-filter"].forEach(id => { el(id).value = ""; });
    applyFilters();
  }

  function applyFilters() {
    const region = current();
    const brand = el("brand-filter").value, status = el("status-filter").value, abc = el("abc-filter").value;
    const search = el("search-filter").value.trim().toLowerCase();
    region.filtered = region.analysis.filter(item => (!brand || item.brand === brand) && (!status || item.status === status) && (!abc || item.abc === abc) && (!search || `${item.model} ${item.product} ${item.itemid}`.toLowerCase().includes(search)));
    el("filter-result").textContent = `${number.format(region.filtered.length)} of ${number.format(region.analysis.length)} items • ${number.format(region.filtered.filter(item => item.reorderRequired).length)} require reorder`;
    renderAll();
  }

  function renderAll() {
    const region = current(), items = region.filtered;
    const sales = d3.sum(items, item => item.sales), units = d3.sum(items, item => item.salesUnits), margin = d3.sum(items, item => item.margin);
    const reorderItems = items.filter(item => item.reorderRequired), reorderUnits = d3.sum(reorderItems, item => item.recommended);
    const forecast = d3.sum(items, item => item.threeMonthForecast), inventory = d3.sum(items, item => item.available);
    renderKpiCards("overview-kpis", [
      ["Net sales", sales ? currency.format(sales) : "—", sales ? "From Sales Report" : "Upload Sales Report"],
      ["Units sold", number.format(units || d3.sum(items, item => item.vol3)), sales ? "Sales Report units" : "Item Report past 3M"],
      ["Items", number.format(items.length), `${unique(items.map(item => item.brand)).length} brands`],
      ["Inventory available", number.format(inventory), "Current stock available"],
      ["Reorder units", number.format(reorderUnits), `${reorderItems.length} affected items`],
      ["3M demand forecast", number.format(forecast), "Forecast units"]
    ]);
    renderKpiCards("sales-kpis", [
      ["Net sales", sales ? currency.format(sales) : "—", "Filtered product sales"],
      ["Units sold", units ? number.format(units) : "—", "Filtered product units"],
      ["Gross profit", sales ? currency.format(margin) : "—", "Sales less cost"],
      ["Gross margin", sales ? percent.format(margin / sales) : "—", "Gross profit ÷ sales"]
    ]);
    const rising = items.filter(item => item.trend > .15).length, falling = items.filter(item => item.trend < -.15).length;
    renderKpiCards("forecast-kpis", [
      ["3M forecast", number.format(forecast), "Weighted demand units"],
      ["Average monthly demand", number.format(d3.sum(items, item => item.avg3)), "Past three-month run rate"],
      ["Rising demand", number.format(rising), "Items above +15%"],
      ["Falling demand", number.format(falling), "Items below −15%"]
    ]);
    const abcSummary = ["A", "B", "C"].map(code => ({ code, items: items.filter(item => item.abc === code) }));
    renderKpiCards("abc-kpis", abcSummary.map(group => [`Class ${group.code}`, number.format(group.items.length), `${percent.format(d3.sum(group.items, item => item.contribution))} contribution`]));
    renderKpiCards("reorder-kpis", [
      ["Reorder SKUs", number.format(reorderItems.length), "Eligible items only"],
      ["Recommended units", number.format(reorderUnits), "Based on Avg/PerM Past 3M"],
      ["Open supplier qty", number.format(d3.sum(reorderItems, item => item.openSupplier)), "For reorder items"],
      ["Open client orders", number.format(d3.sum(reorderItems, item => item.openClient)), "For reorder items"]
    ]);
    el("data-status").textContent = `${region.salesFile ? region.salesFile.name : "No Sales Report"} • ${region.itemFile ? region.itemFile.name : "No Item Sales Report"}`;
    renderTables(); renderInsights(); renderCharts();
  }

  function renderKpiCards(id, cards) {
    el(id).innerHTML = cards.map(card => `<article class="kpi-card"><p class="kpi-label">${card[0]}</p><div class="kpi-value">${card[1]}</div><p class="kpi-meta">${card[2]}</p></article>`).join("");
  }

  function renderTables() {
    const items = current().filtered;
    const ranked = items.slice().sort((a, b) => a.rank - b.rank);
    el("sales-table").innerHTML = ranked.map(item => `<tr><td>${item.rank}</td><td>${escapeHtml(item.model)}</td><td>${escapeHtml(item.brand)}</td><td>${escapeHtml(item.product)}</td><td class="num">${number.format(item.salesUnits)}</td><td class="num">${item.sales ? currency.format(item.sales) : "—"}</td><td class="num">${item.sales ? currency.format(item.margin) : "—"}</td><td class="num">${item.sales ? percent.format(item.marginRate) : "—"}</td><td>${classBadge(item.abc)}</td></tr>`).join("") || emptyRow(9);
    el("forecast-table").innerHTML = items.slice().sort((a, b) => b.threeMonthForecast - a.threeMonthForecast).map(item => `<tr><td>${escapeHtml(item.model)}</td><td>${escapeHtml(item.brand)}</td><td>${escapeHtml(item.product)}</td><td class="num">${number.format(item.vol3)}</td><td class="num">${number.format(item.last30)}</td><td class="num">${decimal.format(item.avg3)}</td><td class="num">${number.format(item.threeMonthForecast)}</td><td class="num">${number.format(item.available)}</td><td class="num">${Number.isFinite(item.monthsCover) ? decimal.format(item.monthsCover) : "—"}</td><td class="${item.trend > .15 ? "trend-up" : item.trend < -.15 ? "trend-down" : ""}">${trendText(item.trend)}</td></tr>`).join("") || emptyRow(10);
    el("abc-table").innerHTML = ranked.map(item => `<tr><td>${item.rank}</td><td>${classBadge(item.abc)}</td><td>${escapeHtml(item.model)}</td><td>${escapeHtml(item.brand)}</td><td>${escapeHtml(item.product)}</td><td class="num">${item.sales ? currency.format(item.sales) : "—"}</td><td class="num">${number.format(item.salesUnits || item.vol3)}</td><td class="num">${percent.format(item.contribution)}</td><td class="num">${percent.format(item.cumulative)}</td><td class="num">${number.format(item.available)}</td></tr>`).join("") || emptyRow(10);
    const reorders = items.filter(item => item.reorderRequired).sort((a, b) => b.recommended - a.recommended);
    el("reorder-table").innerHTML = reorders.map(item => `<tr><td>${escapeHtml(item.model)}</td><td>${escapeHtml(item.brand)}</td><td>${escapeHtml(item.product)}</td><td>${escapeHtml(item.status)}</td><td class="num">${number.format(item.openClient)}</td><td class="num">${number.format(item.stockQty)}</td><td class="num">${number.format(item.available)}</td><td class="num">${number.format(item.openSupplier)}</td><td>${escapeHtml(item.supplierWindow || "")}</td><td class="num">${Number.isFinite(item.daysUntil) ? number.format(item.daysUntil) : ""}</td><td class="num">${number.format(item.recommended)}</td><td><span class="status status-risk">REORDER</span></td><td>${dateText(item.supplierStart)}</td><td>${dateText(item.supplierEnd)}</td><td>${escapeHtml(item.reorderReason)}</td></tr>`).join("") || emptyRow(15, "No reorder-required items match the filters.");
    const rawItems = items.filter(item => item.status !== "Sales only");
    el("raw-table").innerHTML = rawItems.map(item => `<tr><td>${escapeHtml(item.brand)}</td><td>${escapeHtml(item.itemid)}</td><td>${escapeHtml(item.model)}</td><td>${escapeHtml(item.product)}</td><td>${escapeHtml(item.status)}</td><td>${dateText(item.eta)}</td><td class="num">${number.format(item.vol3)}</td><td class="num">${number.format(item.last30)}</td><td class="num">${decimal.format(item.avg3)}</td><td class="num">${number.format(item.stockQty)}</td><td class="num">${number.format(item.available)}</td><td class="num">${number.format(item.openClient)}</td><td class="num">${number.format(item.openSupplier)}</td><td>${escapeHtml(item.supplierWindow)}</td></tr>`).join("") || emptyRow(14);
    el("raw-count").textContent = `${number.format(rawItems.length)} items`;
  }

  function renderInsights() {
    const items = current().filtered;
    if (!items.length) { el("insight-list").innerHTML = '<div class="empty-state">No items match the filters.</div>'; return; }
    const top = items.slice().sort((a, b) => a.rank - b.rank)[0];
    const lowCover = items.filter(item => item.avg3 > 0 && item.monthsCover < 1).sort((a, b) => a.monthsCover - b.monthsCover)[0];
    const delayed = items.filter(item => item.reorderRequired && Number.isFinite(item.daysUntil)).sort((a, b) => b.daysUntil - a.daysUntil)[0];
    const insights = [
      ["ABC priority", top.product, `${classBadgeText(top.abc)} item ranked #${top.rank}, contributing ${percent.format(top.contribution)} of the selected portfolio.`],
      lowCover ? ["Coverage risk", lowCover.product, `${decimal.format(lowCover.monthsCover)} months of cover with ${number.format(lowCover.available)} units available.`] : ["Coverage", "No immediate stock-cover risk", "No filtered item is below one month of cover."],
      delayed ? ["Supplier timing", delayed.product, `${number.format(delayed.daysUntil)} days until the latest supplier delivery window.`] : ["Supplier timing", "No delayed reorder items", "No filtered reorder item has a dated supplier delay."]
    ];
    el("insight-list").innerHTML = insights.map(item => `<article class="insight"><span class="signal">${item[0]}</span><strong>${escapeHtml(item[1])}</strong><p>${item[2]}</p></article>`).join("");
  }

  function activateTab(name) {
    state.tab = name;
    document.querySelectorAll(".tab").forEach(button => { const active = button.dataset.tab === name; button.classList.toggle("active", active); button.setAttribute("aria-selected", String(active)); });
    document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.add("hidden"));
    el(`${name}-panel`).classList.remove("hidden");
    const titles = { overview: "Executive overview", sales: "Sales analysis", forecast: "Demand forecast", abc: "ABC analysis", reorder: "Reorder report", raw: "Item sales data" };
    el("dashboard-title").textContent = titles[name];
    requestAnimationFrame(renderCharts);
  }

  function openSettings() {
    const settings = current().settings;
    el("setting-coverage").value = settings.coverage; el("setting-safety").value = settings.safety; el("setting-critical").value = settings.critical; el("setting-delay").value = settings.delay; el("setting-a").value = settings.a; el("setting-b").value = settings.b; el("setting-abc-metric").value = settings.abcMetric; el("setting-forecast-method").value = settings.forecastMethod;
    el("settings-dialog").showModal();
  }

  function saveSettings(event) {
    if (event.submitter && event.submitter.value === "cancel") return;
    event.preventDefault();
    const next = { coverage: finite(toNumber(el("setting-coverage").value)), safety: finite(toNumber(el("setting-safety").value)), critical: finite(toNumber(el("setting-critical").value)), delay: finite(toNumber(el("setting-delay").value)), a: finite(toNumber(el("setting-a").value)), b: finite(toNumber(el("setting-b").value)), abcMetric: el("setting-abc-metric").value, forecastMethod: el("setting-forecast-method").value };
    if (next.a <= 0 || next.a >= next.b || next.b > 100) { window.alert("ABC thresholds must satisfy: A > 0, A < B, and B ≤ 100."); return; }
    current().settings = next;
    if (current().analyzed) { current().analysis = buildAnalysis(current()); populateFilters(); applyFilters(); }
    el("settings-dialog").close();
  }

  function clearRegion() {
    if (!window.confirm(`Clear all uploaded ${REGION_NAMES[state.region]} data from this browser session?`)) return;
    regions[state.region] = { salesFile: null, itemFile: null, eventFile: null, salesRows: [], itemRows: [], eventRows: [], filteredEvents: [], analysis: [], filtered: [], settings: { ...DEFAULT_SETTINGS }, analyzed: false };
    updateRegionUI();
  }

  function clearEvents() {
    if (!window.confirm(`Clear the uploaded ${REGION_NAMES[state.region]} Events Report from this browser session?`)) return;
    const region = current();
    region.eventFile = null;
    region.eventRows = [];
    region.filteredEvents = [];
    resetEventFilters();
    updateRegionUI();
  }

  function renderCharts() {
    if (!current().analyzed) return;
    const items = current().filtered;
    drawDonut("overview-abc-chart", ["A", "B", "C"].map(code => ({ key: `Class ${code}`, value: d3.sum(items.filter(item => item.abc === code), item => item.abcMetricUsed === "sales" ? item.sales : item.salesUnits) })), "ABC contribution", value => shortNumber(value));
    const reorderByBrand = rollup(items.filter(item => item.reorderRequired), item => item.brand, item => item.recommended, 10);
    drawBars("overview-reorder-chart", reorderByBrand, value => number.format(value), COLORS.red);
    const salesMonths = Array.from(d3.rollup(current().salesRows.filter(row => row.date), rows => d3.sum(rows, row => row.sales), row => +new Date(row.date.getFullYear(), row.date.getMonth(), 1)), ([date, value]) => ({ date: new Date(+date), value })).sort((a, b) => a.date - b.date);
    drawLine("sales-trend-chart", salesMonths);
    drawBars("sales-brand-chart", rollup(items, item => item.brand, item => item.sales, 10), value => currency.format(value), COLORS.teal);
    drawDemandComparison("demand-chart", items.slice().sort((a, b) => b.avg3 - a.avg3).slice(0, 12));
    drawBars("forecast-chart", items.slice().sort((a, b) => b.threeMonthForecast - a.threeMonthForecast).slice(0, 10).map(item => ({ key: item.product, value: item.threeMonthForecast })), value => number.format(value), COLORS.orange);
    drawPareto("pareto-chart", items.slice().sort((a, b) => a.rank - b.rank));
    drawDonut("abc-donut", ["A", "B", "C"].map(code => ({ key: `Class ${code}`, value: items.filter(item => item.abc === code).length })), "Items", value => number.format(value));
  }

  function drawBars(id, data, formatter, color) {
    const container = el(id); container.innerHTML = "";
    if (!data.length || !data.some(item => item.value)) return emptyChart(container);
    const width = Math.max(300, container.clientWidth), rowHeight = Math.max(28, Math.min(38, 300 / data.length)), height = Math.max(290, data.length * rowHeight + 48);
    const margin = { top: 10, right: 30, bottom: 32, left: Math.min(width * .44, Math.max(100, d3.max(data, item => item.key.length) * 6.1)) };
    const innerWidth = width - margin.left - margin.right, innerHeight = height - margin.top - margin.bottom;
    const svg = d3.select(container).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", "Ranked comparison chart");
    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    const x = d3.scaleLinear().domain([0, (d3.max(data, item => item.value) || 1) * 1.06]).range([0, innerWidth]);
    const y = d3.scaleBand().domain(data.map(item => item.key)).range([0, innerHeight]).padding(.28);
    g.selectAll(".track").data(data).join("rect").attr("x", 0).attr("y", item => y(item.key)).attr("width", innerWidth).attr("height", y.bandwidth()).attr("rx", 4).attr("fill", COLORS.soft);
    g.selectAll(".bar").data(data).join("rect").attr("x", 0).attr("y", item => y(item.key)).attr("width", item => x(item.value)).attr("height", y.bandwidth()).attr("rx", 4).attr("fill", color).on("pointerenter", (event, item) => showTooltip(event, `<strong>${escapeHtml(item.key)}</strong>${formatter(item.value)}`)).on("pointermove", moveTooltip).on("pointerleave", hideTooltip);
    g.append("g").attr("class", "axis").call(d3.axisLeft(y).tickSize(0).tickFormat(value => truncate(value, 22))).call(axis => axis.select(".domain").remove());
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${innerHeight})`).call(d3.axisBottom(x).ticks(4).tickFormat(shortNumber));
  }

  function drawDonut(id, data, centerLabel, formatter) {
    const container = el(id); container.innerHTML = "";
    const total = d3.sum(data, item => item.value);
    if (!total) return emptyChart(container);
    const width = Math.max(300, container.clientWidth), narrow = width < 500, height = 350, radius = narrow ? 82 : 105, centerX = narrow ? width / 2 : Math.min(width * .34, 160), centerY = narrow ? 110 : 175;
    const palette = [COLORS.teal, COLORS.orange, COLORS.red];
    const svg = d3.select(container).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", centerLabel);
    const group = svg.append("g").attr("transform", `translate(${centerX},${centerY})`);
    const pie = d3.pie().sort(null).value(item => item.value), arc = d3.arc().innerRadius(radius * .61).outerRadius(radius);
    group.selectAll("path").data(pie(data)).join("path").attr("d", arc).attr("fill", (item, index) => palette[index]).attr("stroke", "white").attr("stroke-width", 2).on("pointerenter", (event, item) => showTooltip(event, `<strong>${item.data.key}</strong>${formatter(item.data.value)}<br>${percent.format(item.data.value / total)}`)).on("pointermove", moveTooltip).on("pointerleave", hideTooltip);
    group.append("text").attr("text-anchor", "middle").attr("y", -3).attr("fill", COLORS.muted).attr("font-size", 11).text(centerLabel);
    group.append("text").attr("text-anchor", "middle").attr("y", 22).attr("fill", COLORS.navy).attr("font-size", 19).attr("font-weight", 700).text(formatter(total));
    const legend = svg.append("g").attr("transform", narrow ? `translate(28,235)` : `translate(${Math.min(width * .65, 330)},110)`);
    data.forEach((item, index) => {
      const row = legend.append("g").attr("transform", narrow ? `translate(${(index % 3) * (width - 56) / 3},0)` : `translate(0,${index * 52})`);
      row.append("circle").attr("cx", 5).attr("cy", 5).attr("r", 5).attr("fill", palette[index]);
      row.append("text").attr("x", 17).attr("y", 8).attr("fill", COLORS.navy).attr("font-size", 11).text(item.key);
      row.append("text").attr("x", 17).attr("y", 25).attr("fill", COLORS.muted).attr("font-size", 10).text(percent.format(item.value / total));
    });
  }

  function drawLine(id, data) {
    const container = el(id); container.innerHTML = "";
    if (data.length < 2 || !data.some(item => item.value)) return emptyChart(container, "Upload a dated Sales Report to view the monthly sales trend.");
    const width = Math.max(320, container.clientWidth), height = 350, margin = { top: 18, right: 20, bottom: 42, left: 68 };
    const innerWidth = width - margin.left - margin.right, innerHeight = height - margin.top - margin.bottom;
    const svg = d3.select(container).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", "Monthly sales trend");
    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    const x = d3.scaleTime().domain(d3.extent(data, item => item.date)).range([0, innerWidth]);
    const y = d3.scaleLinear().domain([0, (d3.max(data, item => item.value) || 1) * 1.12]).nice().range([innerHeight, 0]);
    g.append("g").attr("class", "grid").call(d3.axisLeft(y).ticks(5).tickSize(-innerWidth).tickFormat(""));
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${innerHeight})`).call(d3.axisBottom(x).ticks(width < 600 ? 4 : 8).tickFormat(d3.timeFormat("%b %y")));
    g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(5).tickFormat(value => shortCurrency(value)));
    const line = d3.line().x(item => x(item.date)).y(item => y(item.value)).curve(d3.curveMonotoneX);
    g.append("path").datum(data).attr("fill", "none").attr("stroke", COLORS.teal).attr("stroke-width", 3).attr("d", line);
    g.selectAll("circle").data(data).join("circle").attr("cx", item => x(item.date)).attr("cy", item => y(item.value)).attr("r", 4).attr("fill", COLORS.teal).attr("stroke", "white").attr("stroke-width", 1.5).on("pointerenter", (event, item) => showTooltip(event, `<strong>${monthLabel(item.date)}</strong>${currency.format(item.value)}`)).on("pointermove", moveTooltip).on("pointerleave", hideTooltip);
  }

  function drawDemandComparison(id, items) {
    const container = el(id); container.innerHTML = "";
    if (!items.length) return emptyChart(container);
    const width = Math.max(320, container.clientWidth), height = 350, margin = { top: 34, right: 18, bottom: 100, left: 58 };
    const innerWidth = width - margin.left - margin.right, innerHeight = height - margin.top - margin.bottom;
    const svg = d3.select(container).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", "Average monthly demand compared with last 30 days");
    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    const x0 = d3.scaleBand().domain(items.map(item => item.model)).range([0, innerWidth]).padding(.22), x1 = d3.scaleBand().domain(["avg3", "last30"]).range([0, x0.bandwidth()]).padding(.08);
    const y = d3.scaleLinear().domain([0, (d3.max(items, item => Math.max(item.avg3, item.last30)) || 1) * 1.12]).nice().range([innerHeight, 0]);
    const series = [{ key: "avg3", label: "3M monthly average", color: COLORS.teal }, { key: "last30", label: "Last 30 days", color: COLORS.orange }];
    g.append("g").attr("class", "grid").call(d3.axisLeft(y).ticks(5).tickSize(-innerWidth).tickFormat(""));
    g.selectAll("g.item").data(items).join("g").attr("class", "item").attr("transform", item => `translate(${x0(item.model)},0)`).selectAll("rect").data(item => series.map(s => ({ item, ...s }))).join("rect").attr("x", d => x1(d.key)).attr("y", d => y(d.item[d.key])).attr("width", x1.bandwidth()).attr("height", d => innerHeight - y(d.item[d.key])).attr("fill", d => d.color).on("pointerenter", (event, d) => showTooltip(event, `<strong>${escapeHtml(d.item.product)}</strong>${d.label}: ${decimal.format(d.item[d.key])}`)).on("pointermove", moveTooltip).on("pointerleave", hideTooltip);
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${innerHeight})`).call(d3.axisBottom(x0).tickFormat(value => truncate(value, 13))).selectAll("text").attr("transform", "rotate(-35)").attr("text-anchor", "end");
    g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(5));
    const legend = svg.append("g").attr("transform", `translate(${margin.left},10)`);
    series.forEach((s, index) => { const item = legend.append("g").attr("transform", `translate(${index * 150},0)`); item.append("rect").attr("width", 11).attr("height", 11).attr("rx", 2).attr("fill", s.color); item.append("text").attr("x", 17).attr("y", 10).attr("fill", COLORS.muted).attr("font-size", 10).text(s.label); });
  }

  function drawPareto(id, items) {
    const container = el(id); container.innerHTML = "";
    const data = items.slice(0, Math.min(40, items.length));
    if (!data.length) return emptyChart(container);
    const width = Math.max(320, container.clientWidth), height = 350, margin = { top: 20, right: 58, bottom: 45, left: 58 };
    const innerWidth = width - margin.left - margin.right, innerHeight = height - margin.top - margin.bottom;
    const svg = d3.select(container).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", "ABC Pareto cumulative contribution chart");
    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    const x = d3.scaleLinear().domain([1, Math.max(2, data.length)]).range([0, innerWidth]), y = d3.scaleLinear().domain([0, 1]).range([innerHeight, 0]);
    g.append("g").attr("class", "grid").call(d3.axisLeft(y).ticks(5).tickSize(-innerWidth).tickFormat(""));
    [current().settings.a / 100, current().settings.b / 100].forEach((threshold, index) => {
      g.append("line").attr("class", "threshold-line").attr("x1", 0).attr("x2", innerWidth).attr("y1", y(threshold)).attr("y2", y(threshold));
      g.append("text").attr("class", "threshold-label").attr("x", innerWidth - 3).attr("y", y(threshold) - 5).attr("text-anchor", "end").text(index ? `B ${percent.format(threshold)}` : `A ${percent.format(threshold)}`);
    });
    const line = d3.line().x(item => x(item.rank)).y(item => y(item.cumulative)).curve(d3.curveMonotoneX);
    g.append("path").datum(data).attr("fill", "none").attr("stroke", COLORS.teal).attr("stroke-width", 3).attr("d", line);
    g.selectAll("circle").data(data).join("circle").attr("cx", item => x(item.rank)).attr("cy", item => y(item.cumulative)).attr("r", 3.5).attr("fill", item => item.abc === "A" ? COLORS.teal : item.abc === "B" ? COLORS.orange : COLORS.red).on("pointerenter", (event, item) => showTooltip(event, `<strong>#${item.rank} ${escapeHtml(item.product)}</strong>Class ${item.abc}<br>Cumulative: ${percent.format(item.cumulative)}`)).on("pointermove", moveTooltip).on("pointerleave", hideTooltip);
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${innerHeight})`).call(d3.axisBottom(x).ticks(6).tickFormat(value => `#${Math.round(value)}`));
    g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(5).tickFormat(percent.format));
    g.append("g").attr("class", "axis").attr("transform", `translate(${innerWidth},0)`).call(d3.axisRight(y).ticks(5).tickFormat(percent.format));
  }

  function emptyChart(container, message = "No data available for this view.") { container.innerHTML = `<div class="empty-state">${message}</div>`; }

  function exportActiveWorkbook() {
    if (state.module === "events") exportEventsWorkbook();
    else exportWorkbook();
  }

  function exportWorkbook() {
    const region = current();
    if (!region.analyzed || !window.XLSX) return;
    const workbook = XLSX.utils.book_new();
    const rawRows = region.analysis.filter(item => item.status !== "Sales only").map(item => ({
      Brand: item.brand, itemid: item.itemid, "Model#": item.model, "Item Title": item.product, Status: item.status, ETA: dateText(item.eta), "Vol Past 3M": item.vol3, "Vol Last 30 Days": item.last30, "Avg/PerM Past 3M": item.avg3, "Stock Qty": item.stockQty, "Stock Available": item.available, "STOCK difference": item.stockDifference, "OPEN ORDERS FROM CLIENT": item.openClient, "Open Supplier Qty": item.openSupplier, "Supplier Delivery Window": item.supplierWindow, "Days Until Supplier Delivery": item.daysUntil ?? "", "3M Demand Forecast": item.threeMonthForecast, "ABC Class": item.abc, "Reorder Status": item.reorderRequired ? "REORDER" : item.excluded || !item.eligible ? "EXCLUDED" : "OK", "Reorder Reason": item.reorderReason
    }));
    const reorderRows = region.analysis.filter(item => item.reorderRequired).sort((a, b) => b.recommended - a.recommended).map(item => [item.model, item.brand, item.product, item.status, item.openClient, item.stockQty, item.available, item.openSupplier, item.supplierWindow, item.daysUntil ?? "", item.recommended, "REORDER", dateText(item.supplierStart), dateText(item.supplierEnd), item.reorderReason]);
    const reorderAoa = [[`Reorder Report - ${REGION_NAMES[state.region]} / Status: LIVE, FASHION, BACKORDER / Reorder Required Only`], ["Generated from the uploaded Item Sales Report and current regional settings."], ["Model#", "Brand", "Item Title", "Status", "OPEN ORDERS FROM CLIENT", "ON HAND", "Stock Available", "Open Supplier Qty", "Supplier Delivery Window", "Days Until Supplier Delivery", "Recommended Reorder Qty", "Reorder Status", "Earlier start date", "Latest End Date", "Reorder Reason"], ...reorderRows];
    const abcRows = region.analysis.slice().sort((a, b) => a.rank - b.rank).map(item => ({ Rank: item.rank, Class: item.abc, "Model#": item.model, Brand: item.brand, "Item Title": item.product, Sales: item.sales, Units: item.salesUnits || item.vol3, Contribution: item.contribution, Cumulative: item.cumulative, "Stock Available": item.available }));
    const forecastRows = region.analysis.slice().sort((a, b) => b.threeMonthForecast - a.threeMonthForecast).map(item => ({ "Model#": item.model, Brand: item.brand, "Item Title": item.product, "Vol Past 3M": item.vol3, "Vol Last 30 Days": item.last30, "Avg/PerM Past 3M": item.avg3, "Forecast Monthly": item.forecastMonthly, "3M Forecast": item.threeMonthForecast, "Stock Available": item.available, "Months Cover": Number.isFinite(item.monthsCover) ? item.monthsCover : "", Trend: item.trend }));
    const salesRows = region.analysis.slice().sort((a, b) => b.sales - a.sales).map(item => ({ Rank: item.rank, "Model#": item.model, Brand: item.brand, "Item Title": item.product, Units: item.salesUnits, Sales: item.sales, "Gross Profit": item.margin, "Gross Margin": item.marginRate, "ABC Class": item.abc }));
    const settings = region.settings;
    const settingsAoa = [["Setting", "Value", "Description"], ["Coverage Months", settings.coverage, "Recommended reorder quantity multiplier"], ["Safety Stock Months", settings.safety, "Additional demand coverage"], ["Critical Stock Threshold", settings.critical, "Reorder when Stock Available + Open Supplier Qty is at or below this value"], ["Supplier Delivery Delay Days", settings.delay, "Reorder trigger for a later supplier delivery window"], ["A Class Threshold", settings.a / 100, "Cumulative ABC contribution threshold"], ["B Class Threshold", settings.b / 100, "Cumulative ABC contribution threshold"], ["ABC Metric", settings.abcMetric, "Uses sales when available, otherwise units"], ["Forecast Method", settings.forecastMethod, "Weighted uses 60% last 30 days and 40% three-month average"]];
    const instructions = [["How this regional report works", ""], [1, "RAW REPORT contains normalized item sales, stock and calculated helper fields."], [2, "REORDER REPORT includes only Live, Fashion and Backorder items requiring action."], [3, "Feeds Only, Internal Use and Presentation items are excluded."], [4, "Recommended Reorder Qty uses Avg/PerM Past 3M multiplied by coverage plus safety-stock months."], [5, "ABC Analysis ranks items by sales revenue when available, otherwise units."], [6, "A, B and C classes use the cumulative thresholds in REORDER SETTINGS."], [7, "Demand Forecast uses the selected method in REORDER SETTINGS."], [8, `This workbook was generated separately for ${REGION_NAMES[state.region]}.`]];
    const sheets = [
      ["RAW REPORT", XLSX.utils.json_to_sheet(rawRows), [18, 10, 20, 55, 13, 13, 14, 17, 20, 12, 16, 17, 22, 18, 25, 18, 18, 12, 15, 60]],
      ["REORDER REPORT", XLSX.utils.aoa_to_sheet(reorderAoa), [20, 20, 55, 13, 18, 12, 16, 18, 26, 18, 20, 15, 16, 16, 65]],
      ["REORDER SETTINGS", XLSX.utils.aoa_to_sheet(settingsAoa), [30, 25, 80]],
      ["ABC ANALYSIS", XLSX.utils.json_to_sheet(abcRows), [10, 10, 20, 20, 55, 16, 14, 16, 16, 18]],
      ["DEMAND FORECAST", XLSX.utils.json_to_sheet(forecastRows), [20, 20, 55, 16, 18, 18, 18, 18, 18, 16, 14]],
      ["SALES ANALYSIS", XLSX.utils.json_to_sheet(salesRows), [10, 20, 20, 55, 14, 16, 18, 16, 12]],
      ["INSTRUCTIONS", XLSX.utils.aoa_to_sheet(instructions), [30, 110]]
    ];
    sheets.forEach(([name, sheet, widths]) => { sheet["!cols"] = widths.map(wch => ({ wch })); XLSX.utils.book_append_sheet(workbook, sheet, name); });
    const workbookType = state.module === "sales" ? "Sales Analysis" : "Inventory Report";
    XLSX.writeFile(workbook, `${workbookType} ${state.region === "Canada" ? "CA" : state.region}.xlsx`, { compression: true });
  }

  function eventExportRows(rows) {
    return rows.map(row => ({
      "Event Date": dateText(row.date), Event: row.event, Customer: row.customer, "Model#": row.model, Brand: row.brand, "Item Title": row.product, Status: row.status,
      "Planned Qty": row.planned, "Allocated Qty": row.allocated, "Shipped Qty": row.shipped, "Remaining Qty": row.remaining, Sales: row.sales
    }));
  }

  function exportEventsWorkbook() {
    const region = current();
    if (!region.eventRows.length || !window.XLSX) return;
    const workbook = XLSX.utils.book_new(), sheet = XLSX.utils.json_to_sheet(eventExportRows(region.eventRows));
    sheet["!cols"] = [14, 28, 24, 20, 20, 48, 16, 16, 16, 16, 16, 16].map(wch => ({ wch }));
    XLSX.utils.book_append_sheet(workbook, sheet, "EVENTS");
    const summary = XLSX.utils.aoa_to_sheet([
      [`Events Summary - ${REGION_NAMES[state.region]}`],
      ["Metric", "Value"],
      ["Events", unique(region.eventRows.map(row => row.event)).length],
      ["Planned Units", d3.sum(region.eventRows, row => row.planned)],
      ["Allocated Units", d3.sum(region.eventRows, row => row.allocated)],
      ["Shipped Units", d3.sum(region.eventRows, row => row.shipped)],
      ["Event Sales", d3.sum(region.eventRows, row => row.sales)]
    ]);
    summary["!cols"] = [{ wch: 28 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(workbook, summary, "EVENT SUMMARY");
    XLSX.writeFile(workbook, `Events Report ${state.region === "Canada" ? "CA" : state.region}.xlsx`, { compression: true });
  }

  function exportEventsCsv() {
    const rows = current().filteredEvents;
    const headers = ["Event Date", "Event", "Customer", "Model#", "Brand", "Item Title", "Status", "Planned Qty", "Allocated Qty", "Shipped Qty", "Remaining Qty", "Sales"];
    const data = rows.map(row => [dateText(row.date), row.event, row.customer, row.model, row.brand, row.product, row.status, row.planned, row.allocated, row.shipped, row.remaining, row.sales]);
    downloadCsv([headers, ...data], `${state.region === "Canada" ? "CA" : state.region}-events-report.csv`);
  }

  function exportCurrentCsv() {
    const items = current().filtered;
    let rows;
    if (state.tab === "reorder") rows = items.filter(item => item.reorderRequired).map(item => [item.model, item.brand, item.product, item.status, item.openClient, item.stockQty, item.available, item.openSupplier, item.supplierWindow, item.daysUntil ?? "", item.recommended, "REORDER", dateText(item.supplierStart), dateText(item.supplierEnd), item.reorderReason]);
    else if (state.tab === "abc") rows = items.map(item => [item.rank, item.abc, item.model, item.brand, item.product, item.sales, item.salesUnits || item.vol3, item.contribution, item.cumulative, item.available]);
    else if (state.tab === "forecast") rows = items.map(item => [item.model, item.brand, item.product, item.vol3, item.last30, item.avg3, item.threeMonthForecast, item.available, Number.isFinite(item.monthsCover) ? item.monthsCover : "", item.trend]);
    else rows = items.map(item => [item.model, item.brand, item.product, item.status, item.salesUnits, item.sales, item.margin, item.abc, item.available, item.recommended]);
    const headers = state.tab === "reorder" ? ["Model#", "Brand", "Item Title", "Status", "Open Client", "On Hand", "Stock Available", "Open Supplier Qty", "Supplier Delivery Window", "Days Until Delivery", "Recommended Reorder Qty", "Reorder Status", "Earlier Start", "Latest End", "Reorder Reason"] : state.tab === "abc" ? ["Rank", "Class", "Model#", "Brand", "Item Title", "Sales", "Units", "Contribution", "Cumulative", "Available"] : state.tab === "forecast" ? ["Model#", "Brand", "Item Title", "Past 3M", "Last 30 Days", "Avg/Month", "3M Forecast", "Available", "Months Cover", "Trend"] : ["Model#", "Brand", "Item Title", "Status", "Units", "Sales", "Gross Profit", "ABC", "Available", "Recommended Reorder"];
    downloadCsv([headers, ...rows], `${state.region}-${state.tab}-report.csv`);
  }

  function downloadCsv(rows, filename) {
    const csv = rows.map(row => row.map(csvCell).join(",")).join("\n"), blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = filename; link.click(); URL.revokeObjectURL(link.href);
  }

  function rollup(items, keyFn, valueFn, limit) { return Array.from(d3.rollup(items, rows => d3.sum(rows, valueFn), keyFn), ([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value).slice(0, limit); }
  function unique(values) { return Array.from(new Set(values.filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b))); }
  function uniqueMonths(rows) { return new Set(rows.filter(row => row.date).map(row => `${row.date.getFullYear()}-${row.date.getMonth()}`)).size || 1; }
  function itemKey(model, product) { return normalizeHeader(model || product || ""); }
  function cleanText(value) { return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim(); }
  function normalizeHeader(value) { return cleanText(value).toLowerCase().replace(/[_-]+/g, " ").replace(/[^a-z0-9#% ]/g, "").replace(/\s+/g, " ").trim(); }
  function textValue(value, fallback = "") { const result = cleanText(value); return result || fallback; }
  function finite(value) { return Number.isFinite(value) ? value : 0; }
  function toNumber(value) { if (typeof value === "number") return value; const raw = String(value ?? "").trim(); if (!raw) return NaN; const negative = /^\(.*\)$/.test(raw); const result = Number(raw.replace(/[,$%()]/g, "").replace(/\s/g, "")); return negative ? -result : result; }
  function parseDate(value) { if (value instanceof Date && !isNaN(value)) return value; const raw = cleanText(value); if (!raw) return null; const parsed = new Date(/^\d{4}-\d{1,2}$/.test(raw) ? `${raw}-01T00:00:00` : raw); return isNaN(parsed) ? null : parsed; }
  function startOfToday() { const date = new Date(); return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
  function dateText(date) { return date instanceof Date && !isNaN(date) ? date.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }) : ""; }
  function trendText(value) { if (!Number.isFinite(value)) return "—"; if (value > .15) return `▲ ${percent.format(value)}`; if (value < -.15) return `▼ ${percent.format(Math.abs(value))}`; return `Stable ${percent.format(Math.abs(value))}`; }
  function classBadge(code) { return `<span class="class-badge class-${String(code).toLowerCase()}">${code}</span>`; }
  function classBadgeText(code) { return `Class ${code}`; }
  function emptyRow(cols, message = "No data matches the current filters.") { return `<tr><td colspan="${cols}">${message}</td></tr>`; }
  function shortNumber(value) { const abs = Math.abs(value); if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`; if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`; if (abs >= 1e3) return `${(value / 1e3).toFixed(abs >= 1e5 ? 0 : 1)}K`; return `${Math.round(value)}`; }
  function shortCurrency(value) { return `${state.region === "EU" ? "€" : state.region === "Canada" ? "C$" : "$"}${shortNumber(value)}`; }
  function truncate(value, length) { const text = String(value); return text.length > length ? text.slice(0, length - 1) + "…" : text; }
  function csvCell(value) { const text = String(value ?? ""); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
  function debounce(fn, wait) { let timeout; return (...args) => { clearTimeout(timeout); timeout = setTimeout(() => fn(...args), wait); }; }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char])); }
  function showTooltip(event, html) { const tip = el("chart-tooltip"); tip.innerHTML = html; tip.hidden = false; moveTooltip(event); }
  function moveTooltip(event) { const tip = el("chart-tooltip"), pad = 14, rect = tip.getBoundingClientRect(); let left = event.clientX + pad, top = event.clientY + pad; if (left + rect.width > window.innerWidth - 8) left = event.clientX - rect.width - pad; if (top + rect.height > window.innerHeight - 8) top = event.clientY - rect.height - pad; tip.style.left = `${left}px`; tip.style.top = `${top}px`; }
  function hideTooltip() { el("chart-tooltip").hidden = true; }
})();
