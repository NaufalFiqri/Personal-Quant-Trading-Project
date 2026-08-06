const {
  calculatePositionSize,
  calculateStopLoss,
  validateRiskReward,
  checkDrawdownCircuitBreaker,
} = require("./risk");

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

function throws(fn) {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

function closeTo(a, b, tolerance = 1e-9) {
  return Math.abs(a - b) < tolerance;
}

// --- calculatePositionSize -------------------------------------------------

// $10,000 account, 1% risk, entry $50 with a $2 stop distance -> risk
// $100 total, so 50 shares ($2,500 position).
const sizeResult = calculatePositionSize({
  accountEquity: 10000,
  riskPercent: 1,
  entryPrice: 50,
  stopLossPrice: 48,
});
console.log("calculatePositionSize (1% risk, $2 stop distance):", sizeResult);
check("position size: dollarRisk is 1% of equity", closeTo(sizeResult.dollarRisk, 100), sizeResult);
check("position size: shares = dollarRisk / riskPerShare", closeTo(sizeResult.shares, 50), sizeResult);
check("position size: positionValue = shares * entryPrice", closeTo(sizeResult.positionValue, 2500), sizeResult);
check("position size: not capped when no maxPositionPercent set", !sizeResult.cappedByMaxPosition, sizeResult);

// Tight stop (10 cents) at 2% risk would size a position worth 10x equity -
// maxPositionPercent should cap it back down to a sane size instead.
const cappedResult = calculatePositionSize({
  accountEquity: 10000,
  riskPercent: 2,
  entryPrice: 50,
  stopLossPrice: 49.9,
  maxPositionPercent: 20,
});
console.log("calculatePositionSize (tight stop, capped by maxPositionPercent):", cappedResult);
check("position size: capped position value <= 20% of equity", cappedResult.positionValue <= 2000 + 1e-6, cappedResult);
check("position size: cappedByMaxPosition flag set", cappedResult.cappedByMaxPosition === true, cappedResult);

// A stop at or above entry price is not a valid long stop-loss.
check(
  "position size: throws when stopLossPrice >= entryPrice",
  throws(() => calculatePositionSize({ accountEquity: 10000, entryPrice: 50, stopLossPrice: 50 })),
  null
);

// --- calculateStopLoss ------------------------------------------------------

const percentStop = calculateStopLoss({ entryPrice: 100, method: "percent", percent: 2 });
console.log("calculateStopLoss (2% method) on entry 100:", percentStop);
check("percent stop-loss: 100 with 2% -> 98", closeTo(percentStop, 98), percentStop);

const atrStop = calculateStopLoss({ entryPrice: 100, method: "atr", atr: 2.5, atrMultiplier: 2 });
console.log("calculateStopLoss (ATR method) on entry 100, ATR 2.5, x2:", atrStop);
check("ATR stop-loss: 100 - (2.5 * 2) -> 95", closeTo(atrStop, 95), atrStop);

check(
  "stop-loss: throws on unknown method",
  throws(() => calculateStopLoss({ entryPrice: 100, method: "trailing" })),
  null
);
check(
  "stop-loss: throws when percent missing for percent method",
  throws(() => calculateStopLoss({ entryPrice: 100, method: "percent" })),
  null
);
check(
  "stop-loss: throws when atr missing for atr method",
  throws(() => calculateStopLoss({ entryPrice: 100, method: "atr" })),
  null
);

// --- validateRiskReward ------------------------------------------------------

const goodRR = validateRiskReward({ entryPrice: 100, stopLossPrice: 95, takeProfitPrice: 110, minRRRatio: 1.5 });
console.log("validateRiskReward (risk 5, reward 10):", goodRR);
check("R:R: ratio is 2 (10 reward / 5 risk)", closeTo(goodRR.ratio, 2), goodRR);
check("R:R: valid when ratio >= minRRRatio", goodRR.valid === true, goodRR);

const badRR = validateRiskReward({ entryPrice: 100, stopLossPrice: 95, takeProfitPrice: 102, minRRRatio: 1.5 });
console.log("validateRiskReward (risk 5, reward 2):", badRR);
check("R:R: ratio is 0.4 (2 reward / 5 risk)", closeTo(badRR.ratio, 0.4), badRR);
check("R:R: invalid when ratio < minRRRatio", badRR.valid === false, badRR);

const strictRR = validateRiskReward({ entryPrice: 100, stopLossPrice: 95, takeProfitPrice: 110, minRRRatio: 3 });
console.log("validateRiskReward (same trade, stricter minRRRatio of 3):", strictRR);
check("R:R: same 2:1 trade rejected against a 3:1 minimum", strictRR.valid === false, strictRR);

// --- checkDrawdownCircuitBreaker --------------------------------------------

function equityCurveFrom(values) {
  return values.map((value, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, value }));
}

// Steady, mild day-to-day moves - nothing should trip either threshold.
const calmCurve = equityCurveFrom([10000, 10050, 10020, 10080, 10060, 10100]);
const calmResult = checkDrawdownCircuitBreaker(calmCurve, { maxDailyLossPercent: 3, maxWeeklyLossPercent: 6 });
console.log("checkDrawdownCircuitBreaker (calm equity curve):", calmResult);
check("circuit breaker: not halted on calm equity curve", calmResult.halted === false, calmResult);

// A single day drops 5%, above the 3% daily threshold.
const dailyCrashCurve = equityCurveFrom([10000, 10050, 10020, 9519]);
const dailyCrashResult = checkDrawdownCircuitBreaker(dailyCrashCurve, {
  maxDailyLossPercent: 3,
  maxWeeklyLossPercent: 6,
});
console.log("checkDrawdownCircuitBreaker (single-day 5% drop):", dailyCrashResult);
check("circuit breaker: halted on daily loss breach", dailyCrashResult.halted === true, dailyCrashResult);
check(
  "circuit breaker: reason is daily-loss-limit",
  dailyCrashResult.reason === "daily-loss-limit",
  dailyCrashResult
);

// Grinds down 2.5%/day for 5 trading days - no single day trips the 3% daily
// limit, but the cumulative move over the week breaches the 6% weekly limit.
const weeklyGrindCurve = equityCurveFrom([10000, 9750, 9506.25, 9268.59, 9036.98, 8811.05]);
const weeklyGrindResult = checkDrawdownCircuitBreaker(weeklyGrindCurve, {
  maxDailyLossPercent: 3,
  maxWeeklyLossPercent: 6,
  weeklyLookbackBars: 5,
});
console.log("checkDrawdownCircuitBreaker (gradual 5-day grind down):", weeklyGrindResult);
check("circuit breaker: halted on weekly loss breach", weeklyGrindResult.halted === true, weeklyGrindResult);
check(
  "circuit breaker: reason is weekly-loss-limit",
  weeklyGrindResult.reason === "weekly-loss-limit",
  weeklyGrindResult
);

// A rising equity curve should never halt, regardless of thresholds.
const risingCurve = equityCurveFrom([10000, 10100, 10250, 10400, 10600, 10900]);
const risingResult = checkDrawdownCircuitBreaker(risingCurve, { maxDailyLossPercent: 3, maxWeeklyLossPercent: 6 });
console.log("checkDrawdownCircuitBreaker (rising equity curve):", risingResult);
check("circuit breaker: never halts on a rising equity curve", risingResult.halted === false, risingResult);

// Fewer bars than weeklyLookbackBars shouldn't throw or falsely trip the
// weekly check - it just has no weekly comparison point yet.
const shortCurve = equityCurveFrom([10000, 9600]);
const shortResult = checkDrawdownCircuitBreaker(shortCurve, { maxDailyLossPercent: 3, maxWeeklyLossPercent: 6 });
console.log("checkDrawdownCircuitBreaker (curve shorter than weeklyLookbackBars):", shortResult);
check(
  "circuit breaker: halts on the daily breach even with too little history for a weekly check",
  shortResult.halted === true && shortResult.reason === "daily-loss-limit",
  shortResult
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
