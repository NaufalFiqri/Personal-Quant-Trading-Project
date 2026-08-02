const { calculateSMA } = require("./indicators");

function smaCrossoverStrategy(bars, { shortPeriod = 20, longPeriod = 50 } = {}) {
  const closes = bars.map((b) => b.close);
  const shortSMA = calculateSMA(closes, shortPeriod);
  const longSMA = calculateSMA(closes, longPeriod);

  const signals = [];
  let inPosition = false;

  for (let i = 1; i < bars.length; i++) {
    if (
      shortSMA[i] == null ||
      longSMA[i] == null ||
      shortSMA[i - 1] == null ||
      longSMA[i - 1] == null
    ) {
      continue;
    }

    const crossedUp = shortSMA[i - 1] <= longSMA[i - 1] && shortSMA[i] > longSMA[i];
    const crossedDown = shortSMA[i - 1] >= longSMA[i - 1] && shortSMA[i] < longSMA[i];

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

module.exports = { smaCrossoverStrategy };
