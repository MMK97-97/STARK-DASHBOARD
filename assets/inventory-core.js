function leadTimeFactor(value) {
  const text = cleanText(value);

  if (!text) {
    return 0;
  }

  const match = text.match(/\d+(?:\.\d+)?/);

  if (!match) {
    return 0;
  }

  return Math.max(0, Number(match[0]) || 0);
}

function analyze(rows, region) {
  const settings = loadSettings(region);
  const brands = ensureBrandSettings(region, rows);
  const today = new Date();

  today.setHours(0, 0, 0, 0);

  const items = rows.map(row => {
    const statusUpper = String(row.status)
      .trim()
      .toUpperCase();

    const excluded = [
      "FEEDS ONLY",
      "INTERNAL USE",
      "PRESENTATION"
    ].some(value => statusUpper.includes(value));

    const eligible = [
      "LIVE",
      "FASHION",
      "BACKORDER"
    ].includes(statusUpper);

    const brandSetting = brands[row.brand] || {
      active: true,
      leadTime: ""
    };

    const activeBrand = brandSetting.active !== false;

    const supplierEnd = reviveDate(row.supplierEnd);

    const daysUntil = supplierEnd
      ? Math.ceil((supplierEnd - today) / 86400000)
      : null;

    const reasons = [];

    if (activeBrand && eligible && !excluded) {
      if (
        row.available + row.openSupplier <=
        settings.critical
      ) {
        reasons.push(
          `Available + supplier qty <= ${settings.critical}`
        );
      }

      if (row.openClient > row.available) {
        reasons.push(
          "Open client orders exceed available stock"
        );
      }

      if (
        Number.isFinite(daysUntil) &&
        daysUntil > settings.delay
      ) {
        reasons.push(
          `Supplier delivery exceeds ${settings.delay} days`
        );
      }

      if (
        row.avg3 >
        row.available + row.openSupplier
      ) {
        reasons.push(
          "Average monthly sales exceed available + supplier qty"
        );
      }
    }

    const reorderRequired = reasons.length > 0;
    const leadTime = leadTimeFactor(
      brandSetting.leadTime
    );

    /*
     * Recommended Reorder Quantity:
     *
     * (Stock On Hand - Open Orders From Client)
     * × Lead Time
     * + Average Per Month
     */
    const calculatedRecommendation =
      (row.stockQty - row.openClient) *
      leadTime +
      row.avg3;

    /*
     * Reorder quantities cannot be negative.
     * Decimal quantities are rounded up.
     */
    const recommended = reorderRequired
      ? Math.max(
          0,
          Math.ceil(calculatedRecommendation)
        )
      : 0;

    return {
      ...row,
      activeBrand,
      eligible,
      excluded,
      daysUntil,
      leadTime,
      reorderRequired,
      reorderReason: reasons.join(" | "),
      recommended,
      monthsCover:
        row.avg3 > 0
          ? row.available / row.avg3
          : null,
      abc: "C",
      rank: 0,
      contribution: 0,
      cumulative: 0
    };
  });

  const ranked = items
    .slice()
    .sort((a, b) => b.vol3 - a.vol3);

  const total = ranked.reduce(
    (sum, item) =>
      sum + Math.max(0, item.vol3),
    0
  );

  let cumulative = 0;

  ranked.forEach((item, index) => {
    const prior = cumulative;

    const contribution = total
      ? Math.max(0, item.vol3) / total
      : 0;

    cumulative += contribution;

    item.rank = index + 1;
    item.contribution = contribution;
    item.cumulative = cumulative;

    item.abc =
      prior < settings.a / 100
        ? "A"
        : prior < settings.b / 100
          ? "B"
          : "C";
  });

  return items;
}
