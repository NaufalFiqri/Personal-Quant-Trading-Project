const { calculateSMA } = require("./indicators");
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

function barsFrom(closes) {
  return closes.map((close, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    close,
  }));
}

// --- Basic classification ---------------------------------------------------

// A strictly rising line: the current bar is always the largest value in its
// own trailing window, so its trailing SMA is always below it - favorable
// should be true for every bar once the window has warmed up.
const risingCloses = Array.from({ length: 20 }, (_, i) => 100 + i * 5);
const risingRegime = calculateRegime(barsFrom(risingCloses), { maPeriod: 5 });
console.log("Regime on a rising series (maPeriod 5), last value:", risingRegime[risingRegime.length - 1]);
check(
  "rising series: favorable is true for every warmed-up bar",
  risingRegime.slice(4).every((r) => r.favorable === true),
  risingRegime
);

// The mirror case: a strictly falling line keeps the current bar below its
// own trailing SMA the whole way - favorable should be false throughout.
const fallingCloses = Array.from({ length: 20 }, (_, i) => 200 - i * 5);
const fallingRegime = calculateRegime(barsFrom(fallingCloses), { maPeriod: 5 });
console.log("Regime on a falling series (maPeriod 5), last value:", fallingRegime[fallingRegime.length - 1]);
check(
  "falling series: favorable is false for every warmed-up bar",
  fallingRegime.slice(4).every((r) => r.favorable === false),
  fallingRegime
);

// --- Warm-up period ----------------------------------------------------------

// maPeriod 5: the first 4 bars can't produce a 5-bar average yet - favorable
// should be null there, same as indicators.js leaving early SMA values null.
const warmupRegime = calculateRegime(barsFrom(risingCloses), { maPeriod: 5 });
check(
  "warm-up: bars before the MA has enough data are null",
  warmupRegime.slice(0, 4).every((r) => r.favorable === null),
  warmupRegime.slice(0, 4)
);
check(
  "warm-up: the bar where the MA first has enough data is a real boolean",
  typeof warmupRegime[4].favorable === "boolean",
  warmupRegime[4]
);

// Same check at the actual default (maPeriod 200, unspecified) - a 200-period
// MA needs 200 bars of history, so index 198 (the 199th bar) should still be
// null and index 199 (the 200th bar) should be the first real classification.
const longSeries = Array.from({ length: 250 }, (_, i) => 100 + Math.sin(i / 10) * 5);
const defaultRegime = calculateRegime(barsFrom(longSeries));
check("default maPeriod (200): bar 199 (index 198) is still null", defaultRegime[198].favorable === null, defaultRegime[198]);
check(
  "default maPeriod (200): bar 200 (index 199) is a real boolean",
  typeof defaultRegime[199].favorable === "boolean",
  defaultRegime[199]
);

// --- Boundary: price exactly at the MA line ----------------------------------

// Three flat bars at the same price: the trailing SMA at the last bar equals
// that bar's own close exactly - a deliberate tie, not close-but-not-quite.
const flatRegime = calculateRegime(barsFrom([100, 100, 100]), { maPeriod: 3 });
console.log("Regime on 3 flat bars (maPeriod 3, close == MA exactly):", flatRegime[2]);
check("boundary: a tie (close === MA) counts as unfavorable, not favorable", flatRegime[2].favorable === false, flatRegime[2]);

// --- Crossing back and forth --------------------------------------------------

// Flat, then a jump above, then a return to flat at the new jumped-to level
// (which re-creates a tie), then a drop below. Classification is expected to
// track close vs. that bar's own MA independently at every bar - including
// index 5, where the price is still "up" from the jump but has caught back
// up to its own trailing average and ties again, not because it went down.
const crossingCloses = [10, 10, 10, 40, 40, 40, 5, 5, 5];
const crossingBars = barsFrom(crossingCloses);
const crossingRegime = calculateRegime(crossingBars, { maPeriod: 3 });
const crossingMA = calculateSMA(crossingCloses, 3);

console.log("Regime on a crossing series (maPeriod 3):", crossingRegime.map((r) => r.favorable));
check(
  "crossing series: every warmed-up bar matches close > MA at that same bar",
  crossingRegime.slice(2).every((r, i) => {
    const idx = i + 2;
    return r.favorable === (crossingCloses[idx] > crossingMA[idx]);
  }),
  crossingRegime
);
check("crossing series: index 2 (tie, first flat run) is unfavorable", crossingRegime[2].favorable === false, crossingRegime[2]);
check("crossing series: index 3 (just jumped above) is favorable", crossingRegime[3].favorable === true, crossingRegime[3]);
check(
  "crossing series: index 5 (price caught back up to its own MA, ties again) is unfavorable",
  crossingRegime[5].favorable === false,
  crossingRegime[5]
);
check("crossing series: index 6 (just dropped below) is unfavorable", crossingRegime[6].favorable === false, crossingRegime[6]);

// --- Output shape --------------------------------------------------------------

check(
  "output: one entry per input bar, dates passed through unchanged",
  crossingRegime.length === crossingBars.length && crossingRegime.every((r, i) => r.date === crossingBars[i].date),
  crossingRegime.map((r) => r.date)
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
