(function () {
  "use strict";

  const STYLE_ID = "stark-inventory-transition-styles";
  const LINK_SELECTOR = ".inventory-nav a, .workspace-back";
  const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");

  const transitionStyles = `
    @view-transition {
      navigation: auto;
    }

    .inventory-nav {
      contain: layout paint;
    }

    .inventory-nav a {
      position: relative;
      isolation: isolate;
      overflow: hidden;
      will-change: transform;
      transition:
        color 220ms ease,
        background-color 220ms ease,
        box-shadow 280ms ease,
        transform 220ms cubic-bezier(.2,.8,.2,1) !important;
    }

    .inventory-nav a::after {
      content: "";
      position: absolute;
      z-index: -1;
      inset: 0;
      border-radius: inherit;
      background: linear-gradient(
        110deg,
        transparent 22%,
        rgba(255,255,255,.18) 48%,
        transparent 74%
      );
      opacity: 0;
      transform: translateX(-72%);
      pointer-events: none;
      transition:
        opacity 220ms ease,
        transform 480ms cubic-bezier(.2,.8,.2,1);
    }

    .inventory-nav a:hover::after {
      opacity: .72;
      transform: translateX(72%);
    }

    .inventory-nav a:active,
    .inventory-nav a.tab-pressed {
      transform: scale(.985);
    }

    .inventory-nav a.active,
    .inventory-nav a[aria-current="page"] {
      view-transition-name: inventory-active-tab;
      transform: translateZ(0);
    }

    ::view-transition-group(inventory-active-tab) {
      z-index: 100;
      animation-duration: 420ms;
      animation-timing-function: cubic-bezier(.22,.9,.25,1);
    }

    ::view-transition-old(inventory-active-tab) {
      animation: stark-tab-out 160ms ease both;
      mix-blend-mode: normal;
    }

    ::view-transition-new(inventory-active-tab) {
      animation: stark-tab-in 300ms 50ms cubic-bezier(.2,.8,.2,1) both;
      mix-blend-mode: normal;
    }

    ::view-transition-old(root) {
      animation: stark-page-out 170ms ease both;
    }

    ::view-transition-new(root) {
      animation: stark-page-in 340ms cubic-bezier(.2,.75,.2,1) both;
    }

    body.inventory-fallback-leaving {
      pointer-events: none;
      animation: stark-page-out 120ms ease both !important;
    }

    @keyframes stark-tab-out {
      to {
        opacity: .22;
        filter: blur(1px);
      }
    }

    @keyframes stark-tab-in {
      from {
        opacity: .22;
        filter: blur(1px);
      }

      to {
        opacity: 1;
        filter: none;
      }
    }

    @keyframes stark-page-out {
      to {
        opacity: 0;
        transform: translateY(-4px);
      }
    }

    @keyframes stark-page-in {
      from {
        opacity: 0;
        transform: translateY(7px);
      }

      to {
        opacity: 1;
        transform: none;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .inventory-nav a,
      .inventory-nav a::after,
      body.inventory-fallback-leaving {
        animation: none !important;
        transition: none !important;
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

  function normalizeActiveTab() {
    const page = document.body?.dataset.page;
    if (!page) return;
    document.querySelectorAll(".inventory-nav [data-inventory-page]").forEach(link => {
      const active = link.dataset.inventoryPage === page;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  function supportsCrossDocumentTransitions() {
    return !REDUCED_MOTION.matches &&
      typeof document.startViewTransition === "function" &&
      Boolean(window.CSS) &&
      CSS.supports("view-transition-name: inventory-active-tab");
  }

  function handleNavigation(event) {
    const link = event.target.closest(LINK_SELECTOR);
    if (!link) return;
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target === "_blank" || link.hasAttribute("download")) return;
    const destination = new URL(link.href, window.location.href);
    if (destination.origin !== window.location.origin) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    link.classList.add("tab-pressed");

    if (REDUCED_MOTION.matches || supportsCrossDocumentTransitions()) {
      window.location.href = destination.href;
      return;
    }

    document.body.classList.add("inventory-fallback-leaving");
    window.setTimeout(() => {
      window.location.href = destination.href;
    }, 120);
  }

  installStyles();
  document.addEventListener("click", handleNavigation, true);
  document.addEventListener("DOMContentLoaded", normalizeActiveTab, { once: true });
  window.addEventListener("pageshow", () => {
    document.body?.classList.remove("inventory-fallback-leaving");
    document.querySelectorAll(".tab-pressed").forEach(link => link.classList.remove("tab-pressed"));
    normalizeActiveTab();
  });
})();
