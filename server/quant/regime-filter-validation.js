const { getHistoricalData } = require("./data");
const { maCrossoverStrategy, applyRegimeFilter } = require("./strategy");
const { calculateRegime } = require("./regime");
const { runWalkForward, buildWindows } = require("./walkforward");

// Same 7-ticker set used to test the Phase 1 EMA/AAPL standout for
// replication - a promising result on 1-2 tickers gets the same skepticism
// here, not a pass.
const TICKERS = ["AAPL", "MSFT", "JNJ", "GOOGL", "AMZN", "NVDA", "META"];

const START_DATE = "2022-01-01";
const WINDOW_MONTHS = 18;
const MIN_WINDOW_MONTHS = 3;
// ~231 trading days of calendar buffer - comfortably more than the 200
// trading days the regime filter's MA needs, so by the time a window
// actually starts, the MA (and the crossover strategy's own 50-period MA)
// are both already warmed up from real history instead of from scratch.
const LOOKBACK_MONTHS = 11;

const CROSSOVER_PARAMS = { shortPeriod: 20, longPeriod: 50, maType: "sma" };
const REGIME_PARAMS = { maPeriod: 200 };

function addMonthsLocal(dateStr, months) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function baselineStrategy(bars) {
  return maCrossoverStrategy(bars, CROSSOVER_PARAMS);
}

function regimeFilteredStrategy(bars) {
  const signals = maCrossoverStrategy(bars, CROSSOVER_PARAMS);
  const regime = calculateRegime(bars, REGIME_PARAMS);
  return applyRegimeFilter(signals, regime);
}

// Separate, lightweight pass purely to classify each raw BUY signal as
// kept / blocked-by-warmup / blocked-by-unfavorable, using the exact same
// window+lookback fetch pattern as runWalkForward. Reported alongside the
// backtest comparison so a large "blocked" count isn't misread as "the
// filter is very restrictive" when it's actually "the window needed more
// runway" (or vice versa) - the same distinction requested for the
// single-ticker sanity check, extended to the full walk-forward.
async function blockedSignalBreakdown(ticker, endDate) {
  const windows = buildWindows(START_DATE, endDate, WINDOW_MONTHS, MIN_WINDOW_MONTHS);
  let kept = 0;
  let blockedWarmup = 0;
  let blockedUnfavorable = 0;

  for (const { windowStart, windowEnd } of windows) {
    const fetchStart = addMonthsLocal(windowStart, -LOOKBACK_MONTHS);
    const allBars = await getHistoricalData(ticker, fetchStart, windowEnd);
    const allSignals = maCrossoverStrategy(allBars, CROSSOVER_PARAMS);
    const regime = calculateRegime(allBars, REGIME_PARAMS);
    const regimeByDate = new Map(regime.map((r) => [r.date, r.favorable]));

    const windowBuys = allSignals.filter((s) => s.action === "BUY" && s.date >= windowStart);
    for (const s of windowBuys) {
      const favorable = regimeByDate.get(s.date);
      if (favorable === true) kept++;
      else if (favorable === false) blockedUnfavorable++;
      else blockedWarmup++;
    }
  }

  return { kept, blockedWarmup, blockedUnfavorable, total: kept + blockedWarmup + blockedUnfavorable };
}

function padNum(n, width, decimals = 2) {
  return n.toFixed(decimals).padStart(width);
}

function printRow(label, ticker, agg, totalTrades) {
  console.log(
    label.padEnd(12) +
      ticker.padEnd(8) +
      padNum(agg.averageSharpe, 9, 3) +
      padNum(agg.averageMaxDrawdownPercent, 10) +
      padNum(agg.averageWinRate, 10) +
      padNum(agg.averageReturnPercent, 10) +
      String(totalTrades).padStart(8) +
      String(agg.windowsWithSignal).padStart(10) +
      String(agg.windowsWithoutSignal).padStart(10)
  );
}

function header() {
  const h =
    "Variant".padEnd(12) +
    "Ticker".padEnd(8) +
    "AvgSharpe".padStart(9) +
    "AvgMaxDD%".padStart(10) +
    "AvgWinRt%".padStart(10) +
    "AvgReturn%".padStart(10) +
    "Trades".padStart(8) +
    "TradedWin".padStart(10) +
    "NoSigWin".padStart(10);
  console.log(h);
  console.log("-".repeat(h.length));
}

async function runComparison() {
  const endDate = new Date().toISOString().slice(0, 10);
  const options = {
    startDate: START_DATE,
    endDate,
    windowMonths: WINDOW_MONTHS,
    minWindowMonths: MIN_WINDOW_MONTHS,
    lookbackMonths: LOOKBACK_MONTHS,
  };

  const results = [];
  for (const ticker of TICKERS) {
    const baseline = await runWalkForward(ticker, baselineStrategy, null, options);
    const filtered = await runWalkForward(ticker, regimeFilteredStrategy, null, options);
    const blocked = await blockedSignalBreakdown(ticker, endDate);
    results.push({ ticker, baseline, filtered, blocked });
  }
  return { endDate, options, results };
}

async function main() {
  const { endDate, results } = await runComparison();

  console.log(`Regime filter walk-forward validation`);
  console.log(`Tickers: ${TICKERS.join(", ")}`);
  console.log(
    `Range: ${START_DATE} to ${endDate}, window=${WINDOW_MONTHS}mo, minWindow=${MIN_WINDOW_MONTHS}mo, lookback=${LOOKBACK_MONTHS}mo\n`
  );

  header();
  for (const r of results) {
    const baselineTrades = r.baseline.windowResults.reduce((s, w) => s + w.trades, 0);
    const filteredTrades = r.filtered.windowResults.reduce((s, w) => s + w.trades, 0);
    printRow("baseline", r.ticker, r.baseline.aggregate, baselineTrades);
    printRow("filtered", r.ticker, r.filtered.aggregate, filteredTrades);
  }

  console.log("\n=== Averaged across all 7 tickers ===");
  for (const variant of ["baseline", "filtered"]) {
    const aggs = results.map((r) => r[variant].aggregate);
    const avgSharpe = aggs.reduce((s, a) => s + a.averageSharpe, 0) / aggs.length;
    const avgDD = aggs.reduce((s, a) => s + a.averageMaxDrawdownPercent, 0) / aggs.length;
    const avgWinRate = aggs.reduce((s, a) => s + a.averageWinRate, 0) / aggs.length;
    const avgReturn = aggs.reduce((s, a) => s + a.averageReturnPercent, 0) / aggs.length;
    const totalTrades = results.reduce(
      (s, r) => s + r[variant].windowResults.reduce((s2, w) => s2 + w.trades, 0),
      0
    );
    console.log(
      `${variant.padEnd(10)} avgSharpe ${avgSharpe.toFixed(3).padStart(7)}  avgMaxDD ${avgDD.toFixed(2).padStart(6)}%  ` +
        `avgWinRate ${avgWinRate.toFixed(2).padStart(6)}%  avgReturn ${avgReturn.toFixed(2).padStart(6)}%  totalTrades ${totalTrades}`
    );
  }

  console.log("\n=== BUY signal blocked breakdown (warm-up vs. genuine unfavorable regime) ===");
  let totalKept = 0;
  let totalWarmup = 0;
  let totalUnfavorable = 0;
  for (const r of results) {
    const b = r.blocked;
    totalKept += b.kept;
    totalWarmup += b.blockedWarmup;
    totalUnfavorable += b.blockedUnfavorable;
    console.log(
      `${r.ticker.padEnd(6)} total BUY signals=${b.total}  kept=${b.kept}  blocked-by-warmup=${b.blockedWarmup}  blocked-by-unfavorable=${b.blockedUnfavorable}`
    );
  }
  const totalAll = totalKept + totalWarmup + totalUnfavorable;
  console.log(
    `\nALL TICKERS: total BUY signals=${totalAll}  kept=${totalKept} (${((totalKept / totalAll) * 100).toFixed(1)}%)  ` +
      `blocked-by-warmup=${totalWarmup} (${((totalWarmup / totalAll) * 100).toFixed(1)}%)  ` +
      `blocked-by-unfavorable=${totalUnfavorable} (${((totalUnfavorable / totalAll) * 100).toFixed(1)}%)`
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Regime filter validation failed:", err);
    process.exit(1);
  });
}

module.exports = { runComparison, TICKERS, START_DATE, WINDOW_MONTHS, MIN_WINDOW_MONTHS, LOOKBACK_MONTHS };
