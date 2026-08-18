const {
  calculateSMA,
  calculateEMA,
  calculateWMA,
  calculateRSI,
  calculateRollingMax,
  calculateRollingMin,
} = require("./indicators");

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

// Breakout entry, confirmed by volume, with its own trend-following exit
// (asymmetric Turtle-style channel: a shorter exit window than entry window
// lets a working breakout run while cutting a failed one reasonably fast).
// Entry compares against yesterday's rolling high (rollingHigh[i-1]), not
// today's (rollingHigh[i]) - rollingHigh's window is inclusive of the
// current bar (same convention as calculateSMA), so today's own high is
// part of today's rollingHigh[i] value - comparing close[i] to rollingHigh[i]
// directly would let a bar break out against itself. See test-indicators.js
// for a direct demonstration of that. The exit's rollingLow[i-1] is the same
// reasoning applied to the exit side.
function volumeBreakoutStrategy(
  bars,
  { breakoutPeriod = 20, volumePeriod = 20, volumeMultiplier = 1.5, exitPeriod = 10 } = {}
) {
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const volumes = bars.map((b) => b.volume);

  const rollingHigh = calculateRollingMax(highs, breakoutPeriod);
  const rollingLow = calculateRollingMin(lows, exitPeriod);
  const avgVolume = calculateSMA(volumes, volumePeriod);

  const signals = [];
  let inPosition = false;

  for (let i = 1; i < bars.length; i++) {
    if (rollingHigh[i - 1] == null || avgVolume[i] == null || rollingLow[i - 1] == null) {
      continue;
    }

    if (!inPosition) {
      const priorHigh = rollingHigh[i - 1];
      const requiredVolume = avgVolume[i] * volumeMultiplier;
      const isBreakout = bars[i].close > priorHigh;
      const isVolumeConfirmed = bars[i].volume > requiredVolume;

      if (isBreakout && isVolumeConfirmed) {
        signals.push({
          date: bars[i].date,
          action: "BUY",
          price: bars[i].close,
          // How far above the prior N-day high the close cleared it, and how
          // many multiples of the confirmation threshold (not just the raw
          // average) the actual volume was - carried through to backtest.js's
          // trade log so it's queryable per-trade, not just visible here.
          breakoutMarginPercent: ((bars[i].close - priorHigh) / priorHigh) * 100,
          volumeRatio: bars[i].volume / requiredVolume,
        });
        inPosition = true;
      }
    } else if (bars[i].close < rollingLow[i - 1]) {
      signals.push({ date: bars[i].date, action: "SELL", price: bars[i].close });
      inPosition = false;
    }
  }

  return signals;
}

// Deterministic PRNG (mulberry32) so a given seed always reproduces the
// exact same sequence of entries - a baseline that changed on every run
// would be useless to compare against.
function mulberry32(seed) {
  let state = seed | 0;
  return function () {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// No-edge baseline for comparison against volumeBreakoutStrategy: identical
// Turtle-style exitPeriod-day-low exit, identical warm-up gate on that same
// rollingLow, and entries land on the ATR stop-loss wrapper the same way
// (that wrapper lives in backtest.js, applied uniformly to whatever
// strategy's signals it's given) - the only thing that differs is that BUY
// entries fire on a seeded coin-flip instead of a breakout+volume condition.
// Default entryProbability of 2% per eligible (flat) bar is tuned to land
// in the same few-trades-per-18-month-window range volumeBreakoutStrategy
// actually produced (see volume-breakout-vs-bh.js output: 3-10 trades per
// window), not derived from any formula - it's a rough frequency match, not
// an exact one.
function randomEntryStrategy(bars, { entryProbability = 0.02, seed = 42, exitPeriod = 10 } = {}) {
  const lows = bars.map((b) => b.low);
  const rollingLow = calculateRollingMin(lows, exitPeriod);
  const rng = mulberry32(seed);

  const signals = [];
  let inPosition = false;

  for (let i = 1; i < bars.length; i++) {
    if (rollingLow[i - 1] == null) continue;

    if (!inPosition) {
      if (rng() < entryProbability) {
        signals.push({ date: bars[i].date, action: "BUY", price: bars[i].close });
        inPosition = true;
      }
    } else if (bars[i].close < rollingLow[i - 1]) {
      signals.push({ date: bars[i].date, action: "SELL", price: bars[i].close });
      inPosition = false;
    }
  }

  return signals;
}

// Regime gate: drops BUY signals falling on an unfavorable-regime bar (per
// calculateRegime in regime.js), passing SELL signals through untouched so
// an already-open position keeps running its normal exit logic regardless
// of regime. Generic over the inner strategy - works on any signal list,
// not just maCrossoverStrategy's. A bar with no regime entry (or a null
// favorable, e.g. still in the regime MA's warm-up) is treated the same as
// unfavorable: block the entry rather than assume it's safe.
function applyRegimeFilter(signals, regime) {
  const favorableByDate = new Map(regime.map((r) => [r.date, r.favorable]));

  return signals.filter((signal) => {
    if (signal.action !== "BUY") return true;
    return favorableByDate.get(signal.date) === true;
  });
}

module.exports = {
  smaCrossoverStrategy,
  maCrossoverStrategy,
  rsiMeanReversionStrategy,
  volumeBreakoutStrategy,
  randomEntryStrategy,
  applyRegimeFilter,
};
