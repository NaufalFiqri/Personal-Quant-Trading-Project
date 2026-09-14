const {
  calculateSMA,
  calculateEMA,
  calculateWMA,
  calculateRSI,
  calculateRollingMax,
  calculateRollingMin,
} = require("./indicators");
const { calculateRegime } = require("./regime");

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

// Phase 2 candidate #2 (PHASE2_CONFLUENCE_SCOPING.md): a genuine 3-condition
// AND - not-in-position, trend favorable (calculateRegime), breakout+volume
// (volumeBreakoutStrategy, itself already a 2-condition AND) - built as pure
// composition of two already-validated, already-unit-tested pieces rather
// than new decision logic. applyRegimeFilter's existing entry-gate-only
// behavior (blocks BUY on unfavorable-or-unknown regime, passes every SELL
// through untouched) is what supplies the trend condition and leaves the
// exit exactly as volumeBreakoutStrategy already defined it.
function confluenceBreakoutStrategy(
  bars,
  {
    maPeriod = 200,
    breakoutPeriod = 20,
    volumePeriod = 20,
    volumeMultiplier = 1.5,
    exitPeriod = 10,
  } = {}
) {
  const regime = calculateRegime(bars, { maPeriod });
  const signals = volumeBreakoutStrategy(bars, {
    breakoutPeriod,
    volumePeriod,
    volumeMultiplier,
    exitPeriod,
  });
  return applyRegimeFilter(signals, regime);
}

// Phase 2 insider-cluster candidate (PHASE2_INSIDER_SIGNAL_SCOPING.md §2):
// pure cluster-detection logic, separated from the strategy itself so it can
// be unit-tested against hand-built transaction records without any network
// fetch or bars array, and so the sanity-check/DRIP-flagging step can reuse
// the exact same trigger-finding logic the strategy uses internally.
//
// "Fires once" semantics, same convention as every entry signal in this
// project: a cluster is a NEW trigger only on the first day 2+ distinct
// insiders' code-P purchases fall inside the trailing clusterWindowDays
// window; it does not re-trigger on every subsequent day the condition
// remains true, and resets once the window next drops back below 2 distinct
// insiders.
function detectInsiderClusters(pTransactions, { clusterWindowDays = 30 } = {}) {
  const sorted = [...pTransactions].sort((a, b) => a.date.localeCompare(b.date));
  const uniqueDates = [...new Set(sorted.map((t) => t.date))];

  const triggers = [];
  let inCluster = false;

  for (const date of uniqueDates) {
    const windowStart = new Date(date);
    windowStart.setDate(windowStart.getDate() - clusterWindowDays);
    const windowStartStr = windowStart.toISOString().slice(0, 10);

    const windowTransactions = sorted.filter((t) => t.date >= windowStartStr && t.date <= date);
    const distinctInsiders = [...new Set(windowTransactions.map((t) => t.insider))];

    if (distinctInsiders.length >= 2) {
      if (!inCluster) {
        triggers.push({ date, insiders: distinctInsiders, transactions: windowTransactions });
        inCluster = true;
      }
    } else {
      inCluster = false;
    }
  }

  return triggers;
}

// Entry = a cluster trigger (per detectInsiderClusters). Exit is deliberately
// NOT the price-reactive channel every other strategy in this project uses -
// PHASE2_INSIDER_SIGNAL_SCOPING.md §4 reasoned that insider cluster buying is
// a 6-12+ month literature-documented effect, so the only native SELL is a
// fixed maximum hold (default 252 trading days ~= 12 months). There is no
// separate "6-month minimum" mechanism to implement: since this is the only
// native exit at all, nothing can close the trade before 12 months except
// risk.js's ATR/percent stop (wired in at the backtest.js layer, exactly as
// scoped - "purely as capital protection... not the strategy's primary exit
// mechanism") - the 6-month floor described in the scoping doc falls out for
// free rather than needing its own trigger.
//
// A cluster's trigger `date` is a filing date, not necessarily a trading
// day - it's mapped forward to the next available bar, since (per §5's
// "event dates don't align to the bars array" note) nothing else in this
// codebase has had to reconcile two independent date sequences before.
// A second cluster while already in a position is ignored, same
// not-in-position convention as every other strategy - not designed to
// extend/reset the hold, per §4's explicit "leave as ignored for v1" call.
function insiderClusterStrategy(bars, { pTransactions = [], clusterWindowDays = 30, exitTradingDays = 252 } = {}) {
  const triggers = detectInsiderClusters(pTransactions, { clusterWindowDays });
  const sortedTriggerDates = [...new Set(triggers.map((t) => t.date))].sort();

  const signals = [];
  let inPosition = false;
  let barsHeldSinceEntry = 0;
  let triggerIdx = 0;

  for (const bar of bars) {
    // Consume every trigger dated at/before today exactly once, regardless
    // of position state - a filing date maps forward to the first trading
    // day at/after it. If flat, the first such bar fires a BUY. If already
    // in a position, the consumed trigger(s) are simply discarded, not
    // banked for after the position closes - same "ignored" semantics as
    // every other strategy's not-in-position guard (a missed crossover
    // isn't queued up either).
    let triggeredToday = false;
    while (triggerIdx < sortedTriggerDates.length && sortedTriggerDates[triggerIdx] <= bar.date) {
      triggeredToday = true;
      triggerIdx++;
    }

    if (!inPosition && triggeredToday) {
      signals.push({ date: bar.date, action: "BUY", price: bar.close });
      inPosition = true;
      barsHeldSinceEntry = 0;
      continue;
    }

    if (inPosition) {
      barsHeldSinceEntry++;
      if (barsHeldSinceEntry >= exitTradingDays) {
        signals.push({ date: bar.date, action: "SELL", price: bar.close });
        inPosition = false;
      }
    }
  }

  return signals;
}

module.exports = {
  smaCrossoverStrategy,
  maCrossoverStrategy,
  rsiMeanReversionStrategy,
  volumeBreakoutStrategy,
  randomEntryStrategy,
  applyRegimeFilter,
  confluenceBreakoutStrategy,
  detectInsiderClusters,
  insiderClusterStrategy,
};
