// Gate 2a: one real order-payload test against the paper API. Market is
// closed, so this is expected to queue (status "accepted"/"new"), not fill -
// it gets canceled before that can happen. Uses the exact same
// buildEntryOrderPayload() live-daily-run.js itself calls, not a
// hand-written copy of the payload shape. qty is hardcoded to 1 and the
// stop to ~5% below the latest close, per explicit instruction - NOT
// derived from risk.js sizing, since this is a payload-mechanics test, not
// a real sized entry.

const alpaca = require("./alpaca");
const { getHistoricalData } = require("./data");
const { buildEntryOrderPayload } = require("./live-daily-run");

const TICKER = "AAPL";

async function main() {
  const bars = await getHistoricalData(TICKER, "2026-08-01", "2026-09-28");
  const latestClose = bars[bars.length - 1].close;
  console.log(`Latest ${TICKER} close (${bars[bars.length - 1].date}): $${latestClose.toFixed(2)}`);

  const stopLossPrice = latestClose * 0.95;
  console.log(`Stop price (~5% below latest close): $${stopLossPrice.toFixed(2)}`);

  const payload = buildEntryOrderPayload({ symbol: TICKER, qty: 1, stopLossPrice });
  console.log("\n=== Payload built via the real buildEntryOrderPayload() ===");
  console.log(JSON.stringify(payload, null, 2));

  console.log("\n=== placeOrder() - submitting to Alpaca paper API ===");
  let order;
  try {
    order = await alpaca.placeOrder(payload);
  } catch (err) {
    console.error("REJECTED. Full error:", err.message);
    process.exit(1);
  }
  console.log(JSON.stringify(order, null, 2));
  console.log(`\nKey fields: id=${order.id}, status=${order.status}, order_class=${order.order_class}`);
  console.log("Legs:", JSON.stringify(order.legs, null, 2));

  const orderId = order.id;

  console.log("\n=== getOrder(id) - fetching it back ===");
  const fetched = await alpaca.getOrder(orderId);
  console.log(JSON.stringify(fetched, null, 2));

  console.log("\n=== cancelOrder(id) ===");
  const cancelResult = await alpaca.cancelOrder(orderId);
  console.log("cancelOrder() returned:", JSON.stringify(cancelResult));

  console.log("\n=== getOrder(id) again - confirming canceled ===");
  const afterCancel = await alpaca.getOrder(orderId);
  console.log(JSON.stringify(afterCancel, null, 2));
  console.log(`\nStatus after cancel: ${afterCancel.status}`);

  console.log("\n=== getPositions() - confirming still flat ===");
  const positions = await alpaca.getPositions();
  console.log(JSON.stringify(positions, null, 2));
}

main().catch((err) => {
  console.error("Gate 2a test failed:", err.message);
  process.exit(1);
});
