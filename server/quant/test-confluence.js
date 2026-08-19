const { confluenceBreakoutStrategy, volumeBreakoutStrategy } = require("./strategy");
const { calculateRegime } = require("./regime");

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

function makeBars(rows) {
  return rows.map((row, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    ...row,
  }));
}

// --- Case 1: all three conditions true -> BUY fires -------------------------

// maPeriod=breakoutPeriod=volumePeriod=5 (shrunk from the real 200/20/20
// defaults purely to keep hand-constructed bars small, same practice
// test-regime.js used for maPeriod). 5 flat warmup bars, then a breakout bar
// that clears the rolling high AND the volume threshold. Because breakout
// and trend share the same 5-bar window length here, the breakout bar's own
// close is guaranteed to sit above its own trailing MA too (proven in
// PHASE2_CONFLUENCE_SCOPING.md's implementation notes: with flat prior
// values, a same-window-length MA can never exceed the very value that just
// broke out above the whole window's prior max) - so this case only needs
// the breakout+volume condition to be genuine.
const allThreeParams = { maPeriod: 5, breakoutPeriod: 5, volumePeriod: 5, volumeMultiplier: 1.5, exitPeriod: 3 };
const allThreeBars = makeBars([
  ...Array.from({ length: 5 }, () => ({ high: 100, low: 95, close: 98, volume: 1000 })),
  { high: 106, low: 104, close: 105, volume: 2000 }, // index 5: breakout + volume + (as a side effect) favorable trend
]);
const allThreeRegime = calculateRegime(allThreeBars, { maPeriod: allThreeParams.maPeriod });
const allThreeSignals = confluenceBreakoutStrategy(allThreeBars, allThreeParams);
console.log("Case 1 - all three true - regime at test bar:", allThreeRegime[5]);
console.log("Case 1 - all three true - confluence signals:", allThreeSignals);
check(
  "all three conditions true: BUY fires on the breakout bar",
  allThreeRegime[5].favorable === true &&
    allThreeSignals.length === 1 &&
    allThreeSignals[0].action === "BUY" &&
    allThreeSignals[0].date === allThreeBars[5].date,
  { regime: allThreeRegime[5], signals: allThreeSignals }
);

// --- Case 2: breakout + volume true, but trend unfavorable -> blocked -------

// maPeriod (10) deliberately longer than breakoutPeriod/volumePeriod (5),
// matching the real 200-vs-20 relationship - §1 of the scoping doc explains
// why case 1's "same window length" setup can't produce this case at all
// (the math forces the regime favorable whenever breakout period == MA
// period). Bars: index 0 is filler (falls outside the 10-bar MA window,
// which is indices 1-10); indices 1-4 sit at an elevated close (198) that's
// still inside the MA(10) window at the test bar but *outside* the 5-bar
// breakout/volume window; indices 5-9 are a low, quiet plateau (close 98)
// that defines an easy-to-clear rolling high of 100. The test bar (index
// 10) breaks that low plateau's high with confirming volume - satisfying
// volumeBreakoutStrategy on its own - while the longer trailing MA is still
// pulled up by the untouched elevated closes from indices 1-4, keeping the
// regime unfavorable.
const trendBlockParams = { maPeriod: 10, breakoutPeriod: 5, volumePeriod: 5, volumeMultiplier: 1.5, exitPeriod: 3 };
const trendBlockBars = makeBars([
  { high: 200, low: 195, close: 198, volume: 1000 }, // index 0: filler, outside the MA(10) window at index 10
  ...Array.from({ length: 4 }, () => ({ high: 200, low: 195, close: 198, volume: 1000 })), // indices 1-4: elevated, inside MA(10) window
  ...Array.from({ length: 5 }, () => ({ high: 100, low: 95, close: 98, volume: 1000 })), // indices 5-9: low plateau, defines the breakout/volume window
  { high: 106, low: 104, close: 105, volume: 2000 }, // index 10: breaks the low plateau + volume-confirmed
]);
const trendBlockRegime = calculateRegime(trendBlockBars, { maPeriod: trendBlockParams.maPeriod });
const trendBlockConfluenceSignals = confluenceBreakoutStrategy(trendBlockBars, trendBlockParams);
const trendBlockBreakoutAloneSignals = volumeBreakoutStrategy(trendBlockBars, {
  breakoutPeriod: trendBlockParams.breakoutPeriod,
  volumePeriod: trendBlockParams.volumePeriod,
  volumeMultiplier: trendBlockParams.volumeMultiplier,
  exitPeriod: trendBlockParams.exitPeriod,
});
console.log("\nCase 2 - trend unfavorable - regime at test bar:", trendBlockRegime[10]);
console.log("Case 2 - trend unfavorable - volumeBreakoutStrategy alone (breakout+volume, no trend gate):", trendBlockBreakoutAloneSignals);
console.log("Case 2 - trend unfavorable - confluenceBreakoutStrategy:", trendBlockConfluenceSignals);
check(
  "breakout+volume alone (no trend gate) DOES fire - confirms the setup is a genuine breakout+volume signal",
  trendBlockBreakoutAloneSignals.length === 1 && trendBlockBreakoutAloneSignals[0].action === "BUY",
  trendBlockBreakoutAloneSignals
);
check(
  "trend unfavorable at the same bar",
  trendBlockRegime[10].favorable === false,
  trendBlockRegime[10]
);
check(
  "confluence strategy blocks it: unfavorable trend overrides a valid breakout+volume signal",
  trendBlockConfluenceSignals.length === 0,
  trendBlockConfluenceSignals
);

// --- Case 3: trend favorable, but breakout/volume fails -> blocked ----------

// Same bars/params as case 1 (trend favorable is already confirmed there),
// except the test bar's volume stays at the quiet-bar level instead of
// spiking - price still clears the rolling high (a genuine breakout in
// price terms alone), but volume confirmation fails.
const volumeFailBars = makeBars([
  ...Array.from({ length: 5 }, () => ({ high: 100, low: 95, close: 98, volume: 1000 })),
  { high: 106, low: 104, close: 105, volume: 1000 }, // index 5: price breaks out, volume does NOT confirm
]);
const volumeFailRegime = calculateRegime(volumeFailBars, { maPeriod: allThreeParams.maPeriod });
const volumeFailSignals = confluenceBreakoutStrategy(volumeFailBars, allThreeParams);
console.log("\nCase 3 - volume fails - regime at test bar:", volumeFailRegime[5]);
console.log("Case 3 - volume fails - confluence signals:", volumeFailSignals);
check(
  "trend favorable at the test bar (price breakout alone is enough to pull this same-window MA above itself, per case 1's note)",
  volumeFailRegime[5].favorable === true,
  volumeFailRegime[5]
);
check(
  "confluence strategy blocks it: favorable trend does not override a failed breakout+volume AND",
  volumeFailSignals.length === 0,
  volumeFailSignals
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
