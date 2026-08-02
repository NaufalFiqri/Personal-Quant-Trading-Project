const { getHistoricalData } = require("./data");
const { smaCrossoverStrategy } = require("./strategy");

function twoYearsAgo(date) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() - 2);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = twoYearsAgo(endDate);

  console.log(`Fetching AAPL from ${startDate} to ${endDate}...`);
  const bars = await getHistoricalData("AAPL", startDate, endDate);
  console.log(`Got ${bars.length} bars`);

  const signals = smaCrossoverStrategy(bars, { shortPeriod: 20, longPeriod: 50 });

  console.log(`\n${signals.length} signals generated (SMA20/SMA50 crossover):\n`);
  for (const s of signals) {
    console.log(`${s.date}  ${s.action.padEnd(4)}  $${s.price.toFixed(2)}`);
  }
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
