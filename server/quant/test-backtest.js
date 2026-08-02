const { getHistoricalData } = require("./data");
const { smaCrossoverStrategy } = require("./strategy");
const { runBacktest } = require("./backtest");

function yearsAgo(date, years) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

function printResults(ticker, result) {
  console.log(`\n=== ${ticker} ===`);
  console.log(`Initial capital:        $${result.initialCapital.toFixed(2)}`);
  console.log(`Final value:             $${result.finalValue.toFixed(2)}`);
  console.log(`Total return:            ${result.totalReturnPercent.toFixed(2)}%`);
  console.log(`Buy & hold return:       ${result.buyAndHoldReturnPercent.toFixed(2)}%`);
  console.log(`Max drawdown:            ${result.maxDrawdownPercent.toFixed(2)}%`);
  console.log(`Win rate:                ${result.winRate.toFixed(2)}%`);
  console.log(`Sharpe ratio:            ${result.sharpeRatio.toFixed(3)}`);
  console.log(`Time in market:          ${result.timeInMarketPercent.toFixed(2)}%`);
  console.log(`Number of trades:        ${result.numberOfTrades}`);
  console.log(
    `Strategy: ${result.totalReturnPercent.toFixed(2)}% vs Buy & Hold: ${result.buyAndHoldReturnPercent.toFixed(2)}%`
  );
}

async function backtestTicker(ticker, startDate, endDate) {
  const bars = await getHistoricalData(ticker, startDate, endDate);
  const signals = smaCrossoverStrategy(bars, { shortPeriod: 20, longPeriod: 50 });
  const result = runBacktest(bars, signals, {
    initialCapital: 10000,
    feePercent: 0.001,
    slippagePercent: 0.0005,
  });
  printResults(ticker, result);
  return result;
}

async function main() {
  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = yearsAgo(endDate, 3);

  console.log(`Backtest period: ${startDate} to ${endDate} (3 years)`);

  const tickers = ["AAPL", "MSFT", "JNJ"];
  for (const ticker of tickers) {
    await backtestTicker(ticker, startDate, endDate);
  }
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
