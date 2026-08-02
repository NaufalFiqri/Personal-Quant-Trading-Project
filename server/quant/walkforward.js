const { getHistoricalData } = require("./data");
const { runBacktest } = require("./backtest");

function addMonths(dateStr, months) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

// Splits [startDate, endDate] into sequential, non-overlapping windows of
// `windowMonths` length. The final window is clipped to endDate and may be
// shorter than the rest if the range doesn't divide evenly.
function buildWindows(startDate, endDate, windowMonths) {
  const windows = [];
  let windowStart = startDate;
  while (windowStart < endDate) {
    let windowEnd = addMonths(windowStart, windowMonths);
    if (windowEnd > endDate) windowEnd = endDate;
    windows.push({ windowStart, windowEnd });
    windowStart = windowEnd;
  }
  return windows;
}

// Runs a fixed strategy (no per-window fitting/tuning) independently across
// each sequential window, so results show whether behavior holds up across
// many different real periods rather than looking good in one chosen range.
async function runWalkForward(ticker, strategyFn, strategyParams, options = {}) {
  const { startDate, endDate, windowMonths = 6 } = options;

  const windows = buildWindows(startDate, endDate, windowMonths);
  const windowResults = [];

  for (const { windowStart, windowEnd } of windows) {
    const bars = await getHistoricalData(ticker, windowStart, windowEnd);
    const signals = strategyFn(bars, strategyParams);
    const backtest = runBacktest(bars, signals, {
      initialCapital: 10000,
      feePercent: 0.001,
      slippagePercent: 0.0005,
    });

    windowResults.push({
      windowStart,
      windowEnd,
      returnPercent: backtest.totalReturnPercent,
      buyAndHoldPercent: backtest.buyAndHoldReturnPercent,
      beatBenchmark: backtest.totalReturnPercent > backtest.buyAndHoldReturnPercent,
      sharpeRatio: backtest.sharpeRatio,
      trades: backtest.numberOfTrades,
    });
  }

  const n = windowResults.length;
  const winningWindowsPercent = n > 0
    ? (windowResults.filter((w) => w.beatBenchmark).length / n) * 100
    : 0;
  const averageReturnPercent = n > 0
    ? windowResults.reduce((sum, w) => sum + w.returnPercent, 0) / n
    : 0;
  const averageSharpe = n > 0
    ? windowResults.reduce((sum, w) => sum + w.sharpeRatio, 0) / n
    : 0;

  // Consistency score: standard deviation of per-window returns. Lower
  // means the strategy's return was similar window to window; higher
  // means it swung between very different outcomes depending on the
  // period, which is a separate concern from whether the average was good.
  const variance = n > 0
    ? windowResults.reduce((sum, w) => sum + (w.returnPercent - averageReturnPercent) ** 2, 0) / n
    : 0;
  const consistencyScore = Math.sqrt(variance);

  return {
    windowResults,
    aggregate: {
      winningWindowsPercent,
      averageReturnPercent,
      averageSharpe,
      consistencyScore,
    },
  };
}

module.exports = { runWalkForward, buildWindows };
