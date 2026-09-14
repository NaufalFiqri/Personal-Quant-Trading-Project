const { detectInsiderClusters, insiderClusterStrategy } = require("./strategy");

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

function makeBars(dates) {
  return dates.map((date) => ({ date, open: 100, high: 101, close: 100, low: 99, volume: 1000 }));
}

function tx(insider, date) {
  return { insider, date, shares: "1000", price: "50.00", accession: `acc-${insider}-${date}` };
}

// --- detectInsiderClusters: pure cluster-detection logic --------------------

// --- Case: two distinct insiders within the window -> one cluster trigger --
const twoInsiders = [tx("Alice", "2023-01-05"), tx("Bob", "2023-01-20")];
const twoInsidersTriggers = detectInsiderClusters(twoInsiders, { clusterWindowDays: 30 });
check(
  "two distinct insiders within 30 days fires exactly one cluster",
  twoInsidersTriggers.length === 1 && twoInsidersTriggers[0].date === "2023-01-20",
  twoInsidersTriggers
);
check(
  "cluster trigger records both distinct insiders",
  twoInsidersTriggers[0] && twoInsidersTriggers[0].insiders.sort().join(",") === "Alice,Bob",
  twoInsidersTriggers
);

// --- Case: same insider filing twice does NOT count as two ------------------
const sameInsiderTwice = [tx("Alice", "2023-01-05"), tx("Alice", "2023-01-20")];
const sameInsiderTriggers = detectInsiderClusters(sameInsiderTwice, { clusterWindowDays: 30 });
check(
  "same insider filing twice does not fire a cluster",
  sameInsiderTriggers.length === 0,
  sameInsiderTriggers
);

// --- Case: window boundary - exactly 30 days apart clusters, 31 does not ---
const exactlyThirty = [tx("Alice", "2023-01-01"), tx("Bob", "2023-01-31")]; // 30 days apart
const exactlyThirtyTriggers = detectInsiderClusters(exactlyThirty, { clusterWindowDays: 30 });
check(
  "boundary: exactly 30 days apart counts as within the window",
  exactlyThirtyTriggers.length === 1,
  exactlyThirtyTriggers
);

const thirtyOne = [tx("Alice", "2023-01-01"), tx("Bob", "2023-02-01")]; // 31 days apart
const thirtyOneTriggers = detectInsiderClusters(thirtyOne, { clusterWindowDays: 30 });
check(
  "boundary: 31 days apart does NOT count as within the window",
  thirtyOneTriggers.length === 0,
  thirtyOneTriggers
);

// --- Case: "fires once" - a third insider joining an existing cluster's ----
// window does not re-trigger a second cluster while the condition stays true.
const threeInsiders = [tx("Alice", "2023-01-01"), tx("Bob", "2023-01-10"), tx("Carol", "2023-01-15")];
const threeInsidersTriggers = detectInsiderClusters(threeInsiders, { clusterWindowDays: 30 });
check(
  "fires once: a third insider joining an already-triggered cluster does not re-trigger",
  threeInsidersTriggers.length === 1 && threeInsidersTriggers[0].date === "2023-01-10",
  threeInsidersTriggers
);

// --- Case: cluster resets after the window empties, then can re-trigger ----
const resetAndRetrigger = [
  tx("Alice", "2023-01-01"),
  tx("Bob", "2023-01-10"), // cluster #1 triggers here
  tx("Carol", "2023-06-01"), // window long since emptied
  tx("Dave", "2023-06-15"), // cluster #2 triggers here
];
const resetTriggers = detectInsiderClusters(resetAndRetrigger, { clusterWindowDays: 30 });
check(
  "a cluster can re-trigger later once the window has emptied and refilled",
  resetTriggers.length === 2 && resetTriggers[0].date === "2023-01-10" && resetTriggers[1].date === "2023-06-15",
  resetTriggers
);

// --- insiderClusterStrategy: entry/exit on real bars ------------------------

// --- Case: BUY fires on the trigger date when it's a trading day -----------
const simpleBars = makeBars(["2023-01-18", "2023-01-19", "2023-01-20", "2023-01-21", "2023-01-22"]);
const simpleSignals = insiderClusterStrategy(simpleBars, {
  pTransactions: [tx("Alice", "2023-01-05"), tx("Bob", "2023-01-20")],
  clusterWindowDays: 30,
  exitTradingDays: 3,
});
check(
  "BUY fires on the trigger date itself when it's a trading day",
  simpleSignals[0] && simpleSignals[0].action === "BUY" && simpleSignals[0].date === "2023-01-20",
  simpleSignals
);

// --- Case: exit fires exactly at exitTradingDays bars held ------------------
// Entry at 2023-01-20 (bar index 2). exitTradingDays=3 means SELL on the 3rd
// bar held, i.e. bar index 5 (2023-01-25).
const exitBars = makeBars([
  "2023-01-18", "2023-01-19", "2023-01-20", "2023-01-23", "2023-01-24", "2023-01-25", "2023-01-26",
]);
const exitSignals = insiderClusterStrategy(exitBars, {
  pTransactions: [tx("Alice", "2023-01-05"), tx("Bob", "2023-01-20")],
  clusterWindowDays: 30,
  exitTradingDays: 3,
});
check(
  "exit fires exactly at exitTradingDays bars held, not before",
  exitSignals.length === 2 &&
    exitSignals[0].action === "BUY" &&
    exitSignals[0].date === "2023-01-20" &&
    exitSignals[1].action === "SELL" &&
    exitSignals[1].date === "2023-01-25",
  exitSignals
);

// --- Case: a filing date on a non-trading day (weekend) maps to the next ---
// available bar. 2023-01-21 and 2023-01-22 are a Sat/Sun - no bar exists for
// them, so the cluster trigger (dated 2023-01-21, a Saturday) should fire on
// the next real bar, 2023-01-23.
const weekendBars = makeBars(["2023-01-18", "2023-01-19", "2023-01-20", "2023-01-23", "2023-01-24"]);
const weekendSignals = insiderClusterStrategy(weekendBars, {
  pTransactions: [tx("Alice", "2023-01-05"), tx("Bob", "2023-01-21")], // trigger date is a Saturday
  clusterWindowDays: 30,
  exitTradingDays: 10,
});
check(
  "a trigger dated on a non-trading day maps forward to the next available bar",
  weekendSignals[0] && weekendSignals[0].action === "BUY" && weekendSignals[0].date === "2023-01-23",
  weekendSignals
);

// --- Case: a second, genuinely separate cluster that triggers while still --
// holding the first position is ignored entirely - not acted on when it
// occurs, and not banked to fire right after the position eventually closes.
// Cluster #1 (Alice/Bob) triggers 2023-01-10. Cluster #2 (Carol/Dave) is a
// fully independent pair - by 2023-03-05, Alice/Bob have long aged out of
// the 30-day window, so this is a real second detectInsiderClusters trigger,
// not a continuation of the first. exitTradingDays=60 keeps the position
// open through cluster #2's date, so this exercises the strategy's own
// while-in-position guard, not detectInsiderClusters' own "fires once" rule
// (already covered above).
function consecutiveDates(startDate, count) {
  const dates = [];
  const d = new Date(startDate);
  for (let i = 0; i < count; i++) {
    dates.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}
const ignoredBars = makeBars(consecutiveDates("2023-01-10", 120));
const ignoredPTransactions = [
  tx("Alice", "2023-01-01"),
  tx("Bob", "2023-01-10"), // cluster #1 triggers 2023-01-10
  tx("Carol", "2023-02-20"),
  tx("Dave", "2023-03-05"), // cluster #2 triggers 2023-03-05 - a real, independent second cluster
];
check(
  "sanity: cluster #2 is a genuine independent trigger, not a continuation of #1",
  (() => {
    const triggers = detectInsiderClusters(ignoredPTransactions, { clusterWindowDays: 30 });
    return triggers.length === 2 && triggers[0].date === "2023-01-10" && triggers[1].date === "2023-03-05";
  })(),
  detectInsiderClusters(ignoredPTransactions, { clusterWindowDays: 30 })
);
const ignoredSignals = insiderClusterStrategy(ignoredBars, {
  pTransactions: ignoredPTransactions,
  clusterWindowDays: 30,
  exitTradingDays: 60, // still holding on 2023-03-05 (54 bars after entry), so cluster #2 lands mid-hold
});
check(
  "a second, independent cluster that fires while still in a position is ignored: exactly one BUY/SELL pair, SELL at bar 60, no second BUY ever",
  ignoredSignals.length === 2 &&
    ignoredSignals[0].action === "BUY" &&
    ignoredSignals[0].date === "2023-01-10" &&
    ignoredSignals[1].action === "SELL" &&
    ignoredSignals[1].date === "2023-03-11", // 60 calendar days after 2023-01-10 in this all-days-are-bars synthetic calendar
  ignoredSignals
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
