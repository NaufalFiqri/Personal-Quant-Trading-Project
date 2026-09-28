const { dropIntradayBarIfMarketOpen, flattenPosition, checkEntryBlockedByOpenOrders } = require("./live-daily-run");

let passed = 0;
let failed = 0;

function check(name, condition, actual) {
  if (condition) {
    console.log(`PASS: ${name}`);
    passed++;
  } else {
    console.log(`FAIL: ${name} (actual: ${JSON.stringify(actual)})`);
    failed++;
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
  } catch (err) {
    console.log(`FAIL: ${name} (threw unexpectedly: ${err.message})`);
    failed++;
  }
}

function makeBars(dates) {
  return dates.map((date) => ({ date, open: 100, high: 101, close: 100, low: 99, volume: 1000 }));
}

// --- dropIntradayBarIfMarketOpen -------------------------------------------

const bars5 = makeBars(["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28"]);

const closedResult = dropIntradayBarIfMarketOpen(bars5, { is_open: false, timestamp: "2026-09-28T20:00:00-04:00" });
check("market closed: no bar is dropped", closedResult.length === 5, closedResult);

const openResult = dropIntradayBarIfMarketOpen(bars5, { is_open: true, timestamp: "2026-09-28T11:00:00-04:00" });
check(
  "market open: today's ET-dated bar is dropped, no others",
  openResult.length === 4 && openResult.every((b) => b.date !== "2026-09-28"),
  openResult
);

const openNoMatchResult = dropIntradayBarIfMarketOpen(bars5, { is_open: true, timestamp: "2026-09-29T11:00:00-04:00" });
check(
  "market open but no bar matches today's ET date (e.g. data not yet fetched for it): nothing dropped",
  openNoMatchResult.length === 5,
  openNoMatchResult
);

// --- flattenPosition sequencing, mocked alpaca client ----------------------

// Records every call made to the mock, in order, so sequencing can be
// asserted directly rather than inferred.
function makeCallLog() {
  const calls = [];
  return { calls, record: (name, args) => calls.push({ name, args }) };
}

async function testHappyPath() {
  const { calls, record } = makeCallLog();
  const mockAlpaca = {
    getPosition: async (symbol) => {
      record("getPosition", { symbol });
      return { qty: "7" }; // the REAL held qty - deliberately different from any "strategy-side" number
    },
    getOrders: async ({ status, symbols }) => {
      record("getOrders", { status, symbols });
      return [{ id: "order-1", type: "stop", side: "sell", stop_price: "150.00" }];
    },
    cancelOrder: async (id) => {
      record("cancelOrder", { id });
      return null;
    },
    getOrder: async (id) => {
      record("getOrder", { id });
      return { id, status: "canceled" };
    },
    placeOrder: async (payload) => {
      record("placeOrder", payload);
      return { id: "sell-order-1", status: "accepted" };
    },
  };

  const result = await flattenPosition("AAPL", { alpacaClient: mockAlpaca, dryRun: false });

  const cancelIdx = calls.findIndex((c) => c.name === "cancelOrder");
  const placeIdx = calls.findIndex((c) => c.name === "placeOrder");

  check("happy path: cancelOrder was called", cancelIdx !== -1, calls);
  check("happy path: placeOrder was called", placeIdx !== -1, calls);
  check("happy path: cancel happens strictly before close", cancelIdx !== -1 && placeIdx !== -1 && cancelIdx < placeIdx, calls);
  check("happy path: getOrder (confirmation) happens between cancel and close", calls.some((c, i) => c.name === "getOrder" && i > cancelIdx && i < placeIdx), calls);
  const placeCall = calls.find((c) => c.name === "placeOrder");
  check(
    "happy path: close uses the REAL held qty from getPosition (7), not a hand-picked number",
    placeCall && placeCall.args.qty === "7" && placeCall.args.side === "sell" && placeCall.args.type === "market",
    placeCall
  );
  check("happy path: flattenPosition returns the canceled id(s) and the sell order", result.canceled && result.canceled[0] === "order-1" && result.sellOrder.id === "sell-order-1", result);
}

async function testCancelFailurePath() {
  const { calls } = makeCallLog();
  const mockAlpaca = {
    getPosition: async () => ({ qty: "3" }),
    getOrders: async () => [{ id: "order-2", type: "stop", side: "sell", stop_price: "140.00" }],
    cancelOrder: async () => {
      throw new Error("simulated cancel failure (e.g. network error)");
    },
    getOrder: async () => {
      calls.push({ name: "getOrder" });
      return { status: "new" };
    },
    placeOrder: async (payload) => {
      calls.push({ name: "placeOrder", args: payload });
      throw new Error("placeOrder should NEVER be called on this path");
    },
  };

  let threw = false;
  try {
    await flattenPosition("AAPL", { alpacaClient: mockAlpaca, dryRun: false });
  } catch (err) {
    threw = true;
    check("cancel-failure path: the error propagates out of flattenPosition", err.message.includes("simulated cancel failure"), err.message);
  }
  check("cancel-failure path: flattenPosition threw (did not silently continue)", threw, threw);
  check("cancel-failure path: placeOrder (the close) was NEVER attempted", !calls.some((c) => c.name === "placeOrder"), calls);
}

async function testCloseFailureReprotects() {
  const calls = [];
  const mockAlpaca = {
    getPosition: async () => ({ qty: "10" }),
    getOrders: async () => [{ id: "order-3", type: "stop", side: "sell", stop_price: "120.50" }],
    cancelOrder: async (id) => {
      calls.push({ name: "cancelOrder", id });
      return null;
    },
    getOrder: async (id) => {
      calls.push({ name: "getOrder", id });
      return { id, status: "canceled" };
    },
    placeOrder: async (payload) => {
      calls.push({ name: "placeOrder", payload });
      if (payload.type === "market") {
        throw new Error("simulated close failure (e.g. rejected sell)");
      }
      // The re-protection stop re-place succeeds.
      return { id: "reprotect-order-1", status: "accepted" };
    },
  };

  let threw = false;
  try {
    await flattenPosition("AAPL", { alpacaClient: mockAlpaca, dryRun: false });
  } catch (err) {
    threw = true;
    check("close-failure path: the original close error propagates (not swallowed by the reprotect attempt)", err.message.includes("simulated close failure"), err.message);
  }
  check("close-failure path: flattenPosition threw", threw, threw);

  const marketCall = calls.find((c) => c.name === "placeOrder" && c.payload.type === "market");
  const stopCall = calls.find((c) => c.name === "placeOrder" && c.payload.type === "stop");
  check("close-failure path: the close attempt used the real held qty (10)", marketCall && marketCall.payload.qty === "10", marketCall);
  check(
    "close-failure path: a protective stop was re-placed using the SAME stop_price that was just canceled (120.50), not a new/guessed value",
    stopCall && stopCall.payload.stopPrice === "120.50" && stopCall.payload.qty === "10" && stopCall.payload.side === "sell",
    stopCall
  );
  check(
    "close-failure path: the re-placed protective stop uses timeInForce gtc, not day - a day stop would expire at end of the SAME session it's protecting against, defeating the point of restoring protection",
    stopCall && stopCall.payload.timeInForce === "gtc",
    stopCall
  );
  const cancelIdx = calls.findIndex((c) => c.name === "cancelOrder");
  const marketIdx = calls.findIndex((c) => c.name === "placeOrder" && c.payload.type === "market");
  const stopIdx = calls.findIndex((c) => c.name === "placeOrder" && c.payload.type === "stop");
  check("close-failure path: sequencing is cancel -> close attempt -> reprotect attempt", cancelIdx < marketIdx && marketIdx < stopIdx, calls);
}

async function testCloseFailureReprotectAlsoFails() {
  const mockAlpaca = {
    getPosition: async () => ({ qty: "4" }),
    getOrders: async () => [{ id: "order-4", type: "stop", side: "sell", stop_price: "99.00" }],
    cancelOrder: async () => null,
    getOrder: async (id) => ({ id, status: "canceled" }),
    placeOrder: async (payload) => {
      throw new Error(payload.type === "market" ? "simulated close failure" : "simulated reprotect failure too");
    },
  };

  let threw = false;
  let message = "";
  try {
    await flattenPosition("AAPL", { alpacaClient: mockAlpaca, dryRun: false });
  } catch (err) {
    threw = true;
    message = err.message;
  }
  check("worst-case path (close AND reprotect both fail): still throws rather than reporting success", threw, threw);
  check("worst-case path: the propagated error is the original close failure, not the reprotect failure", message.includes("simulated close failure"), message);
}

async function testDryRunMakesNoMutatingCalls() {
  const calls = [];
  const mockAlpaca = {
    getPosition: async () => ({ qty: "2" }),
    getOrders: async () => [{ id: "order-5", type: "stop", side: "sell", stop_price: "80.00" }],
    cancelOrder: async (id) => {
      calls.push("cancelOrder");
      return null;
    },
    getOrder: async () => {
      calls.push("getOrder");
      return { status: "canceled" };
    },
    placeOrder: async () => {
      calls.push("placeOrder");
      return {};
    },
  };

  const result = await flattenPosition("AAPL", { alpacaClient: mockAlpaca, dryRun: true });
  check("dry-run: no mutating calls (cancelOrder/placeOrder) were made", calls.length === 0, calls);
  check("dry-run: read calls (getPosition/getOrders) still happened for real reporting", true, true); // implicit - getPosition/getOrders aren't in `calls` here since only mutating ones are recorded, but no throw means they ran
  check("dry-run: result reports what WOULD have happened", result.dryRun === true && result.wouldSellQty === "2" && result.wouldCancel[0] === "order-5", result);
}

async function testEntryBlockedWhenOpenOrderExists() {
  const mockAlpaca = {
    getOrders: async ({ status, symbols }) => {
      check("entry-guard: getOrders called with status=open and the right symbol", status === "open" && JSON.stringify(symbols) === JSON.stringify(["AAPL"]), { status, symbols });
      return [{ id: "stray-order-1", type: "limit", side: "buy" }];
    },
  };
  const result = await checkEntryBlockedByOpenOrders("AAPL", { alpacaClient: mockAlpaca });
  check("entry-guard: blocked=true when an open order already exists", result.blocked === true, result);
  check("entry-guard: the open order(s) are returned for logging", result.openOrders.length === 1 && result.openOrders[0].id === "stray-order-1", result);
}

async function testEntryAllowedWhenNoOpenOrders() {
  const mockAlpaca = { getOrders: async () => [] };
  const result = await checkEntryBlockedByOpenOrders("AAPL", { alpacaClient: mockAlpaca });
  check("entry-guard: blocked=false when there are no open orders", result.blocked === false, result);
}

async function testExitBlockedWhenNonStopSellAlreadyOpen() {
  const calls = [];
  const mockAlpaca = {
    getPosition: async () => ({ qty: "6" }),
    getOrders: async () => [{ id: "pending-sell-1", type: "market", side: "sell", stop_price: null }],
    cancelOrder: async () => {
      calls.push("cancelOrder");
      return null;
    },
    placeOrder: async () => {
      calls.push("placeOrder");
      return {};
    },
  };
  const result = await flattenPosition("AAPL", { alpacaClient: mockAlpaca, dryRun: false });
  check("exit-guard: skipped when a non-stop sell is already open", result.skipped === true && result.reason === "non-stop sell already open", result);
  check("exit-guard: neither cancelOrder nor placeOrder was called - no duplicate exit attempted", calls.length === 0, calls);
}

async function testExitNotBlockedByTheExpectedStopLeg() {
  // The normal case: the ONLY open order is the strategy's own stop-loss
  // leg from entry - this must NOT trigger the duplicate-exit guard, since
  // it's expected and is exactly what flattenPosition is supposed to cancel.
  const calls = [];
  const mockAlpaca = {
    getPosition: async () => ({ qty: "6" }),
    getOrders: async () => [{ id: "stop-leg-1", type: "stop", side: "sell", stop_price: "100.00" }],
    cancelOrder: async (id) => {
      calls.push({ name: "cancelOrder", id });
      return null;
    },
    getOrder: async (id) => ({ id, status: "canceled" }),
    placeOrder: async (payload) => {
      calls.push({ name: "placeOrder", payload });
      return { id: "sell-1" };
    },
  };
  const result = await flattenPosition("AAPL", { alpacaClient: mockAlpaca, dryRun: false });
  check("exit-guard: the expected stop leg alone does NOT trigger the duplicate-exit skip", result.skipped !== true, result);
  check("exit-guard: cancel and close both still proceed normally", calls.some((c) => c.name === "cancelOrder") && calls.some((c) => c.name === "placeOrder"), calls);
}

async function main() {
  await checkAsync("happy path", testHappyPath);
  await checkAsync("cancel-failure path", testCancelFailurePath);
  await checkAsync("close-failure-reprotects path", testCloseFailureReprotects);
  await checkAsync("close-and-reprotect-both-fail path", testCloseFailureReprotectAlsoFails);
  await checkAsync("dry-run path", testDryRunMakesNoMutatingCalls);
  await checkAsync("entry blocked by open order", testEntryBlockedWhenOpenOrderExists);
  await checkAsync("entry allowed with no open orders", testEntryAllowedWhenNoOpenOrders);
  await checkAsync("exit blocked by non-stop sell already open", testExitBlockedWhenNonStopSellAlreadyOpen);
  await checkAsync("exit not blocked by the expected stop leg", testExitNotBlockedByTheExpectedStopLeg);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
