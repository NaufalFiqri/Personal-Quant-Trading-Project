// Full continuous backtest of insiderClusterStrategy across all 8 tickers
// that produced a real cluster event, using the 14 already-verified real
// cluster triggers as entries. Not a walk-forward (per the explicit
// instruction: 14 trades total, some tickers with only 1, doesn't support
// windowing the way the higher-frequency technical strategies did) - one
// continuous backtest per ticker over its full available history.
//
// Reuses the already-fetched, already-committed real transaction data
// (form4-frequency-results-midcap.json for RLI, form4-frequency-results-
// midcap-wide.json for the other 7) rather than re-hitting EDGAR for ~1,500
// filings again - same real data already verified in this session.

const fs = require("fs");
const path = require("path");
const { getHistoricalData } = require("./data");
const { insiderClusterStrategy } = require("./strategy");
const { runBacktest } = require("./backtest");

const TICKERS = ["RLI", "WDFC", "CW", "NVST", "ICUI", "CFR", "REXR", "BMI"];
const START_DATE = "2022-01-01";
const END_DATE = new Date().toISOString().slice(0, 10);
const RISK_CONFIG = { stopLossMethod: "atr" };

const midcapResults = JSON.parse(fs.readFileSync(path.join(__dirname, "form4-frequency-results-midcap.json"), "utf8"));
const midcapWideResults = JSON.parse(fs.readFileSync(path.join(__dirname, "form4-frequency-results-midcap-wide.json"), "utf8"));

function getPTransactions(ticker) {
  if (midcapResults[ticker]) return midcapResults[ticker].pTransactions;
  return midcapWideResults[ticker].pTransactions;
}

function pairTrades(trades) {
  const pairs = [];
  let openBuy = null;
  for (const t of trades) {
    if (t.action === "BUY") {
      openBuy = t;
    } else if (t.action === "SELL" && openBuy) {
      pairs.push({ buy: openBuy, sell: t });
      openBuy = null;
    }
  }
  if (openBuy) pairs.push({ buy: openBuy, sell: null });
  return pairs;
}

async function main() {
  console.log(`Full continuous backtest, insiderClusterStrategy, ${START_DATE} to ${END_DATE}`);
  console.log(`Tickers: ${TICKERS.join(", ")}`);
  console.log(`riskConfig: ${JSON.stringify(RISK_CONFIG)}\n`);

  const perTickerResults = [];
  let pooledRoundTrips = 0;
  let pooledWinningRoundTrips = 0;

  for (const ticker of TICKERS) {
    const bars = await getHistoricalData(ticker, START_DATE, END_DATE);
    const pTransactions = getPTransactions(ticker);
    const signals = insiderClusterStrategy(bars, { pTransactions, clusterWindowDays: 30, exitTradingDays: 252 });
    const result = runBacktest(bars, signals, { riskConfig: RISK_CONFIG });

    const pairs = pairTrades(result.trades);
    let roundTrips = 0;
    let winningRoundTrips = 0;
    for (const p of pairs) {
      if (p.sell) {
        roundTrips++;
        if (p.sell.cashAfter > p.buy.cashBefore) winningRoundTrips++;
      }
    }
    pooledRoundTrips += roundTrips;
    pooledWinningRoundTrips += winningRoundTrips;

    console.log(`${"=".repeat(70)}\n${ticker}\n${"=".repeat(70)}`);
    console.log(`Return: ${result.totalReturnPercent.toFixed(2)}%  Buy&Hold: ${result.buyAndHoldReturnPercent.toFixed(2)}%  MaxDD: ${result.maxDrawdownPercent.toFixed(2)}%  WinRate: ${result.winRate.toFixed(2)}%`);
    console.log(`Trades (round trips: ${roundTrips}, winning: ${winningRoundTrips}):`);
    for (const p of pairs) {
      if (p.sell) {
        const pnlPercent = ((p.sell.price - p.buy.price) / p.buy.price) * 100;
        console.log(
          `  BUY ${p.buy.date} @ $${p.buy.price.toFixed(2)}  ->  SELL ${p.sell.date} @ $${p.sell.price.toFixed(2)} (${p.sell.reason})  P&L: ${pnlPercent.toFixed(2)}%  ${p.sell.cashAfter > p.buy.cashBefore ? "WIN" : "LOSS"}`
        );
      } else {
        console.log(`  BUY ${p.buy.date} @ $${p.buy.price.toFixed(2)}  ->  STILL OPEN as of ${END_DATE}`);
      }
    }
    console.log("");

    perTickerResults.push({ ticker, ...result, roundTrips, winningRoundTrips });
  }

  console.log(`${"=".repeat(70)}\nPOOLED SUMMARY ACROSS ALL 8 TICKERS\n${"=".repeat(70)}`);
  console.log("Ticker".padEnd(8) + "Return%".padStart(10) + "MaxDD%".padStart(10) + "WinRate%".padStart(10) + "RoundTrips".padStart(12));
  for (const r of perTickerResults) {
    console.log(
      r.ticker.padEnd(8) +
        r.totalReturnPercent.toFixed(2).padStart(10) +
        r.maxDrawdownPercent.toFixed(2).padStart(10) +
        r.winRate.toFixed(2).padStart(10) +
        String(r.roundTrips).padStart(12)
    );
  }
  const avgReturn = perTickerResults.reduce((s, r) => s + r.totalReturnPercent, 0) / perTickerResults.length;
  const pooledWinRate = pooledRoundTrips > 0 ? (pooledWinningRoundTrips / pooledRoundTrips) * 100 : 0;
  console.log(`\nAverage return% across 8 tickers (equal-weighted): ${avgReturn.toFixed(2)}%`);
  console.log(`Pooled round trips across all 8 tickers: ${pooledRoundTrips}, winning: ${pooledWinningRoundTrips}`);
  console.log(`Pooled win rate (winning round trips / total round trips): ${pooledWinRate.toFixed(2)}%`);
}

main().catch((err) => {
  console.error("full-backtest-insider-cluster failed:", err);
  process.exit(1);
});
