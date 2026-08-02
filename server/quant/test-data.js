const { getHistoricalData } = require("./data");

async function main() {
  console.log("Fetching AAPL Jan-Mar 2024 (first call, expect network fetch)...");
  const first = await getHistoricalData("AAPL", "2024-01-01", "2024-03-31");
  console.log(`Got ${first.length} bars`);
  console.log("First bar:", first[0]);
  console.log("Last bar:", first[first.length - 1]);

  console.log("\nFetching same range again (expect cache hit, no network)...");
  const second = await getHistoricalData("AAPL", "2024-01-01", "2024-03-31");
  console.log(`Got ${second.length} bars`);

  const identical =
    first.length === second.length &&
    JSON.stringify(first) === JSON.stringify(second);

  console.log(
    identical
      ? "\nPASS: cached result identical to first fetch"
      : "\nFAIL: cached result differs from first fetch"
  );
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
