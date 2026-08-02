const { calculateSMA, calculateEMA, calculateWMA, calculateRSI } = require("./indicators");

const MA_FUNCTIONS = {
  sma: calculateSMA,
  ema: calculateEMA,
  wma: calculateWMA,
};

function maCrossoverStrategy(bars, { shortPeriod = 20, longPeriod = 50, maType = "sma" } = {}) {
  const maFn = MA_FUNCTIONS[maType];
  if (!maFn) {
    throw new Error(`Unknown maType "${maType}": must be one of ${Object.keys(MA_FUNCTIONS).join(", ")}`);
  }

  const closes = bars.map((b) => b.close);
  const shortMA = maFn(closes, shortPeriod);
  const longMA = maFn(closes, longPeriod);

  const signals = [];
  let inPosition = false;

  for (let i = 1; i < bars.length; i++) {
    if (
      shortMA[i] == null ||
      longMA[i] == null ||
      shortMA[i - 1] == null ||
      longMA[i - 1] == null
    ) {
      continue;
    }

    const crossedUp = shortMA[i - 1] <= longMA[i - 1] && shortMA[i] > longMA[i];
    const crossedDown = shortMA[i - 1] >= longMA[i - 1] && shortMA[i] < longMA[i];

    if (crossedUp && !inPosition) {
      signals.push({ date: bars[i].date, action: "BUY", price: bars[i].close });
      inPosition = true;
    } else if (crossedDown && inPosition) {
      signals.push({ date: bars[i].date, action: "SELL", price: bars[i].close });
      inPosition = false;
    }
  }

  return signals;
}

function smaCrossoverStrategy(bars, { shortPeriod = 20, longPeriod = 50 } = {}) {
  return maCrossoverStrategy(bars, { shortPeriod, longPeriod, maType: "sma" });
}

function rsiMeanReversionStrategy(
  bars,
  { rsiPeriod = 14, oversoldThreshold = 30, overboughtThreshold = 70 } = {}
) {
  const closes = bars.map((b) => b.close);
  const rsi = calculateRSI(closes, rsiPeriod);

  const signals = [];
  let inPosition = false;

  for (let i = 1; i < bars.length; i++) {
    if (rsi[i] == null || rsi[i - 1] == null) continue;

    const crossedUpFromOversold = rsi[i - 1] < oversoldThreshold && rsi[i] >= oversoldThreshold;
    const crossedDownFromOverbought = rsi[i - 1] > overboughtThreshold && rsi[i] <= overboughtThreshold;

    if (crossedUpFromOversold && !inPosition) {
      signals.push({ date: bars[i].date, action: "BUY", price: bars[i].close });
      inPosition = true;
    } else if (crossedDownFromOverbought && inPosition) {
      signals.push({ date: bars[i].date, action: "SELL", price: bars[i].close });
      inPosition = false;
    }
  }

  return signals;
}

module.exports = { smaCrossoverStrategy, maCrossoverStrategy, rsiMeanReversionStrategy };
