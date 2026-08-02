const { runComparison, printTable, STRATEGIES, TICKERS } = require("./compare-strategies");

async function main() {
  const startDate = "2022-01-01";
  const endDate = "2022-12-31";

  console.log(`Comparison period: ${startDate} to ${endDate} (2022 bear market)`);
  console.log(`Strategies: ${STRATEGIES.map((s) => s.label).join(", ")}`);
  console.log(`Tickers: ${TICKERS.join(", ")}\n`);

  const results = await runComparison(startDate, endDate);

  printTable(results);

  const beatCount = results.filter((r) => r.totalReturnPercent > r.buyAndHoldReturnPercent).length;
  console.log(`\n${beatCount} of ${results.length} tests beat buy & hold.`);
}

main().catch((err) => {
  console.error("Comparison failed:", err);
  process.exit(1);
});
