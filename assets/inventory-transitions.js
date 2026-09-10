(function () {
  "use strict";

  if (window.__starkInventoryTransitionsLoaded) return;
  window.__starkInventoryTransitionsLoaded = true;

  const STYLE_ID = "stark-inventory-transition-styles";
  const PROGRESS_ID = "stark-inventory-transition-progress";
  const LINK_SELECTOR = ".inventory-nav a, .workspace-back";
  const CONTENT_SELECTOR = ".inventory-main > :not(.inventory-nav)";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const prefetchedDestinations = new Set();
  let navigationInProgress = false;

  const transitionStyles = `
    @view-transition {
      navigation: auto;
    }

    .inventory-nav {
      position: relative;
      contain: layout paint;
      transform: translateZ(0);
      backface-visibility: hidden;
    }

    .inventory-nav a {
      position: relative;
      isolation: isolate;
      overflow: hidden;
      -webkit-tap-highlight-color: transparent;
      will-change: transform;
      transition:
        color 260ms ease,
        background-color 260ms ease,
        border-color 260ms ease,
        box-shadow 340ms ease,
        transform 280ms cubic-bezier(.22,1,.36,1) !important;
    }

    .inventory-nav a::after {
      content: "";
      position: absolute;
      z-index: -1;
      inset: 0;
      border-radius: inherit;
      background: linear-gradient(
        110deg,
        transparent 18%,
        rgba(255,255,255,.05) 34%,
        rgba(255,255,255,.24) 50%,
        rgba(255,255,255,.05) 66%,
        transparent 82%
      );
      opacity: 0;
      transform: translateX(-105%);
      pointer-events: none;
      transition:
        opacity 200ms ease,
        transform 580ms cubic-bezier(.22,1,.36,1);
    }

    .inventory-nav a:hover {
      transform: translateY(-1px);
    }

    .inventory-nav a:hover::after,
    .inventory-nav a:focus-visible::after {
      opacity: .76;
      transform: translateX(105%);
    }

    .inventory-nav a:active,
    .inventory-nav a.tab-pressed {
      transform: scale(.982);
    }

    .inventory-nav a.active,
    .inventory-nav a[aria-current="page"] {
      view-transition-name: inventory-active-tab;
      transform: translateZ(0);
      backface-visibility: hidden;
    }

    ${CONTENT_SELECTOR} {
      transition:
        opacity 210ms ease,
        filter 210ms ease,
        transform 250ms cubic-bezier(.4,0,.2,1);
    }

    body.inventory-fallback-leaving {
      pointer-events: none;
      cursor: progress;
    }

    body.inventory-fallback-leaving ${CONTENT_SELECTOR} {
      opacity: 0;
      filter: blur(2px);
      transform: translateY(8px) scale(.997);
    }

    body.inventory-fallback-leaving .inventory-nav a.tab-pressed {
      color: #fff;
      border-color: transparent;
      background: linear-gradient(135deg,var(--premium-navy,#0b2748),var(--premium-blue,#174f7b));
      box-shadow: 0 10px 26px rgba(13,55,94,.22),inset 0 1px rgba(255,255,255,.18);
      transform: none;
    }

    #${PROGRESS_ID} {
      position: fixed;
      z-index: 2147483647;
      top: 0;
      left: 0;
      width: 100%;
      height: 3px;
      opacity: 0;
      transform: scaleX(0);
      transform-origin: left center;
      border-radius: 0 999px 999px 0;
      background: linear-gradient(90deg,var(--region-accent,#0b8f88),#58e4d7,#5aa6ff);
      box-shadow: 0 0 16px rgba(45,201,190,.55);
      pointer-events: none;
      transition: opacity 140ms ease,transform 680ms cubic-bezier(.12,.72,.18,1);
    }

    #${PROGRESS_ID}.is-running {
      opacity: 1;
      transform: scaleX(.78);
    }

    #${PROGRESS_ID}.is-complete {
      opacity: 0;
      transform: scaleX(1);
      transition: opacity 180ms 90ms ease,transform 160ms ease;
    }

    ::view-transition-group(inventory-active-tab) {
      z-index: 100;
      animation-duration: 560ms;
      animation-timing-function: cubic-bezier(.22,1,.36,1);
    }

    ::view-transition-old(inventory-active-tab) {
      animation: stark-tab-out 190ms ease both;
      mix-blend-mode: normal;
    }

    ::view-transition-new(inventory-active-tab) {
      animation: stark-tab-in 420ms 40ms cubic-bezier(.22,1,.36,1) both;
      mix-blend-mode: normal;
    }

    ::view-transition-old(root) {
      animation: stark-page-out 210ms cubic-bezier(.4,0,1,1) both;
      mix-blend-mode: normal;
    }

    ::view-transition-new(root) {
      animation: stark-page-in 460ms cubic-bezier(.22,1,.36,1) both;
      mix-blend-mode: normal;
    }

    @keyframes stark-tab-out {
      to { opacity: .1; filter: blur(2px); }
    }

    @keyframes stark-tab-in {
      from { opacity: .1; filter: blur(2px); transform: scale(.985); }
      to { opacity: 1; filter: none; transform: none; }
    }

    @keyframes stark-page-out {
      to { opacity: 0; filter: blur(2px); transform: translateY(-6px) scale(.998); }
    }

    @keyframes stark-page-in {
      from { opacity: 0; filter: blur(2px); transform: translateY(11px) scale(.998); }
      to { opacity: 1; filter: none; transform: none; }
    }

    @media (prefers-reduced-motion: reduce) {
      .inventory-nav a,
      .inventory-nav a::after,
      ${CONTENT_SELECTOR},
      body.inventory-fallback-leaving,
      #${PROGRESS_ID} {
        animation: none !important;
        transition: none !important;
        filter: none !important;
        transform: none !important;
      }

      ::view-transition-group(inventory-active-tab),
      ::view-transition-old(inventory-active-tab),
      ::view-transition-new(inventory-active-tab),
      ::view-transition-old(root),
      ::view-transition-new(root) {
        animation: none !important;
      }
    }
  `;

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = transitionStyles;
    document.head.appendChild(style);
  }

  function installProgressBar() {
    if (!document.body || document.getElementById(PROGRESS_ID)) return;
    const progress = document.createElement("div");
    progress.id = PROGRESS_ID;
    progress.setAttribute("aria-hidden", "true");
    document.body.appendChild(progress);
  }

  function currentPageKey() {
    const bodyPage = document.body && document.body.dataset.page;
    if (bodyPage) return bodyPage;
    const filename = window.location.pathname.split("/").pop() || "";
    if (filename.includes("dashboard")) return "dashboard";
    if (filename.includes("raw-report")) return "raw";
    if (filename.includes("reorder-report")) return "reorder";
    if (filename.includes("active-brands")) return "brands";
    if (filename.includes("instructions")) return "instructions";
    if (filename.includes("ats")) return "ats";
    return "";
  }

  function normalizeActiveTab() {
    const page = currentPageKey();
    if (!page) return;
    document.querySelectorAll(".inventory-nav [data-inventory-page]").forEach(function (link) {
      const active = link.dataset.inventoryPage === page;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  function supportsCrossDocumentTransitions() {
    return !reducedMotion.matches &&
      typeof document.startViewTransition === "function" &&
      Boolean(window.CSS) &&
      CSS.supports("view-transition-name: inventory-active-tab");
  }

  function isPrimaryUnmodifiedClick(event, link) {
    return !event.defaultPrevented && event.button === 0 &&
      !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey &&
      link.target !== "_blank" && !link.hasAttribute("download");
  }

  function internalDestination(link) {
    const destination = new URL(link.href, window.location.href);
    return destination.origin === window.location.origin ? destination : null;
  }

  function beginProgress() {
    const progress = document.getElementById(PROGRESS_ID);
    if (!progress || reducedMotion.matches) return;
    progress.classList.remove("is-complete");
    void progress.offsetWidth;
    progress.classList.add("is-running");
  }

  function completeProgress() {
    const progress = document.getElementById(PROGRESS_ID);
    if (!progress) return;
    progress.classList.remove("is-running");
    progress.classList.add("is-complete");
    window.setTimeout(function () { progress.classList.remove("is-complete"); }, 320);
  }

  function setFallbackActiveTab(link) {
    document.querySelectorAll(".inventory-nav a.active, .inventory-nav a[aria-current='page']").forEach(function (activeLink) {
      activeLink.classList.remove("active");
      activeLink.removeAttribute("aria-current");
    });
    link.classList.add("active");
    link.setAttribute("aria-current", "page");
  }

  function navigate(destination) {
    window.location.assign(destination.href);
  }

  function handleNavigation(event) {
    const target = event.target instanceof Element ? event.target : event.target.parentElement;
    const link = target && target.closest(LINK_SELECTOR);
    if (!link || !isPrimaryUnmodifiedClick(event, link)) return;
    const destination = internalDestination(link);
    if (!destination) return;

    if (destination.href === window.location.href) {
      event.preventDefault();
      link.classList.remove("tab-pressed");
      void link.offsetWidth;
      link.classList.add("tab-pressed");
      window.setTimeout(function () { link.classList.remove("tab-pressed"); }, 220);
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    if (navigationInProgress) return;
    navigationInProgress = true;
    link.classList.add("tab-pressed");
    beginProgress();

    if (reducedMotion.matches) {
      navigate(destination);
      return;
    }

    if (supportsCrossDocumentTransitions()) {
      window.requestAnimationFrame(function () { navigate(destination); });
      return;
    }

    setFallbackActiveTab(link);
    document.body.classList.add("inventory-fallback-leaving");
    window.setTimeout(function () { navigate(destination); }, 230);
  }

  function prefetchLink(link) {
    if (!link || prefetchedDestinations.has(link.href)) return;
    if (navigator.connection && navigator.connection.saveData) return;
    const destination = internalDestination(link);
    if (!destination || destination.href === window.location.href) return;
    prefetchedDestinations.add(destination.href);
    const hint = document.createElement("link");
    hint.rel = "prefetch";
    hint.href = destination.href;
    document.head.appendChild(hint);
  }

  function handlePrefetchIntent(event) {
    const target = event.target instanceof Element ? event.target : event.target.parentElement;
    const link = target && target.closest(LINK_SELECTOR);
    if (link) prefetchLink(link);
  }

  function resetPageState() {
    navigationInProgress = false;
    if (document.body) {
      document.body.classList.remove("inventory-fallback-leaving", "page-leaving");
      document.body.style.removeProperty("opacity");
      document.body.style.removeProperty("transform");
      document.body.style.removeProperty("filter");
      document.body.style.removeProperty("pointer-events");
      if (typeof document.body.getAnimations === "function") {
        document.body.getAnimations().forEach(function (animation) {
          animation.cancel();
        });
      }
    }
    document.querySelectorAll(".tab-pressed").forEach(function (link) { link.classList.remove("tab-pressed"); });
    completeProgress();
    normalizeActiveTab();
  }

  function handlePageHide() {
    resetPageState();
  }

  function handleVisibilityRestore() {
    if (document.visibilityState === "visible") resetPageState();
  }

  function initialize() {
    installStyles();
    installProgressBar();
    normalizeActiveTab();
    document.addEventListener("click", handleNavigation, true);
    document.addEventListener("pointerover", handlePrefetchIntent, { passive: true, capture: true });
    document.addEventListener("focusin", handlePrefetchIntent, true);
    window.addEventListener("pageshow", resetPageState);
    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityRestore);
  }

  installStyles();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
