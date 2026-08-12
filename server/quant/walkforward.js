const { getHistoricalData } = require("./data");
const { runBacktest } = require("./backtest");

function addMonths(dateStr, months) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function daysBetween(startDateStr, endDateStr) {
  const ms = new Date(endDateStr) - new Date(startDateStr);
  return ms / (1000 * 60 * 60 * 24);
}

// Splits [startDate, endDate] into sequential, non-overlapping windows of
// `windowMonths` length. The final window is clipped to endDate and may be
// shorter than the rest if the range doesn't divide evenly - if it's
// shorter than `minWindowMonths`, it's dropped rather than kept as a
// stunted window that isn't really comparable to the others (e.g. a
// ~1-month leftover sitting next to 6-month windows).
function buildWindows(startDate, endDate, windowMonths, minWindowMonths) {
  const windows = [];
  let windowStart = startDate;
  while (windowStart < endDate) {
    let windowEnd = addMonths(windowStart, windowMonths);
    if (windowEnd > endDate) windowEnd = endDate;
    windows.push({ windowStart, windowEnd });
    windowStart = windowEnd;
  }

  const minDays = minWindowMonths * 30;
  const last = windows[windows.length - 1];
  if (last && daysBetween(last.windowStart, last.windowEnd) < minDays) {
    windows.pop();
  }

  return windows;
}

// Runs a fixed strategy (no per-window fitting/tuning) independently across
// each sequential window, so results show whether behavior holds up across
// many different real periods rather than looking good in one chosen range.
async function runWalkForward(ticker, strategyFn, strategyParams, options = {}) {
  const { startDate, endDate, windowMonths = 6, minWindowMonths = 3, lookbackMonths = 0 } = options;

  const windows = buildWindows(startDate, endDate, windowMonths, minWindowMonths);
  const windowResults = [];

  for (const { windowStart, windowEnd } of windows) {
    // An optional lookback buffer fetched before windowStart lets an
    // indicator with its own warm-up period (e.g. a 200-period regime
    // filter) enter the window already warmed up from real history, instead
    // of re-warming from scratch inside every window - which would eat a
    // large fraction of a typical window's own length. Bars/signals are
    // filtered back down to the window itself before backtesting - the
    // lookback period exists only to prime indicators, never to trade.
    // Default 0 preserves the exact original behavior for existing callers.
    const fetchStart = lookbackMonths > 0 ? addMonths(windowStart, -lookbackMonths) : windowStart;
    const fetchedBars = await getHistoricalData(ticker, fetchStart, windowEnd);
    const fetchedSignals = strategyFn(fetchedBars, strategyParams);

    const bars = lookbackMonths > 0 ? fetchedBars.filter((b) => b.date >= windowStart) : fetchedBars;
    const signals = lookbackMonths > 0 ? fetchedSignals.filter((s) => s.date >= windowStart) : fetchedSignals;

    const backtest = runBacktest(bars, signals, {
      initialCapital: 10000,
      feePercent: 0.001,
      slippagePercent: 0.0005,
    });

    const hasSignal = backtest.numberOfTrades > 0;

    windowResults.push({
      windowStart,
      windowEnd,
      returnPercent: backtest.totalReturnPercent,
      buyAndHoldPercent: backtest.buyAndHoldReturnPercent,
      maxDrawdownPercent: backtest.maxDrawdownPercent,
      winRate: backtest.winRate,
      // A 0-trade window means the strategy never fired, not that it made
      // a defensive decision to sit out - beatBenchmark is only meaningful
      // when the strategy actually did something, so it's null here rather
      // than a same-as-a-loss false negative or a benchmark-was-down false
      // "win".
      beatBenchmark: hasSignal
        ? backtest.totalReturnPercent > backtest.buyAndHoldReturnPercent
        : null,
      hasSignal,
      sharpeRatio: backtest.sharpeRatio,
      trades: backtest.numberOfTrades,
    });
  }

  // No-signal windows are excluded from every aggregate below: a strategy
  // that never traded didn't "tie the benchmark" or "avoid a loss", it just
  // produced no data point. Counting 0.00% returns from silent windows
  // would drag the average toward 0 and could even count as a "win"
  // whenever the benchmark happened to be negative, misrepresenting
  // inaction as a defensive call. They're still shown per-window, labeled,
  // so the "how often did this strategy even do something" signal isn't lost.
  const tradedWindows = windowResults.filter((w) => w.hasSignal);
  const n = tradedWindows.length;

  const winningWindowsPercent = n > 0
    ? (tradedWindows.filter((w) => w.beatBenchmark).length / n) * 100
    : 0;
  const averageReturnPercent = n > 0
    ? tradedWindows.reduce((sum, w) => sum + w.returnPercent, 0) / n
    : 0;
  const averageSharpe = n > 0
    ? tradedWindows.reduce((sum, w) => sum + w.sharpeRatio, 0) / n
    : 0;
  const averageMaxDrawdownPercent = n > 0
    ? tradedWindows.reduce((sum, w) => sum + w.maxDrawdownPercent, 0) / n
    : 0;
  const averageWinRate = n > 0
    ? tradedWindows.reduce((sum, w) => sum + w.winRate, 0) / n
    : 0;

  // Consistency score: standard deviation of per-window returns among
  // windows where the strategy actually traded. Lower means the strategy's
  // return was similar window to window; higher means it swung between
  // very different outcomes depending on the period.
  const variance = n > 0
    ? tradedWindows.reduce((sum, w) => sum + (w.returnPercent - averageReturnPercent) ** 2, 0) / n
    : 0;
  const consistencyScore = Math.sqrt(variance);

  return {
    windowResults,
    aggregate: {
      windowsWithSignal: n,
      windowsWithoutSignal: windowResults.length - n,
      winningWindowsPercent,
      averageReturnPercent,
      averageSharpe,
      averageMaxDrawdownPercent,
      averageWinRate,
      consistencyScore,
    },
  };
}

module.exports = { runWalkForward, buildWindows };
