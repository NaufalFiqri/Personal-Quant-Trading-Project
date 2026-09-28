// Gate 1 verification: read-only Alpaca paper API calls only. No orders
// placed. Never logs API_KEY/API_SECRET - alpaca.js handles those
// internally and this script never touches process.env directly.

const alpaca = require("./alpaca");

function redactId(obj) {
  if (!obj || typeof obj !== "object") return obj;
  return { ...obj, id: obj.id ? "[REDACTED]" : obj.id };
}

async function main() {
  console.log("=== getAccount() ===");
  const account = await alpaca.getAccount();
  const redacted = redactId(account);
  console.log(JSON.stringify(redacted, null, 2));
  console.log(`\nKey fields: status=${account.status}, buying_power=${account.buying_power}, equity=${account.equity}, cash=${account.cash}`);

  console.log("\n=== getPositions() ===");
  const positions = await alpaca.getPositions();
  console.log(JSON.stringify(positions, null, 2));

  console.log('\n=== getPosition("AAPL") ===');
  const aaplPosition = await alpaca.getPosition("AAPL");
  console.log("Result:", aaplPosition === null ? "null (no position - handled gracefully, no throw)" : JSON.stringify(aaplPosition, null, 2));
}

main().catch((err) => {
  console.error("Gate 1 test failed:", err.message);
  process.exit(1);
});
