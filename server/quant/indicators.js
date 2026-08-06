function calculateSMA(prices, period) {
  const sma = new Array(prices.length).fill(null);
  for (let i = period - 1; i < prices.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += prices[j];
    sma[i] = sum / period;
  }
  return sma;
}

function calculateEMA(prices, period) {
  const ema = new Array(prices.length).fill(null);
  if (prices.length < period) return ema;

  let sum = 0;
  for (let i = 0; i < period; i++) sum += prices[i];
  ema[period - 1] = sum / period;

  const k = 2 / (period + 1);
  for (let i = period; i < prices.length; i++) {
    ema[i] = prices[i] * k + ema[i - 1] * (1 - k);
  }

  return ema;
}

function calculateWMA(prices, period) {
  const wma = new Array(prices.length).fill(null);
  const weightSum = (period * (period + 1)) / 2;

  for (let i = period - 1; i < prices.length; i++) {
    let weighted = 0;
    for (let j = 0; j < period; j++) {
      const weight = j + 1;
      weighted += prices[i - period + 1 + j] * weight;
    }
    wma[i] = weighted / weightSum;
  }

  return wma;
}

function calculateRSI(prices, period = 14) {
  const rsi = new Array(prices.length).fill(null);
  if (prices.length <= period) return rsi;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gainSum += change;
    else lossSum += -change;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return rsi;
}

function calculateATR(bars, period = 14) {
  const atr = new Array(bars.length).fill(null);
  if (bars.length <= period) return atr;

  const trueRanges = new Array(bars.length).fill(null);
  for (let i = 1; i < bars.length; i++) {
    const { high, low } = bars[i];
    const prevClose = bars[i - 1].close;
    trueRanges[i] = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
  }

  let sum = 0;
  for (let i = 1; i <= period; i++) sum += trueRanges[i];
  let avgTR = sum / period;
  atr[period] = avgTR;

  for (let i = period + 1; i < bars.length; i++) {
    avgTR = (avgTR * (period - 1) + trueRanges[i]) / period;
    atr[i] = avgTR;
  }

  return atr;
}

module.exports = { calculateSMA, calculateEMA, calculateWMA, calculateRSI, calculateATR };
