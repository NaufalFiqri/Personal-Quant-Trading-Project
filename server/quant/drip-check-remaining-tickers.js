// DRIP-pattern check for the remaining 7 clustered tickers, same explicit
// fractional-share flag used in sanity-check-insider-rli.js. Reuses the
// already-fetched, already-committed real transaction data from
// form4-frequency-results-midcap-wide.json (the same live EDGAR fetch
// verified earlier) rather than re-hitting EDGAR for ~1,260 filings again -
// this is real data already on disk, not synthetic, and detectInsiderClusters
// is the same production function insiderClusterStrategy uses internally.

const fs = require("fs");
const path = require("path");
const { detectInsiderClusters } = require("./strategy");

const TICKERS = ["WDFC", "CW", "NVST", "ICUI", "CFR", "REXR", "BMI"];
const RESULTS_FILE = path.join(__dirname, "form4-frequency-results-midcap-wide.json");

function isFractionalShareCount(sharesStr) {
  return typeof sharesStr === "string" && sharesStr.includes(".");
}

function main() {
  const allResults = JSON.parse(fs.readFileSync(RESULTS_FILE, "utf8"));

  let totalContributingTx = 0;
  let totalFractional = 0;
  let clustersWithAnyFractional = 0;
  let totalClusters = 0;

  for (const ticker of TICKERS) {
    const pTransactions = allResults[ticker].pTransactions;
    const triggers = detectInsiderClusters(pTransactions, { clusterWindowDays: 30 });

    console.log(`\n${"=".repeat(70)}\n${ticker} - ${triggers.length} cluster trigger(s)\n${"=".repeat(70)}`);

    for (const t of triggers) {
      totalClusters++;
      console.log(`\nTrigger date: ${t.date}`);
      console.log(`  Distinct insiders: ${t.insiders.join(", ")}`);
      console.log(`  Contributing transactions:`);
      let clusterHasFractional = false;
      for (const tx of t.transactions) {
        totalContributingTx++;
        const fractional = isFractionalShareCount(tx.shares);
        if (fractional) {
          totalFractional++;
          clusterHasFractional = true;
        }
        console.log(
          `    ${tx.insider.padEnd(22)} ${tx.date}  shares=${String(tx.shares).padStart(10)}  price=${tx.price}` +
            (fractional ? "  <-- FRACTIONAL SHARE COUNT (possible DRIP, not filtered)" : "")
        );
      }
      if (clusterHasFractional) clustersWithAnyFractional++;
    }
  }

  console.log(`\n${"=".repeat(70)}\nSUMMARY ACROSS ALL 7 TICKERS\n${"=".repeat(70)}`);
  console.log(`Total clusters checked: ${totalClusters}`);
  console.log(`Total contributing transactions inspected: ${totalContributingTx}`);
  console.log(`Fractional-share (possible DRIP) transactions found: ${totalFractional}`);
  console.log(`Clusters with at least one fractional-share contributing transaction: ${clustersWithAnyFractional} of ${totalClusters}`);
}

main();
