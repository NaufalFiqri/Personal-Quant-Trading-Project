function runBacktest(bars, signals, options = {}) {
  const {
    initialCapital = 10000,
    feePercent = 0.001,
    slippagePercent = 0.0005,
  } = options;

  const signalByDate = new Map(signals.map((s) => [s.date, s]));

  let cash = initialCapital;
  let shares = 0;

  const trades = [];
  const equityCurve = [];

  for (const bar of bars) {
    const signal = signalByDate.get(bar.date);

    if (signal && signal.action === "BUY" && shares === 0) {
      const adjustedPrice = signal.price * (1 + slippagePercent);
      const fee = cash * feePercent;
      const investable = cash - fee;
      shares = investable / adjustedPrice;
      cash = 0;

      trades.push({
        date: signal.date,
        action: "BUY",
        price: adjustedPrice,
        shares,
        fee,
        cashAfter: cash,
        sharesAfter: shares,
      });
    } else if (signal && signal.action === "SELL" && shares > 0) {
      const adjustedPrice = signal.price * (1 - slippagePercent);
      const grossProceeds = shares * adjustedPrice;
      const fee = grossProceeds * feePercent;
      cash = grossProceeds - fee;
      shares = 0;

      trades.push({
        date: signal.date,
        action: "SELL",
        price: adjustedPrice,
        shares: 0,
        fee,
        cashAfter: cash,
        sharesAfter: shares,
      });
    }

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

  // Win rate: pair each BUY with the SELL that closes it (a "round trip").
  // Since cash is 0 while holding and shares is 0 while in cash, the cash
  // balance right before the BUY and right after the matching SELL are
  // directly comparable dollar amounts — the difference is the round trip's
  // profit or loss.
  let roundTrips = 0;
  let winningRoundTrips = 0;
  let cashBeforeOpenTrade = initialCapital;
  for (const trade of trades) {
    if (trade.action === "BUY") {
      cashBeforeOpenTrade = trade.shares * trade.price + trade.fee;
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

  // Time in market: walk the bars again with a simple position flag,
  // toggled by the same signals used during simulation above.
  let heldShares = 0;
  let barsHeld = 0;
  for (const bar of bars) {
    const signal = signalByDate.get(bar.date);
    if (signal && signal.action === "BUY") heldShares = 1;
    else if (signal && signal.action === "SELL") heldShares = 0;
    if (heldShares > 0) barsHeld++;
  }
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

module.exports = { runBacktest };
