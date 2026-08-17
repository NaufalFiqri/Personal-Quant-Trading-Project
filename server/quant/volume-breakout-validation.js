const { volumeBreakoutStrategy } = require("./strategy");
const { runWalkForward } = require("./walkforward");

// Same 7-ticker set used to validate the regime filter and to test the
// Phase 1 EMA/AAPL standout for replication.
const TICKERS = ["AAPL", "MSFT", "JNJ", "GOOGL", "AMZN", "NVDA", "META"];

const START_DATE = "2022-01-01";
const WINDOW_MONTHS = 18;
const MIN_WINDOW_MONTHS = 3;
// Combined warm-up bottleneck is 20 trading days (breakoutPeriod/volumePeriod);
// 2 calendar months (~42 trading days) is roughly 2x margin, per the scoping doc.
const LOOKBACK_MONTHS = 2;

const STRATEGY_PARAMS = { breakoutPeriod: 20, volumePeriod: 20, volumeMultiplier: 1.5, exitPeriod: 10 };
// ATR-based stop, per the scoping doc's recommendation - breakouts often
// coincide with a volatility expansion a fixed percent doesn't account for.
const RISK_CONFIG = { stopLossMethod: "atr" };

function padNum(n, width, decimals = 2) {
  return n.toFixed(decimals).padStart(width);
}

function header() {
  const h =
    "Ticker".padEnd(8) +
    "Sharpe".padStart(9) +
    "MaxDD%".padStart(10) +
    "WinRate%".padStart(10) +
    "Return%".padStart(10) +
    "Trades".padStart(8) +
    "TradedWin".padStart(10) +
    "NoSigWin".padStart(10);
  console.log(h);
  console.log("-".repeat(h.length));
}

// startDate/endDate default to the original 2022-today validation range but
// are overridable - used by volume-breakout-replication-check.js to re-run
// the identical strategy/config against an earlier, non-overlapping window
// without duplicating this logic.
async function runValidation(startDate = START_DATE, endDate = new Date().toISOString().slice(0, 10)) {
  const options = {
    startDate,
    endDate,
    windowMonths: WINDOW_MONTHS,
    minWindowMonths: MIN_WINDOW_MONTHS,
    lookbackMonths: LOOKBACK_MONTHS,
    riskConfig: RISK_CONFIG,
  };

  const results = [];
  for (const ticker of TICKERS) {
    const result = await runWalkForward(ticker, volumeBreakoutStrategy, STRATEGY_PARAMS, options);
    results.push({ ticker, ...result });
  }
  return { startDate, endDate, results };
}

// Pulls every BUY trade's breakoutMarginPercent/volumeRatio (attached by
// volumeBreakoutStrategy, carried through by backtest.js, surfaced per
// window by walkforward.js's tradeLog) alongside whether that round trip
// eventually won or lost, by pairing each BUY with the next SELL in the
// same window's trade log.
function collectBreakoutTrades(results) {
  const trades = [];
  for (const { ticker, windowResults } of results) {
    for (const w of windowResults) {
      const log = w.tradeLog || [];
      for (let i = 0; i < log.length; i++) {
        if (log[i].action !== "BUY") continue;
        const sell = log.slice(i + 1).find((t) => t.action === "SELL");
        if (!sell) continue; // position still open at window end - no resolved outcome
        const won = sell.cashAfter > log[i].cashBefore;
        trades.push({
          ticker,
          date: log[i].date,
          breakoutMarginPercent: log[i].breakoutMarginPercent,
          volumeRatio: log[i].volumeRatio,
          won,
        });
      }
    }
  }
  return trades;
}

function winRateOf(list) {
  return list.length > 0 ? ((list.filter((t) => t.won).length / list.length) * 100).toFixed(1) : "n/a";
}

// Shared by the original 2022-today run and volume-breakout-replication-check.js
// so both print identically-formatted output for the same underlying data shape.
function printReport(startDate, endDate, results) {
  console.log(`Volume breakout walk-forward validation`);
  console.log(`Tickers: ${TICKERS.join(", ")}`);
  console.log(
    `Range: ${startDate} to ${endDate}, window=${WINDOW_MONTHS}mo, minWindow=${MIN_WINDOW_MONTHS}mo, lookback=${LOOKBACK_MONTHS}mo, riskConfig=${JSON.stringify(RISK_CONFIG)}\n`
  );

  header();
  let totalTrades = 0;
  for (const r of results) {
    const agg = r.aggregate;
    const tickerTrades = r.windowResults.reduce((s, w) => s + w.trades, 0);
    totalTrades += tickerTrades;
    console.log(
      r.ticker.padEnd(8) +
        padNum(agg.averageSharpe, 9, 3) +
        padNum(agg.averageMaxDrawdownPercent, 10) +
        padNum(agg.averageWinRate, 10) +
        padNum(agg.averageReturnPercent, 10) +
        String(tickerTrades).padStart(8) +
        String(agg.windowsWithSignal).padStart(10) +
        String(agg.windowsWithoutSignal).padStart(10)
    );
  }

  console.log("\n=== Averaged across all 7 tickers (see per-ticker table above for the real picture) ===");
  const aggs = results.map((r) => r.aggregate);
  const avgSharpe = aggs.reduce((s, a) => s + a.averageSharpe, 0) / aggs.length;
  const avgDD = aggs.reduce((s, a) => s + a.averageMaxDrawdownPercent, 0) / aggs.length;
  const avgWinRate = aggs.reduce((s, a) => s + a.averageWinRate, 0) / aggs.length;
  const avgReturn = aggs.reduce((s, a) => s + a.averageReturnPercent, 0) / aggs.length;
  console.log(
    `avgSharpe ${avgSharpe.toFixed(3)}  avgMaxDD ${avgDD.toFixed(2)}%  avgWinRate ${avgWinRate.toFixed(2)}%  avgReturn ${avgReturn.toFixed(2)}%  totalTrades ${totalTrades}`
  );

  console.log("\n=== Breakout margin vs. trade outcome ===");
  const breakoutTrades = collectBreakoutTrades(results);
  console.log(`Resolved round trips with a known breakout margin: ${breakoutTrades.length}`);
  for (const t of breakoutTrades) {
    console.log(
      `  ${t.ticker.padEnd(6)} ${t.date}  margin=${t.breakoutMarginPercent.toFixed(2)}%  volumeRatio=${t.volumeRatio.toFixed(2)}x  ${t.won ? "WON" : "lost"}`
    );
  }

  const wide = breakoutTrades.filter((t) => t.breakoutMarginPercent > 1);
  const thin = breakoutTrades.filter((t) => t.breakoutMarginPercent < 0.5);
  const mid = breakoutTrades.filter((t) => t.breakoutMarginPercent >= 0.5 && t.breakoutMarginPercent <= 1);
  console.log(`\nWide margin (>1%): n=${wide.length}, win rate=${winRateOf(wide)}%`);
  console.log(`Mid margin (0.5%-1%): n=${mid.length}, win rate=${winRateOf(mid)}%`);
  console.log(`Thin margin (<0.5%): n=${thin.length}, win rate=${winRateOf(thin)}%`);

  return { breakoutTrades, wide, mid, thin };
}

async function main() {
  const { startDate, endDate, results } = await runValidation();
  printReport(startDate, endDate, results);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Volume breakout validation failed:", err);
    process.exit(1);
  });
}

module.exports = {
  runValidation,
  collectBreakoutTrades,
  printReport,
  winRateOf,
  TICKERS,
  START_DATE,
  WINDOW_MONTHS,
  MIN_WINDOW_MONTHS,
  LOOKBACK_MONTHS,
  RISK_CONFIG,
};
