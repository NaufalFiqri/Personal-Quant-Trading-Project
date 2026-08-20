const { volumeBreakoutStrategy, randomEntryStrategy } = require("./strategy");
const { runWalkForward } = require("./walkforward");

const TICKERS = ["MARA", "PLUG", "FUBO", "CHPT", "IONQ", "UEC", "ACHR"];

const START_DATE = "2022-01-01";
const WINDOW_MONTHS = 18;
const MIN_WINDOW_MONTHS = 3;
const LOOKBACK_MONTHS = 2;

const REAL_PARAMS = { breakoutPeriod: 20, volumePeriod: 20, volumeMultiplier: 1.5, exitPeriod: 10 };
// Same entryProbability/seed/exitPeriod as the large-cap comparison
// (lesson #10 / volume-breakout-vs-random.js) - reused unchanged, not
// re-tuned per ticker, same approach as that comparison used.
const RANDOM_PARAMS = { entryProbability: 0.02, seed: 42, exitPeriod: 10 };
const RISK_CONFIG = { stopLossMethod: "atr" };
// Same slippage proposed for the real strategy in PHASE2_SMALLCAP_SCOPING.md
// §3, applied to both sides here so the comparison is on equal terms.
const SLIPPAGE_PERCENT = 0.003;
const FEE_PERCENT = 0.001;

function padNum(n, width, decimals = 2) {
  return n.toFixed(decimals).padStart(width);
}

function header() {
  const h =
    "Ticker".padEnd(8) +
    "Window".padEnd(23) +
    "RealSharpe".padStart(11) +
    "RealRet%".padStart(9) +
    "RealTr".padStart(7) +
    "RandSharpe".padStart(11) +
    "RandRet%".padStart(9) +
    "RandTr".padStart(7) +
    "RealBeatsRand".padStart(15);
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
    slippagePercent: SLIPPAGE_PERCENT,
    feePercent: FEE_PERCENT,
  };

  console.log(`Small/micro-cap volume breakout vs. random-entry baseline, 7-ticker walk-forward`);
  console.log(`Tickers: ${TICKERS.join(", ")}`);
  console.log(
    `Range: ${START_DATE} to ${endDate}, window=${WINDOW_MONTHS}mo, minWindow=${MIN_WINDOW_MONTHS}mo, lookback=${LOOKBACK_MONTHS}mo, ` +
      `riskConfig=${JSON.stringify(RISK_CONFIG)}, slippagePercent=${SLIPPAGE_PERCENT} (both sides), feePercent=${FEE_PERCENT}`
  );
  console.log(`Random params: ${JSON.stringify(RANDOM_PARAMS)}\n`);

  header();

  let totalWindows = 0;
  let realBeatsRandom = 0;
  const allReal = [];
  const allRandom = [];

  for (const ticker of TICKERS) {
    const real = await runWalkForward(ticker, volumeBreakoutStrategy, REAL_PARAMS, options);
    const random = await runWalkForward(ticker, randomEntryStrategy, RANDOM_PARAMS, options);

    for (let i = 0; i < real.windowResults.length; i++) {
      const rw = real.windowResults[i];
      const nw = random.windowResults[i];
      totalWindows++;
      allReal.push(rw);
      allRandom.push(nw);

      let beats;
      if (rw.hasSignal && nw.hasSignal) {
        beats = rw.returnPercent > nw.returnPercent ? "YES" : "no";
        if (rw.returnPercent > nw.returnPercent) realBeatsRandom++;
      } else {
        beats = "n/a";
      }

      console.log(
        ticker.padEnd(8) +
          `${rw.windowStart} to ${rw.windowEnd}`.padEnd(23) +
          padNum(rw.sharpeRatio, 11, 3) +
          padNum(rw.returnPercent, 9) +
          String(rw.trades).padStart(7) +
          padNum(nw.sharpeRatio, 11, 3) +
          padNum(nw.returnPercent, 9) +
          String(nw.trades).padStart(7) +
          beats.padStart(15)
      );
    }
  }

  const avgRealSharpe = allReal.reduce((s, w) => s + w.sharpeRatio, 0) / allReal.length;
  const avgRealReturn = allReal.reduce((s, w) => s + w.returnPercent, 0) / allReal.length;
  const avgRandSharpe = allRandom.reduce((s, w) => s + w.sharpeRatio, 0) / allRandom.length;
  const avgRandReturn = allRandom.reduce((s, w) => s + w.returnPercent, 0) / allRandom.length;

  console.log("-".repeat(110));
  console.log(`real beat random in ${realBeatsRandom} of ${totalWindows} windows`);
  console.log(
    `Averaged across all ${totalWindows} windows: real Sharpe ${avgRealSharpe.toFixed(3)}, real Return% ${avgRealReturn.toFixed(2)} ` +
      `| random Sharpe ${avgRandSharpe.toFixed(3)}, random Return% ${avgRandReturn.toFixed(2)}`
  );
}

main().catch((err) => {
  console.error("smallcap-vs-random failed:", err);
  process.exit(1);
});
