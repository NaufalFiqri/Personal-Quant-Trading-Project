const { calculatePositionSize, calculateStopLoss, checkDrawdownCircuitBreaker } = require("./risk");
const { calculateATR } = require("./indicators");

// Defaults for the risk-managed BUY/exit logic below - override any subset
// via options.riskConfig to tune between runs without touching this file.
// validateRiskReward from risk.js is intentionally not wired in here: it
// needs a takeProfitPrice, and none of the strategies in strategy.js emit
// one (they exit on a crossover/threshold signal, not a fixed target), so
// there's nothing real to validate it against without inventing one.
const DEFAULT_RISK_CONFIG = {
  riskPercent: 2, // % of account equity risked per trade
  stopLossMethod: "percent", // "percent" | "atr"
  stopLossPercent: 5, // used when stopLossMethod is "percent"
  atrPeriod: 14, // used when stopLossMethod is "atr"
  atrMultiplier: 2, // used when stopLossMethod is "atr"
  maxDailyLossPercent: 3,
  maxWeeklyLossPercent: 6,
  weeklyLookbackBars: 5,
};

function runBacktest(bars, signals, options = {}) {
  const {
    initialCapital = 10000,
    feePercent = 0.001,
    slippagePercent = 0.0005,
    riskConfig: riskConfigOverrides = {},
  } = options;
  const riskConfig = { ...DEFAULT_RISK_CONFIG, ...riskConfigOverrides };

  const signalByDate = new Map(signals.map((s) => [s.date, s]));

  // Only computed when needed - ATR requires OHLC and a warm-up period the
  // "percent" method doesn't.
  const atrValues = riskConfig.stopLossMethod === "atr" ? calculateATR(bars, riskConfig.atrPeriod) : null;

  let cash = initialCapital;
  let shares = 0;
  let stopLossPrice = null;

  const trades = [];
  const equityCurve = [];
  let barsHeld = 0;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const signal = signalByDate.get(bar.date);

    // Stop-loss: exit an open position the moment the bar's low breaches the
    // stop, before looking at any new signal for the day. Filled at the stop
    // price itself (a resting-stop-order assumption), adjusted for slippage
    // like every other exit below.
    if (shares > 0 && stopLossPrice != null && bar.low <= stopLossPrice) {
      const adjustedPrice = stopLossPrice * (1 - slippagePercent);
      const grossProceeds = shares * adjustedPrice;
      const fee = grossProceeds * feePercent;
      cash += grossProceeds - fee;

      console.log(
        `[backtest] ${bar.date}: stop-loss triggered at $${stopLossPrice.toFixed(2)} (bar low $${bar.low.toFixed(2)})`
      );

      trades.push({
        date: bar.date,
        action: "SELL",
        reason: "STOP_LOSS",
        price: adjustedPrice,
        shares: 0,
        fee,
        cashAfter: cash,
        sharesAfter: 0,
      });
      shares = 0;
      stopLossPrice = null;
    }

    if (signal && signal.action === "BUY" && shares === 0) {
      // Circuit breaker runs before every new entry, against the equity
      // curve built so far (i.e. strictly prior to today) - it only gates
      // opening new positions, not exits.
      const breaker = checkDrawdownCircuitBreaker(equityCurve, riskConfig);
      if (breaker.halted) {
        console.log(
          `[backtest] ${bar.date}: entry skipped - circuit breaker halted (${breaker.reason}, daily ${breaker.dailyLossPercent.toFixed(2)}%, weekly ${breaker.weeklyLossPercent.toFixed(2)}%)`
        );
      } else {
        const adjustedPrice = signal.price * (1 + slippagePercent);
        const atr = atrValues ? atrValues[i] : null;

        if (riskConfig.stopLossMethod === "atr" && atr == null) {
          console.log(
            `[backtest] ${bar.date}: BUY signal skipped - ATR not yet available for stop-loss (insufficient warm-up bars)`
          );
        } else {
          const stopPrice = calculateStopLoss({
            entryPrice: adjustedPrice,
            method: riskConfig.stopLossMethod,
            percent: riskConfig.stopLossPercent,
            atr,
            atrMultiplier: riskConfig.atrMultiplier,
          });

          const sized = calculatePositionSize({
            accountEquity: cash,
            riskPercent: riskConfig.riskPercent,
            entryPrice: adjustedPrice,
            stopLossPrice: stopPrice,
          });
          const wholeShares = Math.floor(sized.shares);

          if (wholeShares <= 0) {
            console.log(
              `[backtest] ${bar.date}: BUY signal skipped - sized position rounds to 0 shares (${riskConfig.riskPercent}% risk of $${cash.toFixed(2)} equity, entry $${adjustedPrice.toFixed(2)}, stop $${stopPrice.toFixed(2)})`
            );
          } else {
            const cashBefore = cash;
            const positionValue = wholeShares * adjustedPrice;
            const fee = positionValue * feePercent;
            cash -= positionValue + fee;
            shares = wholeShares;
            stopLossPrice = stopPrice;

            trades.push({
              date: bar.date,
              action: "BUY",
              price: adjustedPrice,
              shares,
              fee,
              stopLossPrice,
              dollarRisk: sized.dollarRisk,
              cashBefore,
              cashAfter: cash,
              sharesAfter: shares,
            });
          }
        }
      }
    } else if (signal && signal.action === "SELL" && shares > 0) {
      const adjustedPrice = signal.price * (1 - slippagePercent);
      const grossProceeds = shares * adjustedPrice;
      const fee = grossProceeds * feePercent;
      cash += grossProceeds - fee;
      shares = 0;
      stopLossPrice = null;

      trades.push({
        date: signal.date,
        action: "SELL",
        reason: "SIGNAL",
        price: adjustedPrice,
        shares: 0,
        fee,
        cashAfter: cash,
        sharesAfter: 0,
      });
    }

    if (shares > 0) barsHeld++;
    equityCurve.push({ date: bar.date, value: cash + shares * bar.close });
  }

  const finalValue = equityCurve.length
    ? equityCurve[equityCurve.length - 1].value
    : initialCapital;

  const totalReturnPercent = ((finalValue - initialCapital) / initialCapital) * 100;

  const buyAndHoldReturnPercent = bars.length
    ? ((bars[bars.length - 1].close - bars[0].close) / bars[0].close) * 100
    : 0;

  // Max drawdown: walk the equity curve, keep the highest value seen so far
  // (the "peak"), and measure how far below that peak the curve ever fell.
  // The largest of those peak-to-trough drops is the max drawdown — it
  // answers "what's the worst paper loss I'd have sat through?", which
  // total return alone hides.
  let peak = -Infinity;
  let maxDrawdownPercent = 0;
  for (const point of equityCurve) {
    if (point.value > peak) peak = point.value;
    const drawdown = ((peak - point.value) / peak) * 100;
    if (drawdown > maxDrawdownPercent) maxDrawdownPercent = drawdown;
  }

  // Win rate: pair each BUY with the SELL that closes it (a "round trip") by
  // comparing total account cash right before the BUY (recorded on the trade
  // itself as cashBefore) against total account cash right after the
  // matching SELL. Using the trade's own recorded cashBefore/cashAfter
  // (rather than assuming cash is 0 while holding) is what makes this work
  // correctly now that a BUY no longer necessarily spends 100% of cash -
  // any uninvested leftover carries through untouched and cancels out on
  // both sides of the comparison.
  let roundTrips = 0;
  let winningRoundTrips = 0;
  let cashBeforeOpenTrade = initialCapital;
  for (const trade of trades) {
    if (trade.action === "BUY") {
      cashBeforeOpenTrade = trade.cashBefore;
    } else if (trade.action === "SELL") {
      roundTrips++;
      if (trade.cashAfter > cashBeforeOpenTrade) winningRoundTrips++;
    }
  }
  const winRate = roundTrips > 0 ? (winningRoundTrips / roundTrips) * 100 : 0;

  // Sharpe ratio: return per unit of volatility, not just raw return. Two
  // strategies can post the same total return while one got there on a
  // smooth, steady climb and the other lurched through wild swings — the
  // smoother one has a higher Sharpe and is arguably "better" on a
  // risk-adjusted basis, because you'd have been able to sit through it.
  // Computed from daily returns of the equity curve: mean return divided
  // by its standard deviation, annualized by sqrt(252) trading days/year.
  // Assumes a risk-free rate of 0 (i.e. ignores the return of just holding
  // cash/T-bills) for simplicity.
  const dailyReturns = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].value;
    const curr = equityCurve[i].value;
    dailyReturns.push((curr - prev) / prev);
  }
  let sharpeRatio = 0;
  if (dailyReturns.length > 0) {
    const meanReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const variance =
      dailyReturns.reduce((a, b) => a + (b - meanReturn) ** 2, 0) / dailyReturns.length;
    const stdDev = Math.sqrt(variance);
    sharpeRatio = stdDev === 0 ? 0 : (meanReturn / stdDev) * Math.sqrt(252);
  }

  // Time in market: tracked bar-by-bar during the main loop above (rather
  // than a second pass replaying BUY/SELL signals) because a position can
  // now be closed by the stop-loss before the strategy ever emits its own
  // SELL signal - re-deriving "held" purely from signals would overstate
  // how long the position was actually open.
  const timeInMarketPercent = bars.length > 0 ? (barsHeld / bars.length) * 100 : 0;

  return {
    initialCapital,
    finalValue,
    totalReturnPercent,
    buyAndHoldReturnPercent,
    maxDrawdownPercent,
    winRate,
    sharpeRatio,
    timeInMarketPercent,
    numberOfTrades: trades.length,
    trades,
    equityCurve,
  };
}

module.exports = { runBacktest, DEFAULT_RISK_CONFIG };
