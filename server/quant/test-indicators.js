const { calculateSMA, calculateRSI } = require("./indicators");

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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
