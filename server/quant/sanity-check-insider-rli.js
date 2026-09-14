// Single-ticker sanity check, RLI - per PHASE2_INSIDER_SIGNAL_SCOPING.md §6
// step 3. Real fetched price + insider data, not synthetic. Not a backtest -
// just showing what insiderClusterStrategy actually does on real RLI data,
// plus explicit DRIP-pattern flagging on every contributing transaction
// (fractional share counts, per the pattern already spotted in TTC/AVA
// during the 22-ticker frequency check).

const { getHistoricalData } = require("./data");
const { getInsiderPurchases } = require("./insider-data");
const { detectInsiderClusters, insiderClusterStrategy } = require("./strategy");

const TICKER = "RLI";
const START_DATE = "2022-01-01";
const END_DATE = "2026-08-20"; // matches the already-validated frequency-check range
const BARS_END_DATE = "2026-09-14"; // today - extra runway past END_DATE so exits (up to 252 trading days) are visible where data allows

function isFractionalShareCount(sharesStr) {
  return typeof sharesStr === "string" && sharesStr.includes(".");
}

async function main() {
  console.log(`=== RLI insider-cluster sanity check ===`);
  console.log(`Price data: ${START_DATE} to ${BARS_END_DATE}`);
  console.log(`Insider data: ${START_DATE} to ${END_DATE}\n`);

  const bars = await getHistoricalData(TICKER, START_DATE, BARS_END_DATE);
  console.log(`Fetched ${bars.length} price bars.\n`);

  const pTransactions = await getInsiderPurchases(TICKER, START_DATE, END_DATE);
  console.log(`Fetched ${pTransactions.length} code-P transactions.\n`);

  const triggers = detectInsiderClusters(pTransactions, { clusterWindowDays: 30 });
  console.log(`=== Cluster triggers detected: ${triggers.length} ===`);
  for (const t of triggers) {
    console.log(`\nTrigger date: ${t.date}`);
    console.log(`  Distinct insiders: ${t.insiders.join(", ")}`);
    console.log(`  Contributing transactions (within the trailing 30-day window):`);
    for (const tx of t.transactions) {
      const fractional = isFractionalShareCount(tx.shares);
      console.log(
        `    ${tx.insider.padEnd(22)} ${tx.date}  shares=${String(tx.shares).padStart(8)}  price=${tx.price}` +
          (fractional ? "  <-- FRACTIONAL SHARE COUNT (possible DRIP, not flagged as discretionary)" : "")
      );
    }
  }

  console.log(`\n=== insiderClusterStrategy signals on real RLI bars (exitTradingDays=252) ===`);
  const signals = insiderClusterStrategy(bars, { pTransactions, clusterWindowDays: 30, exitTradingDays: 252 });
  if (signals.length === 0) {
    console.log("No signals generated.");
  }
  for (const s of signals) {
    console.log(`  ${s.action.padEnd(4)} ${s.date}  price=${s.price.toFixed(2)}`);
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total signals: ${signals.length} (${signals.filter((s) => s.action === "BUY").length} BUY, ${signals.filter((s) => s.action === "SELL").length} SELL)`);
  const openPosition = signals.length % 2 === 1;
  console.log(`Position still open at end of available bars: ${openPosition}`);
}

main().catch((err) => {
  console.error("sanity-check-insider-rli failed:", err);
  process.exit(1);
});
