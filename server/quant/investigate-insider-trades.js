// Direct investigation of two things in the real insider-cluster backtest
// output, per explicit request: (1) the CW +29.57% trade's real details and
// price path, (2) whether the ~-2.0x% results on NVST/ICUI/CFR/REXR/BMI are
// mechanically similar ATR-stop distances. Reuses the exact same real bars/
// pTransactions/backtest call as full-backtest-insider-cluster.js - no new
// data, just closer inspection of what that run already produced.

const fs = require("fs");
const path = require("path");
const { getHistoricalData } = require("./data");
const { insiderClusterStrategy, detectInsiderClusters } = require("./strategy");
const { runBacktest } = require("./backtest");
const { calculateATR } = require("./indicators");

const START_DATE = "2022-01-01";
const END_DATE = new Date().toISOString().slice(0, 10);
const RISK_CONFIG = { stopLossMethod: "atr" };
const ATR_PERIOD = 14; // DEFAULT_RISK_CONFIG in backtest.js
const ATR_MULTIPLIER = 2; // DEFAULT_RISK_CONFIG in backtest.js

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
    if (t.action === "BUY") openBuy = t;
    else if (t.action === "SELL" && openBuy) {
      pairs.push({ buy: openBuy, sell: t });
      openBuy = null;
    }
  }
  if (openBuy) pairs.push({ buy: openBuy, sell: null });
  return pairs;
}

async function runTicker(ticker) {
  const bars = await getHistoricalData(ticker, START_DATE, END_DATE);
  const pTransactions = getPTransactions(ticker);
  const signals = insiderClusterStrategy(bars, { pTransactions, clusterWindowDays: 30, exitTradingDays: 252 });
  const result = runBacktest(bars, signals, { riskConfig: RISK_CONFIG });
  const atrValues = calculateATR(bars, ATR_PERIOD);
  return { bars, pTransactions, result, atrValues };
}

async function main() {
  // === PART 1: CW's +29.57% trade ===
  console.log("=".repeat(70));
  console.log("PART 1: CW trade - real details and price path");
  console.log("=".repeat(70));

  const cw = await runTicker("CW");
  const cwPairs = pairTrades(cw.result.trades);
  const cwTrade = cwPairs[0];
  console.log(`\nEntry: ${cwTrade.buy.date} @ $${cwTrade.buy.price.toFixed(2)}`);
  console.log(`Exit:  ${cwTrade.sell.date} @ $${cwTrade.sell.price.toFixed(2)}  reason=${cwTrade.sell.reason}`);
  console.log(`P&L: ${(((cwTrade.sell.price - cwTrade.buy.price) / cwTrade.buy.price) * 100).toFixed(2)}%`);

  const cwTriggers = detectInsiderClusters(cw.pTransactions, { clusterWindowDays: 30 });
  const cwTrigger = cwTriggers.find((t) => t.date === "2023-07-10");
  console.log(`\nCluster that triggered this entry (date ${cwTrigger.date}):`);
  console.log(`  Distinct insiders: ${cwTrigger.insiders.join(", ")}`);
  console.log(`  Contributing transactions:`);
  for (const tx of cwTrigger.transactions) {
    console.log(`    ${tx.insider.padEnd(22)} ${tx.date}  shares=${String(tx.shares).padStart(6)}  price=${tx.price}`);
  }

  console.log(`\nCW price path over the holding period (${cwTrade.buy.date} to ${cwTrade.sell.date}), monthly snapshots:`);
  const entryIdx = cw.bars.findIndex((b) => b.date === cwTrade.buy.date);
  const exitIdx = cw.bars.findIndex((b) => b.date === cwTrade.sell.date);
  const holdBars = cw.bars.slice(entryIdx, exitIdx + 1);
  let lastMonth = null;
  for (const b of holdBars) {
    const month = b.date.slice(0, 7);
    if (month !== lastMonth) {
      console.log(`  ${b.date}  close=$${b.close.toFixed(2)}`);
      lastMonth = month;
    }
  }
  console.log(`  ${holdBars[holdBars.length - 1].date}  close=$${holdBars[holdBars.length - 1].close.toFixed(2)}  <- exit bar`);
  const closes = holdBars.map((b) => b.close);
  const minClose = Math.min(...closes);
  const maxClose = Math.max(...closes);
  const minDate = holdBars.find((b) => b.close === minClose).date;
  const maxDate = holdBars.find((b) => b.close === maxClose).date;
  console.log(`\n  Min close over hold: $${minClose.toFixed(2)} on ${minDate}`);
  console.log(`  Max close over hold: $${maxClose.toFixed(2)} on ${maxDate}`);
  console.log(`  Close on final day before exit bar: $${holdBars[holdBars.length - 2] ? holdBars[holdBars.length - 2].close.toFixed(2) : "n/a"}`);

  // === PART 2: the ~-2.0x% trades ===
  console.log(`\n${"=".repeat(70)}`);
  console.log("PART 2: NVST/ICUI/CFR/REXR/BMI - exit reasons and ATR-stop distances");
  console.log("=".repeat(70));

  const tickers = ["NVST", "ICUI", "CFR", "REXR", "BMI"];
  for (const ticker of tickers) {
    const { bars, result, atrValues } = await runTicker(ticker);
    const pairs = pairTrades(result.trades);
    console.log(`\n--- ${ticker} ---`);
    for (const p of pairs) {
      const entryIdx = bars.findIndex((b) => b.date === p.buy.date);
      const atrAtEntry = atrValues[entryIdx];
      const stopDistanceFromStopPrice = atrAtEntry != null ? (p.buy.price - p.buy.stopLossPrice) : null;
      const backedOutAtr = p.buy.stopLossPrice != null ? (p.buy.price - p.buy.stopLossPrice) / ATR_MULTIPLIER : null;
      const stopPercentOfEntry = p.buy.stopLossPrice != null ? ((p.buy.price - p.buy.stopLossPrice) / p.buy.price) * 100 : null;

      console.log(`  Entry: ${p.buy.date} @ $${p.buy.price.toFixed(2)}`);
      console.log(`  Recorded stopLossPrice on the BUY trade: $${p.buy.stopLossPrice.toFixed(4)}`);
      console.log(`  ATR(14) computed independently at entry bar: ${atrAtEntry != null ? atrAtEntry.toFixed(4) : "null (warm-up)"}`);
      console.log(`  ATR backed out from (entryPrice - stopLossPrice)/${ATR_MULTIPLIER}: ${backedOutAtr != null ? backedOutAtr.toFixed(4) : "n/a"}`);
      console.log(`  Stop distance as % of entry price: ${stopPercentOfEntry != null ? stopPercentOfEntry.toFixed(3) + "%" : "n/a"}`);
      if (p.sell) {
        console.log(`  Exit:  ${p.sell.date} @ $${p.sell.price.toFixed(2)}  reason=${p.sell.reason}`);
        console.log(`  P&L: ${(((p.sell.price - p.buy.price) / p.buy.price) * 100).toFixed(2)}%`);
      } else {
        console.log(`  Exit: STILL OPEN as of ${END_DATE}`);
      }
    }
  }

  // === PART 3: pooled stats excluding CW ===
  console.log(`\n${"=".repeat(70)}`);
  console.log("PART 3: pooled stats with CW excluded (remaining 7 tickers)");
  console.log("=".repeat(70));

  const allTickers = ["RLI", "WDFC", "NVST", "ICUI", "CFR", "REXR", "BMI"]; // CW excluded
  let pooledRoundTrips = 0;
  let pooledWinningRoundTrips = 0;
  const perTickerReturns = [];
  for (const ticker of allTickers) {
    const { bars, result } = await runTicker(ticker);
    const pairs = pairTrades(result.trades);
    let roundTrips = 0;
    let winning = 0;
    for (const p of pairs) {
      if (p.sell) {
        roundTrips++;
        if (p.sell.cashAfter > p.buy.cashBefore) winning++;
      }
    }
    pooledRoundTrips += roundTrips;
    pooledWinningRoundTrips += winning;
    perTickerReturns.push(result.totalReturnPercent);
    console.log(`  ${ticker}: return=${result.totalReturnPercent.toFixed(2)}%  roundTrips=${roundTrips}  winning=${winning}`);
  }
  const avgReturnExCW = perTickerReturns.reduce((a, b) => a + b, 0) / perTickerReturns.length;
  const winRateExCW = pooledRoundTrips > 0 ? (pooledWinningRoundTrips / pooledRoundTrips) * 100 : 0;
  console.log(`\nExcluding CW: average return% across ${allTickers.length} tickers (equal-weighted): ${avgReturnExCW.toFixed(2)}%`);
  console.log(`Excluding CW: pooled round trips: ${pooledRoundTrips}, winning: ${pooledWinningRoundTrips}, pooled win rate: ${winRateExCW.toFixed(2)}%`);
}

main().catch((err) => {
  console.error("investigate-insider-trades failed:", err);
  process.exit(1);
});
