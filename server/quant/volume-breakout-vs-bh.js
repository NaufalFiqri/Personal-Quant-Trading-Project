const { volumeBreakoutStrategy } = require("./strategy");
const { runWalkForward } = require("./walkforward");

const TICKERS = ["AAPL", "MSFT", "JNJ", "GOOGL", "AMZN", "NVDA", "META"];

const START_DATE = "2022-01-01";
const WINDOW_MONTHS = 18;
const MIN_WINDOW_MONTHS = 3;
const LOOKBACK_MONTHS = 2;

const STRATEGY_PARAMS = { breakoutPeriod: 20, volumePeriod: 20, volumeMultiplier: 1.5, exitPeriod: 10 };
const RISK_CONFIG = { stopLossMethod: "atr" };

function padNum(n, width, decimals = 2) {
  return n.toFixed(decimals).padStart(width);
}

function header() {
  const h =
    "Ticker".padEnd(8) +
    "Window".padEnd(23) +
    "Return%".padStart(10) +
    "B&H%".padStart(10) +
    "  Beat B&H".padEnd(11) +
    "Trades".padStart(8);
  console.log(h);
  console.log("-".repeat(h.length));
}

async function main() {
  const endDate = new Date().toISOString().slice(0, 10);
  console.log(`Volume breakout vs. buy & hold, per ticker/window`);
  console.log(`Tickers: ${TICKERS.join(", ")}`);
  console.log(
    `Range: ${START_DATE} to ${endDate}, window=${WINDOW_MONTHS}mo, minWindow=${MIN_WINDOW_MONTHS}mo, lookback=${LOOKBACK_MONTHS}mo, riskConfig=${JSON.stringify(RISK_CONFIG)}\n`
  );

  header();

  let totalWindows = 0;
  let beatCount = 0;

  for (const ticker of TICKERS) {
    // runWalkForward already returns buyAndHoldPercent per window (computed
    // in backtest.js as the window's own first/last close), so it's read
    // directly here rather than recomputed.
    const { windowResults } = await runWalkForward(ticker, volumeBreakoutStrategy, STRATEGY_PARAMS, {
      startDate: START_DATE,
      endDate,
      windowMonths: WINDOW_MONTHS,
      minWindowMonths: MIN_WINDOW_MONTHS,
      lookbackMonths: LOOKBACK_MONTHS,
      riskConfig: RISK_CONFIG,
    });

    for (const w of windowResults) {
      totalWindows++;
      const beat = w.hasSignal ? (w.beatBenchmark ? "YES" : "no") : "no signal";
      if (w.hasSignal && w.beatBenchmark) beatCount++;
      console.log(
        ticker.padEnd(8) +
          `${w.windowStart} to ${w.windowEnd}`.padEnd(23) +
          padNum(w.returnPercent, 10) +
          padNum(w.buyAndHoldPercent, 10) +
          `  ${beat}`.padEnd(11) +
          String(w.trades).padStart(8)
      );
    }
  }

  console.log("-".repeat(70));
  console.log(`${beatCount} of ${totalWindows} windows beat buy & hold`);
}

main().catch((err) => {
  console.error("volume-breakout-vs-bh failed:", err);
  process.exit(1);
});
