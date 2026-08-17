const { volumeBreakoutStrategy } = require("./strategy");

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

// 20 quiet, unremarkable bars - just enough history to warm up a 20-period
// breakoutPeriod/volumePeriod (default params). Used as a shared prefix so
// each scenario below only has to vary the bar that comes after it.
function quietBars() {
  return Array.from({ length: 20 }, () => ({ high: 100, low: 95, close: 98, volume: 1000 }));
}

// --- Warm-up: no signal is even evaluable before day 20 --------------------

const warmupOnly = makeBars(quietBars());
const warmupSignals = volumeBreakoutStrategy(warmupOnly);
console.log("Signals from 20 quiet bars alone (no day 20 to evaluate yet):", warmupSignals);
check("warm-up: no signal possible with fewer than breakoutPeriod+1 bars", warmupSignals.length === 0, warmupSignals);

// --- Breakout + volume confirmed -> BUY fires -------------------------------

// rollingHigh(20) after the quiet prefix is 100; rollingAvgVolume(20)
// including today's own bar is (19*1000 + 2000)/20 = 1050. close=105 clears
// 100, volume=2000 clears 1.5*1050=1575 - both conditions true.
const breakoutConfirmed = makeBars([...quietBars(), { high: 106, low: 104, close: 105, volume: 2000 }]);
const confirmedSignals = volumeBreakoutStrategy(breakoutConfirmed);
console.log("\nBreakout + volume confirmed:", confirmedSignals);
check(
  "breakout + volume confirmed: BUY fires on day 20 (index 20), not earlier",
  confirmedSignals.length === 1 && confirmedSignals[0].action === "BUY" && confirmedSignals[0].date === breakoutConfirmed[20].date,
  confirmedSignals
);

// breakoutMarginPercent = (105-100)/100*100 = 5; volumeRatio = 2000 / (1050*1.5) = 2000/1575
check(
  "breakout metadata: breakoutMarginPercent and volumeRatio match hand-computed values",
  Math.abs(confirmedSignals[0].breakoutMarginPercent - 5) < 1e-9 &&
    Math.abs(confirmedSignals[0].volumeRatio - 2000 / 1575) < 1e-9,
  confirmedSignals[0]
);

// --- Breakout WITHOUT volume confirmation -> must NOT fire (tests the AND) -

// Same price breakout (close=105 > rollingHigh 100), but volume stays at the
// quiet-bar level (1000) - well under 1.5x its own now-unchanged average
// (1000). Price alone is not enough.
const breakoutNoVolume = makeBars([...quietBars(), { high: 106, low: 104, close: 105, volume: 1000 }]);
const noVolumeSignals = volumeBreakoutStrategy(breakoutNoVolume);
console.log("\nBreakout WITHOUT volume confirmation:", noVolumeSignals);
check("breakout without volume confirmation does NOT fire a BUY", noVolumeSignals.length === 0, noVolumeSignals);

// --- Volume spike WITHOUT a price breakout -> must NOT fire (tests the AND) -

// close=99 stays under rollingHigh 100 (no breakout), even though volume
// (5000) is a large spike relative to its own average. Volume alone is not
// enough either.
const volumeNoBreakout = makeBars([...quietBars(), { high: 100, low: 97, close: 99, volume: 5000 }]);
const noBreakoutSignals = volumeBreakoutStrategy(volumeNoBreakout);
console.log("\nVolume spike WITHOUT a price breakout:", noBreakoutSignals);
check("volume spike without a price breakout does NOT fire a BUY", noBreakoutSignals.length === 0, noBreakoutSignals);

// --- Boundary: a tie against yesterday's rolling high is NOT a breakout ----

// close lands exactly on rollingHigh(20) = 100 - strict ">" required, so a
// tie doesn't count, same precedent regime.js set for its own tie case.
const tieBar = makeBars([...quietBars(), { high: 100, low: 97, close: 100, volume: 2000 }]);
const tieSignals = volumeBreakoutStrategy(tieBar);
console.log("\nClose exactly ties the rolling high (100 == 100):", tieSignals);
check("a tie against the rolling high does not count as a breakout", tieSignals.length === 0, tieSignals);

// --- Exit: SELL fires when close falls below the trailing 10-day low -------

// Continues past the confirmed breakout (day 20) with 10 flat bars (low=103)
// to fully establish a fresh rollingLow(10) once the old quiet-bar lows (95)
// age out of the 10-bar window, then a bar that closes below it.
const exitScenario = makeBars([
  ...quietBars(),
  { high: 106, low: 104, close: 105, volume: 2000 }, // day 20: BUY
  ...Array.from({ length: 9 }, () => ({ high: 106, low: 103, close: 105, volume: 1000 })), // days 21-29
  { high: 106, low: 103, close: 105, volume: 1000 }, // day 30
  { high: 103, low: 101, close: 102, volume: 1000 }, // day 31: closes below the 103 floor
]);
const exitSignals = volumeBreakoutStrategy(exitScenario);
console.log("\nExit scenario signals:", exitSignals);
check(
  "exit: exactly one BUY followed by one SELL, SELL on the day price breaks the 10-day low",
  exitSignals.length === 2 &&
    exitSignals[0].action === "BUY" &&
    exitSignals[1].action === "SELL" &&
    exitSignals[1].date === exitScenario[31].date,
  exitSignals
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
