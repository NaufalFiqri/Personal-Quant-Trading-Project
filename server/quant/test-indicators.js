const { calculateSMA, calculateEMA, calculateWMA, calculateRSI, calculateATR } = require("./indicators");

function arraysClose(a, b, tolerance = 1e-9) {
  if (a.length !== b.length) return false;
  return a.every((v, i) => {
    if (v === null || b[i] === null) return v === b[i];
    return Math.abs(v - b[i]) < tolerance;
  });
}

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

// SMA check
const smaResult = calculateSMA([10, 20, 30, 40, 50], 3);
console.log("SMA(3) on [10,20,30,40,50]:", smaResult);
check(
  "SMA(3) matches expected [null,null,20,30,40]",
  arraysClose(smaResult, [null, null, 20, 30, 40]),
  smaResult
);

// EMA/WMA reaction speed: a flat series that suddenly jumps. A moving
// average that "reacts faster" ends up numerically closer to the new
// price a few bars after the jump than a slower-reacting one does.
const flatThenJump = [
  ...Array(30).fill(100),
  ...Array(15).fill(150),
];
const period = 10;
const smaJump = calculateSMA(flatThenJump, period);
const emaJump = calculateEMA(flatThenJump, period);
const wmaJump = calculateWMA(flatThenJump, period);

// A few bars after the jump (index 33, i.e. 4 bars in), compare distance
// from the new price (150) — smaller distance = faster reaction.
const checkIndex = 33;
const smaDist = Math.abs(150 - smaJump[checkIndex]);
const emaDist = Math.abs(150 - emaJump[checkIndex]);
const wmaDist = Math.abs(150 - wmaJump[checkIndex]);

console.log(`\nAfter price jump 100->150, at index ${checkIndex}:`);
console.log(`  SMA: ${smaJump[checkIndex].toFixed(2)} (distance from 150: ${smaDist.toFixed(2)})`);
console.log(`  EMA: ${emaJump[checkIndex].toFixed(2)} (distance from 150: ${emaDist.toFixed(2)})`);
console.log(`  WMA: ${wmaJump[checkIndex].toFixed(2)} (distance from 150: ${wmaDist.toFixed(2)})`);

check("EMA reacts faster than SMA (closer to new price)", emaDist < smaDist, {
  emaDist,
  smaDist,
});
check("WMA reacts faster than SMA (closer to new price)", wmaDist < smaDist, {
  wmaDist,
  smaDist,
});
// Not asserted: EMA vs WMA ordering is not fixed. WMA's window is finite
// (period bars) so on a step change it fully converges to the new price
// after exactly `period` bars. EMA's window is infinite/asymptotic — it
// keeps a shrinking trace of every past value forever and never fully
// catches up. So immediately after a jump WMA can look "faster" than EMA,
// even though EMA weights the single most recent bar the same as WMA does
// here (both ~0.182 for period=10). Print both so this is visible instead
// of asserting an ordering that isn't actually guaranteed.
console.log(
  `  (EMA vs WMA ordering is data-dependent, not fixed: WMA converges fully after ${period} bars since it drops old data outright; EMA approaches asymptotically and never fully catches up)`
);

// Basic correctness checks against hand-computed values
const wmaResult = calculateWMA([10, 20, 30], 3);
// weights 1,2,3 on [10,20,30] -> (10*1 + 20*2 + 30*3) / 6 = 140/6
check(
  "WMA(3) on [10,20,30] matches expected [null,null,23.333]",
  arraysClose(wmaResult, [null, null, 140 / 6], 1e-6),
  wmaResult
);

const emaResult = calculateEMA([10, 20, 30, 40, 50], 3);
// seed = avg(10,20,30) = 20; k = 2/4 = 0.5
// ema[3] = 40*0.5 + 20*0.5 = 30; ema[4] = 50*0.5 + 30*0.5 = 40
check(
  "EMA(3) on [10,20,30,40,50] matches expected [null,null,20,30,40]",
  arraysClose(emaResult, [null, null, 20, 30, 40], 1e-9),
  emaResult
);

// RSI rising sequence
const rising = Array.from({ length: 30 }, (_, i) => 100 + i);
const rsiRising = calculateRSI(rising, 14);
const lastRising = rsiRising[rsiRising.length - 1];
console.log("RSI on rising sequence, last value:", lastRising);
check("RSI on rising sequence ends above 90", lastRising > 90, lastRising);

// RSI falling sequence
const falling = Array.from({ length: 30 }, (_, i) => 200 - i);
const rsiFalling = calculateRSI(falling, 14);
const lastFalling = rsiFalling[rsiFalling.length - 1];
console.log("RSI on falling sequence, last value:", lastFalling);
check("RSI on falling sequence ends below 10", lastFalling < 10, lastFalling);

// ATR check: hand-computed values on a series with a constant true range.
// high/low spread of 2 and close abutting the prior bar's high each day
// keeps TR = 2 on every bar after the first, so ATR should settle at
// exactly 2 once the warm-up period has passed.
const atrBars = [
  { high: 10, low: 8, close: 9 },
  { high: 11, low: 9, close: 10 },
  { high: 12, low: 10, close: 11 },
  { high: 13, low: 11, close: 12 },
  { high: 14, low: 12, close: 13 },
];
const atrResult = calculateATR(atrBars, 3);
console.log("ATR(3) on constant-true-range bars:", atrResult);
check(
  "ATR(3) matches expected [null,null,null,2,2]",
  arraysClose(atrResult, [null, null, null, 2, 2]),
  atrResult
);

// ATR reaction to a volatility spike: 20 quiet bars (small true range),
// one wide-range bar, then a few more quiet bars. ATR should be
// noticeably higher right after the spike than right before it.
const quietBars = Array.from({ length: 20 }, () => ({ high: 101, low: 99, close: 100 }));
const spikeBar = { high: 120, low: 90, close: 105 };
const postSpikeBars = Array.from({ length: 5 }, () => ({ high: 106, low: 104, close: 105 }));
const volatilityBars = [...quietBars, spikeBar, ...postSpikeBars];
const volatilityATR = calculateATR(volatilityBars, 14);

const atrBeforeSpike = volatilityATR[quietBars.length - 1];
const atrAfterSpike = volatilityATR[volatilityBars.length - 1];
console.log(`\nATR before spike: ${atrBeforeSpike.toFixed(2)}, after spike: ${atrAfterSpike.toFixed(2)}`);
check("ATR rises after a volatility spike", atrAfterSpike > atrBeforeSpike, {
  atrBeforeSpike,
  atrAfterSpike,
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
