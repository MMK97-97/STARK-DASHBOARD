(function (global) {
  "use strict";

  const DB_NAME = "stark-regional-inventory";
  const STORE_NAME = "datasets";
  const VERSION = 1;
  const REGION_NAMES = { US: "United States", EU: "European Union", Canada: "Canada" };
  const DEFAULT_SETTINGS = { critical: 3, coverage: 1, delay: 15, a: 80, b: 95 };
  const ITEM_ALIASES = {
    brand: ["brand"], itemid: ["itemid", "item id"], model: ["model#", "model", "model number", "sku"], product: ["item title", "product", "item name", "description"], status: ["status"], eta: ["eta"],
    vol3: ["vol past 3m", "volume past 3m", "past 3 months", "3 month sales", "3m units"], last30: ["vol last 30 days", "last 30 days", "30 day sales", "30d units"], avg3: ["avg/perm past 3m", "avg per m past 3m", "average per month past 3m", "avg monthly sales"],
    stockQty: ["stock qty", "on hand", "stock quantity"], available: ["stock available", "available", "ats", "available to sell"], stockDifference: ["stock difference"], openClient: ["open orders from client", "open client orders"], openSupplier: ["open supplier qty", "open orders to supplier", "open supplier orders"], supplierWindow: ["supplier delivery window", "delivery window"]
  };

  function getRegion() {
    const value = new URLSearchParams(location.search).get("region") || "US";
    return value === "EU" || value === "Canada" ? value : "US";
  }

  function regionCode(region) { return region === "Canada" ? "CA" : region; }
  function regionName(region) { return REGION_NAMES[region] || REGION_NAMES.US; }
  function cleanText(value) { return String(value == null ? "" : value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim(); }
  function normalizeHeader(value) { return cleanText(value).toLowerCase().replace(/[_-]+/g, " ").replace(/[^a-z0-9#% ]/g, "").replace(/\s+/g, " ").trim(); }
  function textValue(value, fallback) { return cleanText(value) || (fallback || ""); }
  function finite(value) { return Number.isFinite(value) ? value : 0; }
  function toNumber(value) { if (typeof value === "number") return value; const raw = String(value == null ? "" : value).trim(); if (!raw) return NaN; const negative = /^\(.*\)$/.test(raw); const result = Number(raw.replace(/[,$%()]/g, "").replace(/\s/g, "")); return negative ? -result : result; }
  function parseDate(value) { if (value instanceof Date && !isNaN(value)) return value; const raw = cleanText(value); if (!raw) return null; const parsed = new Date(/^\d{4}-\d{1,2}$/.test(raw) ? `${raw}-01T00:00:00` : raw); return isNaN(parsed) ? null : parsed; }
  function dateIso(date) { return date instanceof Date && !isNaN(date) ? date.toISOString() : ""; }
  function reviveDate(value) { return value ? parseDate(value) : null; }
  function dateText(value) { const date = value instanceof Date ? value : reviveDate(value); return date ? date.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }) : ""; }
  function escapeHtml(value) { return String(value == null ? "" : value).replace(/[&<>\"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[character])); }
  function csvCell(value) { const text = String(value == null ? "" : value); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
  function unique(values) { return Array.from(new Set(values.filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b))); }

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!global.indexedDB) return reject(new Error("IndexedDB is unavailable."));
      const request = indexedDB.open(DB_NAME, VERSION);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function databaseAction(mode, action) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode), store = transaction.objectStore(STORE_NAME), request = action(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    });
  }

  async function saveDataset(region, dataset) { try { return await databaseAction("readwrite", store => store.put(dataset, region)); } catch (_) { sessionStorage.setItem(`stark-inventory-${region}`, JSON.stringify(dataset)); return true; } }
  async function loadDataset(region) { try { return (await databaseAction("readonly", store => store.get(region))) || null; } catch (_) { const raw = sessionStorage.getItem(`stark-inventory-${region}`); return raw ? JSON.parse(raw) : null; } }
  async function clearDataset(region) { try { await databaseAction("readwrite", store => store.delete(region)); } catch (_) { sessionStorage.removeItem(`stark-inventory-${region}`); } }

  function settingsKey(region) { return `stark-inventory-settings-${region}`; }
  function brandKey(region) { return `stark-active-brands-${region}`; }
  function loadSettings(region) { try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(settingsKey(region)) || "{}") }; } catch (_) { return { ...DEFAULT_SETTINGS }; } }
  function saveSettings(region, settings) { localStorage.setItem(settingsKey(region), JSON.stringify({ ...DEFAULT_SETTINGS, ...settings })); }
  function loadBrandSettings(region) { try { return JSON.parse(localStorage.getItem(brandKey(region)) || "{}"); } catch (_) { return {}; } }
  function saveBrandSettings(region, settings) { localStorage.setItem(brandKey(region), JSON.stringify(settings)); }
  function ensureBrandSettings(region, rows) {
    const saved = loadBrandSettings(region);
    unique(rows.map(row => row.brand)).forEach(brand => { if (!saved[brand]) saved[brand] = { active: true, leadTime: "" }; });
    saveBrandSettings(region, saved);
    return saved;
  }

  async function readReportFile(file) {
    const bytes = await file.arrayBuffer();
    const prefix = new TextDecoder("utf-8").decode(bytes.slice(0, 5000)).trim().toLowerCase();
    if (prefix.includes("<table") || prefix.startsWith("<div") || prefix.startsWith("<html")) return parseHtmlReport(new TextDecoder("utf-8").decode(bytes));
    if (!global.XLSX) throw new Error("The Excel reader did not load. Refresh the page and try again.");
    const workbook = XLSX.read(bytes, { type: "array", cellDates: true }), candidates = [];
    workbook.SheetNames.forEach(name => candidates.push(XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: "", raw: false })));
    return candidates.sort((a, b) => b.length - a.length)[0] || [];
  }

  function directCells(row) { return Array.from(row.children).filter(child => child.tagName === "TD" || child.tagName === "TH"); }
  function parseHtmlReport(text) {
    const doc = new DOMParser().parseFromString(text, "text/html"), table = doc.querySelector("#gvreport") || doc.querySelector("table");
    if (!table) return [];
    const rows = Array.from(table.querySelectorAll("tr")).filter(row => row.closest("table") === table);
    if (!rows.length) return [];
    const headers = directCells(rows[0]).map(cell => cleanText(cell.textContent));
    return rows.slice(1).map(row => {
      const result = {}, cells = directCells(row);
      headers.forEach((header, index) => {
        const cell = cells[index];
        if (!cell) return result[header] = "";
        if (normalizeHeader(header) === "open orders to supplier") {
          const supplier = parseSupplierCell(cell);
          result[header] = supplier.windowText; result.__supplierQty = supplier.qty; result.__supplierPOs = supplier.pos; result.__supplierStart = dateIso(supplier.start); result.__supplierEnd = dateIso(supplier.end);
        } else {
          const clone = cell.cloneNode(true); clone.querySelectorAll("table").forEach(nested => nested.remove()); result[header] = cleanText(clone.textContent);
        }
      });
      return result;
    }).filter(row => Object.values(row).some(Boolean));
  }

  function parseSupplierCell(cell) {
    const nested = cell.querySelector("table");
    if (!nested) return parseSupplierText(cleanText(cell.textContent));
    const nestedRows = Array.from(nested.querySelectorAll("tr")).map(directCells).filter(cells => cells.length), headers = (nestedRows.shift() || []).map(cell => normalizeHeader(cell.textContent));
    let qty = 0; const windows = [], pos = [];
    nestedRows.forEach(cells => {
      const values = cells.map(cell => cleanText(cell.textContent));
      const poIndex = headers.findIndex(header => header === "po" || header === "po#" || header.includes("po")), qtyIndex = headers.findIndex(header => header === "qty" || header.includes("quantity")), windowIndex = headers.findIndex(header => header.includes("delivery window"));
      if (poIndex >= 0 && values[poIndex]) pos.push(values[poIndex]);
      if (qtyIndex >= 0) qty += finite(toNumber(values[qtyIndex]));
      if (windowIndex >= 0 && values[windowIndex]) windows.push(values[windowIndex]);
    });
    const range = windowRange(windows);
    return { qty, windowText: windows.join(" | "), pos: pos.join(", "), start: range.start, end: range.end };
  }

  function parseSupplierText(text) { const windows = String(text || "").match(/\d{1,2}\/\d{1,2}\/\d{4}\s*-\s*\d{1,2}\/\d{1,2}\/\d{4}/g) || [], range = windowRange(windows); return { qty: 0, windowText: windows.join(" | ") || text || "", pos: "", start: range.start, end: range.end }; }
  function windowRange(windows) { const dates = windows.flatMap(value => String(value).split(/\s*-\s*/).map(parseDate).filter(Boolean)).sort((a, b) => a - b); return { start: dates[0] || null, end: dates[dates.length - 1] || null }; }
  function detectMapping(headers, aliases) { const normalized = headers.map(original => ({ original, normalized: normalizeHeader(original) })), result = {}; Object.entries(aliases).forEach(([key, values]) => { const targets = values.map(normalizeHeader), exact = normalized.find(header => targets.includes(header.normalized)), fuzzy = normalized.find(header => targets.some(target => header.normalized.includes(target) || target.includes(header.normalized))); result[key] = (exact || fuzzy || {}).original || ""; }); return result; }

  function normalizeItemRows(rows) {
    if (!rows.length) return [];
    const mapping = detectMapping(Object.keys(rows[0]), ITEM_ALIASES), normalized = [];
    rows.forEach((row, index) => {
      const get = key => mapping[key] ? row[mapping[key]] : "", model = textValue(get("model")), product = textValue(get("product")), brand = textValue(get("brand"));
      if (!model && !product && !brand) return;
      const supplierText = textValue(get("supplierWindow"), textValue(get("openSupplier"))), parsed = parseSupplierText(supplierText), avgInput = finite(toNumber(get("avg3"))), vol3 = finite(toNumber(get("vol3")));
      normalized.push({
        id: index + 1, brand: brand || "Unspecified", itemid: textValue(get("itemid")), model: model || product, product: product || model, status: textValue(get("status"), "Unspecified"), eta: dateIso(parseDate(get("eta"))),
        vol3, last30: finite(toNumber(get("last30"))), avg3: avgInput || vol3 / 3, stockQty: finite(toNumber(get("stockQty"))), available: finite(toNumber(get("available"))), stockDifference: finite(toNumber(get("stockDifference"))), openClient: finite(toNumber(get("openClient"))),
        openSupplier: Number.isFinite(toNumber(row.__supplierQty)) ? toNumber(row.__supplierQty) : finite(toNumber(get("openSupplier"))), supplierWindow: supplierText, supplierPOs: textValue(row.__supplierPOs), supplierStart: row.__supplierStart || dateIso(parsed.start), supplierEnd: row.__supplierEnd || dateIso(parsed.end)
      });
    });
    return normalized;
  }

  function analyze(rows, region) {
    const settings = loadSettings(region), brands = ensureBrandSettings(region, rows), today = new Date(); today.setHours(0, 0, 0, 0);
    const items = rows.map(row => {
      const statusUpper = String(row.status).trim().toUpperCase(), excluded = ["FEEDS ONLY", "INTERNAL USE", "PRESENTATION"].some(value => statusUpper.includes(value)), eligible = ["LIVE", "FASHION", "BACKORDER"].includes(statusUpper), activeBrand = brands[row.brand] ? brands[row.brand].active !== false : true;
      const supplierEnd = reviveDate(row.supplierEnd), daysUntil = supplierEnd ? Math.ceil((supplierEnd - today) / 86400000) : null, reasons = [];
      if (activeBrand && eligible && !excluded) {
        if (row.available + row.openSupplier <= settings.critical) reasons.push(`Available + supplier qty <= ${settings.critical}`);
        if (row.openClient > row.available) reasons.push("Open client orders exceed available stock");
        if (Number.isFinite(daysUntil) && daysUntil > settings.delay) reasons.push(`Supplier delivery exceeds ${settings.delay} days`);
        if (row.avg3 > row.available + row.openSupplier) reasons.push("Average monthly sales exceed available + supplier qty");
      }
      const reorderRequired = reasons.length > 0;
      return { ...row, activeBrand, eligible, excluded, daysUntil, reorderRequired, reorderReason: reasons.join(" | "), recommended: reorderRequired ? Math.ceil(row.avg3 * Math.max(0, settings.coverage)) : 0, monthsCover: row.avg3 > 0 ? row.available / row.avg3 : null, abc: "C", rank: 0, contribution: 0, cumulative: 0 };
    });
    const ranked = items.slice().sort((a, b) => b.vol3 - a.vol3), total = ranked.reduce((sum, item) => sum + Math.max(0, item.vol3), 0); let cumulative = 0;
    ranked.forEach((item, index) => { const prior = cumulative, contribution = total ? Math.max(0, item.vol3) / total : 0; cumulative += contribution; item.rank = index + 1; item.contribution = contribution; item.cumulative = cumulative; item.abc = prior < settings.a / 100 ? "A" : prior < settings.b / 100 ? "B" : "C"; });
    return items;
  }

  function downloadCsv(rows, filename) { const csv = rows.map(row => row.map(csvCell).join(",")).join("\n"), blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }), link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 100); }

  function initFrame(page) {
    const region = getRegion(), code = regionCode(region);
    document.querySelectorAll("[data-region-name]").forEach(node => node.textContent = regionName(region));
    document.querySelectorAll("[data-region-code]").forEach(node => node.textContent = code);
    document.querySelectorAll("[data-region-link]").forEach(link => { const url = new URL(link.getAttribute("href"), location.href); url.searchParams.set("region", region); link.setAttribute("href", url.pathname.split("/").pop() + url.search); });
    document.querySelectorAll("[data-inventory-page]").forEach(link => link.classList.toggle("active", link.dataset.inventoryPage === page));
    const select = document.getElementById("region-select"); if (select) { select.value = region; select.addEventListener("change", () => { const url = new URL(location.href); url.searchParams.set("region", select.value); location.href = url.href; }); }
    return region;
  }

  global.StarkInventory = { REGION_NAMES, DEFAULT_SETTINGS, getRegion, regionCode, regionName, cleanText, normalizeHeader, toNumber, dateText, escapeHtml, unique, readReportFile, normalizeItemRows, analyze, saveDataset, loadDataset, clearDataset, loadSettings, saveSettings, loadBrandSettings, saveBrandSettings, ensureBrandSettings, downloadCsv, initFrame };
})(window);
