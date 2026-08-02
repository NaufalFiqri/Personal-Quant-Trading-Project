const { getHistoricalData } = require("./data");
const { smaCrossoverStrategy } = require("./strategy");
const { runBacktest } = require("./backtest");

function yearsAgo(date, years) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

const PERIOD_PAIRS = [
  [10, 30],
  [10, 50],
  [15, 40],
  [20, 50],
  [20, 100],
  [50, 200],
];

const TICKERS = ["AAPL", "MSFT", "JNJ"];

function padNum(n, width, decimals = 2) {
  return n.toFixed(decimals).padStart(width);
}

function printTable(results) {
  const header =
    "Ticker".padEnd(8) +
    "Short".padStart(7) +
    "Long".padStart(7) +
    "Return%".padStart(10) +
    "B&H%".padStart(10) +
    "MaxDD%".padStart(10) +
    "WinRate%".padStart(10) +
    "Trades".padStart(8) +
    "  Beat B&H";
  console.log(header);
  console.log("-".repeat(header.length));

  for (const ticker of TICKERS) {
    const forTicker = results
      .filter((r) => r.ticker === ticker)
      .sort((a, b) => b.totalReturnPercent - a.totalReturnPercent);

    for (const r of forTicker) {
      const beat = r.totalReturnPercent > r.buyAndHoldReturnPercent ? "YES" : "no";
      console.log(
        r.ticker.padEnd(8) +
          String(r.shortPeriod).padStart(7) +
          String(r.longPeriod).padStart(7) +
          padNum(r.totalReturnPercent, 10) +
          padNum(r.buyAndHoldReturnPercent, 10) +
          padNum(r.maxDrawdownPercent, 10) +
          padNum(r.winRate, 10) +
          String(r.numberOfTrades).padStart(8) +
          "  " +
          beat
      );
    }
    console.log("");
  }
}

function printSummary(results) {
  const beatCount = results.filter(
    (r) => r.totalReturnPercent > r.buyAndHoldReturnPercent
  ).length;
  console.log(`${beatCount} of ${results.length} tests beat buy & hold.\n`);

  // "Consistency" here means low spread of outperformance-vs-B&H across the
  // 3 tickers for a given combo, not the highest single return -- a combo
  // that beats B&H by roughly the same small margin on all 3 stocks is
  // more consistent than one that wins huge on one and loses big on others.
  const byCombo = new Map();
  for (const r of results) {
    const key = `${r.shortPeriod}/${r.longPeriod}`;
    if (!byCombo.has(key)) byCombo.set(key, []);
    byCombo.get(key).push(r.totalReturnPercent - r.buyAndHoldReturnPercent);
  }

  console.log("Consistency across tickers (spread of return-vs-B&H, lower = more consistent):");
  const comboStats = [];
  for (const [combo, diffs] of byCombo.entries()) {
    const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const variance =
      diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / diffs.length;
    const stdDev = Math.sqrt(variance);
    comboStats.push({ combo, mean, stdDev, diffs });
  }
  comboStats.sort((a, b) => a.stdDev - b.stdDev);

  for (const c of comboStats) {
    console.log(
      `  ${c.combo.padEnd(8)} avg outperformance vs B&H: ${padNum(c.mean, 8)}%   std dev: ${padNum(c.stdDev, 8)}`
    );
  }
  console.log(
    `\nMost consistent (lowest std dev across tickers): ${comboStats[0].combo}`
  );
}

async function main() {
  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = yearsAgo(endDate, 3);

  console.log(`Sweep period: ${startDate} to ${endDate} (3 years)`);
  console.log(`Combos: ${PERIOD_PAIRS.map((p) => `${p[0]}/${p[1]}`).join(", ")}`);
  console.log(`Tickers: ${TICKERS.join(", ")}\n`);

  const barsByTicker = {};
  for (const ticker of TICKERS) {
    barsByTicker[ticker] = await getHistoricalData(ticker, startDate, endDate);
  }

  const results = [];
  for (const ticker of TICKERS) {
    const bars = barsByTicker[ticker];
    for (const [shortPeriod, longPeriod] of PERIOD_PAIRS) {
      const signals = smaCrossoverStrategy(bars, { shortPeriod, longPeriod });
      const backtest = runBacktest(bars, signals, {
        initialCapital: 10000,
        feePercent: 0.001,
        slippagePercent: 0.0005,
      });
      results.push({
        ticker,
        shortPeriod,
        longPeriod,
        totalReturnPercent: backtest.totalReturnPercent,
        buyAndHoldReturnPercent: backtest.buyAndHoldReturnPercent,
        maxDrawdownPercent: backtest.maxDrawdownPercent,
        winRate: backtest.winRate,
        numberOfTrades: backtest.numberOfTrades,
      });
    }
  }

  printTable(results);
  printSummary(results);
}

main().catch((err) => {
  console.error("Sweep failed:", err);
  process.exit(1);
});
