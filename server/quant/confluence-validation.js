const { confluenceBreakoutStrategy } = require("./strategy");
const { runWalkForward } = require("./walkforward");

// Same 7-ticker set used throughout Phase 1/2.
const TICKERS = ["AAPL", "MSFT", "JNJ", "GOOGL", "AMZN", "NVDA", "META"];

const START_DATE = "2022-01-01";
const WINDOW_MONTHS = 18;
const MIN_WINDOW_MONTHS = 3;
// 200-day trend filter dominates the combined warm-up requirement (see
// PHASE2_CONFLUENCE_SCOPING.md §4) - reusing candidate #3's exact
// lookbackMonths value and reasoning, since the binding constraint is
// identical.
const LOOKBACK_MONTHS = 11;

const STRATEGY_PARAMS = { maPeriod: 200, breakoutPeriod: 20, volumePeriod: 20, volumeMultiplier: 1.5, exitPeriod: 10 };
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

async function main() {
  const endDate = new Date().toISOString().slice(0, 10);
  console.log(`Confluence strategy (trend + breakout + volume) walk-forward validation`);
  console.log(`Tickers: ${TICKERS.join(", ")}`);
  console.log(
    `Range: ${START_DATE} to ${endDate}, window=${WINDOW_MONTHS}mo, minWindow=${MIN_WINDOW_MONTHS}mo, lookback=${LOOKBACK_MONTHS}mo, riskConfig=${JSON.stringify(RISK_CONFIG)}, params=${JSON.stringify(STRATEGY_PARAMS)}\n`
  );

  header();

  let totalTrades = 0;
  const results = [];
  for (const ticker of TICKERS) {
    const result = await runWalkForward(ticker, confluenceBreakoutStrategy, STRATEGY_PARAMS, {
      startDate: START_DATE,
      endDate,
      windowMonths: WINDOW_MONTHS,
      minWindowMonths: MIN_WINDOW_MONTHS,
      lookbackMonths: LOOKBACK_MONTHS,
      riskConfig: RISK_CONFIG,
    });
    results.push({ ticker, ...result });

    const agg = result.aggregate;
    const tickerTrades = result.windowResults.reduce((s, w) => s + w.trades, 0);
    totalTrades += tickerTrades;
    console.log(
      ticker.padEnd(8) +
        padNum(agg.averageSharpe, 9, 3) +
        padNum(agg.averageMaxDrawdownPercent, 10) +
        padNum(agg.averageWinRate, 10) +
        padNum(agg.averageReturnPercent, 10) +
        String(tickerTrades).padStart(8) +
        String(agg.windowsWithSignal).padStart(10) +
        String(agg.windowsWithoutSignal).padStart(10)
    );
  }

  console.log("\n=== Averaged across all 7 tickers ===");
  const aggs = results.map((r) => r.aggregate);
  const avgSharpe = aggs.reduce((s, a) => s + a.averageSharpe, 0) / aggs.length;
  const avgDD = aggs.reduce((s, a) => s + a.averageMaxDrawdownPercent, 0) / aggs.length;
  const avgWinRate = aggs.reduce((s, a) => s + a.averageWinRate, 0) / aggs.length;
  const avgReturn = aggs.reduce((s, a) => s + a.averageReturnPercent, 0) / aggs.length;
  console.log(
    `avgSharpe ${avgSharpe.toFixed(3)}  avgMaxDD ${avgDD.toFixed(2)}%  avgWinRate ${avgWinRate.toFixed(2)}%  avgReturn ${avgReturn.toFixed(2)}%  totalTrades ${totalTrades}`
  );

  console.log("\n=== Per-window trade counts (flagging zero/low-signal windows explicitly) ===");
  for (const r of results) {
    for (const w of r.windowResults) {
      const flag = w.trades === 0 ? "  <- ZERO SIGNAL" : w.trades <= 2 ? "  <- LOW SIGNAL (<=2 trades)" : "";
      console.log(
        `${r.ticker.padEnd(8)}${w.windowStart} to ${w.windowEnd}  trades=${String(w.trades).padStart(2)}  hasSignal=${String(w.hasSignal).padEnd(5)}${flag}`
      );
    }
  }
}

main().catch((err) => {
  console.error("confluence-validation failed:", err);
  process.exit(1);
});
