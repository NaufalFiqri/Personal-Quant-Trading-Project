const { getHistoricalData } = require("./data");
const { maCrossoverStrategy, rsiMeanReversionStrategy } = require("./strategy");
const { runBacktest } = require("./backtest");

function yearsAgo(date, years) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

const TICKERS = ["AAPL", "MSFT", "JNJ"];

const STRATEGIES = [
  { label: "SMA 20/50", run: (bars) => maCrossoverStrategy(bars, { shortPeriod: 20, longPeriod: 50, maType: "sma" }) },
  { label: "EMA 20/50", run: (bars) => maCrossoverStrategy(bars, { shortPeriod: 20, longPeriod: 50, maType: "ema" }) },
  { label: "WMA 20/50", run: (bars) => maCrossoverStrategy(bars, { shortPeriod: 20, longPeriod: 50, maType: "wma" }) },
  {
    label: "RSI 14 (30/70)",
    run: (bars) => rsiMeanReversionStrategy(bars, { rsiPeriod: 14, oversoldThreshold: 30, overboughtThreshold: 70 }),
  },
];

function padNum(n, width, decimals = 2) {
  return n.toFixed(decimals).padStart(width);
}

function printTable(results) {
  const header =
    "Strategy".padEnd(16) +
    "Ticker".padEnd(8) +
    "Return%".padStart(10) +
    "B&H%".padStart(10) +
    "MaxDD%".padStart(10) +
    "WinRate%".padStart(10) +
    "Sharpe".padStart(9) +
    "TimeInMkt%".padStart(11) +
    "Trades".padStart(8) +
    "  Beat B&H";
  console.log(header);
  console.log("-".repeat(header.length));

  for (const r of results) {
    const beat = r.totalReturnPercent > r.buyAndHoldReturnPercent ? "YES" : "no";
    console.log(
      r.strategy.padEnd(16) +
        r.ticker.padEnd(8) +
        padNum(r.totalReturnPercent, 10) +
        padNum(r.buyAndHoldReturnPercent, 10) +
        padNum(r.maxDrawdownPercent, 10) +
        padNum(r.winRate, 10) +
        padNum(r.sharpeRatio, 9, 3) +
        padNum(r.timeInMarketPercent, 11) +
        String(r.numberOfTrades).padStart(8) +
        "  " +
        beat
    );
  }
}

// Runs the fixed strategy/parameter set across the fixed ticker list for
// the given date range, returning the raw results array (no printing).
async function runComparison(startDate, endDate) {
  const barsByTicker = {};
  for (const ticker of TICKERS) {
    barsByTicker[ticker] = await getHistoricalData(ticker, startDate, endDate);
  }

  const results = [];
  for (const strategy of STRATEGIES) {
    for (const ticker of TICKERS) {
      const bars = barsByTicker[ticker];
      const signals = strategy.run(bars);
      const backtest = runBacktest(bars, signals, {
        initialCapital: 10000,
        feePercent: 0.001,
        slippagePercent: 0.0005,
      });
      results.push({
        strategy: strategy.label,
        ticker,
        totalReturnPercent: backtest.totalReturnPercent,
        buyAndHoldReturnPercent: backtest.buyAndHoldReturnPercent,
        maxDrawdownPercent: backtest.maxDrawdownPercent,
        winRate: backtest.winRate,
        sharpeRatio: backtest.sharpeRatio,
        timeInMarketPercent: backtest.timeInMarketPercent,
        numberOfTrades: backtest.numberOfTrades,
      });
    }
  }
  return results;
}

async function main() {
  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = yearsAgo(endDate, 3);

  console.log(`Comparison period: ${startDate} to ${endDate} (3 years)`);
  console.log(`Strategies: ${STRATEGIES.map((s) => s.label).join(", ")}`);
  console.log(`Tickers: ${TICKERS.join(", ")}\n`);

  const results = await runComparison(startDate, endDate);

  printTable(results);

  const beatCount = results.filter((r) => r.totalReturnPercent > r.buyAndHoldReturnPercent).length;
  console.log(`\n${beatCount} of ${results.length} tests beat buy & hold.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Comparison failed:", err);
    process.exit(1);
  });
}

module.exports = { runComparison, printTable, TICKERS, STRATEGIES };
