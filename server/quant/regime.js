const { calculateSMA } = require("./indicators");

// Long-only regime filter: a bar's regime is "favorable" when price is
// trending above its own long-period trend line, "unfavorable" otherwise.
// A tie (close exactly equal to the MA) counts as unfavorable - a filter
// meant to gate new entries should require a clear signal, not a coin flip.
function calculateRegime(bars, { maPeriod = 200 } = {}) {
  const closes = bars.map((b) => b.close);
  const ma = calculateSMA(closes, maPeriod);

  return bars.map((bar, i) => ({
    date: bar.date,
    favorable: ma[i] == null ? null : bar.close > ma[i],
  }));
}

module.exports = { calculateRegime };
