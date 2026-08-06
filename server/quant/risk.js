// Standalone risk-management logic: position sizing, stop-loss calculation,
// risk/reward validation, and a drawdown circuit breaker. Long-only, not
// tied to any specific strategy - consumes plain numbers/equity curves so it
// can sit underneath a backtested strategy today and a live paper-trading
// loop later without changing shape.

const STOP_LOSS_METHODS = ["percent", "atr"];

function calculatePositionSize({
  accountEquity,
  riskPercent = 1,
  entryPrice,
  stopLossPrice,
  maxPositionPercent = null,
} = {}) {
  const riskPerShare = entryPrice - stopLossPrice;
  if (riskPerShare <= 0) {
    throw new Error(
      `Invalid stopLossPrice (${stopLossPrice}): must be below entryPrice (${entryPrice}) for a long position`
    );
  }

  const dollarRisk = accountEquity * (riskPercent / 100);
  let shares = dollarRisk / riskPerShare;
  let positionValue = shares * entryPrice;
  let cappedByMaxPosition = false;

  if (maxPositionPercent != null) {
    const maxPositionValue = accountEquity * (maxPositionPercent / 100);
    if (positionValue > maxPositionValue) {
      shares = maxPositionValue / entryPrice;
      positionValue = shares * entryPrice;
      cappedByMaxPosition = true;
    }
  }

  return {
    shares,
    dollarRisk,
    positionValue,
    positionPercent: (positionValue / accountEquity) * 100,
    riskPerShare,
    cappedByMaxPosition,
  };
}

function calculateStopLoss({
  entryPrice,
  method = "percent",
  percent,
  atr,
  atrMultiplier = 2,
} = {}) {
  if (!STOP_LOSS_METHODS.includes(method)) {
    throw new Error(`Unknown stop-loss method "${method}": must be one of ${STOP_LOSS_METHODS.join(", ")}`);
  }

  if (method === "percent") {
    if (percent == null) throw new Error('"percent" is required when method is "percent"');
    return entryPrice * (1 - percent / 100);
  }

  if (atr == null) throw new Error('"atr" is required when method is "atr"');
  return entryPrice - atr * atrMultiplier;
}

function validateRiskReward({
  entryPrice,
  stopLossPrice,
  takeProfitPrice,
  minRRRatio = 1.5,
} = {}) {
  const riskAmount = entryPrice - stopLossPrice;
  const rewardAmount = takeProfitPrice - entryPrice;
  const ratio = riskAmount > 0 ? rewardAmount / riskAmount : 0;

  return {
    valid: riskAmount > 0 && ratio >= minRRRatio,
    ratio,
    riskAmount,
    rewardAmount,
  };
}

function checkDrawdownCircuitBreaker(
  equityCurve,
  { maxDailyLossPercent = 3, maxWeeklyLossPercent = 6, weeklyLookbackBars = 5 } = {}
) {
  const last = equityCurve.length - 1;

  let dailyLossPercent = 0;
  if (last >= 1) {
    const prev = equityCurve[last - 1].value;
    const curr = equityCurve[last].value;
    dailyLossPercent = ((prev - curr) / prev) * 100;
  }

  let weeklyLossPercent = 0;
  if (last >= weeklyLookbackBars) {
    const prev = equityCurve[last - weeklyLookbackBars].value;
    const curr = equityCurve[last].value;
    weeklyLossPercent = ((prev - curr) / prev) * 100;
  }

  let halted = false;
  let reason = null;
  if (dailyLossPercent >= maxDailyLossPercent) {
    halted = true;
    reason = "daily-loss-limit";
  } else if (weeklyLossPercent >= maxWeeklyLossPercent) {
    halted = true;
    reason = "weekly-loss-limit";
  }

  return { halted, reason, dailyLossPercent, weeklyLossPercent };
}

module.exports = {
  calculatePositionSize,
  calculateStopLoss,
  validateRiskReward,
  checkDrawdownCircuitBreaker,
};
