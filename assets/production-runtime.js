(() => {
  "use strict";

  if (window.__starkProductionRuntime) return;
  window.__starkProductionRuntime = true;

  const body = document.body;
  if (!body) return;

  const resetPageState = () => {
    body.classList.remove(
      "premium-content-leaving",
      "page-leaving",
      "inventory-fallback-leaving",
      "runtime-loading"
    );
    document.documentElement.classList.add("runtime-ready");
  };

  const announceRuntimeIssue = message => {
    if (!message || document.querySelector(".runtime-notice")) return;
    const notice = document.createElement("div");
    notice.className = "runtime-notice";
    notice.setAttribute("role", "status");
    notice.innerHTML = `<strong>That action could not be completed.</strong><span>${message}</span><button type="button" aria-label="Dismiss message">×</button>`;
    notice.querySelector("button").addEventListener("click", () => notice.remove());
    body.appendChild(notice);
    window.setTimeout(() => notice.remove(), 9000);
  };

  window.addEventListener("pageshow", resetPageState);
  window.addEventListener("popstate", resetPageState);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") resetPageState();
  });

  window.addEventListener("error", event => {
    const source = String(event.filename || "");
    if (source && !source.startsWith(location.origin) && !source.startsWith("file:")) return;
    console.error("Stark runtime error", event.error || event.message);
    announceRuntimeIssue("The page stayed available. Refresh once if the action does not recover.");
  });

  window.addEventListener("unhandledrejection", event => {
    console.error("Stark runtime rejection", event.reason);
    announceRuntimeIssue("The page stayed available. Please retry the last action.");
  });

  if ("scrollRestoration" in history) history.scrollRestoration = "auto";
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", resetPageState, { once: true });
  } else {
    resetPageState();
  }
})();
