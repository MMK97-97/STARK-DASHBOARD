(function (global) {
  "use strict";

  const FIXED_REGION = "EU";
  const DB_NAME = "stark-regional-inventory-eu";
  const STORE_NAME = "datasets";
  const VERSION = 1;
  const REGION_NAMES = { US: "United States", EU: "European Union", Canada: "Canada" };
  const DEFAULT_SETTINGS = { critical: 3, coverage: 1, delay: 15, a: 80, b: 95 };
  const ITEM_ALIASES = {
    brand: ["brand"], itemid: ["itemid", "item id"], model: ["model#", "model", "model number", "sku"], product: ["item title", "product", "item name", "description"], status: ["status"], eta: ["eta"],
    vol3: ["vol past 3m", "volume past 3m", "past 3 months", "3 month sales", "3m units"], last30: ["vol last 30 days", "last 30 days", "30 day sales", "30d units"], avg3: ["avg/perm past 3m", "avg per m past 3m", "average per month past 3m", "avg monthly sales"],
    stockQty: ["stock qty", "on hand", "stock quantity"], available: ["stock available", "available", "ats", "available to sell"], ats: ["ats"], stockDifference: ["stock difference"], openClient: ["open orders from client", "open client orders"], openSupplier: ["total open supplier qty", "open supplier qty", "open orders to supplier", "open supplier orders"], supplierDueQty: ["open supplier qty <=30 days", "open supplier qty within 30 days", "supplier qty due within 30 days"], supplierWindow: ["supplier delivery window", "delivery window"], supplierPOs: ["po#", "supplier po#", "supplier pos"], supplierLinePO: ["open orders to supplier"], supplierLineQty: ["supplier qty"]
  };

  function getRegion() {
    return FIXED_REGION;
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

  function leadTimeInMonths(value) {
    const text = cleanText(value).toLowerCase();
    if (!text) return 0;
    const match = text.match(/-?\d+(?:\.\d+)?/);
    if (!match) return 0;
    const amount = Math.max(0, Number(match[0]) || 0);
    if (/day/.test(text)) return amount / 30.4375;
    if (/week|wk/.test(text)) return amount / 4.345;
    if (/year|yr/.test(text)) return amount * 12;
    return amount;
  }

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

  async function readReportFile(file, region = "US") {
    const bytes = await file.arrayBuffer();
    const prefix = new TextDecoder("utf-8").decode(bytes.slice(0, 5000)).trim().toLowerCase(), extension = String(file.name || "").split(".").pop().toLowerCase();
    if (prefix.includes("<table") || prefix.startsWith("<div") || prefix.startsWith("<html")) return parseHtmlReport(new TextDecoder("utf-8").decode(bytes));
    if (["csv", "tsv"].includes(extension)) return parseDelimitedReport(new TextDecoder("utf-8").decode(bytes), extension === "tsv" ? "\t" : ",");
    if (extension === "xlsx" && global.JSZip) {
      try { return await parseXlsxReport(bytes, region); }
      catch (error) { if (!global.XLSX) throw error; }
    }
    if (global.XLSX) {
      const workbook = XLSX.read(bytes, { type: "array", cellDates: true });
      const sheets = workbook.SheetNames.map(name => ({ name, rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: "", raw: false }) }));
      const rawSheet = sheets.find(sheet => normalizeHeader(sheet.name) === "raw report") || sheets.slice().sort((a, b) => b.rows.length - a.rows.length)[0];
      const atsSheet = sheets.find(sheet => normalizeHeader(sheet.name) === "ats data");
      return region === "EU" ? mergeAtsRows(rawSheet?.rows || [], atsSheet?.rows || []) : (rawSheet?.rows || []);
    }
    throw new Error("The Excel reader did not load. Confirm that the assets folder was uploaded with the HTML files.");
  }

  function parseDelimitedReport(text, delimiter) {
    const records = []; let row = [], value = "", quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (character === '"' && quoted && text[index + 1] === '"') { value += '"'; index += 1; }
      else if (character === '"') quoted = !quoted;
      else if (character === delimiter && !quoted) { row.push(value); value = ""; }
      else if ((character === "\n" || character === "\r") && !quoted) {
        if (character === "\r" && text[index + 1] === "\n") index += 1;
        row.push(value); if (row.some(cell => cleanText(cell))) records.push(row); row = []; value = "";
      } else value += character;
    }
    row.push(value); if (row.some(cell => cleanText(cell))) records.push(row);
    if (!records.length) return [];
    const headers = records.shift().map(cleanText);
    return records.map((values, index) => Object.fromEntries([...headers.map((header, column) => [header, values[column] || ""]), ["__rawRow", index + 2]]));
  }

  async function parseXlsxReport(bytes, region = "US") {
    const zip = await JSZip.loadAsync(bytes), parser = new DOMParser(), xml = async path => {
      const entry = zip.file(path); if (!entry) return null;
      const doc = parser.parseFromString(await entry.async("text"), "application/xml");
      if (doc.getElementsByTagName("parsererror").length) throw new Error(`The workbook contains invalid XML in ${path}.`);
      return doc;
    };
    const workbook = await xml("xl/workbook.xml"), relationships = await xml("xl/_rels/workbook.xml.rels");
    if (!workbook || !relationships) throw new Error("This is not a readable Excel workbook.");
    const relationPaths = {};
    Array.from(relationships.getElementsByTagName("Relationship")).forEach(node => {
      const target = node.getAttribute("Target") || "", path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
      relationPaths[node.getAttribute("Id")] = path.replace(/\/+/g, "/");
    });
    const sheets = Array.from(workbook.getElementsByTagName("sheet")).map(node => {
      const id = node.getAttribute("r:id") || Array.from(node.attributes).find(attribute => attribute.name.endsWith(":id"))?.value;
      return { name: node.getAttribute("name") || "Sheet", path: relationPaths[id] };
    }).filter(sheet => sheet.path && zip.file(sheet.path));
    const sharedDoc = await xml("xl/sharedStrings.xml"), shared = sharedDoc ? Array.from(sharedDoc.getElementsByTagName("si")).map(node => Array.from(node.getElementsByTagName("t")).map(text => text.textContent || "").join("")) : [];
    const stylesDoc = await xml("xl/styles.xml"), dateStyles = parseDateStyles(stylesDoc);
    const preferred = sheets.find(sheet => normalizeHeader(sheet.name) === "raw report"), ordered = preferred ? [preferred, ...sheets.filter(sheet => sheet !== preferred)] : sheets, candidates = [];
    for (const sheet of ordered) {
      const sheetDoc = await xml(sheet.path), result = sheetDoc ? worksheetObjects(sheetDoc, shared, dateStyles, region === "EU") : [];
      candidates.push({ name: sheet.name, rows: result });
    }
    const rawSheet = candidates.find(sheet => normalizeHeader(sheet.name) === "raw report") || candidates.slice().sort((a, b) => b.rows.length - a.rows.length)[0];
    const atsSheet = candidates.find(sheet => normalizeHeader(sheet.name) === "ats data");
    return region === "EU" ? mergeAtsRows(rawSheet?.rows || [], atsSheet?.rows || []) : (rawSheet?.rows || []);
  }

  function mergeAtsRows(rawRows, atsRows) {
    if (!rawRows.length || !atsRows.length) return rawRows;
    const rawMapping = detectMapping(Object.keys(rawRows[0]), { model: ITEM_ALIASES.model });
    const atsMapping = detectMapping(Object.keys(atsRows[0]), { model: ITEM_ALIASES.model, ats: ITEM_ALIASES.ats });
    if (!rawMapping.model || !atsMapping.model || !atsMapping.ats) return rawRows;
    const atsByModel = new Map();
    atsRows.forEach(row => {
      const key = cleanText(row[atsMapping.model]).toUpperCase();
      const value = toNumber(row[atsMapping.ats]);
      if (key && Number.isFinite(value)) atsByModel.set(key, value);
    });
    return rawRows.map(row => ({ ...row, __ats: atsByModel.get(cleanText(row[rawMapping.model]).toUpperCase()) ?? "" }));
  }

  function parseDateStyles(stylesDoc) {
    if (!stylesDoc) return new Set();
    const custom = {};
    Array.from(stylesDoc.getElementsByTagName("numFmt")).forEach(node => custom[node.getAttribute("numFmtId")] = node.getAttribute("formatCode") || "");
    const result = new Set(), builtIn = new Set([14,15,16,17,18,19,20,21,22,27,30,36,45,46,47,50,57]);
    const cellXfs = stylesDoc.getElementsByTagName("cellXfs")[0];
    if (!cellXfs) return result;
    Array.from(cellXfs.getElementsByTagName("xf")).forEach((node, index) => {
      const id = Number(node.getAttribute("numFmtId") || 0), format = String(custom[id] || "").replace(/\[[^\]]*\]|"[^"]*"/g, "");
      if (builtIn.has(id) || /[ymdhis]/i.test(format)) result.add(index);
    });
    return result;
  }

  function worksheetObjects(doc, shared, dateStyles, keepDuplicateHeaders = false) {
    const grid = [], rowNumbers = [];
    Array.from(doc.getElementsByTagName("row")).forEach((rowNode, rowIndex) => {
      const values = [], actualRow = Number(rowNode.getAttribute("r") || rowIndex + 1);
      Array.from(rowNode.getElementsByTagName("c")).forEach(cell => {
        const reference = cell.getAttribute("r") || "A1", column = columnNumber(reference), type = cell.getAttribute("t") || "", style = Number(cell.getAttribute("s") || 0), valueNode = cell.getElementsByTagName("v")[0], inline = cell.getElementsByTagName("is")[0];
        let value = inline ? Array.from(inline.getElementsByTagName("t")).map(node => node.textContent || "").join("") : (valueNode ? valueNode.textContent || "" : "");
        if (type === "s") value = shared[Number(value)] ?? "";
        else if (type === "b") value = value === "1";
        else if (!type && value !== "" && Number.isFinite(Number(value))) value = dateStyles.has(style) ? excelDate(Number(value)) : Number(value);
        values[column] = value;
      });
      grid.push(values); rowNumbers.push(actualRow);
    });
    if (!grid.length) return [];
    const hints = ["brand", "itemid", "model#", "item title", "status", "avg/perm past 3m", "stock qty", "stock available"], scan = grid.slice(0, 25).map((row, index) => ({ index, score: row.reduce((score, value) => score + (hints.includes(normalizeHeader(value)) ? 1 : 0), 0) })).sort((a, b) => b.score - a.score), headerIndex = scan[0]?.score ? scan[0].index : grid.findIndex(row => row.some(value => cleanText(value)));
    if (headerIndex < 0) return [];
    const headerCounts = {};
    const headers = grid[headerIndex].map(value => {
      const base = cleanText(value);
      if (!base || !keepDuplicateHeaders) return base;
      headerCounts[base] = (headerCounts[base] || 0) + 1;
      return headerCounts[base] > 1 ? `${base} ${headerCounts[base]}` : base;
    });
    return grid.slice(headerIndex + 1).map((values, index) => {
      const result = { __rawRow: rowNumbers[headerIndex + index + 1] || headerIndex + index + 2 };
      headers.forEach((header, column) => { if (header) result[header] = values[column] ?? ""; });
      return result;
    }).filter(row => Object.entries(row).some(([key, value]) => key !== "__rawRow" && value !== "" && value != null));
  }

  function columnNumber(reference) { const letters = String(reference).match(/^[A-Z]+/i)?.[0] || "A"; return letters.toUpperCase().split("").reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1; }
  function excelDate(serial) { const date = new Date(Date.UTC(1899, 11, 30) + serial * 86400000); return Number.isFinite(date.getTime()) ? date.toISOString() : serial; }

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

  function normalizeItemRows(rows, region = "US") {
    if (!rows.length) return [];
    if (region !== "EU") return normalizeStandardItemRows(rows);
    const headers = Array.from(new Set(rows.flatMap(row => Object.keys(row))));
    const mapping = detectMapping(headers, ITEM_ALIASES), normalized = [];
    let current = null;
    rows.forEach((row, index) => {
      const get = key => mapping[key] ? row[mapping[key]] : "";
      const model = textValue(get("model")), product = textValue(get("product")), brand = textValue(get("brand"));
      if (!model && !product && !brand) {
        if (!current) return;
        const qty = toNumber(get("supplierLineQty")), po = textValue(get("supplierLinePO")), windowText = textValue(get("supplierWindow"));
        if (Number.isFinite(qty) || po || windowText) current.supplierLines.push({ qty: finite(qty), po, windowText });
        return;
      }
      const supplierText = textValue(get("supplierWindow"), textValue(get("openSupplier"))), parsed = parseSupplierText(supplierText), avgInput = finite(toNumber(get("avg3"))), vol3 = finite(toNumber(get("vol3"))), ats = finite(toNumber(row.__ats ?? get("ats"))), supplierDueInput = toNumber(get("supplierDueQty"));
      current = {
        id: index + 1, rawRow: finite(toNumber(row.__rawRow)) || index + 2, brand: brand || "Unspecified", itemid: textValue(get("itemid")), model: model || product, product: product || model, status: textValue(get("status"), "Unspecified"), eta: dateIso(parseDate(get("eta"))),
        vol3, last30: finite(toNumber(get("last30"))), avg3: avgInput || vol3 / 3, stockQty: finite(toNumber(get("stockQty"))), available: finite(toNumber(get("available"))), ats, stockDifference: finite(toNumber(get("stockDifference"))), openClient: finite(toNumber(get("openClient"))),
        openSupplier: Number.isFinite(toNumber(row.__supplierQty)) ? toNumber(row.__supplierQty) : finite(toNumber(get("openSupplier"))), supplierDueQty: Number.isFinite(supplierDueInput) ? supplierDueInput : null, supplierWindow: supplierText, supplierPOs: textValue(row.__supplierPOs, textValue(get("supplierPOs"))), supplierStart: row.__supplierStart || dateIso(parsed.start), supplierEnd: row.__supplierEnd || dateIso(parsed.end), supplierLines: []
      };
      normalized.push(current);
    });
    const today = new Date(); today.setHours(0, 0, 0, 0); const cutoff = new Date(today.getTime() + 30 * 86400000);
    normalized.forEach(item => {
      if (!item.supplierLines.length) return delete item.supplierLines;
      const validLines = item.supplierLines.filter(line => line.qty || line.po || line.windowText), windows = validLines.map(line => line.windowText).filter(Boolean), range = windowRange(windows);
      item.openSupplier = validLines.reduce((sum, line) => sum + finite(line.qty), 0);
      item.supplierDueQty = validLines.reduce((sum, line) => { const start = windowRange([line.windowText]).start; return sum + (start && start <= cutoff ? finite(line.qty) : 0); }, 0);
      item.supplierPOs = unique(validLines.map(line => line.po)).join(", ");
      item.supplierWindow = windows.join(" | "); item.supplierStart = dateIso(range.start); item.supplierEnd = dateIso(range.end); delete item.supplierLines;
    });
    return normalized;
  }

  function normalizeStandardItemRows(rows) {
    const mapping = detectMapping(Object.keys(rows[0]), ITEM_ALIASES), normalized = [];
    rows.forEach((row, index) => {
      const get = key => mapping[key] ? row[mapping[key]] : "", model = textValue(get("model")), product = textValue(get("product")), brand = textValue(get("brand"));
      if (!model && !product && !brand) return;
      const supplierText = textValue(get("supplierWindow"), textValue(get("openSupplier"))), parsed = parseSupplierText(supplierText), avgInput = finite(toNumber(get("avg3"))), vol3 = finite(toNumber(get("vol3")));
      normalized.push({
        id: index + 1, rawRow: finite(toNumber(row.__rawRow)) || index + 2, brand: brand || "Unspecified", itemid: textValue(get("itemid")), model: model || product, product: product || model, status: textValue(get("status"), "Unspecified"), eta: dateIso(parseDate(get("eta"))),
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
      const supplierDate = region === "EU" ? (reviveDate(row.supplierStart) || reviveDate(row.supplierEnd)) : reviveDate(row.supplierEnd), daysUntil = supplierDate ? Math.ceil((supplierDate - today) / 86400000) : null, reasons = [];
      if (activeBrand && eligible && !excluded) {
        if (row.available + row.openSupplier <= settings.critical) reasons.push(`Available + supplier qty <= ${settings.critical}`);
        if (row.openClient > row.available) reasons.push("Open client orders exceed available stock");
        if (Number.isFinite(daysUntil) && daysUntil > settings.delay) reasons.push(`Supplier delivery exceeds ${settings.delay} days`);
        if (row.avg3 > row.available + row.openSupplier) reasons.push("Average monthly sales exceed available + supplier qty");
      }
      const reorderRequired = reasons.length > 0;
      const leadTime = brands[row.brand]?.leadTime || "";
      const leadTimeMonths = leadTimeInMonths(leadTime);
      const actualAvailable = row.stockQty + finite(row.ats);
      const upcomingAvailability = row.stockQty - row.openClient;
      const supplierDueQty = Number.isFinite(row.supplierDueQty) ? row.supplierDueQty : (Number.isFinite(daysUntil) && daysUntil <= 30 ? row.openSupplier : 0);
      const calculatedRecommendation = (row.stockQty + row.openSupplier - row.openClient) * leadTimeMonths + row.avg3;
      const recommended = reorderRequired ? Math.max(0, Math.ceil(calculatedRecommendation)) : 0;
      return { ...row, actualAvailable, upcomingAvailability, supplierDueQty, activeBrand, eligible, excluded, daysUntil, leadTime, leadTimeMonths, reorderRequired, reorderReason: reasons.join(" | "), recommended, monthsCover: row.avg3 > 0 ? row.available / row.avg3 : null, abc: "C", rank: 0, contribution: 0, cumulative: 0 };
    });
    const ranked = items.slice().sort((a, b) => b.vol3 - a.vol3), total = ranked.reduce((sum, item) => sum + Math.max(0, item.vol3), 0); let cumulative = 0;
    ranked.forEach((item, index) => { const prior = cumulative, contribution = total ? Math.max(0, item.vol3) / total : 0; cumulative += contribution; item.rank = index + 1; item.contribution = contribution; item.cumulative = cumulative; item.abc = prior < settings.a / 100 ? "A" : prior < settings.b / 100 ? "B" : "C"; });
    return items;
  }

  function downloadCsv(rows, filename) { const csv = rows.map(row => row.map(csvCell).join(",")).join("\n"), blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }), link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 100); }

  function initFrame(page) {
    const region = FIXED_REGION, code = regionCode(region);
    document.querySelectorAll("[data-region-name]").forEach(node => node.textContent = regionName(region));
    document.querySelectorAll("[data-region-code]").forEach(node => node.textContent = code);
    document.querySelectorAll("[data-inventory-page]").forEach(link => link.classList.toggle("active", link.dataset.inventoryPage === page));
    const select = document.getElementById("region-select"); if (select) { select.value = region; select.addEventListener("change", () => { const suffix = { US: "us", EU: "eu", Canada: "ca" }[select.value]; const route = { inventory: "inventory", dashboard: "inventory-dashboard", raw: "raw-report", reorder: "reorder-report", brands: "active-brands", instructions: "instructions" }[page] || "inventory"; location.href = `${route}-${suffix}.html`; }); }
    return region;
  }

  global.StarkInventory = { REGION_NAMES, DEFAULT_SETTINGS, getRegion, regionCode, regionName, cleanText, normalizeHeader, toNumber, dateText, escapeHtml, unique, readReportFile, normalizeItemRows, analyze, saveDataset, loadDataset, clearDataset, loadSettings, saveSettings, loadBrandSettings, saveBrandSettings, ensureBrandSettings, downloadCsv, initFrame };
})(window);
