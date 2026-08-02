const { runWalkForward } = require("./walkforward");
const { maCrossoverStrategy, rsiMeanReversionStrategy } = require("./strategy");

const TICKERS = ["AAPL", "MSFT", "JNJ"];

const STRATEGIES = [
  {
    label: "SMA 20/50",
    fn: maCrossoverStrategy,
    params: { shortPeriod: 20, longPeriod: 50, maType: "sma" },
  },
  {
    label: "EMA 20/50",
    fn: maCrossoverStrategy,
    params: { shortPeriod: 20, longPeriod: 50, maType: "ema" },
  },
  {
    label: "WMA 20/50",
    fn: maCrossoverStrategy,
    params: { shortPeriod: 20, longPeriod: 50, maType: "wma" },
  },
  {
    label: "RSI 14 (30/70)",
    fn: rsiMeanReversionStrategy,
    params: { rsiPeriod: 14, oversoldThreshold: 30, overboughtThreshold: 70 },
  },
];

function padNum(n, width, decimals = 2) {
  return n.toFixed(decimals).padStart(width);
}

function printCombo(label, ticker, windowResults, aggregate) {
  console.log(`\n=== ${label} - ${ticker} ===`);
  const header =
    "Window".padEnd(23) +
    "Return%".padStart(10) +
    "B&H%".padStart(10) +
    "Sharpe".padStart(9) +
    "Trades".padStart(8) +
    "  Beat B&H";
  console.log(header);
  console.log("-".repeat(header.length));

  for (const w of windowResults) {
    const beat = w.hasSignal ? (w.beatBenchmark ? "YES" : "no") : "no signal";
    console.log(
      `${w.windowStart} to ${w.windowEnd}`.padEnd(23) +
        padNum(w.returnPercent, 10) +
        padNum(w.buyAndHoldPercent, 10) +
        padNum(w.sharpeRatio, 9, 3) +
        String(w.trades).padStart(8) +
        "  " +
        beat
    );
  }

  console.log("-".repeat(header.length));
  console.log(
    `Aggregate (${aggregate.windowsWithSignal} traded windows` +
      `, ${aggregate.windowsWithoutSignal} excluded as no-signal): ` +
      `winning windows ${aggregate.winningWindowsPercent.toFixed(2)}%` +
      `  avg return ${aggregate.averageReturnPercent.toFixed(2)}%` +
      `  avg Sharpe ${aggregate.averageSharpe.toFixed(3)}` +
      `  consistency (stdDev) ${aggregate.consistencyScore.toFixed(2)}`
  );
}

async function main() {
  const startDate = "2022-01-01";
  const endDate = new Date().toISOString().slice(0, 10);
  const windowMonths = 6;

  console.log(`Walk-forward range: ${startDate} to ${endDate}, ${windowMonths}-month windows`);
  console.log(`Strategies: ${STRATEGIES.map((s) => s.label).join(", ")}`);
  console.log(`Tickers: ${TICKERS.join(", ")}`);

  for (const strategy of STRATEGIES) {
    for (const ticker of TICKERS) {
      const { windowResults, aggregate } = await runWalkForward(
        ticker,
        strategy.fn,
        strategy.params,
        { startDate, endDate, windowMonths }
      );
      printCombo(strategy.label, ticker, windowResults, aggregate);
    }
  }
}

main().catch((err) => {
  console.error("Walk-forward test failed:", err);
  process.exit(1);
});
