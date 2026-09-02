(function () {
  "use strict";

  const SI = window.StarkInventory;

  const page =
    document.body.dataset.page ||
    "inventory";

  const region =
    SI.initFrame(page);

  let dataset = null;
  let items = [];

  const number =
    new Intl.NumberFormat(
      "en-US",
      {
        maximumFractionDigits: 0
      }
    );

  const decimal =
    new Intl.NumberFormat(
      "en-US",
      {
        maximumFractionDigits: 1
      }
    );

  const percent =
    new Intl.NumberFormat(
      "en-US",
      {
        style: "percent",
        maximumFractionDigits: 1
      }
    );

  const el = id =>
    document.getElementById(id);

  configureInventoryNavigation();

  if (
    document.readyState === "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init
    );
  } else {
    init();
  }

  /*
   * Remove Inventory Analysis from the top navigation
   * and replace it with a Back button.
   */
  function configureInventoryNavigation() {
    const backButton =
      document.querySelector(
        ".inventory-overview-link"
      );

    if (!backButton) return;

    backButton.textContent =
      "← Back";

    backButton.href =
      `index.html?region=${encodeURIComponent(region)}`;

    backButton.setAttribute(
      "aria-label",
      "Back to regional modules"
    );

    backButton.classList.remove(
      "inventory-overview-link"
    );

    backButton.classList.add(
      "inventory-back-button"
    );

    backButton.style.display =
      "inline-flex";

    backButton.style.alignItems =
      "center";

    backButton.style.justifyContent =
      "center";

    backButton.style.minHeight =
      "40px";

    backButton.style.marginRight =
      "auto";

    backButton.style.padding =
      "8px 15px";

    backButton.style.border =
      "1px solid #c8d4df";

    backButton.style.borderRadius =
      "8px";

    backButton.style.color =
      "#10233f";

    backButton.style.background =
      "#ffffff";

    backButton.style.boxShadow =
      "0 4px 12px rgba(16, 35, 63, 0.07)";

    backButton.style.fontWeight =
      "700";

    backButton.style.textDecoration =
      "none";
  }

  async function init() {
    dataset =
      await SI.loadDataset(region);

    items = dataset
      ? SI.analyze(
          dataset.rows,
          region
        )
      : [];

    renderDataNote();

    if (page === "dashboard") {
      initDashboard();
    }

    if (page === "raw") {
      initRaw();
    }

    if (page === "reorder") {
      initReorder();
    }

    if (page === "brands") {
      initBrands();
    }
  }

  function renderDataNote() {
    document
      .querySelectorAll(
        "[data-file-status]"
      )
      .forEach(node => {
        node.textContent = dataset
          ? `${dataset.fileName} • ${number.format(dataset.rows.length)} items`
          : "No Item Sales Report uploaded";

        node.classList.toggle(
          "ready",
          Boolean(dataset)
        );
      });

    document
      .querySelectorAll(
        "[data-requires-data]"
      )
      .
