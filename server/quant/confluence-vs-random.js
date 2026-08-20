const { getHistoricalData } = require("./data");
const { volumeBreakoutStrategy, randomEntryStrategy, applyRegimeFilter, confluenceBreakoutStrategy } = require("./strategy");
const { calculateRegime } = require("./regime");
const { runWalkForward } = require("./walkforward");

const TICKERS = ["AAPL", "MSFT", "JNJ", "GOOGL", "AMZN", "NVDA", "META"];

const START_DATE = "2022-01-01";
const WINDOW_MONTHS = 18;
const MIN_WINDOW_MONTHS = 3;
const LOOKBACK_MONTHS = 11; // matches confluence-validation.js / regime-filter-validation.js
const RISK_CONFIG = { stopLossMethod: "atr" };

const CONFLUENCE_PARAMS = { maPeriod: 200, breakoutPeriod: 20, volumePeriod: 20, volumeMultiplier: 1.5, exitPeriod: 10 };
// Same entryProbability/seed/exitPeriod as the ungated baseline used in
// LEARNINGS.md lesson #10 - reused unchanged so the ungated variant here is
// directly comparable to that prior result, not a new/different baseline.
const UNGATED_RANDOM_PARAMS = { entryProbability: 0.02, seed: 42, exitPeriod: 10 };

function regimeGatedRandomStrategy(bars, params) {
  const regime = calculateRegime(bars, { maPeriod: 200 });
  const signals = randomEntryStrategy(bars, params);
  return applyRegimeFilter(signals, regime);
}

// Derives one adjusted entryProbability, pooled across all 7 tickers' full
// history, so the regime-gated random baseline fires at roughly the same
// per-eligible-bar rate the ungated baseline was originally tuned to (0.02),
// once restricted to favorable-regime bars only - per
// PHASE2_CONFLUENCE_SCOPING.md §6 step 5(b): hold the trend filter's own
// restriction effect constant, don't let it silently starve the random
// baseline's trade count relative to what 0.02 was calibrated against.
async function deriveGatedProbability() {
  let favorableBars = 0;
  let totalBars = 0;
  for (const ticker of TICKERS) {
    const bars = await getHistoricalData(ticker, "2013-01-01", new Date().toISOString().slice(0, 10));
    const regime = calculateRegime(bars, { maPeriod: 200 });
    for (const r of regime) {
      totalBars++;
      if (r.favorable === true) favorableBars++;
    }
  }
  const favorableFraction = favorableBars / totalBars;
  const adjustedProbability = UNGATED_RANDOM_PARAMS.entryProbability / favorableFraction;
  return { favorableBars, totalBars, favorableFraction, adjustedProbability };
}

function padNum(n, width, decimals = 2) {
  return n.toFixed(decimals).padStart(width);
}

function header() {
  const h =
    "Variant".padEnd(16) +
    "Ticker".padEnd(8) +
    "Sharpe".padStart(9) +
    "Return%".padStart(10) +
    "Trades".padStart(8);
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

  console.log(`Confluence vs. random-entry baselines, 7-ticker walk-forward`);
  console.log(`Tickers: ${TICKERS.join(", ")}`);
  console.log(`Range: ${START_DATE} to ${endDate}, window=${WINDOW_MONTHS}mo, minWindow=${MIN_WINDOW_MONTHS}mo, lookback=${LOOKBACK_MONTHS}mo, riskConfig=${JSON.stringify(RISK_CONFIG)}\n`);

  const gatedProbInfo = await deriveGatedProbability();
  console.log(
    `Pooled favorable-regime fraction across all 7 tickers, full 2013-01-01-to-today history, maPeriod=200: ` +
      `${gatedProbInfo.favorableBars} / ${gatedProbInfo.totalBars} bars = ${(gatedProbInfo.favorableFraction * 100).toFixed(1)}%`
  );
  console.log(
    `Regime-gated random entryProbability, re-derived so the in-favorable-regime firing rate matches the ` +
      `ungated baseline's own 0.02 target: 0.02 / ${gatedProbInfo.favorableFraction.toFixed(4)} = ${gatedProbInfo.adjustedProbability.toFixed(4)}\n`
  );
  const GATED_RANDOM_PARAMS = { entryProbability: gatedProbInfo.adjustedProbability, seed: 42, exitPeriod: 10 };

  header();

  const results = { confluence: [], breakoutAlone: [], ungatedRandom: [], gatedRandom: [] };

  for (const ticker of TICKERS) {
    const confluence = await runWalkForward(ticker, confluenceBreakoutStrategy, CONFLUENCE_PARAMS, options);
    const breakoutAlone = await runWalkForward(
      ticker,
      volumeBreakoutStrategy,
      { breakoutPeriod: 20, volumePeriod: 20, volumeMultiplier: 1.5, exitPeriod: 10 },
      options
    );
    const ungatedRandom = await runWalkForward(ticker, randomEntryStrategy, UNGATED_RANDOM_PARAMS, options);
    const gatedRandom = await runWalkForward(ticker, regimeGatedRandomStrategy, GATED_RANDOM_PARAMS, options);

    results.confluence.push({ ticker, ...confluence });
    results.breakoutAlone.push({ ticker, ...breakoutAlone });
    results.ungatedRandom.push({ ticker, ...ungatedRandom });
    results.gatedRandom.push({ ticker, ...gatedRandom });

    for (const [label, r] of [
      ["confluence", confluence],
      ["breakout-alone", breakoutAlone],
      ["ungated-random", ungatedRandom],
      ["regime-gated-rand", gatedRandom],
    ]) {
      const trades = r.windowResults.reduce((s, w) => s + w.trades, 0);
      console.log(
        label.padEnd(16) +
          ticker.padEnd(8) +
          padNum(r.aggregate.averageSharpe, 9, 3) +
          padNum(r.aggregate.averageReturnPercent, 10) +
          String(trades).padStart(8)
      );
    }
  }

  console.log("\n=== Head-to-head, per window: does confluence beat regime-gated-random, and does breakout-alone beat ungated-random? ===");
  let confluenceBeatsGated = 0;
  let breakoutBeatsUngated = 0;
  let totalWindows = 0;

  for (let t = 0; t < TICKERS.length; t++) {
    const ticker = TICKERS[t];
    const confWindows = results.confluence[t].windowResults;
    const gatedWindows = results.gatedRandom[t].windowResults;
    const breakoutWindows = results.breakoutAlone[t].windowResults;
    const ungatedWindows = results.ungatedRandom[t].windowResults;

    for (let w = 0; w < confWindows.length; w++) {
      totalWindows++;
      const cw = confWindows[w];
      const gw = gatedWindows[w];
      const bw = breakoutWindows[w];
      const uw = ungatedWindows[w];

      const confBeatsGated = cw.hasSignal && gw.hasSignal ? cw.returnPercent > gw.returnPercent : null;
      const breakoutBeatsUng = bw.hasSignal && uw.hasSignal ? bw.returnPercent > uw.returnPercent : null;

      if (confBeatsGated === true) confluenceBeatsGated++;
      if (breakoutBeatsUng === true) breakoutBeatsUngated++;

      console.log(
        `${ticker.padEnd(8)}${cw.windowStart} to ${cw.windowEnd}  ` +
          `confluence=${cw.returnPercent.toFixed(2)}%  regime-gated-random=${gw.returnPercent.toFixed(2)}%  confBeatsGated=${confBeatsGated}  ` +
          `|  breakout-alone=${bw.returnPercent.toFixed(2)}%  ungated-random=${uw.returnPercent.toFixed(2)}%  breakoutBeatsUngated=${breakoutBeatsUng}`
      );
    }
  }

  console.log(`\nconfluence beat regime-gated-random in ${confluenceBeatsGated} of ${totalWindows} windows`);
  console.log(`breakout-alone beat ungated-random in ${breakoutBeatsUngated} of ${totalWindows} windows`);
}

main().catch((err) => {
  console.error("confluence-vs-random failed:", err);
  process.exit(1);
});
