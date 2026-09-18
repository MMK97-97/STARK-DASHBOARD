(() => {
  "use strict";

  const body = document.body;
  if (!body || body.dataset.page !== "analysis-report") return;

  const regionCode = String(body.dataset.region || "US").toUpperCase();
  const region = regionCode === "CA" ? "Canada" : regionCode;
  const regionName = regionCode === "US" ? "United States" : regionCode === "EU" ? "European Union" : "Canada";
  const eligibleStatuses = new Set(["live", "fashion", "backorder"]);
  const sourceTypes = ["itemStock", "average", "skuSales", "brandSales", "customerSales", "stateSales", "priceCost", "pipeline"];
  const requiredSources = ["itemStock", "average", "skuSales"];
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const colors = ["#08a696", "#0878d1", "#f5a623", "#dc4b65", "#7657d6", "#4eb4cc", "#9aafbf"];
  const state = { data: {}, meta: {}, analysis: [], filtered: [], activeView: "overview", kpiFilter: "", chartFilter: null, periodFilter: "", brandFilter: "" };

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[character]));
  const clean = value => String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  const norm = value => clean(value).toUpperCase().replace(/[^A-Z0-9]+/g, "");
  const header = value => clean(value).toLowerCase().replace(/[_#-]+/g, " ").replace(/[^a-z0-9% ]/g, "").replace(/\s+/g, " ").trim();
  const number = value => { const raw = String(value ?? "").trim(); if (!raw) return 0; const negative = /^\(.*\)$/.test(raw); const parsed = Number(raw.replace(/[,$%()]/g, "").replace(/\s/g, "")); return Number.isFinite(parsed) ? (negative ? -parsed : parsed) : 0; };
  const sum = values => values.reduce((total, value) => total + (Number.isFinite(+value) ? +value : 0), 0);
  const average = values => values.length ? sum(values) / values.length : 0;
  const std = values => { if (values.length < 2) return 0; const mean = average(values); return Math.sqrt(sum(values.map(value => (value - mean) ** 2)) / (values.length - 1)); };
  const unique = values => [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
  const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
  const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: regionCode === "EU" ? "EUR" : regionCode === "CA" ? "CAD" : "USD", maximumFractionDigits: 0 });
  const pct = value => `${Number.isFinite(value) ? (value * 100).toFixed(1) : "0.0"}%`;
  const dateText = date => date instanceof Date && !isNaN(date) ? date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
  const reportDate = () => new Date(`${state.meta.asOf || new Date().toISOString().slice(0,10)}T00:00:00`);
  const keyOf = row => norm(row.model) || norm(row.itemId);
  const toast = (message, error = false) => { const node = $("analysis-toast"); node.textContent = message; node.className = `toast show${error ? " error" : ""}`; clearTimeout(toast.timer); toast.timer = setTimeout(() => node.className = "toast", 3400); };

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("stark-inventory-analysis-v1", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("reports");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function dbAction(mode, callback) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("reports", mode), store = tx.objectStore("reports"), request = callback(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    });
  }
  const dbKey = type => `${regionCode}:${type}`;
  const loadStored = type => dbAction("readonly", store => store.get(dbKey(type))).catch(() => null);
  const saveStored = (type, value) => dbAction("readwrite", store => store.put(value, dbKey(type)));
  const deleteStored = type => dbAction("readwrite", store => store.delete(dbKey(type))).catch(() => null);

  function getField(row, aliases) {
    const entries = Object.entries(row || {}), wanted = aliases.map(header);
    const match = entries.find(([name]) => wanted.includes(header(name)));
    return match ? match[1] : "";
  }
  function hasField(row, aliases) { return Object.keys(row || {}).some(name => aliases.map(header).includes(header(name))); }
  function requireFields(rows, fields, label) {
    const first = rows[0] || {}, missing = fields.filter(field => !hasField(first, field.aliases));
    if (missing.length) throw new Error(`${label}: missing ${missing.map(field => field.label).join(", ")}.`);
  }

  async function workbookRows(file) {
    if (!window.XLSX) throw new Error("The spreadsheet reader has not finished loading. Try again in a moment.");
    const bytes = await file.arrayBuffer();
    const workbook = XLSX.read(bytes, { type: "array", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
  }
  function parseSupplierWindow(value) {
    const dates = clean(value).match(/\d{1,2}\/\d{1,2}\/\d{4}/g) || [];
    return dates.map(value => new Date(`${value} 00:00:00`)).filter(date => !isNaN(date));
  }
  function parseAverageHtml(text) {
    const documentNode = new DOMParser().parseFromString(text, "text/html");
    const table = documentNode.querySelector("#gvreport") || documentNode.querySelector("table");
    if (!table) throw new Error("Average Item report: no report table was found.");
    const rows = [...table.rows], headers = [...rows.shift().cells].map(cell => clean(cell.textContent));
    return rows.filter(row => row.cells.length === headers.length).map(row => {
      const values = {}, cells = [...row.cells];
      headers.forEach((name, index) => { const clone = cells[index].cloneNode(true); clone.querySelectorAll("table").forEach(table => table.remove()); values[name] = clean(clone.textContent); });
      const supplierCell = cells[headers.findIndex(name => header(name) === "open orders to supplier")];
      values.__suppliers = supplierCell ? [...supplierCell.querySelectorAll("table tr")].slice(1).map(tr => {
        const cellValues = [...tr.cells].map(cell => clean(cell.textContent));
        return { po: cellValues[0] || "", qty: number(cellValues[1]), window: cellValues[2] || "" };
      }).filter(line => line.po || line.qty || line.window) : [];
      return values;
    });
  }
  async function sourceRows(file, type) {
    const bytes = await file.arrayBuffer();
    const prefix = new TextDecoder("utf-8").decode(bytes.slice(0, 5000)).toLowerCase();
    if (type === "average" && (prefix.includes("<table") || prefix.includes("gvreport"))) return parseAverageHtml(new TextDecoder("utf-8").decode(bytes));
    return workbookRows(file);
  }

  async function normalizeUpload(file, type) {
    const rows = await sourceRows(file, type);
    if (!rows.length) throw new Error("The selected report has no data rows.");
    if (type === "itemStock") {
      requireFields(rows, [{label:"item ID",aliases:["itemid","item id"]},{label:"brand",aliases:["brand"]},{label:"model",aliases:["modelnumber","model#","model"]},{label:"status",aliases:["itemstatus","status"]},{label:"stock quantity",aliases:["currentstockqty","stock qty"]}], "Item Stock report");
      const months = Object.keys(rows[0]).filter(name => /^\d{6}$/.test(clean(name))).sort();
      if (months.length < 3) throw new Error("Item Stock report: at least three YYYYMM demand columns are required.");
      return { rows: rows.map(row => ({ itemId:clean(getField(row,["itemid","item id"])), brand:clean(getField(row,["brand"])), model:clean(getField(row,["modelnumber","model#","model"])), title:clean(getField(row,["title","item title"])), status:clean(getField(row,["itemstatus","status"])), stock:Math.max(0,number(getField(row,["currentstockqty","stock qty"]))), demand:months.map(month => Math.max(0,number(row[month]))) })), meta:{months} };
    }
    if (type === "average") {
      requireFields(rows, [{label:"model",aliases:["model#","model"]},{label:"brand",aliases:["brand"]},{label:"Stock Qty",aliases:["stock qty","on hand"]},{label:"Open Orders From Client",aliases:["open orders from client"]}], "Average Item report");
      return { rows: rows.map(row => ({ itemId:clean(getField(row,["itemid","item id"])), brand:clean(getField(row,["brand"])), model:clean(getField(row,["model#","model","modelnumber"])), title:clean(getField(row,["item title","title"])), status:clean(getField(row,["status"])), avg3:number(getField(row,["avg/perm past 3m","avg per m past 3m"])), stock:Math.max(0,number(getField(row,["stock qty","on hand"]))), available:number(getField(row,["stock available","ats"])), openClient:Math.max(0,number(getField(row,["open orders from client"])),0), suppliers:(row.__suppliers || []) })), meta:{} };
    }
    if (type === "skuSales") {
      requireFields(rows, [{label:"Brand",aliases:["brand"]},{label:"Model#",aliases:["model#","model"]},{label:"Total",aliases:["total"]}], "Brand Sales by SKU report");
      const grouped = new Map();
      rows.forEach(row => { const key = `${norm(getField(row,["brand"]))}|${norm(getField(row,["model#","model"]))}`; const current = grouped.get(key) || { brand:clean(getField(row,["brand"])), model:clean(getField(row,["model#","model"])), title:clean(getField(row,["title","item title"])), revenue:Array(12).fill(0), total:0 }; monthNames.forEach((month,index) => current.revenue[index] += number(getField(row,[month]))); current.total += number(getField(row,["total"])); grouped.set(key,current); });
      return { rows:[...grouped.values()], meta:{rawRows:rows.length,revenueMonths:monthNames} };
    }
    if (type === "brandSales") {
      requireFields(rows, [{label:"Brand",aliases:["brand"]},{label:"Total",aliases:["total"]}], "Brand Sales report");
      return { rows:rows.map(row => ({ brandId:clean(getField(row,["brandid","brand id"])), brand:clean(getField(row,["brand"])), revenue:monthNames.map(month => number(getField(row,[month]))), total:number(getField(row,["total"])) })), meta:{revenueMonths:monthNames} };
    }
    if (type === "customerSales") {
      requireFields(rows, [{label:"Customer",aliases:["customer","client"]},{label:"Total",aliases:["total"]}], "Customer Sales report");
      return { rows:rows.map(row => ({ customerId:clean(getField(row,["customerid","customer id"])), customer:clean(getField(row,["customer","client"])), revenue:monthNames.map(month => number(getField(row,[month]))), total:number(getField(row,["total"])) })), meta:{revenueMonths:monthNames} };
    }
    if (type === "stateSales") {
      if (!hasField(rows[0], ["state","state name","province","region"])) throw new Error("Sales by State report: no State or Province column was found. A customer report cannot be used as geography.");
      return { rows:rows.map(row => ({ state:clean(getField(row,["state","state name","province","region"])), revenue:monthNames.map(month => number(getField(row,[month])),0), total:number(getField(row,["total"])) })), meta:{revenueMonths:monthNames} };
    }
    if (type === "priceCost") {
      requireFields(rows, [{label:"Model",aliases:["model#","model","modelnumber","sku"]}], "Price & Cost list");
      if (!hasField(rows[0],["cost","unit cost"]) && !hasField(rows[0],["netprice","net price"])) throw new Error("Price & Cost list: Cost or NetPrice is required.");
      return { rows:rows.map(row => ({ model:clean(getField(row,["model#","model","modelnumber","sku"])), itemId:clean(getField(row,["itemid","item id"])), cost:Math.max(0,number(getField(row,["cost","unit cost"]))), netPrice:Math.max(0,number(getField(row,["netprice","net price"])))})), meta:{} };
    }
    if (type === "pipeline") {
      requireFields(rows, [{label:"Model",aliases:["model#","model","sku"]},{label:"Expected Qty",aliases:["expected qty","quantity","qty"]},{label:"Required Date",aliases:["required date","need date","date"]}], "Program Pipeline");
      return { rows:rows.map(row => { const probabilityRaw=clean(getField(row,["probability","probability %"])),probabilityValue=probabilityRaw?number(probabilityRaw):1;return { program:clean(getField(row,["program","program name"])), client:clean(getField(row,["client","customer"])), model:clean(getField(row,["model#","model","sku"])), expectedQty:Math.max(0,number(getField(row,["expected qty","quantity","qty"]))), probability:Math.min(1,Math.max(0,probabilityValue/(probabilityValue>1?100:1))), requiredDate:clean(getField(row,["required date","need date","date"])) };}), meta:{} };
    }
    throw new Error("Unsupported report type.");
  }

  function leadMonths(value) {
    const text = clean(value).toLowerCase(), values = [...text.matchAll(/\d+(?:\.\d+)?/g)].map(match => +match[0]);
    if (!values.length) return 1;
    const amount = Math.max(...values);
    if (/day/.test(text)) return Math.max(.1, amount / 30.44);
    if (/week|wk/.test(text)) return Math.max(.1, amount / 4.35);
    if (/year/.test(text)) return amount * 12;
    return amount;
  }
  function activeBrands() {
    try { return JSON.parse(localStorage.getItem(`stark-active-brands-${region}`) || "{}"); } catch (_) { return {}; }
  }
  function brandSetting(brand) {
    const settings = activeBrands(), match = Object.keys(settings).find(name => clean(name).toLowerCase() === clean(brand).toLowerCase());
    return match ? settings[match] : { active:true, leadTime:"" };
  }
  function forecastValue(history, method) {
    const recent = count => average(history.slice(-Math.min(count, history.length)));
    if (!history.length) return 0;
    if (method === "3-month average") return recent(3);
    if (method === "6-month average") return recent(6);
    if (method === "Seasonal naive" && history.length >= 12) return history[history.length - 12];
    if (method === "Exponential smoothing") return history.slice(1).reduce((level, value) => .35 * value + .65 * level, history[0]);
    const last = history.slice(-3).reverse(), weights = [.5,.3,.2].slice(0,last.length), divisor = sum(weights);
    return divisor ? sum(last.map((value,index) => value * weights[index])) / divisor : recent(3);
  }
  function selectForecast(history) {
    const methods = ["Weighted recent", "3-month average", "6-month average", "Exponential smoothing", ...(history.length >= 12 ? ["Seasonal naive"] : [])];
    const results = methods.map(method => {
      const errors = [], signed = [];
      for (let index=3; index<history.length; index++) { const forecast = forecastValue(history.slice(0,index),method), actual=history[index]; errors.push(Math.abs(actual-forecast)); signed.push(forecast-actual); }
      return { method, mae:errors.length?average(errors):Infinity, abs:sum(errors), signed:sum(signed), actual:sum(history.slice(3)) };
    }).sort((a,b)=>a.mae-b.mae);
    const best = results[0] || {method:"Weighted recent",abs:0,signed:0,actual:0};
    return { method:best.method, forecast:Math.max(0,forecastValue(history,best.method)), wape:best.actual?best.abs/best.actual:null, bias:best.actual?best.signed/best.actual:null };
  }
  function supplierInbound(row, months) {
    const start = reportDate(), end = new Date(start); end.setDate(end.getDate()+Math.ceil(months*30.44));
    return sum((row?.suppliers || []).map(line => { const dates=parseSupplierWindow(line.window), due=dates.at(-1); return due && due>=start && due<=end ? Math.max(0,number(line.qty)) : 0; }));
  }

  function computeAnalysis() {
    const itemRows = state.data.itemStock || [], averageRows=state.data.average || [], skuRows=state.data.skuSales || [], priceRows=state.data.priceCost || [], pipelineRows=state.data.pipeline || [];
    const months = state.meta.itemStock?.months || state.meta.months || [];
    const asOfMonth = (state.meta.asOf || new Date().toISOString().slice(0,7)).replace("-","");
    const completeIndexes = months.map((month,index)=>({month,index})).filter(entry=>entry.month<asOfMonth);
    const avgMap=new Map(), avgItemMap=new Map(); averageRows.forEach(row=>{avgMap.set(norm(row.model),row);avgItemMap.set(norm(row.itemId),row);});
    const revenueMap=new Map(); skuRows.forEach(row=>revenueMap.set(norm(row.model),row));
    const priceMap=new Map(); priceRows.forEach(row=>{priceMap.set(norm(row.model)||norm(row.itemId),row);});
    const pipelineMap=new Map(); pipelineRows.forEach(row=>{const key=norm(row.model); if(!pipelineMap.has(key))pipelineMap.set(key,[]);pipelineMap.get(key).push(row);});
    let rows=itemRows.map(item=>{
      const key=keyOf(item), avgRow=avgMap.get(norm(item.model))||avgItemMap.get(norm(item.itemId))||{}, revenueRow=revenueMap.get(norm(item.model))||{}, prices=priceMap.get(key)||{}, brandConfig=brandSetting(item.brand), active=brandConfig.active!==false, eligible=eligibleStatuses.has(clean(item.status).toLowerCase())&&active;
      const history=completeIndexes.map(entry=>Math.max(0,number((item.demand||[])[entry.index]))), last9=history.slice(-9), selected=selectForecast(history), avg3=average(history.slice(-3)), avg6=average(history.slice(-6));
      const pipeline=(pipelineMap.get(norm(item.model))||[]), start=reportDate(), due=(days)=>pipeline.filter(row=>{const date=new Date(row.requiredDate);return !isNaN(date)&&date>=start&&date<=new Date(start.getTime()+days*86400000);}).reduce((total,row)=>total+row.expectedQty*row.probability,0);
      const forecast30=selected.forecast+due(30), forecast90=selected.forecast*3+due(90), hasCommitmentRow=Boolean(avgRow.model||avgRow.itemId), onHand=Math.max(0,number(hasCommitmentRow?avgRow.stock:item.stock)), committed=Math.max(0,number(avgRow.openClient)), leadTime=leadMonths(brandConfig.leadTime), inbound=supplierInbound(avgRow,leadTime), projected=onHand-committed+inbound;
      const sigma=std(history.slice(-Math.min(12,history.length))), z=1.65, safety=z*sigma*Math.sqrt(Math.max(.1,leadTime)), reorderPoint=forecast30*leadTime+safety, target=forecast30*Math.max(2,leadTime+1)+safety, recommended=Math.max(0,Math.ceil(target-projected)), mos=forecast30>0?Math.max(0,projected)/forecast30:null, excess=Math.max(0,Math.floor(onHand-(forecast30*4+safety))), dead=onHand>0&&sum(last9)===0, price=prices.netPrice||0,cost=prices.cost||0;
      return {...item,key,eligible,active,history,months:completeIndexes.map(entry=>entry.month),avgRow,revenue:number(revenueRow.total),price,cost,avg3,avg6,forecast30,forecast90,forecastMethod:selected.method,wape:selected.wape,bias:selected.bias,cv:avg3?std(history.slice(-6))/avg3:Infinity,onHand,committed,inbound,projected,leadTime,safety,reorderPoint,target,recommended,mos,excess,dead,pipeline30:due(30),inventoryValue:cost?onHand*cost:null,reorderValue:cost?recommended*cost:null,excessValue:cost?excess*cost:null};
    }).filter(row=>row.eligible);
    const metricTotal=sum(rows.map(row=>row.revenue))||sum(rows.map(row=>sum(row.history)));
    let cumulative=0; rows.slice().sort((a,b)=>(b.revenue||sum(b.history))-(a.revenue||sum(a.history))).forEach(row=>{const metric=row.revenue||sum(row.history);cumulative+=metric;row.contribution=metricTotal?metric/metricTotal:0;row.abc=cumulative/(metricTotal||1)<=.8?"A":cumulative/(metricTotal||1)<=.95?"B":"C";});
    rows.forEach(row=>{row.xyz=!Number.isFinite(row.cv)||row.cv>1?"Z":row.cv>.5?"Y":"X";const serviceZ=row.abc==="A"?2.05:row.abc==="B"?1.65:1.28;row.safety=serviceZ*std(row.history.slice(-Math.min(12,row.history.length)))*Math.sqrt(Math.max(.1,row.leadTime));row.reorderPoint=row.forecast30*row.leadTime+row.safety;row.target=row.forecast30*Math.max(2,row.leadTime+1)+row.safety;row.recommended=Math.max(0,Math.ceil(row.target-row.projected));row.excess=Math.max(0,Math.floor(row.onHand-(row.forecast30*4+row.safety)));row.reorderValue=row.cost?row.recommended*row.cost:null;row.excessValue=row.cost?row.excess*row.cost:null;const programRisk=row.pipeline30>row.projected; if(row.dead){row.exception="DEAD STOCK";row.exceptionClass="excess";}else if(programRisk){row.exception="PROGRAM RISK";row.exceptionClass="risk";}else if(row.forecast30>0&&(row.projected<=0||row.mos<.5)){row.exception="URGENT REORDER";row.exceptionClass="risk";}else if(row.recommended>0&&row.projected<row.reorderPoint){row.exception="REORDER";row.exceptionClass="risk";}else if(row.excess>0&&row.mos>4){row.exception="EXCESS";row.exceptionClass="excess";}else if(row.mos!=null&&row.mos<2){row.exception="WATCH";row.exceptionClass="warn";}else{row.exception="HEALTHY";row.exceptionClass="good";} row.stockoutDate=row.forecast30>0?new Date(reportDate().getTime()+Math.max(0,row.projected/row.forecast30*30.44)*86400000):null;});
    state.analysis=rows;
    applyFilters();
  }

  function applyFilters() {
    const brand=$("filter-brand").value||state.brandFilter,status=$("filter-status").value,abc=$("filter-abc").value,xyz=$("filter-xyz").value,search=norm($("filter-search").value);
    state.filtered=state.analysis.filter(row=>(!brand||row.brand===brand)&&(!status||row.status===status)&&(!abc||row.abc===abc)&&(!xyz||row.xyz===xyz)&&(!search||[row.model,row.itemId,row.title,row.brand].some(value=>norm(value).includes(search)))&&matchesKpi(row)&&matchesChart(row)&&matchesPeriod(row));
    renderAll();
  }

  function coverageBand(row) { if(row.mos==null)return "No demand";if(row.mos<.5)return "Critical <0.5";if(row.mos<1)return "Low 0.5–1";if(row.mos<2)return "Healthy 1–2";if(row.mos<=4)return "Watch 2–4";return "Excess >4"; }
  function matchesKpi(row) { switch(state.kpiFilter){case "forecast":return row.forecast30>0;case "risk":return ["URGENT REORDER","REORDER","PROGRAM RISK"].includes(row.exception);case "recommended":return row.recommended>0;case "stock":return row.onHand>0;case "excess":return row.excess>0;case "accuracy":return row.wape!=null;case "value":return (row.inventoryValue||0)>0;default:return true;} }
  function matchesChart(row) { if(!state.chartFilter)return true;const {type,value}=state.chartFilter;if(type==="exception")return row.exception===value;if(type==="coverage")return coverageBand(row)===value;if(type==="method")return row.forecastMethod===value;if(type==="xyz")return row.xyz===value;return true; }
  function matchesPeriod(row) { if(!state.periodFilter)return true;if(state.periodFilter==="__forecast__")return row.forecast30>0;const index=row.months.indexOf(state.periodFilter);return index>=0&&(row.history[index]||0)>0; }
  function kpi(key,label,value,note,kind="") { return `<button type="button" class="iar-kpi ${kind}${state.kpiFilter===key?" is-active":""}" data-kpi-filter="${esc(key)}" aria-pressed="${state.kpiFilter===key}"><small>${esc(label)}</small><strong>${esc(value)}</strong><span>${esc(note)}</span></button>`; }
  function renderKpis() {
    const rows=state.filtered, forecast=sum(rows.map(row=>row.forecast30)), recommended=sum(rows.map(row=>row.recommended)), risks=rows.filter(row=>["URGENT REORDER","REORDER","PROGRAM RISK"].includes(row.exception)).length, excess=sum(rows.map(row=>row.excess)), stock=sum(rows.map(row=>row.onHand)), weightedActual=sum(rows.map(row=>sum(row.history.slice(3)))), weightedError=sum(rows.map(row=>(row.wape??0)*sum(row.history.slice(3)))), accuracy=weightedActual?Math.max(0,1-weightedError/weightedActual):null, inventoryValue=sum(rows.map(row=>row.inventoryValue||0));
    $("analysis-kpis").innerHTML=[kpi("all","Analyzed SKUs",whole.format(rows.length),`${unique(rows.map(row=>row.brand)).length} active brands`),kpi("forecast","Forecast 30D",fmt.format(forecast),"Selected by SKU backtest","good"),kpi("risk","Stockout risk",whole.format(risks),"Urgent, reorder or program risk","risk"),kpi("recommended","Recommended units",whole.format(recommended),"Lead-time demand + safety stock","warn"),kpi("stock","On-hand units",whole.format(stock),"Eligible active-brand inventory"),kpi("excess","Excess units",whole.format(excess),"Above four months plus safety stock","warn"),kpi("accuracy","Forecast accuracy",accuracy==null?"—":pct(accuracy),accuracy==null?"Insufficient backtest history":"1 − portfolio WAPE"),kpi("value","Inventory value",state.data.priceCost?.length?money.format(inventoryValue):"—",state.data.priceCost?.length?"At uploaded unit Cost":"Upload Price & Cost list")].join("");
  }
  function barChart(rows,valueKey,labelKey,formatter=fmt.format,maxRows=9,click) {
    const selected=rows.slice(0,maxRows),max=Math.max(1,...selected.map(row=>+row[valueKey]||0));
    return selected.map(row=>`<button class="bar-row${click&&state.brandFilter===row[labelKey]?" active":""}" type="button" ${click?`data-bar-value="${esc(row[labelKey])}"`:""}><span title="${esc(row[labelKey])}">${esc(row[labelKey])}</span><span class="bar-track"><i class="bar-fill" style="width:${Math.max(1,(+row[valueKey]||0)/max*100)}%"></i></span><b>${esc(formatter(+row[valueKey]||0))}</b></button>`).join("")||`<div class="empty-state"><p>No data matches the current filters.</p></div>`;
  }
  function grouped(rows,key,fields) { const map=new Map(); rows.forEach(row=>{const name=row[key]||"Unspecified",current=map.get(name)||{name};fields.forEach(field=>current[field]=(current[field]||0)+(row[field]||0));current.count=(current.count||0)+1;map.set(name,current);});return [...map.values()]; }
  function donut(entries,totalLabel,filterType="") { const total=sum(entries.map(entry=>entry.value))||1;let cursor=0;const stops=[];entries.forEach((entry,index)=>{const start=cursor/total*100;cursor+=entry.value;stops.push(`${colors[index%colors.length]} ${start}% ${cursor/total*100}%`);});return `<div class="donut-wrap"><div class="donut" style="background:conic-gradient(${stops.join(",")})"><span class="donut-center"><strong>${whole.format(total)}</strong><span>${esc(totalLabel)}</span></span></div><div class="legend-list">${entries.map((entry,index)=>filterType?`<button type="button" class="legend-item${state.chartFilter?.type===filterType&&state.chartFilter?.value===entry.name?" is-active":""}" data-analysis-filter-type="${esc(filterType)}" data-analysis-filter-value="${esc(entry.name)}" aria-pressed="${state.chartFilter?.type===filterType&&state.chartFilter?.value===entry.name}"><i style="background:${colors[index%colors.length]}"></i><span>${esc(entry.name)}</span><strong>${whole.format(entry.value)}</strong></button>`:`<div class="legend-item"><i style="background:${colors[index%colors.length]}"></i><span>${esc(entry.name)}</span><strong>${whole.format(entry.value)}</strong></div>`).join("")}</div></div>`; }
  function lineChart(actual,forecast,labels,periodKeys=[]) {
    const values=[...actual,...forecast].filter(Number.isFinite),max=Math.max(1,...values),width=620,height=210,pad=28,step=(width-pad*2)/Math.max(1,labels.length-1),y=value=>height-pad-(value/max)*(height-pad*2),path=series=>{let started=false;return series.map((value,index)=>{if(!Number.isFinite(value)){started=false;return "";}const command=started?"L":"M";started=true;return `${command}${pad+index*step},${y(value)}`;}).join(" ");};
    return `<svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Demand and forecast trend">${[0,.25,.5,.75,1].map(r=>`<line class="grid" x1="${pad}" y1="${y(max*r)}" x2="${width-pad}" y2="${y(max*r)}"/><text x="0" y="${y(max*r)+3}">${fmt.format(max*r)}</text>`).join("")}<path class="actual" d="${path(actual)}"/>${forecast.length?`<path class="forecast" d="${path(forecast)}"/>`:""}${labels.map((label,index)=>{const value=Number.isFinite(actual[index])?actual[index]:forecast[index];const key=periodKeys[index]||"";return `<g class="trend-filter${state.periodFilter===key?" is-active":""}" ${key?`data-period-filter="${esc(key)}" role="button" tabindex="0"`:""}><circle cx="${pad+index*step}" cy="${y(Number.isFinite(value)?value:0)}" r="${state.periodFilter===key?5:3}"/><text x="${pad+index*step}" y="${height-5}" text-anchor="middle">${esc(label)}</text><title>${esc(label)}: ${fmt.format(Number.isFinite(value)?value:0)}</title></g>`;}).join("")}</svg>`;
  }
  function renderOverview() {
    const rows=state.filtered, months=state.analysis[0]?.months||[],recentMonths=months.slice(-8),actual=recentMonths.map((_,i)=>sum(rows.map(row=>row.history.slice(-recentMonths.length)[i]||0))),labels=recentMonths.map(value=>`${value.slice(4)}/${value.slice(2,4)}`),forecast=sum(rows.map(row=>row.forecast30));
    $("trend-chart").innerHTML=lineChart([...actual,NaN],[...Array(Math.max(0,actual.length-1)).fill(NaN),actual.at(-1)||0,forecast],[...labels,"Next"],[...recentMonths,"__forecast__"]);
    const exceptions=grouped(rows,"exception",[]).map(row=>({name:row.name,value:row.count})).sort((a,b)=>b.value-a.value);$("exception-chart").innerHTML=donut(exceptions,"SKUs","exception");
    const brands=grouped(rows,"brand",["recommended"]).sort((a,b)=>b.recommended-a.recommended);$("brand-demand-chart").innerHTML=barChart(brands,"recommended","name",whole.format,5,true);
    const coverage=["Critical <0.5","Low 0.5–1","Healthy 1–2","Watch 2–4","Excess >4","No demand"].map(name=>({name,value:rows.filter(row=>coverageBand(row)===name).length}));$("abc-xyz-chart").innerHTML=donut(coverage,"SKUs","coverage");
    const urgent=rows.filter(row=>["URGENT REORDER","PROGRAM RISK"].includes(row.exception)).length,reorderRows=rows.filter(row=>row.recommended>0),recommended=sum(reorderRows.map(row=>row.recommended)),supplyGap=sum(rows.map(row=>Math.max(0,row.reorderPoint-row.projected))),errorRows=rows.filter(row=>row.wape!=null),actualUnits=sum(errorRows.map(row=>sum(row.history.slice(3)))),weightedError=sum(errorRows.map(row=>(row.wape||0)*sum(row.history.slice(3)))),accuracy=actualUnits?Math.max(0,1-weightedError/actualUnits):null,topBrand=brands[0]?.name||"No brand";
    $("advanced-insights").innerHTML=`<article class="insight-card risk"><i>!</i><div><strong>Immediate action</strong><span>${whole.format(urgent)} urgent or program-risk SKUs; ${esc(topBrand)} has the largest replenishment signal.</span></div></article><article class="insight-card warn"><i>↗</i><div><strong>Supply gap</strong><span>${whole.format(recommended)} recommended units across ${whole.format(reorderRows.length)} models; ${whole.format(supplyGap)} units below reorder points.</span></div></article><article class="insight-card"><i>✓</i><div><strong>Forecast confidence</strong><span>${accuracy==null?"Insufficient backtest history":`${pct(accuracy)} portfolio accuracy`} using SKU-level method selection and complete months only.</span></div></article>`;
    $("exception-table").innerHTML=rows.slice().sort((a,b)=>b.recommended-a.recommended||a.mos-b.mos).slice(0,250).map(row=>`<tr><td>${esc(row.model)}</td><td>${esc(row.brand)}</td><td>${esc(row.title)}</td><td>${esc(row.status)}</td><td class="num">${fmt.format(row.forecast30)}</td><td class="num">${fmt.format(row.projected)}</td><td class="num">${fmt.format(row.safety)}</td><td class="num">${whole.format(row.recommended)}</td><td class="num">${row.mos==null?"—":row.mos.toFixed(1)}</td><td><span class="status-pill ${row.exceptionClass}">${esc(row.exception)}</span></td></tr>`).join("")||emptyRow(10);
  }
  function renderForecast() {
    const rows=state.filtered,methods=grouped(rows,"forecastMethod",[]).map(row=>({name:row.name,value:row.count})).sort((a,b)=>b.value-a.value);$("method-chart").innerHTML=donut(methods,"SKUs");
    const withError=rows.filter(row=>row.wape!=null),wape=withError.length?sum(withError.map(row=>row.wape*sum(row.history.slice(3))))/sum(withError.map(row=>sum(row.history.slice(3)))):null,bias=withError.length?sum(withError.map(row=>row.bias*sum(row.history.slice(3))))/sum(withError.map(row=>sum(row.history.slice(3)))):null;$("accuracy-chart").innerHTML=`<div class="dq-list"><div class="dq-item"><i></i><div><strong>Portfolio WAPE</strong><span>Weighted absolute percentage error</span></div><b>${wape==null?"—":pct(wape)}</b></div><div class="dq-item ${Math.abs(bias||0)>.15?"warn":""}"><i></i><div><strong>Forecast bias</strong><span>Positive means over-forecasting</span></div><b>${bias==null?"—":pct(bias)}</b></div></div>`;
    const variability=["X","Y","Z"].map(name=>({name,value:rows.filter(row=>row.xyz===name).length}));$("variability-chart").innerHTML=donut(variability,"SKUs");
    $("forecast-table").innerHTML=rows.slice().sort((a,b)=>b.forecast30-a.forecast30).slice(0,500).map(row=>`<tr><td>${esc(row.model)}</td><td>${esc(row.brand)}</td><td>${row.abc}/${row.xyz}</td><td>${esc(row.forecastMethod)}</td><td class="num">${fmt.format(row.avg3)}</td><td class="num">${fmt.format(row.avg6)}</td><td class="num">${fmt.format(row.forecast30)}</td><td class="num">${fmt.format(row.forecast90)}</td><td class="num">${row.wape==null?"—":pct(row.wape)}</td><td class="num">${row.bias==null?"—":pct(row.bias)}</td></tr>`).join("")||emptyRow(10);
  }
  function renderInventory() {
    const rows=state.filtered,bands=[{name:"< 0.5 Critical",test:r=>r.mos!=null&&r.mos<.5},{name:"0.5–1 Low",test:r=>r.mos>=.5&&r.mos<1},{name:"1–2 Healthy",test:r=>r.mos>=1&&r.mos<2},{name:"2–4 Watch",test:r=>r.mos>=2&&r.mos<=4},{name:"> 4 Excess",test:r=>r.mos>4},{name:"No demand",test:r=>r.mos==null}].map(b=>({name:b.name,value:rows.filter(b.test).length}));$("mos-chart").innerHTML=donut(bands,"SKUs");
    $("action-chart").innerHTML=donut([{name:"Recommended PO",value:sum(rows.map(r=>r.recommended))},{name:"Excess",value:sum(rows.map(r=>r.excess))},{name:"Committed",value:sum(rows.map(r=>r.committed))},{name:"Inbound in lead time",value:sum(rows.map(r=>r.inbound))}],"units");
    $("inventory-table").innerHTML=rows.slice().sort((a,b)=>b.recommended-a.recommended).slice(0,500).map(row=>`<tr><td>${esc(row.model)}</td><td>${esc(row.brand)}</td><td>${esc(row.title)}</td><td class="num">${fmt.format(row.onHand)}</td><td class="num">${fmt.format(row.committed)}</td><td class="num">${fmt.format(row.inbound)}</td><td class="num">${fmt.format(row.projected)}</td><td class="num">${fmt.format(row.reorderPoint)}</td><td class="num">${fmt.format(row.target)}</td><td class="num">${whole.format(row.recommended)}</td><td><span class="status-pill ${row.exceptionClass}">${esc(row.exception)}</span></td></tr>`).join("")||emptyRow(11);
  }
  function renderBrands() {
    const rows=state.filtered,brandRows=grouped(rows,"brand",["revenue","forecast30","onHand","recommended","excess"]).map(row=>({...row,risk:rows.filter(item=>item.brand===row.name&&item.exceptionClass==="risk").length})).sort((a,b)=>b.revenue-a.revenue);$("brand-revenue-chart").innerHTML=barChart(brandRows,"revenue","name",money.format,9,true);$("sku-revenue-chart").innerHTML=barChart(rows.slice().sort((a,b)=>b.revenue-a.revenue).map(row=>({name:row.model,value:row.revenue})),"value","name",money.format,9);
    $("brand-table").innerHTML=brandRows.map(row=>`<tr><td>${esc(row.name)}</td><td class="num">${whole.format(row.count)}</td><td class="num">${money.format(row.revenue)}</td><td class="num">${fmt.format(row.forecast30)}</td><td class="num">${whole.format(row.onHand)}</td><td class="num">${whole.format(row.recommended)}</td><td class="num">${whole.format(row.excess)}</td><td class="num">${whole.format(row.risk)}</td></tr>`).join("")||emptyRow(8);
  }
  function renderCustomers() {
    const rows=(state.data.customerSales||[]).filter(row=>row.customer),total=sum(rows.map(row=>row.total)),sorted=rows.slice().sort((a,b)=>b.total-a.total);$("customer-chart").innerHTML=barChart(sorted.map(row=>({name:row.customer,value:row.total})),"value","name",money.format,10);const monthly=monthNames.map((month,index)=>sum(rows.map(row=>row.revenue[index]||0)));$("customer-trend").innerHTML=lineChart(monthly,[],monthNames.map(name=>name.slice(0,3)));$("customer-table").innerHTML=sorted.map((row,index)=>`<tr><td>${esc(row.customer)}</td><td class="num">${money.format(row.total)}</td><td class="num">${pct(total?row.total/total:0)}</td><td class="num">${index+1}</td></tr>`).join("")||emptyRow(4);
  }
  function renderGeography() { const rows=state.data.stateSales||[];$("geography-content").innerHTML=rows.length?`<div class="bar-chart">${barChart(rows.slice().sort((a,b)=>b.total-a.total).map(row=>({name:row.state,value:row.total})),"value","name",money.format,25)}</div>`:`<div class="empty-state"><div><strong>Geography is unavailable</strong><p>${esc(state.meta.stateSales?.invalid||"Upload a valid Sales by State file. The file must contain a State or Province column; customer data will not be relabeled as geography.")}</p></div></div>`; }
  function dqItem(title,detail,value,level="") { return `<div class="dq-item ${level}"><i></i><div><strong>${esc(title)}</strong><span>${esc(detail)}</span></div><b>${esc(value)}</b></div>`; }
  function renderQuality() {
    $("source-quality").innerHTML=sourceTypes.map(type=>{const meta=state.meta[type],required=requiredSources.includes(type);return dqItem(type.replace(/([A-Z])/g," $1").replace(/^./,c=>c.toUpperCase()),meta?.invalid||meta?.name|| (required?"Required source is missing":"Optional source not loaded"),meta?.rows?`${whole.format(meta.rows)} rows`:meta?.invalid?"Rejected":"—",meta?.invalid?"bad":required&&!meta?"bad":!meta?"warn":"");}).join("");
    const itemRows=state.data.itemStock||[],avgKeys=new Set((state.data.average||[]).map(keyOf)),revenueKeys=new Set((state.data.skuSales||[]).map(keyOf)),avgMatch=itemRows.filter(row=>avgKeys.has(keyOf(row))).length,revenueMatch=itemRows.filter(row=>revenueKeys.has(keyOf(row))).length,costKeys=new Set((state.data.priceCost||[]).map(keyOf)),costMatch=itemRows.filter(row=>costKeys.has(keyOf(row))).length;
    const brandRevenue=sum((state.data.brandSales||[]).map(row=>row.total)),skuRevenue=sum((state.data.skuSales||[]).map(row=>row.total)),revenueVariance=brandRevenue-skuRevenue,blankBrand=sum((state.data.brandSales||[]).filter(row=>!row.brand).map(row=>row.total));
    $("join-quality").innerHTML=[dqItem("Inventory commitment join","Item stock models matched to Average Item commitments",itemRows.length?pct(avgMatch/itemRows.length):"—",itemRows.length&&avgMatch/itemRows.length<.9?"warn":""),dqItem("SKU revenue join","Inventory models matched to SKU sales revenue",itemRows.length?pct(revenueMatch/itemRows.length):"—",itemRows.length&&revenueMatch/itemRows.length<.8?"warn":""),dqItem("Revenue reconciliation",blankBrand?`Brand summary includes ${money.format(blankBrand)} without a brand; variance is not assigned to a SKU.`:"Brand and SKU revenue totals reconcile.",brandRevenue&&skuRevenue?money.format(revenueVariance):"—",Math.abs(revenueVariance)>.01?"warn":""),dqItem("Cost coverage","Inventory models with uploaded unit Cost",itemRows.length?pct(costMatch/itemRows.length):"—",costMatch<itemRows.length?"warn":""),dqItem("Eligible scope","Only active Live, Fashion, and Backorder SKUs are modeled",`${whole.format(state.analysis.length)} SKUs`),dqItem("Partial month control","The current incomplete YYYYMM demand period is excluded",state.meta.itemStock?.months?.at(-1)||"—")].join("");
    $("methodology").innerHTML=`<div class="method-note"><strong>Forecast selection.</strong> Each SKU is backtested using weighted recent demand, 3-month average, 6-month average, exponential smoothing, and seasonal naive when 12 months are available. The lowest one-step MAE method is used. WAPE and bias remain visible.</div><div class="method-note"><strong>Replenishment.</strong> Recommended PO = max(0, Target Inventory − Projected Available), where Projected Available = On Hand − Committed Client Orders + Supplier Qty arriving within lead time; Target Inventory covers the larger of two months or lead time plus one month, plus service-level safety stock. No overdue supplier quantity is counted.</div><div class="method-note"><strong>Controls.</strong> Only active Live, Fashion, and Backorder items are included. Negative demand is not allowed to inflate forecasts. Geography, cost exposure, and pipeline demand remain unavailable until their exact source fields validate.</div>`;
  }
  function emptyRow(columns) { return `<tr><td colspan="${columns}"><div class="empty-state"><p>No data matches the current filters.</p></div></td></tr>`; }
  function renderAll() { renderKpis();renderOverview();renderForecast();renderInventory();renderBrands();renderCustomers();renderGeography();renderQuality(); }

  function renderSourceStatus() {
    sourceTypes.forEach(type=>{const node=document.querySelector(`[data-source-status="${type}"]`),meta=state.meta[type];if(!node)return;if(meta?.invalid){node.textContent=meta.invalid;node.className="upload-status bad";}else if(meta){node.textContent=`${meta.name||"Loaded"} • ${whole.format(meta.rows||state.data[type]?.length||0)} rows`;node.className="upload-status good";}else{node.textContent=requiredSources.includes(type)?"Required • not loaded":"Optional";node.className="upload-status";}});
    const ready=requiredSources.filter(type=>state.data[type]?.length).length,missing=requiredSources.filter(type=>!state.data[type]?.length);$("data-readiness").innerHTML=`<strong>Readiness:</strong><span>${ready===requiredSources.length?"Core analysis ready.":`Core ${ready}/${requiredSources.length}; missing ${missing.join(", ")}.`} ${state.analysis.length?`${whole.format(state.analysis.length)} eligible active-brand SKUs calculated.`:""}</span>`;$("analysis-live-title").textContent=state.analysis.length?"Validated analysis active":"Upload core reports";$("analysis-live-detail").textContent=state.analysis.length?`${whole.format(state.analysis.length)} eligible SKUs • ${regionName}`:"No calculations are shown until item history is valid";
  }
  function populateFilters() { const brand=$("filter-brand"),current=brand.value,brands=unique(state.analysis.map(row=>row.brand));brand.innerHTML=`<option value="">All brands</option>${brands.map(value=>`<option>${esc(value)}</option>`).join("")}`;brand.value=brands.includes(current)?current:"";const status=$("filter-status"),currentStatus=status.value,statuses=unique(state.analysis.map(row=>row.status));status.innerHTML=`<option value="">All eligible statuses</option>${statuses.map(value=>`<option>${esc(value)}</option>`).join("")}`;status.value=statuses.includes(currentStatus)?currentStatus:""; }
  async function handleUpload(event) {
    const input=event.currentTarget,file=input.files?.[0],type=input.dataset.upload;if(!file)return;const status=document.querySelector(`[data-source-status="${type}"]`);status.textContent="Validating…";status.className="upload-status";
    try{const parsed=await normalizeUpload(file,type),stored={rows:parsed.rows,meta:{...parsed.meta,name:file.name,rows:parsed.meta.rawRows||parsed.rows.length,uploadedAt:new Date().toISOString()}};await saveStored(type,stored);state.data[type]=stored.rows;state.meta[type]=stored.meta;if(type==="itemStock")state.meta.months=stored.meta.months;localStorage.removeItem(`stark-analysis-seed-disabled-${regionCode}`);populateFilters();computeAnalysis();renderSourceStatus();toast(`${file.name} validated and applied.`);}catch(error){state.meta[type]={name:file.name,rows:0,invalid:error.message};renderSourceStatus();renderQuality();toast(error.message,true);}finally{input.value="";}
  }

  function csvDownload(rows,name) { const csv=rows.map(row=>row.map(value=>{const text=String(value??"");return /[",\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;}).join(",")).join("\n"),blob=new Blob(["\ufeff",csv],{type:"text/csv;charset=utf-8"}),link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000); }
  function exportRows(type) { const rows=state.filtered; if(type==="forecast")return [["Model","Brand","ABC","XYZ","Method","Avg 3M","Avg 6M","Forecast 30D","Forecast 90D","WAPE","Bias"],...rows.map(r=>[r.model,r.brand,r.abc,r.xyz,r.forecastMethod,r.avg3,r.avg6,r.forecast30,r.forecast90,r.wape??"",r.bias??""])];if(type==="inventory")return [["Model","Brand","Item","On Hand","Committed","Inbound in Lead Time","Projected Available","Reorder Point","Target","Recommended PO","Action"],...rows.map(r=>[r.model,r.brand,r.title,r.onHand,r.committed,r.inbound,r.projected,r.reorderPoint,r.target,r.recommended,r.exception])];return [["Model","Brand","Item","Status","Forecast 30D","Projected Available","Safety Stock","Recommended PO","MOS","Exception"],...rows.map(r=>[r.model,r.brand,r.title,r.status,r.forecast30,r.projected,r.safety,r.recommended,r.mos??"",r.exception])]; }

  function exportChartSeries() {
    const rows=state.filtered,months=state.analysis[0]?.months||[],recentMonths=months.slice(-8),trend=recentMonths.map((month,index)=>({label:`${month.slice(4)}/${month.slice(2,4)}`,value:sum(rows.map(row=>row.history.slice(-recentMonths.length)[index]||0))}));
    trend.push({label:"Next 30D",value:sum(rows.map(row=>row.forecast30)),forecast:true});
    const exceptions=grouped(rows,"exception",[]).map(row=>({label:row.name,value:row.count})).sort((a,b)=>b.value-a.value);
    const brands=grouped(rows,"brand",["forecast30"]).map(row=>({label:row.name,value:row.forecast30})).sort((a,b)=>b.value-a.value).slice(0,10);
    const mosBands=[{label:"< 0.5 Critical",test:r=>r.mos!=null&&r.mos<.5},{label:"0.5–1 Low",test:r=>r.mos>=.5&&r.mos<1},{label:"1–2 Healthy",test:r=>r.mos>=1&&r.mos<2},{label:"2–4 Watch",test:r=>r.mos>=2&&r.mos<=4},{label:"> 4 Excess",test:r=>r.mos>4},{label:"No demand",test:r=>r.mos==null}].map(band=>({label:band.label,value:rows.filter(band.test).length}));
    return {trend,exceptions,brands,mosBands};
  }
  function chartCanvas(title,subtitle,draw) {
    const canvas=document.createElement("canvas"),width=1100,height=520;canvas.width=width;canvas.height=height;const ctx=canvas.getContext("2d");ctx.fillStyle="#ffffff";ctx.fillRect(0,0,width,height);ctx.fillStyle="#eff8fb";ctx.fillRect(0,0,width,78);ctx.fillStyle="#0b3458";ctx.font="700 27px Manrope, Arial, sans-serif";ctx.fillText(title,34,37);ctx.fillStyle="#64758f";ctx.font="500 14px DM Sans, Arial, sans-serif";ctx.fillText(subtitle,34,61);ctx.strokeStyle="#d5e5ee";ctx.strokeRect(.5,.5,width-1,height-1);draw(ctx,{x:52,y:105,w:996,h:360});return canvas.toDataURL("image/png").split(",")[1];
  }
  function lineChartImage(series) {
    return chartCanvas("Demand History & Selected Forecast","Complete historical months plus the next 30-day forecast",(ctx,box)=>{const max=Math.max(1,...series.map(point=>point.value)),step=box.w/Math.max(1,series.length-1);ctx.font="12px DM Sans, Arial";ctx.textAlign="right";for(let index=0;index<=4;index++){const value=max*(1-index/4),y=box.y+box.h*index/4;ctx.strokeStyle="#e3edf3";ctx.beginPath();ctx.moveTo(box.x,y);ctx.lineTo(box.x+box.w,y);ctx.stroke();ctx.fillStyle="#71839a";ctx.fillText(fmt.format(value),box.x-8,y+4);}ctx.textAlign="center";ctx.lineWidth=4;ctx.strokeStyle="#0879dc";ctx.beginPath();series.forEach((point,index)=>{const x=box.x+step*index,y=box.y+box.h-(point.value/max)*box.h;if(index===series.length-1){ctx.stroke();ctx.beginPath();ctx.strokeStyle="#08a696";ctx.setLineDash([10,7]);const previous=series[index-1],px=box.x+step*(index-1),py=box.y+box.h-(previous.value/max)*box.h;ctx.moveTo(px,py);ctx.lineTo(x,y);ctx.stroke();ctx.setLineDash([]);ctx.beginPath();}else if(index===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.stroke();series.forEach((point,index)=>{const x=box.x+step*index,y=box.y+box.h-(point.value/max)*box.h;ctx.fillStyle=point.forecast?"#08a696":"#0879dc";ctx.beginPath();ctx.arc(x,y,6,0,Math.PI*2);ctx.fill();ctx.fillStyle="#536b83";ctx.fillText(point.label,x,box.y+box.h+27);});});
  }
  function donutChartImage(title,subtitle,series) {
    return chartCanvas(title,subtitle,(ctx,box)=>{const total=sum(series.map(point=>point.value))||1,cx=box.x+250,cy=box.y+box.h/2,radius=142;let start=-Math.PI/2;series.forEach((point,index)=>{const angle=point.value/total*Math.PI*2;ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,radius,start,start+angle);ctx.closePath();ctx.fillStyle=colors[index%colors.length];ctx.fill();start+=angle;});ctx.beginPath();ctx.arc(cx,cy,75,0,Math.PI*2);ctx.fillStyle="#fff";ctx.fill();ctx.fillStyle="#102d4d";ctx.font="700 30px Manrope, Arial";ctx.textAlign="center";ctx.fillText(whole.format(total),cx,cy+2);ctx.fillStyle="#71839a";ctx.font="12px DM Sans, Arial";ctx.fillText("SKUs",cx,cy+25);ctx.textAlign="left";series.forEach((point,index)=>{const x=box.x+520,y=box.y+24+index*48;ctx.fillStyle=colors[index%colors.length];ctx.fillRect(x,y-11,14,14);ctx.fillStyle="#304b66";ctx.font="600 15px DM Sans, Arial";ctx.fillText(point.label,x+25,y);ctx.textAlign="right";ctx.fillStyle="#102d4d";ctx.fillText(whole.format(point.value),box.x+box.w,y);ctx.textAlign="left";});});
  }
  function barChartImage(series) {
    return chartCanvas("Forecast Demand by Brand","Top brands by selected 30-day SKU forecast",(ctx,box)=>{const max=Math.max(1,...series.map(point=>point.value)),labelWidth=220,trackWidth=box.w-labelWidth-110,rowHeight=box.h/Math.max(1,series.length);series.forEach((point,index)=>{const y=box.y+index*rowHeight+rowHeight*.22,height=Math.max(12,rowHeight*.5);ctx.fillStyle="#304b66";ctx.font="600 14px DM Sans, Arial";ctx.textAlign="left";const label=point.label.length>25?`${point.label.slice(0,24)}…`:point.label;ctx.fillText(label,box.x,y+height*.75);ctx.fillStyle="#e8f0f5";ctx.fillRect(box.x+labelWidth,y,trackWidth,height);const gradient=ctx.createLinearGradient(box.x+labelWidth,0,box.x+labelWidth+trackWidth,0);gradient.addColorStop(0,"#08a696");gradient.addColorStop(1,"#0879dc");ctx.fillStyle=gradient;ctx.fillRect(box.x+labelWidth,y,Math.max(2,point.value/max*trackWidth),height);ctx.fillStyle="#102d4d";ctx.textAlign="right";ctx.fillText(fmt.format(point.value),box.x+box.w,y+height*.75);});});
  }
  function pictureAnchor(index,name,fromCol,fromRow,toCol,toRow) {
    return `<xdr:twoCellAnchor><xdr:from><xdr:col>${fromCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${toCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${index+1}" name="${name}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rIdImage${index+1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm/><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>`;
  }
  async function embedCharts(workbookBytes,images) {
    if(!window.JSZip)throw new Error("The chart packaging component is unavailable. Refresh the page and export again.");
    const zip=await JSZip.loadAsync(workbookBytes),sheetPath="xl/worksheets/sheet1.xml",sheetFile=zip.file(sheetPath);if(!sheetFile)throw new Error("The Excel dashboard sheet could not be prepared.");let sheetXml=await sheetFile.async("string");if(!/xmlns:r=/.test(sheetXml))sheetXml=sheetXml.replace("<worksheet ",'<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');sheetXml=sheetXml.replace("</worksheet>",'<drawing r:id="rIdCharts"/></worksheet>');zip.file(sheetPath,sheetXml);
    const relPath="xl/worksheets/_rels/sheet1.xml.rels",existingRel=zip.file(relPath),relEntry='<Relationship Id="rIdCharts" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>';let relXml=existingRel?await existingRel.async("string"):'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';relXml=relXml.replace("</Relationships>",`${relEntry}</Relationships>`);zip.file(relPath,relXml);
    const anchors=[[0,15,8,34],[8,15,16,34],[0,35,8,54],[8,35,16,54]],names=["Demand Forecast","Exception Portfolio","Brand Forecast","Months of Supply"];const drawing='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'+images.map((_,index)=>pictureAnchor(index,names[index],...anchors[index])).join("")+'</xdr:wsDr>';zip.file("xl/drawings/drawing1.xml",drawing);
    const drawingRels='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+images.map((_,index)=>`<Relationship Id="rIdImage${index+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/analysis-chart-${index+1}.png"/>`).join("")+'</Relationships>';zip.file("xl/drawings/_rels/drawing1.xml.rels",drawingRels);images.forEach((image,index)=>zip.file(`xl/media/analysis-chart-${index+1}.png`,image,{base64:true}));
    const contentFile=zip.file("[Content_Types].xml");let contentXml=await contentFile.async("string");if(!/Extension="png"/.test(contentXml))contentXml=contentXml.replace("</Types>",'<Default Extension="png" ContentType="image/png"/></Types>');if(!/PartName="\/xl\/drawings\/drawing1.xml"/.test(contentXml))contentXml=contentXml.replace("</Types>",'<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>');zip.file("[Content_Types].xml",contentXml);return zip.generateAsync({type:"blob",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",compression:"DEFLATE"});
  }
  function downloadBlob(blob,name) { const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),1200); }
  async function exportWorkbook() {
    if(!state.filtered.length)return toast("No analysis matches the current filters. Reset the filters before exporting.",true);if(!window.XLSX)return toast("The Excel export component is still loading. Try again in a moment.",true);const button=$("export-analysis"),original=button.textContent;button.disabled=true;button.textContent="Building charts…";
    try{const rows=state.filtered,series=exportChartSeries(),forecast30=sum(rows.map(row=>row.forecast30)),forecast90=sum(rows.map(row=>row.forecast90)),risks=rows.filter(row=>["URGENT REORDER","REORDER","PROGRAM RISK"].includes(row.exception)).length,recommended=sum(rows.map(row=>row.recommended)),excess=sum(rows.map(row=>row.excess)),dead=rows.filter(row=>row.dead).length,withError=rows.filter(row=>row.wape!=null),actual=sum(withError.map(row=>sum(row.history.slice(3)))),error=sum(withError.map(row=>(row.wape||0)*sum(row.history.slice(3)))),accuracy=actual?Math.max(0,1-error/actual):"";
      const dashboardRows=[["INVENTORY ANALYSIS DASHBOARD"],[`${regionName} • Exported ${new Date().toLocaleString()} • ${whole.format(rows.length)} filtered SKUs`],[],["KPI","Value","Definition"],["Analyzed SKUs",rows.length,"Active Live, Fashion and Backorder items"],["Forecast 30D",forecast30,"Selected by SKU backtest"],["Forecast 90D",forecast90,"Baseline forecast plus applicable program pipeline"],["Stockout Risk",risks,"Urgent reorder, reorder, or program risk"],["Recommended Units",recommended,"Target inventory less projected available"],["Excess Units",excess,"Above maximum coverage and safety stock"],["Dead Stock Models",dead,"Positive stock with zero nine-month demand"],["Forecast Accuracy",accuracy,"1 minus portfolio WAPE"],[],["Charts below reflect the same filters used in every exported data sheet."]];
      const workbook=XLSX.utils.book_new(),dashboard=XLSX.utils.aoa_to_sheet(dashboardRows),append=(name,data)=>XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(data),name);dashboard["!cols"]=[{wch:25},{wch:22},{wch:55},...Array(13).fill({wch:13})];dashboard["!rows"]=[{hpt:28},{hpt:20},...Array(58).fill({hpt:20})];dashboard["!merges"]=[XLSX.utils.decode_range("A1:P1"),XLSX.utils.decode_range("A2:P2"),XLSX.utils.decode_range("A14:P14")];XLSX.utils.book_append_sheet(workbook,dashboard,"Dashboard");append("Inventory Actions",exportRows("inventory"));append("Demand Forecast",exportRows("forecast"));append("Exceptions",exportRows("exceptions"));append("Chart Data",[["Demand Period","Units"],...series.trend.map(point=>[point.label,point.value]),[],["Exception","SKUs"],...series.exceptions.map(point=>[point.label,point.value]),[],["Brand","Forecast 30D"],...series.brands.map(point=>[point.label,point.value]),[],["MOS Band","SKUs"],...series.mosBands.map(point=>[point.label,point.value])]);append("Data Quality",[["Source","File","Rows","Issue"],...sourceTypes.map(type=>[type,state.meta[type]?.name||"",state.meta[type]?.rows||0,state.meta[type]?.invalid||""])]);append("Methodology",[["Rule","Definition"],["Eligible scope","Active Live, Fashion and Backorder items"],["Forecast","Lowest one-step MAE among weighted recent, 3M, 6M, exponential smoothing and seasonal naive"],["Projected available","On hand - committed client orders + inbound arriving within lead time"],["Reorder point","Demand during lead time plus ABC service-level safety stock"],["Recommended PO","max(0, target inventory - projected available)"],["Source method","Historical redemption, program demand, commitments, supplier timing, and inventory remain separate until the decision calculation"]]);
      const images=[lineChartImage(series.trend),donutChartImage("Exception Portfolio","Decision status distribution for filtered SKUs",series.exceptions),barChartImage(series.brands),donutChartImage("Months of Supply","Coverage bands based on projected available ÷ forecast",series.mosBands)],bytes=XLSX.write(workbook,{bookType:"xlsx",type:"array"}),blob=await embedCharts(bytes,images);downloadBlob(blob,`Inventory Analysis ${regionCode} ${new Date().toISOString().slice(0,10)}.xlsx`);toast("Excel analysis exported with dashboard charts and detailed data.");
    }catch(error){toast(`Export failed: ${error.message}`,true);}finally{button.disabled=false;button.textContent=original;}
  }

  async function initData() {
    document.querySelectorAll("[data-region-label]").forEach(node=>node.textContent=regionName);
    const disabled=localStorage.getItem(`stark-analysis-seed-disabled-${regionCode}`)==="true",seed=!disabled?window.STARK_INVENTORY_ANALYSIS_SEED?.[regionCode]:null;
    if(seed){state.meta={asOf:seed.asOf,months:seed.months,...seed.sources};sourceTypes.forEach(type=>{if(seed[type])state.data[type]=seed[type];});state.meta.itemStock={...(state.meta.itemStock||{}),months:seed.months};}
    const stored=await Promise.all(sourceTypes.map(loadStored));stored.forEach((value,index)=>{if(!value)return;const type=sourceTypes[index];state.data[type]=value.rows;state.meta[type]=value.meta;if(type==="itemStock")state.meta.months=value.meta.months;});
    populateFilters();computeAnalysis();renderSourceStatus();
  }
  function bind() {
    document.querySelectorAll("[data-upload]").forEach(input=>input.addEventListener("change",handleUpload));
    $("toggle-analysis-sources").addEventListener("click",()=>{const panel=$("analysis-upload-grid"),open=panel.hasAttribute("hidden");panel.toggleAttribute("hidden",!open);$("toggle-analysis-sources").setAttribute("aria-expanded",String(open));$("toggle-analysis-sources").textContent=open?"Hide sources":"Manage sources";});
    ["filter-brand","filter-status","filter-abc","filter-xyz"].forEach(id=>$(id).addEventListener("change",()=>{state.kpiFilter="";state.chartFilter=null;state.periodFilter="";state.brandFilter="";applyFilters();}));$("filter-search").addEventListener("input",()=>{state.kpiFilter="";state.chartFilter=null;state.periodFilter="";applyFilters();});
    $("reset-analysis-filters").addEventListener("click",()=>{["filter-brand","filter-status","filter-abc","filter-xyz","filter-search"].forEach(id=>$(id).value="");state.kpiFilter="";state.chartFilter=null;state.periodFilter="";state.brandFilter="";applyFilters();});
    document.querySelector(".analysis-tabs").addEventListener("click",event=>{const button=event.target.closest("button[data-view]");if(!button)return;document.querySelectorAll(".analysis-tabs button").forEach(node=>node.classList.toggle("active",node===button));document.querySelectorAll("[data-analysis-view]").forEach(node=>node.classList.toggle("active",node.dataset.analysisView===button.dataset.view));state.activeView=button.dataset.view;});
    document.addEventListener("click",event=>{const kpiButton=event.target.closest("[data-kpi-filter]");if(kpiButton){const key=kpiButton.dataset.kpiFilter;state.kpiFilter=key==="all"||state.kpiFilter===key?"":key;applyFilters();return;}const chartButton=event.target.closest("[data-analysis-filter-type]");if(chartButton){const next={type:chartButton.dataset.analysisFilterType,value:chartButton.dataset.analysisFilterValue};state.chartFilter=state.chartFilter?.type===next.type&&state.chartFilter?.value===next.value?null:next;applyFilters();return;}const periodButton=event.target.closest("[data-period-filter]");if(periodButton){state.periodFilter=state.periodFilter===periodButton.dataset.periodFilter?"":periodButton.dataset.periodFilter;applyFilters();return;}const bar=event.target.closest("[data-bar-value]");if(bar){state.brandFilter=state.brandFilter===bar.dataset.barValue?"":bar.dataset.barValue;$("filter-brand").value=state.brandFilter;applyFilters();return;}const exportButton=event.target.closest("[data-export-table]");if(exportButton)exportWorkbook();});
    document.addEventListener("keydown",event=>{if((event.key==="Enter"||event.key===" ")&&event.target.matches("[data-period-filter]")){event.preventDefault();event.target.click();}});
    $("export-analysis").addEventListener("click",()=>exportWorkbook());
    $("clear-analysis").addEventListener("click",async()=>{if(!confirm(`Clear all Inventory Analysis Report uploads for ${regionName}? Existing Inventory Dashboard data will not be changed.`))return;await Promise.all(sourceTypes.map(deleteStored));localStorage.setItem(`stark-analysis-seed-disabled-${regionCode}`,"true");state.data={};state.meta={};state.analysis=[];state.filtered=[];populateFilters();renderSourceStatus();renderAll();toast("Regional analysis sources cleared.");});
    window.addEventListener("storage",event=>{if(event.key===`stark-active-brands-${region}`){computeAnalysis();populateFilters();renderSourceStatus();}});
  }

  bind();
  initData().catch(error=>toast(`Analysis could not start: ${error.message}`,true));
})();
