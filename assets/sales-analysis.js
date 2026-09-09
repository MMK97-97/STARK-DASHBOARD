(function () {
  "use strict";

  const REGION_NAMES = { US: "United States", EU: "European Union", CA: "Canada" };
  const REGION_CURRENCY = { US: "USD", EU: "EUR", CA: "CAD" };
  const ELIGIBLE_STATUSES = new Set(["LIVE", "FASHION", "BACKORDER"]);
  const DB_NAME = "stark-sales-intelligence-v1";
  const DB_STORE = "regional-sales";
  const DB_VERSION = 1;
  const COLORS = {
    navy: "#164f78", teal: "#109990", blue: "#3978d6", purple: "#7658d9",
    orange: "#e8942f", red: "#d94e62", green: "#198764", muted: "#65758b", line: "#d6e1eb"
  };
  const TIER_COLORS = { High: COLORS.green, Medium: COLORS.orange, Low: COLORS.red };
  const state = {
    region: normalizeRegion(new URLSearchParams(location.search).get("region")),
    tab: "overview",
    regions: { US: emptyRegion(), EU: emptyRegion(), CA: emptyRegion() },
    filters: { year: "ALL", brand: "ALL", tier: "ALL", stock: "ALL", metric: "units", search: "" }
  };

  const $ = id => document.getElementById(id);
  const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
  const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
  let toastTimer = 0;
  let resizeTimer = 0;

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    bindEvents();
    await Promise.all(Object.keys(state.regions).map(loadRegion));
    updateRegionStatus();
    selectRegion(state.region, false);
  }

  function emptyRegion() {
    return { sales: null, prices: null, analysis: null };
  }

  function bindEvents() {
    $("sales-file").addEventListener("change", event => uploadSales(event.target.files[0]));
    $("price-file").addEventListener("change", event => uploadPrices(event.target.files[0]));
    $("analyze-button").addEventListener("click", generateAnalysis);
    $("clear-region").addEventListener("click", clearRegion);
    $("export-workbook").addEventListener("click", () => exportWorkbook("all"));
    $("reset-filters").addEventListener("click", resetFilters);
    document.querySelectorAll(".region-tab").forEach(button => button.addEventListener("click", () => selectRegion(button.dataset.region)));
    document.querySelectorAll(".analysis-tab").forEach(button => button.addEventListener("click", () => activateTab(button.dataset.tab)));
    document.querySelectorAll(".export-section").forEach(button => button.addEventListener("click", () => exportWorkbook(button.dataset.export)));
    ["year-filter", "brand-filter", "tier-filter", "stock-filter", "metric-filter"].forEach(id => {
      $(id).addEventListener("change", updateFilters);
    });
    $("search-filter").addEventListener("input", debounce(updateFilters, 150));
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => renderActivePanel(), 180);
    });
  }

  async function uploadSales(file) {
    if (!file) return;
    setBusy(true);
    try {
      const workbookRows = await readWorkbook(file, "sales");
      const normalized = normalizeSalesReport(workbookRows.rows);
      normalized.fileName = file.name;
      normalized.sheetName = workbookRows.sheetName;
      normalized.importedAt = new Date().toISOString();
      state.regions[state.region].sales = normalized;
      state.regions[state.region].analysis = null;
      await persistRegion(state.region);
      updateUploadUI();
      updateRegionStatus();
      showToast(`${integer.format(normalized.eligibleRowCount)} eligible model rows loaded from ${file.name}.`);
      await generateAnalysis();
    } catch (error) {
      showToast(error.message || "The sales report could not be read.", true);
    } finally {
      $("sales-file").value = "";
      setBusy(false);
    }
  }

  async function uploadPrices(file) {
    if (!file) return;
    setBusy(true);
    try {
      const workbookRows = await readWorkbook(file, "price");
      const normalized = normalizePriceList(workbookRows.rows);
      normalized.fileName = file.name;
      normalized.sheetName = workbookRows.sheetName;
      normalized.importedAt = new Date().toISOString();
      state.regions[state.region].prices = normalized;
      state.regions[state.region].analysis = null;
      await persistRegion(state.region);
      updateUploadUI();
      updateRegionStatus();
      showToast(`${integer.format(normalized.rows.length)} valid prices loaded from ${file.name}.`);
      if (current().sales) await generateAnalysis();
    } catch (error) {
      showToast(error.message || "The price list could not be read.", true);
    } finally {
      $("price-file").value = "";
      setBusy(false);
    }
  }

  async function readWorkbook(file, purpose) {
    if (!window.XLSX) throw new Error("The Excel reader has not loaded. Refresh the page and try again.");
    const bytes = await file.arrayBuffer();
    const workbook = XLSX.read(bytes, { type: "array", cellDates: true, dense: false });
    let best = null;
    workbook.SheetNames.forEach(sheetName => {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "", raw: true });
      if (!rows.length) return;
      const headers = Object.keys(rows[0]);
      const normalized = headers.map(normalizeHeader);
      const periodCount = headers.filter(header => Boolean(parsePeriodKey(header))).length;
      const modelScore = normalized.some(header => ["model", "model#", "model number", "modelnumber", "sku"].includes(header)) ? 8 : 0;
      const statusScore = normalized.some(header => ["status", "item status", "itemstatus"].includes(header)) ? 5 : 0;
      const priceScore = normalized.some(header => /(^| )(unit price|selling price|list price|price|msrp|retail)( |$)/.test(header)) ? 8 : 0;
      const score = purpose === "sales" ? periodCount * 4 + modelScore + statusScore + Math.min(rows.length, 5) : priceScore + modelScore + Math.min(rows.length, 5);
      if (!best || score > best.score) best = { score, sheetName, rows };
    });
    if (!best) throw new Error("No usable rows were found in the workbook.");
    return best;
  }

  function normalizeSalesReport(rows) {
    if (!rows.length) throw new Error("The sales report is empty.");
    const headers = unique(rows.flatMap(row => Object.keys(row)));
    const periodHeaders = headers.map(header => ({ header, period: parsePeriodKey(header) })).filter(item => item.period);
    const fields = {
      model: findField(headers, ["model#", "model", "model number", "modelnumber", "sku", "item number"]),
      itemId: findField(headers, ["itemid", "item id", "item code", "product id"]),
      brand: findField(headers, ["brand", "brand name", "vendor"]),
      title: findField(headers, ["title", "item title", "product", "product title", "description"]),
      status: findField(headers, ["itemstatus", "item status", "status"]),
      stock: findField(headers, ["currentstockqty", "current stock qty", "current stock quantity", "stock qty", "on hand", "quantity on hand", "inventory"]),
      date: findField(headers, ["period", "month", "date", "sales month", "invoice date"]),
      units: findField(headers, ["units", "quantity", "qty", "sales units", "units sold"]),
      price: findField(headers, ["unit price", "selling price", "list price", "price", "msrp", "retail"])
    };
    if (!fields.model && !fields.itemId) throw new Error("The sales report needs Model# or Item ID.");
    if (!fields.status) throw new Error("The sales report needs an Item Status column so only Live, Fashion and Backorder can be analyzed.");
    if (!fields.stock) throw new Error("The sales report needs Current Stock Qty or an equivalent on-hand column.");
    if (!periodHeaders.length && !(fields.date && fields.units)) {
      throw new Error("No YYYYMM monthly columns were found. Expected columns such as 202509 or 202601.");
    }

    const recordMap = new Map();
    const periods = new Set(periodHeaders.map(item => item.period));
    let excludedRowCount = 0;
    let invalidRowCount = 0;
    let eligibleRowCount = 0;

    rows.forEach((row, rowIndex) => {
      const status = normalizeKey(row[fields.status]);
      if (!ELIGIBLE_STATUSES.has(status)) { excludedRowCount += 1; return; }
      const model = cleanText(fields.model ? row[fields.model] : "");
      const itemId = cleanText(fields.itemId ? row[fields.itemId] : "");
      if (!model && !itemId) { invalidRowCount += 1; return; }
      eligibleRowCount += 1;
      const brand = cleanText(fields.brand ? row[fields.brand] : "") || "Unspecified";
      const key = `${normalizeKey(model || itemId)}|${normalizeKey(brand)}`;
      if (!recordMap.has(key)) {
        recordMap.set(key, {
          key, model: model || itemId, itemId, brand,
          title: cleanText(fields.title ? row[fields.title] : "") || model || itemId,
          status: titleCase(status), stock: 0, embeddedPrice: 0, monthly: {}, sourceRows: 0, firstSourceRow: rowIndex + 2
        });
      }
      const record = recordMap.get(key);
      // Wide reports contain one stock balance per item row and can be safely
      // aggregated. In long monthly reports, the same balance is repeated by
      // month, so use the maximum instead of multiplying stock by period count.
      record.stock = periodHeaders.length
        ? record.stock + finiteNumber(row[fields.stock])
        : Math.max(record.stock, finiteNumber(row[fields.stock]));
      record.sourceRows += 1;
      if (fields.price) record.embeddedPrice = positiveNumber(row[fields.price]) || record.embeddedPrice;
      if (periodHeaders.length) {
        periodHeaders.forEach(({ header, period }) => {
          record.monthly[period] = finiteNumber(record.monthly[period]) + finiteNumber(row[header]);
        });
      } else {
        const period = parsePeriodValue(row[fields.date]);
        if (!period) { invalidRowCount += 1; return; }
        periods.add(period);
        record.monthly[period] = finiteNumber(record.monthly[period]) + finiteNumber(row[fields.units]);
      }
    });

    const items = Array.from(recordMap.values());
    if (!items.length) throw new Error("No Live, Fashion or Backorder model rows were found.");
    return {
      rows: items,
      periods: Array.from(periods).sort(),
      rawRowCount: rows.length,
      eligibleRowCount,
      excludedRowCount,
      invalidRowCount
    };
  }

  function normalizePriceList(rows) {
    if (!rows.length) throw new Error("The price list is empty.");
    const headers = unique(rows.flatMap(row => Object.keys(row)));
    const fields = {
      model: findField(headers, ["model#", "model", "model number", "modelnumber", "sku", "item number"]),
      itemId: findField(headers, ["itemid", "item id", "item code", "product id"]),
      price: findField(headers, ["unit price", "selling price", "list price", "price", "msrp", "retail", "retail price", "net price"]),
      cost: findField(headers, ["unit cost", "cost", "landed cost", "wholesale cost"])
    };
    if ((!fields.model && !fields.itemId) || !fields.price) throw new Error("The price list needs Model# or Item ID and a Price column.");
    const map = new Map();
    let invalidRowCount = 0;
    rows.forEach(row => {
      const model = cleanText(fields.model ? row[fields.model] : "");
      const itemId = cleanText(fields.itemId ? row[fields.itemId] : "");
      const price = positiveNumber(row[fields.price]);
      if ((!model && !itemId) || !price) { invalidRowCount += 1; return; }
      const normalized = { model, itemId, price, cost: positiveNumber(fields.cost ? row[fields.cost] : 0) };
      if (model) map.set(`M:${normalizeKey(model)}`, normalized);
      if (itemId) map.set(`I:${normalizeKey(itemId)}`, normalized);
    });
    const validRows = unique(Array.from(map.values()).map(item => JSON.stringify(item))).map(item => JSON.parse(item));
    if (!validRows.length) throw new Error("No valid positive prices were found.");
    return { rows: validRows, invalidRowCount };
  }

  async function generateAnalysis() {
    const region = current();
    if (!region.sales) return;
    setBusy(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 20));
      region.analysis = analyze(region.sales, region.prices);
      await persistRegion(state.region);
      initializeFilters();
      updateUploadUI();
      renderAll();
      showToast("Advanced sales and demand analysis is ready.");
    } catch (error) {
      showToast(error.message || "The analysis could not be generated.", true);
    } finally {
      setBusy(false);
    }
  }

  function analyze(sales, prices) {
    const periods = sales.periods.slice().sort();
    const currentPeriod = `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    const latestPeriod = periods[periods.length - 1] || "";
    const latestIsPartial = latestPeriod === currentPeriod;
    const completePeriods = latestIsPartial ? periods.slice(0, -1) : periods.slice();
    const baselinePeriods = completePeriods.slice(-9);
    const priceMap = new Map();
    (prices?.rows || []).forEach(row => {
      if (row.model) priceMap.set(`M:${normalizeKey(row.model)}`, row);
      if (row.itemId) priceMap.set(`I:${normalizeKey(row.itemId)}`, row);
    });

    const items = sales.rows.map(source => {
      const match = priceMap.get(`M:${normalizeKey(source.model)}`) || priceMap.get(`I:${normalizeKey(source.itemId)}`);
      const price = match?.price || source.embeddedPrice || 0;
      const priceSource = match ? (match.model ? "Model#" : "Item ID") : source.embeddedPrice ? "Sales report" : "Missing";
      const baselineHistory = baselinePeriods.map(period => Math.max(0, finiteNumber(source.monthly[period])));
      const history = completePeriods.map(period => Math.max(0, finiteNumber(source.monthly[period])));
      const demand9 = sum(baselineHistory);
      const avg9 = baselinePeriods.length ? demand9 / baselinePeriods.length : 0;
      const currentStock = Math.max(0, finiteNumber(source.stock));
      const target2 = avg9 * 2;
      const excessUnits = Math.max(0, currentStock - target2);
      const excessStock = excessUnits > 1e-9;
      const deadStock = currentStock > 0 && demand9 === 0;
      const monthsCover = avg9 > 0 ? currentStock / avg9 : currentStock > 0 ? Infinity : 0;
      const forecast = forecastDemand(history);
      const stockCondition = deadStock ? "Dead" : excessStock ? "Excess" : monthsCover < 1 ? "Low Cover" : "Balanced";
      return {
        ...source,
        price,
        priceSource,
        cost: match?.cost || 0,
        demand9,
        avg9,
        target2,
        excessUnits,
        excessStock,
        excessValue: excessUnits * price,
        deadStock,
        monthsCover,
        stockCondition,
        forecast,
        projectedCover: forecast.next > 0 ? currentStock / forecast.next : currentStock > 0 ? Infinity : 0
      };
    });

    const ranked = items.slice().sort((a, b) => b.demand9 - a.demand9 || a.model.localeCompare(b.model));
    const totalDemand = sum(ranked.map(item => item.demand9));
    let cumulative = 0;
    ranked.forEach((item, index) => {
      const contribution = totalDemand ? item.demand9 / totalDemand : 0;
      const tier = item.demand9 <= 0 ? "Low" : cumulative < .8 ? "High" : cumulative < .95 ? "Medium" : "Low";
      cumulative += contribution;
      Object.assign(item, { rank: index + 1, unitContribution9: contribution, cumulativeContribution9: cumulative, tier });
    });

    return {
      items,
      periods,
      completePeriods,
      baselinePeriods,
      latestPeriod,
      latestIsPartial,
      priceMatches: items.filter(item => item.price > 0).length,
      generatedAt: new Date().toISOString()
    };
  }

  function forecastDemand(history) {
    const clean = history.map(value => Math.max(0, finiteNumber(value)));
    if (!clean.length) return { method: "No history", next: 0, threeMonth: 0, wape: null, confidence: "Low", observations: 0 };
    const candidates = [
      { name: "Last month", predict: values => values[values.length - 1] || 0 },
      { name: "3-month average", predict: values => mean(values.slice(-3)) },
      { name: "6-month weighted", predict: weightedForecast },
      { name: "Damped trend", predict: dampedTrendForecast }
    ];
    if (clean.length >= 12) candidates.push({ name: "Seasonal naive", predict: values => values.length >= 12 ? values[values.length - 12] : mean(values) });
    if (clean.filter(value => value === 0).length / clean.length >= .35) candidates.push({ name: "Croston SBA", predict: crostonForecast });

    const validationStart = Math.max(3, clean.length - 6);
    let best = null;
    candidates.forEach(candidate => {
      let absoluteError = 0;
      let actualTotal = 0;
      let tests = 0;
      for (let index = validationStart; index < clean.length; index += 1) {
        const prediction = constrainForecast(candidate.predict(clean.slice(0, index)), clean.slice(0, index));
        absoluteError += Math.abs(clean[index] - prediction);
        actualTotal += clean[index];
        tests += 1;
      }
      const denominator = actualTotal || Math.max(1, tests * mean(clean.slice(0, validationStart)));
      const wape = tests ? absoluteError / denominator : Infinity;
      if (!best || wape < best.wape) best = { ...candidate, wape, tests };
    });

    const next = constrainForecast(best.predict(clean), clean);
    const confidence = clean.length >= 9 && best.wape <= .30 ? "High" : clean.length >= 6 && best.wape <= .65 ? "Medium" : "Low";
    return {
      method: best.name,
      next,
      threeMonth: next * 3,
      wape: Number.isFinite(best.wape) ? best.wape : null,
      confidence,
      observations: clean.length
    };
  }

  function weightedForecast(values) {
    const sample = values.slice(-6);
    const denominator = sample.reduce((total, _, index) => total + index + 1, 0);
    return denominator ? sample.reduce((total, value, index) => total + value * (index + 1), 0) / denominator : 0;
  }

  function dampedTrendForecast(values) {
    if (values.length < 2) return values[0] || 0;
    const alpha = .42, beta = .18, phi = .88;
    let level = values[0], trend = values[1] - values[0];
    for (let index = 1; index < values.length; index += 1) {
      const priorLevel = level;
      level = alpha * values[index] + (1 - alpha) * (level + phi * trend);
      trend = beta * (level - priorLevel) + (1 - beta) * phi * trend;
    }
    return level + phi * trend;
  }

  function crostonForecast(values) {
    const nonzero = values.map((value, index) => ({ value, index })).filter(item => item.value > 0);
    if (!nonzero.length) return 0;
    const alpha = .18;
    let demand = nonzero[0].value;
    let interval = Math.max(1, nonzero[0].index + 1);
    let lastIndex = nonzero[0].index;
    nonzero.slice(1).forEach(item => {
      demand += alpha * (item.value - demand);
      const gap = Math.max(1, item.index - lastIndex);
      interval += alpha * (gap - interval);
      lastIndex = item.index;
    });
    return interval ? (1 - alpha / 2) * demand / interval : demand;
  }

  function constrainForecast(value, history) {
    const average = mean(history);
    const maximum = Math.max(1, ...history, average * 4) * 2.5;
    return Math.min(maximum, Math.max(0, finiteNumber(value)));
  }

  function selectRegion(region, updateUrl = true) {
    state.region = normalizeRegion(region);
    state.filters = { year: "ALL", brand: "ALL", tier: "ALL", stock: "ALL", metric: "units", search: "" };
    document.documentElement.dataset.region = state.region;
    document.querySelectorAll(".region-tab").forEach(button => {
      const active = button.dataset.region === state.region;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    $("hero-region").textContent = REGION_NAMES[state.region];
    $("analysis-region-label").textContent = `${REGION_NAMES[state.region]} portfolio`;
    $("workspace-link").href = `index.html?workspace=${state.region === "CA" ? "Canada" : state.region}`;
    $("workspace-link").textContent = `← ${state.region === "CA" ? "Canada" : state.region} workspace`;
    if (updateUrl) history.replaceState(null, "", `sales-analysis.html?region=${state.region}`);
    initializeFilters();
    updateUploadUI();
    if (current().analysis) renderAll();
  }

  function initializeFilters() {
    const analysis = current().analysis;
    const years = analysis ? unique(analysis.periods.map(period => period.slice(0, 4))) : [];
    const brands = analysis ? unique(analysis.items.map(item => item.brand)) : [];
    fillSelect($("year-filter"), [{ value: "ALL", label: "All years" }, ...years.map(year => ({ value: year, label: year }))], state.filters.year);
    fillSelect($("brand-filter"), [{ value: "ALL", label: "All brands" }, ...brands.map(brand => ({ value: brand, label: brand }))], state.filters.brand);
    $("tier-filter").value = state.filters.tier;
    $("stock-filter").value = state.filters.stock;
    $("metric-filter").value = state.filters.metric;
    $("search-filter").value = state.filters.search;
  }

  function updateFilters() {
    state.filters.year = $("year-filter").value;
    state.filters.brand = $("brand-filter").value;
    state.filters.tier = $("tier-filter").value;
    state.filters.stock = $("stock-filter").value;
    state.filters.metric = $("metric-filter").value;
    state.filters.search = cleanText($("search-filter").value).toLowerCase();
    if (state.filters.metric === "revenue" && current().analysis?.priceMatches === 0) {
      state.filters.metric = "units";
      $("metric-filter").value = "units";
      showToast("Upload a price list before selecting estimated revenue.", true);
    }
    renderAll();
  }

  function resetFilters() {
    state.filters = { year: "ALL", brand: "ALL", tier: "ALL", stock: "ALL", metric: "units", search: "" };
    initializeFilters();
    renderAll();
  }

  function filteredItems() {
    const analysis = current().analysis;
    if (!analysis) return [];
    return analysis.items.filter(item => {
      if (state.filters.brand !== "ALL" && item.brand !== state.filters.brand) return false;
      if (state.filters.tier !== "ALL" && item.tier !== state.filters.tier) return false;
      if (state.filters.stock !== "ALL" && item.stockCondition !== state.filters.stock) return false;
      if (state.filters.search && !`${item.model} ${item.itemId} ${item.title} ${item.brand}`.toLowerCase().includes(state.filters.search)) return false;
      return true;
    });
  }

  function scopePeriods() {
    const analysis = current().analysis;
    if (!analysis) return [];
    return state.filters.year === "ALL" ? analysis.periods : analysis.periods.filter(period => period.startsWith(state.filters.year));
  }

  function renderAll() {
    const analysis = current().analysis;
    if (!analysis) return updateUploadUI();
    const items = filteredItems();
    const periods = scopePeriods();
    $("filter-result").textContent = `${integer.format(items.length)} of ${integer.format(analysis.items.length)} eligible models • ${periods.length} period${periods.length === 1 ? "" : "s"} in the selected year scope`;
    updateAnalysisPills();
    renderActivePanel();
    $("analysis").classList.remove("hidden");
    $("empty-state").classList.add("hidden");
    $("export-workbook").disabled = false;
  }

  function renderOverview(items, periods) {
    const periodRows = periodSummary(items, periods);
    const netUnits = sum(periodRows.map(row => row.netUnits));
    const revenue = sum(periodRows.map(row => row.revenue));
    const currentStock = sum(items.map(item => item.stock));
    const monthlyDemand = sum(items.map(item => item.avg9));
    const excessUnits = sum(items.map(item => item.excessUnits));
    const coverage = monthlyDemand > 0 ? currentStock / monthlyDemand : Infinity;
    renderKpis("overview-kpis", [
      ["Net sales units", formatNumber(netUnits), `${periods.length} selected periods`],
      ["Estimated revenue", formatMoney(revenue), priceCoverageText(items)],
      ["Average monthly demand", formatNumber(monthlyDemand), "Last nine complete months"],
      ["Current stock", formatNumber(currentStock), "Eligible statuses only"],
      ["Portfolio coverage", formatCover(coverage), "Current stock ÷ monthly demand", coverage > 4 ? "warn" : "good"],
      ["Excess stock", formatNumber(excessUnits), "Above two months of demand", excessUnits > 0 ? "risk" : "good"]
    ]);
    drawLine("monthly-trend-chart", periodRows.map(row => ({ key: periodLabel(row.period), value: metricPeriod(row) })), metricFormatter());
    drawDonut("seller-mix-chart", tierRollup(items, item => metricItem(item, current().analysis.baselinePeriods)), "Contribution", metricFormatter(), [COLORS.green, COLORS.orange, COLORS.red]);
    drawHorizontalBars("brand-chart", rollupItems(items, item => item.brand, item => metricItem(item, periods), 12), metricFormatter(), COLORS.teal);
    drawGroupedBars("overview-stock-chart", topBy(items, item => item.stock, 12).map(item => ({ key: item.model, Current: item.stock, "2M target": item.target2 })), [
      { key: "Current", color: COLORS.blue }, { key: "2M target", color: COLORS.teal }
    ], value => formatNumber(value));
  }

  function renderYear(items, periods) {
    const rows = periodSummary(items, periods);
    const annual = annualSummary(items, current().analysis.periods);
    const units = sum(rows.map(row => row.netUnits));
    const revenue = sum(rows.map(row => row.revenue));
    const average = rows.length ? units / rows.length : 0;
    const best = rows.slice().sort((a, b) => metricPeriod(b) - metricPeriod(a))[0];
    const prior = rows.length > 1 ? rows[rows.length - 2] : null;
    const latest = rows[rows.length - 1];
    const momentum = prior && metricPeriod(prior) !== 0 ? (metricPeriod(latest) - metricPeriod(prior)) / Math.abs(metricPeriod(prior)) : null;
    renderKpis("year-kpis", [
      ["Selected-period units", formatNumber(units), state.filters.year === "ALL" ? "All available years" : state.filters.year],
      ["Estimated revenue", formatMoney(revenue), priceCoverageText(items)],
      ["Monthly average", formatNumber(average), "Net sales units"],
      ["Best month", best ? periodLabel(best.period) : "—", best ? metricFormatter()(metricPeriod(best)) : "No activity"],
      ["Latest momentum", momentum == null ? "—" : percent.format(momentum), "Versus previous selected month", momentum != null && momentum < 0 ? "risk" : "good"],
      ["Active models", formatNumber(unique(rows.flatMap(row => row.activeModels)).length), "Models with positive sales"]
    ]);
    $("year-monthly-title").textContent = state.filters.year === "ALL" ? "Monthly sales across all years" : `Monthly sales in ${state.filters.year}`;
    drawLine("year-monthly-chart", rows.map(row => ({ key: periodLabel(row.period), value: metricPeriod(row) })), metricFormatter());
    drawColumns("annual-chart", annual.map(row => ({ key: row.year, value: state.filters.metric === "revenue" ? row.revenue : row.netUnits })), metricFormatter(), COLORS.purple);
    drawHorizontalBars("year-brand-chart", rollupItems(items, item => item.brand, item => metricItem(item, periods), 18), metricFormatter(), COLORS.blue);
    $("year-row-count").textContent = `${rows.length} periods`;
    $("year-table").innerHTML = rows.map((row, index) => {
      const priorRow = rows[index - 1];
      const change = priorRow && priorRow.netUnits !== 0 ? (row.netUnits - priorRow.netUnits) / Math.abs(priorRow.netUnits) : null;
      return `<tr><td><strong>${escapeHtml(periodLabel(row.period))}</strong>${row.period === current().analysis.latestPeriod && current().analysis.latestIsPartial ? " <small>(partial)</small>" : ""}</td><td>${row.period.slice(0,4)}</td><td class="num">${integer.format(row.modelsSelling)}</td><td class="num">${formatNumber(row.netUnits)}</td><td class="num">${formatNumber(row.demandUnits)}</td><td class="num">${formatMoney(row.revenue)}</td><td class="num">${change == null ? "—" : percent.format(change)}</td></tr>`;
    }).join("") || emptyTable(7);
  }

  function renderStock(items) {
    const dead = items.filter(item => item.deadStock);
    const excess = items.filter(item => item.excessStock);
    const excessUnits = sum(excess.map(item => item.excessUnits));
    const excessValue = sum(excess.map(item => item.excessValue));
    const deadUnits = sum(dead.map(item => item.stock));
    const covers = items.map(item => item.monthsCover).filter(Number.isFinite).sort((a,b) => a-b);
    renderKpis("stock-kpis", [
      ["Dead-stock models", formatNumber(dead.length), "Stock with zero 9M demand", dead.length ? "risk" : "good"],
      ["Dead-stock units", formatNumber(deadUnits), "Immediate review"],
      ["Excess-stock models", formatNumber(excess.length), "Above the two-month target", excess.length ? "warn" : "good"],
      ["Excess units", formatNumber(excessUnits), "Current stock less 2M target"],
      ["Excess value", formatMoney(excessValue), priceCoverageText(excess)],
      ["Median coverage", formatCover(median(covers)), "Across finite model coverage"]
    ]);
    const coverage = [
      { key: "Dead / no demand", value: items.filter(item => item.deadStock).length },
      { key: "Under 1 month", value: items.filter(item => !item.deadStock && item.monthsCover < 1).length },
      { key: "1–2 months", value: items.filter(item => item.monthsCover >= 1 && item.monthsCover <= 2).length },
      { key: "2–4 months", value: items.filter(item => item.monthsCover > 2 && item.monthsCover <= 4).length },
      { key: "Over 4 months", value: items.filter(item => item.monthsCover > 4 && Number.isFinite(item.monthsCover)).length }
    ];
    drawDonut("coverage-chart", coverage, "Models", value => integer.format(value), [COLORS.red, COLORS.orange, COLORS.green, COLORS.blue, COLORS.purple]);
    drawHorizontalBars("excess-brand-chart", rollupItems(excess, item => item.brand, item => state.filters.metric === "revenue" ? item.excessValue : item.excessUnits, 16), metricFormatter(), COLORS.purple);
    drawHorizontalBars("stock-model-chart", topBy(items.filter(item => item.deadStock || item.excessStock), item => state.filters.metric === "revenue" ? item.excessValue : item.excessUnits, 18).map(item => ({ key: item.model, value: state.filters.metric === "revenue" ? item.excessValue : item.excessUnits })), metricFormatter(), COLORS.red);
    const sorted = items.slice().sort((a,b) => stockPriority(b) - stockPriority(a));
    $("stock-row-count").textContent = tableCount(sorted);
    $("stock-table").innerHTML = sorted.slice(0, 350).map(item => `<tr><td class="model-cell">${escapeHtml(item.model)}</td><td>${escapeHtml(item.brand)}</td><td class="title-cell">${escapeHtml(item.title)}</td><td>${statusBadge(item.status)}</td><td>${conditionBadge(item.stockCondition)}</td><td class="num">${formatNumber(item.stock)}</td><td class="num">${formatNumber(item.demand9)}</td><td class="num">${formatNumber(item.avg9)}</td><td class="num">${formatCover(item.monthsCover)}</td><td class="num">${formatNumber(item.target2)}</td><td class="num">${formatNumber(item.excessUnits)}</td><td class="num">${formatMoney(item.excessValue)}</td></tr>`).join("") || emptyTable(12);
  }

  function renderTiers(items) {
    const groups = ["High", "Medium", "Low"].map(tier => ({ tier, items: items.filter(item => item.tier === tier) }));
    const total = sum(items.map(item => item.demand9));
    renderKpis("tier-kpis", groups.map(group => [
      `${group.tier} sellers`, formatNumber(group.items.length),
      `${percent.format(total ? sum(group.items.map(item => item.demand9)) / total : 0)} of selected demand`,
      group.tier === "High" ? "good" : group.tier === "Medium" ? "warn" : "risk"
    ]).concat([
      ["Selling models", formatNumber(items.filter(item => item.demand9 > 0).length), "Positive demand in baseline"],
      ["Zero-demand models", formatNumber(items.filter(item => item.demand9 === 0).length), "Included in low sellers", items.some(item => item.demand9 === 0) ? "risk" : "good"],
      ["9M demand", formatNumber(total), "Eligible selected models"]
    ]));
    drawDonut("tier-contribution-chart", groups.map(group => ({ key: group.tier, value: sum(group.items.map(item => item.demand9)) })), "Demand", value => formatNumber(value), [COLORS.green, COLORS.orange, COLORS.red]);
    drawColumns("tier-count-chart", groups.map(group => ({ key: group.tier, value: group.items.length })), value => integer.format(value), COLORS.teal, true);
    const brands = unique(items.map(item => item.brand)).map(brand => {
      const brandItems = items.filter(item => item.brand === brand);
      const brandTotal = sum(brandItems.map(item => item.demand9));
      return { key: brand, value: brandTotal ? sum(brandItems.filter(item => item.tier === "High").map(item => item.demand9)) / brandTotal : 0 };
    }).sort((a,b) => b.value - a.value).slice(0, 18);
    drawHorizontalBars("tier-brand-chart", brands, value => percent.format(value), COLORS.green, { domain: [0,1] });
    const sorted = items.slice().sort((a,b) => a.rank - b.rank);
    const totalRevenue = sum(items.map(item => item.demand9 * item.price));
    $("tier-row-count").textContent = tableCount(sorted);
    $("tier-table").innerHTML = sorted.slice(0,350).map(item => `<tr><td>${tierBadge(item.tier)}</td><td class="num">${integer.format(item.rank)}</td><td class="model-cell">${escapeHtml(item.model)}</td><td>${escapeHtml(item.brand)}</td><td class="title-cell">${escapeHtml(item.title)}</td><td class="num">${formatNumber(item.demand9)}</td><td class="num">${formatNumber(item.avg9)}</td><td class="num">${percent.format(item.unitContribution9)}</td><td class="num">${percent.format(item.cumulativeContribution9)}</td><td class="num">${totalRevenue && item.price ? percent.format(item.demand9 * item.price / totalRevenue) : "—"}</td></tr>`).join("") || emptyTable(10);
  }

  function renderContribution(items, periods) {
    const rows = contributionRows(items, periods);
    const totalUnits = sum(rows.map(row => row.units));
    const totalRevenue = sum(rows.map(row => row.revenue));
    const topModel = rows[0];
    const brandCount = unique(rows.map(row => row.brand)).length;
    const top10Share = totalUnits ? sum(rows.slice(0,10).map(row => row.units)) / totalUnits : 0;
    renderKpis("contribution-kpis", [
      ["Selected units", formatNumber(totalUnits), `${periods.length} periods`],
      ["Estimated revenue", formatMoney(totalRevenue), priceCoverageText(items)],
      ["Contributing brands", formatNumber(brandCount), "Selected model set"],
      ["Top model", topModel ? topModel.model : "—", topModel ? `${percent.format(topModel.portfolioUnitShare)} of units` : "No sales"],
      ["Top 10 concentration", percent.format(top10Share), "Share of selected units", top10Share > .6 ? "warn" : "good"],
      ["Models selling", formatNumber(rows.filter(row => row.units > 0).length), "Positive net sales"]
    ]);
    drawHorizontalBars("model-contribution-chart", rows.slice(0,18).map(row => ({ key: row.model, value: state.filters.metric === "revenue" ? row.revenue : row.units })), metricFormatter(), COLORS.blue);
    drawDonut("brand-contribution-chart", rollupItems(items, item => item.brand, item => metricItem(item, periods), 8), "Brand mix", metricFormatter(), [COLORS.teal, COLORS.blue, COLORS.purple, COLORS.orange, COLORS.green, COLORS.red, "#5f6f84", "#9bb3c7"]);
    $("contribution-row-count").textContent = tableCount(rows);
    $("contribution-table").innerHTML = rows.slice(0,350).map(row => `<tr><td class="num">${row.portfolioRank}</td><td class="num">${row.brandRank}</td><td class="model-cell">${escapeHtml(row.model)}</td><td>${escapeHtml(row.brand)}</td><td class="title-cell">${escapeHtml(row.title)}</td><td class="num">${formatNumber(row.units)}</td><td class="num">${formatMoney(row.revenue)}</td><td class="num">${percent.format(row.brandUnitShare)}</td><td class="num">${row.brandRevenueShare == null ? "—" : percent.format(row.brandRevenueShare)}</td><td class="num">${percent.format(row.portfolioUnitShare)}</td><td class="num">${row.portfolioRevenueShare == null ? "—" : percent.format(row.portfolioRevenueShare)}</td></tr>`).join("") || emptyTable(11);
  }

  function renderForecast(items) {
    const rows = items.slice().sort((a,b) => b.forecast.next - a.forecast.next);
    const next = sum(rows.map(item => item.forecast.next));
    const three = sum(rows.map(item => item.forecast.threeMonth));
    const high = rows.filter(item => item.forecast.confidence === "High").length;
    const validWapes = rows.map(item => item.forecast.wape).filter(Number.isFinite);
    const projectedCover = next > 0 ? sum(rows.map(item => item.stock)) / next : Infinity;
    renderKpis("forecast-kpis", [
      ["Next-month forecast", formatNumber(next), "Selected models"],
      ["Three-month forecast", formatNumber(three), "Selected methods combined"],
      ["High-confidence models", formatNumber(high), `${percent.format(rows.length ? high / rows.length : 0)} of selected models`, high ? "good" : "warn"],
      ["Median backtest WAPE", validWapes.length ? percent.format(median(validWapes)) : "—", "Lower is better"],
      ["Projected portfolio cover", formatCover(projectedCover), "Stock ÷ next-month forecast", projectedCover > 4 ? "warn" : "good"],
      ["Methods selected", formatNumber(unique(rows.map(item => item.forecast.method)).length), "Chosen model by model"]
    ]);
    drawGroupedBars("forecast-chart", rows.slice(0,14).map(item => ({ key: item.model, "9M average": item.avg9, Forecast: item.forecast.next })), [
      { key: "9M average", color: COLORS.teal }, { key: "Forecast", color: COLORS.purple }
    ], value => formatNumber(value));
    drawDonut("accuracy-chart", ["High","Medium","Low"].map(key => ({ key, value: rows.filter(item => item.forecast.confidence === key).length })), "Confidence", value => integer.format(value), [COLORS.green, COLORS.orange, COLORS.red]);
    $("forecast-row-count").textContent = tableCount(rows);
    $("forecast-table").innerHTML = rows.slice(0,350).map(item => `<tr><td class="model-cell">${escapeHtml(item.model)}</td><td>${escapeHtml(item.brand)}</td><td class="title-cell">${escapeHtml(item.title)}</td><td>${escapeHtml(item.forecast.method)}</td><td>${confidenceBadge(item.forecast.confidence)}</td><td class="num">${integer.format(item.forecast.observations)}</td><td class="num">${formatNumber(item.avg9)}</td><td class="num">${formatNumber(item.forecast.next)}</td><td class="num">${formatNumber(item.forecast.threeMonth)}</td><td class="num">${item.forecast.wape == null ? "—" : percent.format(item.forecast.wape)}</td><td class="num">${formatNumber(item.stock)}</td><td class="num">${formatCover(item.projectedCover)}</td></tr>`).join("") || emptyTable(12);
  }

  function renderData(items) {
    const sales = current().sales;
    const analysis = current().analysis;
    renderKpis("data-kpis", [
      ["Source rows", formatNumber(sales.rawRowCount), sales.fileName],
      ["Eligible rows", formatNumber(sales.eligibleRowCount), "Live, Fashion, Backorder"],
      ["Excluded rows", formatNumber(sales.excludedRowCount), "All other statuses"],
      ["Invalid eligible rows", formatNumber(sales.invalidRowCount), "Missing model or period"],
      ["Monthly periods", formatNumber(analysis.periods.length), `${periodLabel(analysis.periods[0])} to ${periodLabel(analysis.latestPeriod)}`],
      ["Price match rate", percent.format(analysis.items.length ? analysis.priceMatches / analysis.items.length : 0), `${analysis.priceMatches} matched models`]
    ]);
    $("data-row-count").textContent = tableCount(items);
    $("data-table").innerHTML = items.slice(0,500).map(item => `<tr><td class="model-cell">${escapeHtml(item.model)}</td><td>${escapeHtml(item.itemId)}</td><td>${escapeHtml(item.brand)}</td><td class="title-cell">${escapeHtml(item.title)}</td><td>${statusBadge(item.status)}</td><td class="num">${formatNumber(item.stock)}</td><td class="num">${integer.format(Object.keys(item.monthly).length)}</td><td class="num">${item.price ? formatMoney(item.price) : "—"}</td><td>${escapeHtml(item.priceSource)}</td><td>${escapeHtml(periodLabel(analysis.completePeriods[analysis.completePeriods.length - 1]))}</td></tr>`).join("") || emptyTable(10);
  }

  function periodSummary(items, periods) {
    return periods.map(period => {
      const values = items.map(item => finiteNumber(item.monthly[period]));
      return {
        period,
        netUnits: sum(values),
        demandUnits: sum(values.map(value => Math.max(0, value))),
        revenue: sum(items.map(item => finiteNumber(item.monthly[period]) * item.price)),
        modelsSelling: values.filter(value => value > 0).length,
        activeModels: items.filter(item => finiteNumber(item.monthly[period]) > 0).map(item => item.model)
      };
    });
  }

  function annualSummary(items, periods) {
    return unique(periods.map(period => period.slice(0,4))).map(year => {
      const rows = periodSummary(items, periods.filter(period => period.startsWith(year)));
      return { year, netUnits: sum(rows.map(row => row.netUnits)), demandUnits: sum(rows.map(row => row.demandUnits)), revenue: sum(rows.map(row => row.revenue)) };
    });
  }

  function contributionRows(items, periods) {
    const raw = items.map(item => ({
      model: item.model, brand: item.brand, title: item.title,
      units: sum(periods.map(period => finiteNumber(item.monthly[period]))),
      revenue: sum(periods.map(period => finiteNumber(item.monthly[period]) * item.price))
    }));
    const portfolioUnits = sum(raw.map(row => row.units));
    const portfolioRevenue = sum(raw.map(row => row.revenue));
    const brandUnits = groupTotals(raw, row => row.brand, row => row.units);
    const brandRevenue = groupTotals(raw, row => row.brand, row => row.revenue);
    raw.sort((a,b) => b.units - a.units || a.model.localeCompare(b.model));
    const brandRanks = new Map();
    unique(raw.map(row => row.brand)).forEach(brand => {
      raw.filter(row => row.brand === brand).sort((a,b) => b.units - a.units).forEach((row,index) => brandRanks.set(`${brand}|${row.model}`, index + 1));
    });
    return raw.map((row,index) => ({
      ...row,
      portfolioRank: index + 1,
      brandRank: brandRanks.get(`${row.brand}|${row.model}`),
      brandUnitShare: brandUnits.get(row.brand) ? row.units / brandUnits.get(row.brand) : 0,
      brandRevenueShare: brandRevenue.get(row.brand) ? row.revenue / brandRevenue.get(row.brand) : null,
      portfolioUnitShare: portfolioUnits ? row.units / portfolioUnits : 0,
      portfolioRevenueShare: portfolioRevenue ? row.revenue / portfolioRevenue : null
    }));
  }

  function renderKpis(id, cards) {
    $(id).innerHTML = cards.map(([label, value, meta, tone]) => `<article class="kpi-card"><div class="kpi-label">${escapeHtml(label)}</div><div class="kpi-value ${tone ? `tone-${tone}` : ""}">${escapeHtml(value)}</div><p class="kpi-meta">${escapeHtml(meta || "")}</p></article>`).join("");
  }

  function drawLine(id, data, formatter) {
    const container = $(id);
    clearChart(container);
    if (!data.length || !data.some(item => item.value !== 0)) return chartEmpty(container, "No sales activity is available for this selection.");
    const width = Math.max(500, container.clientWidth || 760), height = 350;
    const margin = { top: 22, right: 18, bottom: 62, left: 72 };
    const innerWidth = width - margin.left - margin.right, innerHeight = height - margin.top - margin.bottom;
    const svg = d3.select(container).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img");
    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    const x = d3.scalePoint().domain(data.map(item => item.key)).range([0, innerWidth]).padding(.45);
    const minimum = Math.min(0, d3.min(data, item => item.value) || 0);
    const maximum = Math.max(1, d3.max(data, item => item.value) || 1);
    const y = d3.scaleLinear().domain([minimum * 1.08, maximum * 1.12]).nice().range([innerHeight,0]);
    g.append("g").attr("class","grid").call(d3.axisLeft(y).ticks(5).tickSize(-innerWidth).tickFormat(""));
    g.append("g").attr("class","axis").attr("transform",`translate(0,${innerHeight})`).call(d3.axisBottom(x).tickValues(x.domain().filter((_,index) => data.length <= 12 || index % Math.ceil(data.length / 10) === 0))).selectAll("text").attr("transform","rotate(-32)").attr("text-anchor","end");
    g.append("g").attr("class","axis").call(d3.axisLeft(y).ticks(5).tickFormat(shortMetric));
    const area = d3.area().x(item => x(item.key)).y0(y(0)).y1(item => y(item.value)).curve(d3.curveMonotoneX);
    const line = d3.line().x(item => x(item.key)).y(item => y(item.value)).curve(d3.curveMonotoneX);
    g.append("path").datum(data).attr("fill","rgba(16,153,144,.10)").attr("d",area);
    g.append("path").datum(data).attr("fill","none").attr("stroke",COLORS.teal).attr("stroke-width",3).attr("d",line);
    g.selectAll("circle").data(data).join("circle").attr("cx",item => x(item.key)).attr("cy",item => y(item.value)).attr("r",4).attr("fill",COLORS.teal).attr("stroke","white").attr("stroke-width",2).on("pointerenter",(event,item) => showTooltip(event, `<strong>${escapeHtml(item.key)}</strong>${escapeHtml(formatter(item.value))}`)).on("pointermove",moveTooltip).on("pointerleave",hideTooltip);
  }

  function drawColumns(id, data, formatter, color, individualColors) {
    const container = $(id);
    clearChart(container);
    if (!data.length || !data.some(item => item.value > 0)) return chartEmpty(container);
    const width = Math.max(360, container.clientWidth || 520), height = 350;
    const margin = { top: 20, right: 16, bottom: 48, left: 62 };
    const innerWidth = width - margin.left - margin.right, innerHeight = height - margin.top - margin.bottom;
    const svg = d3.select(container).append("svg").attr("viewBox",`0 0 ${width} ${height}`);
    const g = svg.append("g").attr("transform",`translate(${margin.left},${margin.top})`);
    const x = d3.scaleBand().domain(data.map(item => item.key)).range([0,innerWidth]).padding(.3);
    const y = d3.scaleLinear().domain([0,(d3.max(data,item => item.value) || 1) * 1.12]).nice().range([innerHeight,0]);
    g.append("g").attr("class","grid").call(d3.axisLeft(y).ticks(5).tickSize(-innerWidth).tickFormat(""));
    g.append("g").attr("class","axis").attr("transform",`translate(0,${innerHeight})`).call(d3.axisBottom(x));
    g.append("g").attr("class","axis").call(d3.axisLeft(y).ticks(5).tickFormat(shortMetric));
    g.selectAll("rect").data(data).join("rect").attr("x",item => x(item.key)).attr("y",item => y(item.value)).attr("width",x.bandwidth()).attr("height",item => innerHeight-y(item.value)).attr("rx",5).attr("fill",(item,index) => individualColors ? [COLORS.green,COLORS.orange,COLORS.red][index] || color : color).on("pointerenter",(event,item) => showTooltip(event,`<strong>${escapeHtml(item.key)}</strong>${escapeHtml(formatter(item.value))}`)).on("pointermove",moveTooltip).on("pointerleave",hideTooltip);
  }

  function drawHorizontalBars(id, data, formatter, color, options = {}) {
    const container = $(id);
    clearChart(container);
    const filtered = data.filter(item => Number.isFinite(item.value) && item.value !== 0);
    if (!filtered.length) return chartEmpty(container, state.filters.metric === "revenue" ? "Upload or match prices to view revenue." : "No values are available for this selection.");
    const width = Math.max(500, container.clientWidth || 900), rowHeight = 25;
    const height = Math.max(310, filtered.length * rowHeight + 62);
    const margin = { top: 12, right: 48, bottom: 34, left: Math.min(220, Math.max(115, width * .22)) };
    const innerWidth = width - margin.left - margin.right, innerHeight = height - margin.top - margin.bottom;
    const svg = d3.select(container).append("svg").attr("viewBox",`0 0 ${width} ${height}`);
    const g = svg.append("g").attr("transform",`translate(${margin.left},${margin.top})`);
    const xDomain = options.domain || [Math.min(0,d3.min(filtered,item => item.value) || 0), Math.max(1,d3.max(filtered,item => item.value) || 1) * 1.1];
    const x = d3.scaleLinear().domain(xDomain).nice().range([0,innerWidth]);
    const y = d3.scaleBand().domain(filtered.map(item => item.key)).range([0,innerHeight]).padding(.22);
    g.append("g").attr("class","grid").call(d3.axisBottom(x).ticks(5).tickSize(innerHeight).tickFormat(""));
    g.append("g").attr("class","axis").call(d3.axisLeft(y).tickFormat(value => truncate(value,28)));
    g.append("g").attr("class","axis").attr("transform",`translate(0,${innerHeight})`).call(d3.axisBottom(x).ticks(5).tickFormat(shortMetric));
    g.selectAll("rect").data(filtered).join("rect").attr("x",item => x(Math.min(0,item.value))).attr("y",item => y(item.key)).attr("width",item => Math.abs(x(item.value)-x(0))).attr("height",y.bandwidth()).attr("rx",4).attr("fill",color).on("pointerenter",(event,item) => showTooltip(event,`<strong>${escapeHtml(item.key)}</strong>${escapeHtml(formatter(item.value))}`)).on("pointermove",moveTooltip).on("pointerleave",hideTooltip);
  }

  function drawGroupedBars(id, data, series, formatter) {
    const container = $(id);
    clearChart(container);
    if (!data.length || !data.some(item => series.some(entry => item[entry.key] > 0))) return chartEmpty(container);
    const width = Math.max(560,container.clientWidth || 900), height = 350;
    const margin = { top: 38, right: 16, bottom: 85, left: 62 };
    const innerWidth = width-margin.left-margin.right, innerHeight = height-margin.top-margin.bottom;
    const svg = d3.select(container).append("svg").attr("viewBox",`0 0 ${width} ${height}`);
    const g = svg.append("g").attr("transform",`translate(${margin.left},${margin.top})`);
    const x0 = d3.scaleBand().domain(data.map(item => item.key)).range([0,innerWidth]).padding(.25);
    const x1 = d3.scaleBand().domain(series.map(item => item.key)).range([0,x0.bandwidth()]).padding(.08);
    const y = d3.scaleLinear().domain([0,(d3.max(data,item => d3.max(series,entry => item[entry.key] || 0)) || 1)*1.12]).nice().range([innerHeight,0]);
    g.append("g").attr("class","grid").call(d3.axisLeft(y).ticks(5).tickSize(-innerWidth).tickFormat(""));
    const groups = g.selectAll("g.bar-group").data(data).join("g").attr("class","bar-group").attr("transform",item => `translate(${x0(item.key)},0)`);
    groups.selectAll("rect").data(item => series.map(entry => ({...entry,parent:item,value:item[entry.key] || 0}))).join("rect").attr("x",item => x1(item.key)).attr("y",item => y(item.value)).attr("width",x1.bandwidth()).attr("height",item => innerHeight-y(item.value)).attr("rx",3).attr("fill",item => item.color).on("pointerenter",(event,item) => showTooltip(event,`<strong>${escapeHtml(item.parent.key)}</strong>${escapeHtml(item.key)}: ${escapeHtml(formatter(item.value))}`)).on("pointermove",moveTooltip).on("pointerleave",hideTooltip);
    g.append("g").attr("class","axis").attr("transform",`translate(0,${innerHeight})`).call(d3.axisBottom(x0).tickFormat(value => truncate(value,14))).selectAll("text").attr("transform","rotate(-32)").attr("text-anchor","end");
    g.append("g").attr("class","axis").call(d3.axisLeft(y).ticks(5).tickFormat(shortMetric));
    const legend = svg.append("g").attr("transform",`translate(${margin.left},12)`);
    series.forEach((entry,index) => { const row=legend.append("g").attr("transform",`translate(${index*150},0)`); row.append("rect").attr("width",10).attr("height",10).attr("rx",2).attr("fill",entry.color); row.append("text").attr("x",16).attr("y",9).attr("fill",COLORS.muted).attr("font-size",9).text(entry.key); });
  }

  function drawDonut(id, data, centerLabel, formatter, palette) {
    const container = $(id);
    clearChart(container);
    const filtered = data.filter(item => item.value > 0);
    const total = sum(filtered.map(item => item.value));
    if (!filtered.length || total <= 0) return chartEmpty(container);
    const width = Math.max(340,container.clientWidth || 440), height = 350;
    const radius = Math.min(116,width*.26);
    const svg = d3.select(container).append("svg").attr("viewBox",`0 0 ${width} ${height}`);
    const cx = width < 430 ? width/2 : width*.36, cy=145;
    const group = svg.append("g").attr("transform",`translate(${cx},${cy})`);
    const pie = d3.pie().sort(null).value(item => item.value);
    const arc = d3.arc().innerRadius(radius*.62).outerRadius(radius);
    group.selectAll("path").data(pie(filtered)).join("path").attr("d",arc).attr("fill",(_,index)=>palette[index%palette.length]).attr("stroke","white").attr("stroke-width",2).on("pointerenter",(event,item)=>showTooltip(event,`<strong>${escapeHtml(item.data.key)}</strong>${escapeHtml(formatter(item.data.value))}<br>${percent.format(item.data.value/total)}`)).on("pointermove",moveTooltip).on("pointerleave",hideTooltip);
    group.append("text").attr("text-anchor","middle").attr("y",-5).attr("fill",COLORS.muted).attr("font-size",10).text(centerLabel);
    group.append("text").attr("text-anchor","middle").attr("y",18).attr("fill","#10243f").attr("font-size",18).attr("font-weight",700).text(shortMetric(total));
    const legend = svg.append("g").attr("transform",width<430?`translate(28,285)`:`translate(${width*.67},78)`);
    filtered.slice(0,7).forEach((item,index)=>{ const row=legend.append("g").attr("transform",width<430?`translate(${(index%3)*(width-56)/3},${Math.floor(index/3)*34})`:`translate(0,${index*36})`); row.append("circle").attr("cx",5).attr("cy",5).attr("r",5).attr("fill",palette[index%palette.length]); row.append("text").attr("x",16).attr("y",8).attr("fill","#10243f").attr("font-size",9).text(truncate(item.key,18)); row.append("text").attr("x",16).attr("y",22).attr("fill",COLORS.muted).attr("font-size",8).text(percent.format(item.value/total)); });
  }

  function activateTab(tab) {
    state.tab = tab;
    document.querySelectorAll(".analysis-tab").forEach(button => {
      const active = button.dataset.tab === tab;
      button.classList.toggle("active",active);
      button.setAttribute("aria-selected",String(active));
    });
    document.querySelectorAll(".tab-panel").forEach(panel => {
      const active = panel.dataset.panel === tab;
      panel.hidden = !active;
      panel.classList.toggle("active",active);
    });
    requestAnimationFrame(renderActivePanel);
  }

  function renderActivePanel() {
    if (!current().analysis) return;
    const items = filteredItems(), periods = scopePeriods();
    if (state.tab === "overview") renderOverview(items,periods);
    else if (state.tab === "year") renderYear(items,periods);
    else if (state.tab === "stock") renderStock(items);
    else if (state.tab === "tiers") renderTiers(items);
    else if (state.tab === "contribution") renderContribution(items,periods);
    else if (state.tab === "forecast") renderForecast(items);
    else renderData(items);
  }

  function updateUploadUI() {
    const region = current();
    const analysis = region.analysis;
    $("sales-file-state").textContent = region.sales ? "Loaded" : "Required";
    $("sales-file-state").className = `file-state${region.sales ? " ready" : ""}`;
    $("sales-file-detail").textContent = region.sales ? `${region.sales.fileName} • ${integer.format(region.sales.eligibleRowCount)} eligible rows` : "Excel, XLS, CSV or TSV";
    $("price-file-state").textContent = region.prices ? "Loaded" : "Optional";
    $("price-file-state").className = `file-state${region.prices ? " ready" : " optional"}`;
    $("price-file-detail").textContent = region.prices ? `${region.prices.fileName} • ${integer.format(region.prices.rows.length)} prices` : "Revenue remains unavailable until prices are matched";
    $("analyze-button").disabled = !region.sales;
    $("clear-region").disabled = !region.sales && !region.prices;
    $("analysis-state").textContent = analysis ? "Ready" : region.sales ? "Ready to run" : "Waiting";
    $("analysis-copy").textContent = analysis ? `${integer.format(analysis.items.length)} eligible models analyzed across ${analysis.periods.length} monthly periods.` : "The engine validates periods, filters eligible statuses and selects a forecast method by model.";
    $("hero-data-state").textContent = analysis ? `${region.sales.fileName} • ${integer.format(analysis.items.length)} models` : region.sales ? "Sales report ready to analyze" : "Upload a sales report to begin";
    $("analysis").classList.toggle("hidden",!analysis);
    $("empty-state").classList.toggle("hidden",Boolean(analysis));
    $("export-workbook").disabled = !analysis;
  }

  function updateAnalysisPills() {
    const analysis = current().analysis;
    if (!analysis) return;
    $("period-pill").textContent = `${analysis.periods.length} periods${analysis.latestIsPartial ? " • latest partial" : ""}`;
    $("eligible-pill").textContent = `${integer.format(analysis.items.length)} eligible models`;
    $("price-pill").textContent = analysis.priceMatches ? `${percent.format(analysis.priceMatches/analysis.items.length)} price matched` : "No prices matched";
    $("analysis-summary").textContent = `${periodLabel(analysis.periods[0])} through ${periodLabel(analysis.latestPeriod)} • Nine-month baseline ends ${periodLabel(analysis.completePeriods[analysis.completePeriods.length-1])}`;
  }

  function updateRegionStatus() {
    Object.keys(state.regions).forEach(region => {
      const data = state.regions[region];
      $(`region-status-${region}`).textContent = data.analysis ? `${integer.format(data.analysis.items.length)} models` : data.sales ? "Ready" : "No data";
    });
  }

  async function clearRegion() {
    if (!confirm(`Clear the saved Sales Analysis data for ${REGION_NAMES[state.region]}?`)) return;
    state.regions[state.region] = emptyRegion();
    await deleteStoredRegion(state.region);
    resetFilters();
    updateUploadUI();
    updateRegionStatus();
    showToast(`${REGION_NAMES[state.region]} sales data cleared.`);
  }

  function exportWorkbook(section) {
    if (!window.XLSX || !current().analysis) return;
    const analysis = current().analysis;
    const items = filteredItems();
    const periods = scopePeriods();
    const workbook = XLSX.utils.book_new();
    const add = (name, rows, widths) => {
      const sheet = Array.isArray(rows) && Array.isArray(rows[0]) ? XLSX.utils.aoa_to_sheet(rows) : XLSX.utils.json_to_sheet(rows);
      sheet["!cols"] = (widths || []).map(wch => ({ wch }));
      XLSX.utils.book_append_sheet(workbook,sheet,name.slice(0,31));
    };
    const wants = name => section === "all" || section === name || (section === "overview" && name === "year");

    if (wants("overview")) add("EXECUTIVE SUMMARY", executiveExport(items,periods), [34,22,80]);
    if (wants("year")) {
      add("MONTHLY ANALYSIS", periodSummary(items,periods).map(row => ({ Period: row.period, Month: periodLabel(row.period), Year: row.period.slice(0,4), "Models Selling": row.modelsSelling, "Net Units": row.netUnits, "Demand Units": row.demandUnits, "Estimated Revenue": row.revenue })), [12,16,10,16,16,16,20]);
      add("YEAR ANALYSIS", annualSummary(items,analysis.periods).map(row => ({ Year: row.year, "Net Units": row.netUnits, "Demand Units": row.demandUnits, "Estimated Revenue": row.revenue })), [12,18,18,22]);
    }
    if (wants("stock")) add("STOCK HEALTH", stockExport(items), [20,20,55,15,16,16,16,16,16,16,16,18,18,20]);
    if (wants("tiers")) add("SELLER TIERS", tierExport(items), [12,10,20,20,55,16,16,18,18,18]);
    if (wants("contribution")) add("MODEL CONTRIBUTION", contributionExport(contributionRows(items,periods)), [14,12,20,20,55,16,20,20,20,20,20]);
    if (wants("forecast")) add("DEMAND FORECAST", forecastExport(items), [20,20,55,20,14,16,16,16,16,18,16,18]);
    if (wants("data")) add("VALIDATED SOURCE", sourceExport(items,analysis), [20,14,20,55,14,16,14,16,16,18]);
    if (section === "all") {
      add("PRICE LIST", (current().prices?.rows || []).map(row => ({ "Model#": row.model, "Item ID": row.itemId, Price: row.price, Cost: row.cost })), [22,16,16,16]);
      add("METHODOLOGY", methodologyExport(analysis), [34,105]);
    }
    XLSX.writeFile(workbook,`Sales Intelligence ${state.region} ${section === "all" ? "Complete" : titleCase(section)}.xlsx`,{compression:true});
  }

  function executiveExport(items,periods) {
    const periodRows=periodSummary(items,periods), currentStock=sum(items.map(item=>item.stock)), monthly=sum(items.map(item=>item.avg9));
    return [[`Sales Intelligence - ${REGION_NAMES[state.region]}`,""],["Analysis scope",state.filters.year === "ALL" ? "All available years" : state.filters.year],["Eligible statuses","Live, Fashion, Backorder"],["Models",items.length],["Net sales units",sum(periodRows.map(row=>row.netUnits))],["Estimated revenue",sum(periodRows.map(row=>row.revenue))],["Current stock",currentStock],["Nine-month average monthly demand",monthly],["Portfolio months of cover",monthly?currentStock/monthly:""],["Dead-stock models",items.filter(item=>item.deadStock).length],["Excess units",sum(items.map(item=>item.excessUnits))],["Excess value",sum(items.map(item=>item.excessValue))],["Generated",new Date().toISOString()]];
  }

  function stockExport(items) { return items.map(item=>({"Model#":item.model,Brand:item.brand,"Item Title":item.title,Status:item.status,Condition:item.stockCondition,"Current Stock":item.stock,"9M Demand":item.demand9,"Average Per Month":item.avg9,"Months Cover":Number.isFinite(item.monthsCover)?item.monthsCover:"No demand","Two-Month Target":item.target2,"Excess Units":item.excessUnits,"Unit Price":item.price||"","Excess Value":item.excessValue||"","Dead Stock":item.deadStock?"YES":"NO"})); }
  function tierExport(items) { return items.slice().sort((a,b)=>a.rank-b.rank).map(item=>({Tier:item.tier,Rank:item.rank,"Model#":item.model,Brand:item.brand,"Item Title":item.title,"9M Demand":item.demand9,"Average Per Month":item.avg9,"Unit Contribution":item.unitContribution9,"Cumulative Contribution":item.cumulativeContribution9,"Estimated 9M Revenue":item.demand9*item.price})); }
  function contributionExport(rows) { return rows.map(row=>({"Portfolio Rank":row.portfolioRank,"Brand Rank":row.brandRank,"Model#":row.model,Brand:row.brand,"Item Title":row.title,Units:row.units,"Estimated Revenue":row.revenue,"Share of Brand Units":row.brandUnitShare,"Share of Brand Revenue":row.brandRevenueShare??"","Share of Total Units":row.portfolioUnitShare,"Share of Total Revenue":row.portfolioRevenueShare??""})); }
  function forecastExport(items) { return items.slice().sort((a,b)=>b.forecast.next-a.forecast.next).map(item=>({"Model#":item.model,Brand:item.brand,"Item Title":item.title,"Selected Method":item.forecast.method,Confidence:item.forecast.confidence,"History Months":item.forecast.observations,"9M Average":item.avg9,"Next Month Forecast":item.forecast.next,"3M Forecast":item.forecast.threeMonth,"Backtest WAPE":item.forecast.wape??"","Current Stock":item.stock,"Projected Months Cover":Number.isFinite(item.projectedCover)?item.projectedCover:"No forecast demand"})); }
  function sourceExport(items,analysis) { return items.map(item=>({"Model#":item.model,"Item ID":item.itemId,Brand:item.brand,"Item Title":item.title,Status:item.status,"Current Stock":item.stock,"Monthly Periods":Object.keys(item.monthly).length,"Unit Price":item.price||"","Price Match":item.priceSource,"Latest Complete Period":analysis.completePeriods[analysis.completePeriods.length-1]})); }
  function methodologyExport(analysis) { return [["Method","Definition"],["Eligible statuses","Only Live, Fashion and Backorder rows are analyzed."],["Period interpretation","A header in YYYYMM format is treated as a calendar month; 202509 is September 2025 and 202601 is January 2026."],["Partial month",analysis.latestIsPartial?`${analysis.latestPeriod} matches the current calendar month and is excluded from the nine-month baseline and forecast training.`:"The latest uploaded period is treated as complete."],["Nine-month demand","Sum of non-negative model demand across the last nine complete periods."],["Average monthly demand","Nine-month demand divided by the number of available complete baseline months, up to nine."],["Dead stock","Current stock is positive and nine-month demand is zero."],["Months coverage","Current stock divided by average monthly demand. Positive stock with zero demand is reported as no-demand/infinite coverage."],["Excess stock","Current stock above two months of average demand. Excess units = max(0, current stock - 2 x average monthly demand)."],["Seller tiers","High sellers form the first 80% of cumulative nine-month demand, medium sellers the next 15%, and low sellers the remainder. Zero-demand models are low sellers."],["Estimated revenue","Monthly model units multiplied by the matched price list value. It is an estimate, not invoice revenue."],["Forecast method selection","Each model is rolling-backtested using last month, 3-month average, 6-month weighted average, damped trend, seasonal naive when sufficient history exists, and Croston SBA for intermittent demand."],["Forecast accuracy","The method with the lowest backtest WAPE is selected. Forecasts are constrained to non-negative, historically plausible values."],["Regional separation",`${REGION_NAMES[state.region]} data is stored and analyzed independently in this browser.`]]; }

  function metricPeriod(row) { return state.filters.metric === "revenue" ? row.revenue : row.netUnits; }
  function metricItem(item, periods) { return periods.reduce((total,period)=>total+(state.filters.metric === "revenue"?finiteNumber(item.monthly[period])*item.price:finiteNumber(item.monthly[period])),0); }
  function metricFormatter() { return state.filters.metric === "revenue" ? formatMoney : formatNumber; }
  function shortMetric(value) { return state.filters.metric === "revenue" ? shortMoney(value) : shortNumber(value); }
  function tierRollup(items,valueFn) { return ["High","Medium","Low"].map(key=>({key,value:sum(items.filter(item=>item.tier===key).map(valueFn))})); }
  function rollupItems(items,keyFn,valueFn,limit=Infinity) { return Array.from(d3.rollup(items,rows=>sum(rows.map(valueFn)),keyFn),([key,value])=>({key,value})).sort((a,b)=>b.value-a.value).slice(0,limit); }
  function groupTotals(items,keyFn,valueFn) { return d3.rollup(items,rows=>sum(rows.map(valueFn)),keyFn); }
  function topBy(items,valueFn,limit) { return items.slice().sort((a,b)=>valueFn(b)-valueFn(a)).slice(0,limit); }
  function stockPriority(item) { return (item.deadStock?1e12:0)+item.excessUnits*1e4+item.monthsCover; }

  function statusBadge(status) { return `<span class="status-badge">${escapeHtml(status)}</span>`; }
  function tierBadge(tier) { return `<span class="tier-badge tier-${tier.toLowerCase()}">${escapeHtml(tier)}</span>`; }
  function confidenceBadge(value) { return `<span class="confidence-badge confidence-${value.toLowerCase()}">${escapeHtml(value)}</span>`; }
  function conditionBadge(value) { return `<span class="condition-badge condition-${value.toLowerCase().replace(/\s+/g,"-")}">${escapeHtml(value)}</span>`; }
  function tableCount(rows) { return `${integer.format(rows.length)} models${rows.length>350?" • first 350 shown; export includes all":""}`; }
  function emptyTable(columns) { return `<tr><td colspan="${columns}">No records match the current filters.</td></tr>`; }

  function current() { return state.regions[state.region]; }
  function normalizeRegion(value) { const upper=String(value||"US").toUpperCase(); return upper==="CANADA"||upper==="CA"?"CA":upper==="EU"?"EU":"US"; }
  function fillSelect(select,options,value) { select.innerHTML=options.map(option=>`<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join(""); select.value=options.some(option=>option.value===value)?value:"ALL"; }
  function findField(headers,aliases) { const map=new Map(headers.map(header=>[normalizeHeader(header),header])); for(const alias of aliases){const exact=map.get(normalizeHeader(alias));if(exact)return exact;} for(const [normalized,original] of map){if(aliases.some(alias=>normalized.includes(normalizeHeader(alias))))return original;} return ""; }
  function parsePeriodKey(value) { const match=String(value??"").trim().match(/^(20\d{2})(0[1-9]|1[0-2])$/); return match?`${match[1]}${match[2]}`:""; }
  function parsePeriodValue(value) { const direct=parsePeriodKey(value); if(direct)return direct; const date=value instanceof Date?value:new Date(value); return Number.isNaN(date.getTime())?"":`${date.getFullYear()}${String(date.getMonth()+1).padStart(2,"0")}`; }
  function periodLabel(period) { if(!period||String(period).length!==6)return "—"; const date=new Date(Number(String(period).slice(0,4)),Number(String(period).slice(4,6))-1,1); return new Intl.DateTimeFormat("en-US",{month:"short",year:"numeric"}).format(date); }
  function normalizeHeader(value) { return cleanText(value).toLowerCase().replace(/[_-]+/g," ").replace(/[^a-z0-9#% ]/g,"").replace(/\s+/g," ").trim(); }
  function normalizeKey(value) { return cleanText(value).toUpperCase().replace(/[^A-Z0-9]/g,""); }
  function cleanText(value) { return String(value??"").replace(/\u00a0/g," ").replace(/\s+/g," ").trim(); }
  function finiteNumber(value) { if(typeof value==="number")return Number.isFinite(value)?value:0; const raw=String(value??"").trim(); if(!raw)return 0; const negative=/^\(.*\)$/.test(raw); const numberValue=Number(raw.replace(/[,$%()]/g,"").replace(/\s/g,"")); return Number.isFinite(numberValue)?(negative?-numberValue:numberValue):0; }
  function positiveNumber(value) { return Math.max(0,finiteNumber(value)); }
  function sum(values) { return values.reduce((total,value)=>total+finiteNumber(value),0); }
  function mean(values) { return values.length?sum(values)/values.length:0; }
  function median(values) { if(!values.length)return 0; const sorted=values.slice().sort((a,b)=>a-b); const mid=Math.floor(sorted.length/2); return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2; }
  function unique(values) { return Array.from(new Set(values.filter(value=>value!==""&&value!=null))); }
  function titleCase(value) { return String(value||"").toLowerCase().replace(/\b\w/g,letter=>letter.toUpperCase()); }
  function truncate(value,length) { const text=String(value??""); return text.length>length?`${text.slice(0,length-1)}…`:text; }
  function formatNumber(value) { return decimal.format(finiteNumber(value)); }
  function formatCover(value) { return Number.isFinite(value)?`${decimal.format(value)} mo`:value===Infinity?"No demand":"—"; }
  function formatMoney(value) { const currency=REGION_CURRENCY[state.region]; return new Intl.NumberFormat(state.region==="EU"?"en-IE":"en-US",{style:"currency",currency,maximumFractionDigits:0}).format(finiteNumber(value)); }
  function shortNumber(value) { const absolute=Math.abs(value); if(absolute>=1e6)return `${(value/1e6).toFixed(1)}M`; if(absolute>=1e3)return `${(value/1e3).toFixed(1)}K`; return decimal.format(value); }
  function shortMoney(value) { return `${value<0?"-":""}${REGION_CURRENCY[state.region]==="EUR"?"€":REGION_CURRENCY[state.region]==="CAD"?"C$":"$"}${shortNumber(Math.abs(value))}`; }
  function priceCoverageText(items) { const matched=items.filter(item=>item.price>0).length; return items.length?`${percent.format(matched/items.length)} model price coverage`:"No selected models"; }
  function escapeHtml(value) { return String(value??"").replace(/[&<>"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[char])); }
  function debounce(fn,wait) { let timer; return (...args)=>{clearTimeout(timer);timer=setTimeout(()=>fn(...args),wait);}; }

  function clearChart(container) { container.innerHTML=""; }
  function chartEmpty(container,message="No data is available for this selection.") { container.innerHTML=`<div class="chart-empty">${escapeHtml(message)}</div>`; }
  function showTooltip(event,html) { const tooltip=$("tooltip"); tooltip.innerHTML=html; tooltip.hidden=false; moveTooltip(event); }
  function moveTooltip(event) { const tooltip=$("tooltip"); const x=Math.min(innerWidth-tooltip.offsetWidth-14,event.clientX+14); const y=Math.min(innerHeight-tooltip.offsetHeight-14,event.clientY+14); tooltip.style.left=`${Math.max(8,x)}px`; tooltip.style.top=`${Math.max(8,y)}px`; }
  function hideTooltip() { $("tooltip").hidden=true; }
  function showToast(message,error=false) { clearTimeout(toastTimer); const toast=$("toast"); toast.textContent=message; toast.className=`toast show${error?" error":""}`; toastTimer=setTimeout(()=>toast.className="toast",4200); }
  function setBusy(busy) { document.body.classList.toggle("busy",busy); }

  function openDatabase() {
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open(DB_NAME,DB_VERSION);
      request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(DB_STORE))db.createObjectStore(DB_STORE);};
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
  }
  async function loadRegion(region) { try { const db=await openDatabase(); const value=await new Promise((resolve,reject)=>{const tx=db.transaction(DB_STORE,"readonly");const request=tx.objectStore(DB_STORE).get(region);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);}); db.close(); if(value)state.regions[region]=value; if(value?.sales&&!value.analysis)value.analysis=analyze(value.sales,value.prices); } catch(error) { console.warn("Sales data could not be restored.",error); } }
  async function persistRegion(region) { try { const db=await openDatabase(); await new Promise((resolve,reject)=>{const tx=db.transaction(DB_STORE,"readwrite");tx.objectStore(DB_STORE).put(state.regions[region],region);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);}); db.close(); } catch(error) { console.warn("Sales data could not be saved.",error); } }
  async function deleteStoredRegion(region) { try { const db=await openDatabase(); await new Promise((resolve,reject)=>{const tx=db.transaction(DB_STORE,"readwrite");tx.objectStore(DB_STORE).delete(region);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);}); db.close(); } catch(error) { console.warn("Sales data could not be cleared.",error); } }
})();
