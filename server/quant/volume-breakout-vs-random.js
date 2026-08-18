const { volumeBreakoutStrategy, randomEntryStrategy } = require("./strategy");
const { runWalkForward } = require("./walkforward");

const TICKERS = ["AAPL", "MSFT", "JNJ", "GOOGL", "AMZN", "NVDA", "META"];

const START_DATE = "2022-01-01";
const WINDOW_MONTHS = 18;
const MIN_WINDOW_MONTHS = 3;
const LOOKBACK_MONTHS = 2;

const REAL_PARAMS = { breakoutPeriod: 20, volumePeriod: 20, volumeMultiplier: 1.5, exitPeriod: 10 };
const RANDOM_PARAMS = { entryProbability: 0.02, seed: 42, exitPeriod: 10 };
const RISK_CONFIG = { stopLossMethod: "atr" };

function padNum(n, width, decimals = 2) {
  return n.toFixed(decimals).padStart(width);
}

function header() {
  const h =
    "Ticker".padEnd(8) +
    "Window".padEnd(23) +
    "Real%".padStart(8) +
    "Rand%".padStart(8) +
    "B&H%".padStart(9) +
    "RealBeatBH".padStart(12) +
    "RandBeatBH".padStart(12) +
    "RealBeatRand".padStart(14) +
    "RealTr".padStart(8) +
    "RandTr".padStart(8);
  console.log(h);
  console.log("-".repeat(h.length));
}

async function main() {
  const endDate = new Date().toISOString().slice(0, 10);
  const options = {
    startDate: START_DATE,
    endDate,
    windowMonths: WINDOW_MONTHS,
    minWindowMonths: MIN_WINDOW_MONTHS,
    lookbackMonths: LOOKBACK_MONTHS,
    riskConfig: RISK_CONFIG,
  };

  console.log(`Volume breakout vs. random-entry baseline vs. buy & hold, per ticker/window`);
  console.log(`Tickers: ${TICKERS.join(", ")}`);
  console.log(
    `Range: ${START_DATE} to ${endDate}, window=${WINDOW_MONTHS}mo, minWindow=${MIN_WINDOW_MONTHS}mo, lookback=${LOOKBACK_MONTHS}mo, riskConfig=${JSON.stringify(RISK_CONFIG)}`
  );
  console.log(`Random params: ${JSON.stringify(RANDOM_PARAMS)}\n`);

  header();

  let totalWindows = 0;
  let randomBeatBH = 0;
  let realBeatBH = 0;
  let realBeatRandom = 0;

  for (const ticker of TICKERS) {
    const real = await runWalkForward(ticker, volumeBreakoutStrategy, REAL_PARAMS, options);
    const random = await runWalkForward(ticker, randomEntryStrategy, RANDOM_PARAMS, options);

    // Both calls use the identical startDate/endDate/windowMonths/minWindowMonths,
    // so buildWindows (walkforward.js) produces the identical window boundary
    // list for both - windowResults[i] from each run refers to the same
    // [windowStart, windowEnd) pair and can be zipped by index directly.
    for (let i = 0; i < real.windowResults.length; i++) {
      const rw = real.windowResults[i];
      const nw = random.windowResults[i];
      totalWindows++;

      const rBeatBH = rw.hasSignal ? (rw.beatBenchmark ? "YES" : "no") : "no signal";
      const nBeatBH = nw.hasSignal ? (nw.beatBenchmark ? "YES" : "no") : "no signal";
      if (rw.hasSignal && rw.beatBenchmark) realBeatBH++;
      if (nw.hasSignal && nw.beatBenchmark) randomBeatBH++;

      let realBeatRand;
      if (rw.hasSignal && nw.hasSignal) {
        realBeatRand = rw.returnPercent > nw.returnPercent ? "YES" : "no";
        if (rw.returnPercent > nw.returnPercent) realBeatRandom++;
      } else {
        realBeatRand = "n/a";
      }

      console.log(
        ticker.padEnd(8) +
          `${rw.windowStart} to ${rw.windowEnd}`.padEnd(23) +
          padNum(rw.returnPercent, 8) +
          padNum(nw.returnPercent, 8) +
          padNum(rw.buyAndHoldPercent, 9) +
          rBeatBH.padStart(12) +
          nBeatBH.padStart(12) +
          realBeatRand.padStart(14) +
          String(rw.trades).padStart(8) +
          String(nw.trades).padStart(8)
      );
    }
  }

  console.log("-".repeat(110));
  console.log(`real beat B&H in ${realBeatBH} of ${totalWindows} windows`);
  console.log(`random beat B&H in ${randomBeatBH} of ${totalWindows} windows`);
  console.log(`real beat random in ${realBeatRandom} of ${totalWindows} windows (windows where both had a signal)`);
}

main().catch((err) => {
  console.error("volume-breakout-vs-random failed:", err);
  process.exit(1);
});
