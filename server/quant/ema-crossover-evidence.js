const { runWalkForward } = require("./walkforward");
const { maCrossoverStrategy } = require("./strategy");

// Original 3 tickers plus 4 additional large-cap, liquid, moderate-to-high
// volatility tech/growth-adjacent names with a similar profile to AAPL, to
// see whether EMA 20/50's standout walk-forward result on AAPL generalizes
// or was specific to that one ticker.
const TICKERS = ["AAPL", "MSFT", "JNJ", "GOOGL", "AMZN", "NVDA", "META"];

const EMA_PARAMS = { shortPeriod: 20, longPeriod: 50, maType: "ema" };

function padNum(n, width, decimals = 2) {
  return n.toFixed(decimals).padStart(width);
}

function printSummaryTable(title, resultsByTicker) {
  console.log(`\n${title}`);
  const header =
    "Ticker".padEnd(8) +
    "TradedWin".padStart(10) +
    "NoSignal".padStart(9) +
    "WinRate%".padStart(10) +
    "AvgReturn%".padStart(11) +
    "AvgSharpe".padStart(11) +
    "Consistency".padStart(12);
  console.log(header);
  console.log("-".repeat(header.length));

  for (const { ticker, aggregate } of resultsByTicker) {
    console.log(
      ticker.padEnd(8) +
        String(aggregate.windowsWithSignal).padStart(10) +
        String(aggregate.windowsWithoutSignal).padStart(9) +
        padNum(aggregate.winningWindowsPercent, 10) +
        padNum(aggregate.averageReturnPercent, 11) +
        padNum(aggregate.averageSharpe, 11, 3) +
        padNum(aggregate.consistencyScore, 12)
    );
  }
}

async function runForWindowSize(startDate, endDate, windowMonths) {
  const resultsByTicker = [];
  for (const ticker of TICKERS) {
    const { aggregate } = await runWalkForward(ticker, maCrossoverStrategy, EMA_PARAMS, {
      startDate,
      endDate,
      windowMonths,
    });
    resultsByTicker.push({ ticker, aggregate });
  }
  return resultsByTicker;
}

async function main() {
  const startDate = "2022-01-01";
  const endDate = new Date().toISOString().slice(0, 10);

  console.log(`EMA 20/50 crossover walk-forward evidence-gathering`);
  console.log(`Range: ${startDate} to ${endDate}`);
  console.log(`Tickers: ${TICKERS.join(", ")}`);

  const sixMonth = await runForWindowSize(startDate, endDate, 6);
  printSummaryTable("PART A: 6-month windows (7 tickers)", sixMonth);

  const threeMonth = await runForWindowSize(startDate, endDate, 3);
  printSummaryTable("PART B: 3-month windows (7 tickers)", threeMonth);
}

main().catch((err) => {
  console.error("EMA crossover evidence run failed:", err);
  process.exit(1);
});
