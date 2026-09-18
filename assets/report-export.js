(() => {
  "use strict";

  if (window.StarkReportExport) return;

  const path = location.pathname.split("/").pop() || "index.html";
  const reportPages = /^(inventory-dashboard|inventory-analysis-report|raw-report|reorder-report|active-brands|instructions)-(us|eu|ca)\.html$/i.test(path)
    || ["ats-eu.html", "sales-analysis.html", "events.html", "freight-estimator.html", "freight-consolidate.html", "shipment-tracking.html"].includes(path);
  if (!reportPages || document.querySelector(".tv-app")) return;

  const waitFrame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const cleanName = value => String(value || "Stark Report").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
  const region = (() => {
    const suffix = path.match(/-(us|eu|ca)\.html$/i)?.[1]?.toUpperCase();
    const query = new URLSearchParams(location.search).get("region");
    const bodyRegion = document.body.dataset.region;
    const stored = localStorage.getItem("stark-selected-region");
    return suffix || String(query || bodyRegion || stored || "US").toUpperCase();
  })();

  const title = () => document.querySelector("main h1, .hero h1, .inventory-page-heading h1, h1")?.textContent?.trim()
    || document.title.split("|")[0].trim()
    || "Stark Report";

  const cssText = async () => {
    const blocks = [];
    const inline = Array.from(document.querySelectorAll("style")).map(node => node.textContent || "");
    blocks.push(...inline);
    const localSheets = Array.from(document.querySelectorAll('link[rel="stylesheet"][href]'))
      .map(node => new URL(node.href, location.href))
      .filter(url => url.origin === location.origin || url.protocol === "file:");
    const fetched = await Promise.all(localSheets.map(async url => {
      try { return await (await fetch(url.href)).text(); } catch (_) { return ""; }
    }));
    blocks.push(...fetched);
    return blocks.join("\n");
  };

  const syncFormState = (source, clone) => {
    const sourceFields = source.querySelectorAll("input, select, textarea");
    const cloneFields = clone.querySelectorAll("input, select, textarea");
    sourceFields.forEach((field, index) => {
      const copy = cloneFields[index];
      if (!copy) return;
      if (field instanceof HTMLInputElement) {
        if (["checkbox", "radio"].includes(field.type)) copy.toggleAttribute("checked", field.checked);
        else copy.setAttribute("value", field.value);
      } else if (field instanceof HTMLTextAreaElement) {
        copy.textContent = field.value;
      } else if (field instanceof HTMLSelectElement) {
        Array.from(copy.options).forEach((option, optionIndex) => option.toggleAttribute("selected", optionIndex === field.selectedIndex));
      }
    });
  };

  const captureCanvases = (source, clone) => {
    const sourceCanvases = source.querySelectorAll("canvas");
    const cloneCanvases = clone.querySelectorAll("canvas");
    sourceCanvases.forEach((canvas, index) => {
      const copy = cloneCanvases[index];
      if (!copy) return;
      try {
        const image = document.createElement("img");
        image.src = canvas.toDataURL("image/png");
        image.alt = canvas.getAttribute("aria-label") || "Report chart";
        image.className = "exported-canvas-chart";
        copy.replaceWith(image);
      } catch (_) {
        copy.remove();
      }
    });
  };

  const makeClone = () => {
    const source = document.body;
    const clone = source.cloneNode(true);
    syncFormState(source, clone);
    captureCanvases(source, clone);

    clone.querySelectorAll([
      "script", "noscript", "link", ".premium-side-rail", ".premium-rail-toggle",
      ".report-export-action", ".runtime-notice", "dialog", "template",
      "[hidden]", ".hidden", "input[type=file]"
    ].join(",")).forEach(node => node.remove());

    clone.querySelectorAll("button").forEach(button => {
      if (!button.closest(".kpi, .inventory-kpi, .kpi-card")) button.remove();
    });
    clone.querySelectorAll("a").forEach(link => {
      link.removeAttribute("href");
      link.removeAttribute("target");
    });
    clone.classList.remove("premium-shell-active", "premium-rail-open", "premium-content-leaving");
    clone.classList.add("export-document");
    return clone;
  };

  const exportReport = async trigger => {
    const original = trigger?.innerHTML;
    if (trigger) {
      trigger.disabled = true;
      trigger.innerHTML = '<span class="report-export-spinner" aria-hidden="true"></span><span>Preparing…</span>';
    }
    try {
      await waitFrame();
      const clone = makeClone();
      const styles = await cssText();
      const reportTitle = title();
      const exportedAt = new Date();
      const metadata = document.createElement("section");
      metadata.className = "export-cover";
      metadata.innerHTML = `<p>STARK PREMIUM · SUPPLY CHAIN INTELLIGENCE</p><h1>${reportTitle}</h1><div><strong>${region} market</strong><span>Exported ${exportedAt.toLocaleString()}</span><span>Current filters and visible analysis</span></div></section>`;
      clone.prepend(metadata);

      const exportCss = `
        :root{color-scheme:light}html{background:#edf4f8!important}body.export-document{display:block!important;margin:0!important;padding:28px!important;max-width:none!important;background:#edf4f8!important;color:#0b2440!important;font-family:Arial,sans-serif!important}body.export-document>*{margin-left:auto!important;margin-right:auto!important;max-width:1480px!important}.export-cover{box-sizing:border-box;margin-bottom:20px;padding:30px 34px;border-radius:20px;color:#fff;background:linear-gradient(120deg,#0a3156,#0c6a79)}.export-cover p{margin:0 0 8px;font-size:11px;font-weight:800;letter-spacing:.15em;color:#5ff1df}.export-cover h1{margin:0 0 14px;font-size:34px}.export-cover div{display:flex;gap:18px;flex-wrap:wrap;font-size:12px}.export-cover span,.export-cover strong{padding:7px 11px;border:1px solid rgba(255,255,255,.22);border-radius:999px}.export-document header,.export-document nav,.export-document .inventory-nav,.export-document .sales-header{display:none!important}.export-document main,.export-document .shell,.export-document .page,.export-document .inventory-main,.export-document #sales-main{width:100%!important;max-width:1480px!important;margin:0 auto!important;padding:0!important}.export-document [data-requires-data],.export-document .tab-panel.active,.export-document .analysis-view.active{display:block!important}.export-document .chart svg,.export-document svg,.export-document .exported-canvas-chart{max-width:100%!important;height:auto!important}.export-document .table-wrap,.export-document .inventory-table-wrap,.export-document .analysis-table-wrap{max-height:none!important;overflow:visible!important}.export-document table{width:100%!important;font-size:10px!important;page-break-inside:auto}.export-document tr{page-break-inside:avoid}.export-document .panel,.export-document .inventory-panel,.export-document .analysis-card,.export-document .kpi,.export-document .inventory-kpi,.export-document .kpi-card{break-inside:avoid;box-shadow:none!important}.export-document input,.export-document select,.export-document textarea{pointer-events:none}@page{size:landscape;margin:10mm}@media print{html,body.export-document{background:#fff!important;padding:0!important}.export-cover{-webkit-print-color-adjust:exact;print-color-adjust:exact}.export-document .panel,.export-document .inventory-panel,.export-document .analysis-card{border:1px solid #cadbe5!important}}
      `;
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${reportTitle} · ${region}</title><style>${styles}\n${exportCss}</style></head>${clone.outerHTML}</html>`;
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${cleanName(reportTitle)} ${region} ${exportedAt.toISOString().slice(0, 10)}.html`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    } catch (error) {
      console.error("Visual report export failed", error);
      alert(`The report could not be exported: ${error.message}`);
    } finally {
      if (trigger) {
        trigger.disabled = false;
        trigger.innerHTML = original;
      }
    }
  };

  const button = document.createElement("button");
  button.type = "button";
  button.className = "report-export-action";
  button.title = "Export the current report with its KPIs, charts and visible tables";
  button.setAttribute("aria-label", "Export current report with charts");
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 18v3h14v-3"/></svg><span>Export report</span>';
  button.addEventListener("click", () => exportReport(button));
  document.body.appendChild(button);

  window.StarkReportExport = { exportReport: () => exportReport(button) };
})();
