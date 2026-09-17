// Random-entry baseline for the insider-cluster strategy, per
// PHASE2_INSIDER_SIGNAL_SCOPING.md §6 step 5: the exit shape here is
// time-based (6-12 month hold), not price-reactive, so the random baseline
// needs its own matching time-based-hold variant rather than reusing
// randomEntryStrategy's existing 10-day-low channel exit unmodified. This is
// exactly that new (small) variant, built directly against the same 8
// tickers and the same per-ticker entry count as the real cluster events.

const { getHistoricalData } = require("./data");
const { runBacktest } = require("./backtest");

const TICKERS = ["RLI", "WDFC", "CW", "NVST", "ICUI", "CFR", "REXR", "BMI"];
// Matched to the real cluster count per ticker (not the actual-fired-trade
// count from the real backtest) - RLI=3, WDFC=3, CW=1, NVST=2, ICUI=1,
// CFR=2, REXR=1, BMI=1, per the already-verified frequency-check results.
const ENTRY_COUNTS = { RLI: 3, WDFC: 3, CW: 1, NVST: 2, ICUI: 1, CFR: 2, REXR: 1, BMI: 1 };
const START_DATE = "2022-01-01";
const END_DATE = new Date().toISOString().slice(0, 10);
const RISK_CONFIG = { stopLossMethod: "atr" };
const EXIT_TRADING_DAYS = 252;

function mulberry32(seed) {
  let state = seed | 0;
  return function () {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Picks n distinct random bar indices (sorted ascending) from bars, seeded
// for reproducibility.
function pickRandomDates(bars, n, seed) {
  const rng = mulberry32(seed);
  const indices = new Set();
  while (indices.size < n && indices.size < bars.length) {
    indices.add(Math.floor(rng() * bars.length));
  }
  return [...indices].sort((a, b) => a - b).map((i) => bars[i].date);
}

// Same entry/exit state machine as insiderClusterStrategy in strategy.js,
// but driven directly by a pre-picked list of trigger dates instead of
// detectInsiderClusters(pTransactions) - the only difference from the real
// strategy is where the trigger dates come from.
function randomTimedHoldStrategy(bars, triggerDates, exitTradingDays) {
  const sortedTriggerDates = [...triggerDates].sort();
  const signals = [];
  let inPosition = false;
  let barsHeldSinceEntry = 0;
  let triggerIdx = 0;

  for (const bar of bars) {
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

function pairTrades(trades) {
  const pairs = [];
  let openBuy = null;
  for (const t of trades) {
    if (t.action === "BUY") {
      openBuy = t;
    } else if (t.action === "SELL" && openBuy) {
      pairs.push({ buy: openBuy, sell: t });
      openBuy = null;
    }
  }
  if (openBuy) pairs.push({ buy: openBuy, sell: null });
  return pairs;
}

async function main() {
  console.log(`Random-entry baseline, matched-count time-based-hold, ${START_DATE} to ${END_DATE}`);
  console.log(`Tickers: ${TICKERS.join(", ")}`);
  console.log(`riskConfig: ${JSON.stringify(RISK_CONFIG)}, exitTradingDays: ${EXIT_TRADING_DAYS}\n`);

  const perTickerResults = [];
  let pooledRoundTrips = 0;
  let pooledWinningRoundTrips = 0;

  for (let i = 0; i < TICKERS.length; i++) {
    const ticker = TICKERS[i];
    const bars = await getHistoricalData(ticker, START_DATE, END_DATE);
    const n = ENTRY_COUNTS[ticker];
    const triggerDates = pickRandomDates(bars, n, 42 + i);
    const signals = randomTimedHoldStrategy(bars, triggerDates, EXIT_TRADING_DAYS);
    const result = runBacktest(bars, signals, { riskConfig: RISK_CONFIG });

    const pairs = pairTrades(result.trades);
    let roundTrips = 0;
    let winningRoundTrips = 0;
    for (const p of pairs) {
      if (p.sell) {
        roundTrips++;
        if (p.sell.cashAfter > p.buy.cashBefore) winningRoundTrips++;
      }
    }
    pooledRoundTrips += roundTrips;
    pooledWinningRoundTrips += winningRoundTrips;

    console.log(`${"=".repeat(70)}\n${ticker} (random trigger dates: ${triggerDates.join(", ")})\n${"=".repeat(70)}`);
    console.log(`Return: ${result.totalReturnPercent.toFixed(2)}%  MaxDD: ${result.maxDrawdownPercent.toFixed(2)}%  WinRate: ${result.winRate.toFixed(2)}%`);
    console.log(`Trades (round trips: ${roundTrips}, winning: ${winningRoundTrips}):`);
    for (const p of pairs) {
      if (p.sell) {
        const pnlPercent = ((p.sell.price - p.buy.price) / p.buy.price) * 100;
        console.log(
          `  BUY ${p.buy.date} @ $${p.buy.price.toFixed(2)}  ->  SELL ${p.sell.date} @ $${p.sell.price.toFixed(2)} (${p.sell.reason})  P&L: ${pnlPercent.toFixed(2)}%  ${p.sell.cashAfter > p.buy.cashBefore ? "WIN" : "LOSS"}`
        );
      } else {
        console.log(`  BUY ${p.buy.date} @ $${p.buy.price.toFixed(2)}  ->  STILL OPEN as of ${END_DATE}`);
      }
    }
    console.log("");

    perTickerResults.push({ ticker, ...result, roundTrips, winningRoundTrips });
  }

  console.log(`${"=".repeat(70)}\nPOOLED SUMMARY ACROSS ALL 8 TICKERS (RANDOM BASELINE)\n${"=".repeat(70)}`);
  console.log("Ticker".padEnd(8) + "Return%".padStart(10) + "MaxDD%".padStart(10) + "WinRate%".padStart(10) + "RoundTrips".padStart(12));
  for (const r of perTickerResults) {
    console.log(
      r.ticker.padEnd(8) +
        r.totalReturnPercent.toFixed(2).padStart(10) +
        r.maxDrawdownPercent.toFixed(2).padStart(10) +
        r.winRate.toFixed(2).padStart(10) +
        String(r.roundTrips).padStart(12)
    );
  }
  const avgReturn = perTickerResults.reduce((s, r) => s + r.totalReturnPercent, 0) / perTickerResults.length;
  const pooledWinRate = pooledRoundTrips > 0 ? (pooledWinningRoundTrips / pooledRoundTrips) * 100 : 0;
  console.log(`\nAverage return% across 8 tickers (equal-weighted): ${avgReturn.toFixed(2)}%`);
  console.log(`Pooled round trips across all 8 tickers: ${pooledRoundTrips}, winning: ${pooledWinningRoundTrips}`);
  console.log(`Pooled win rate (winning round trips / total round trips): ${pooledWinRate.toFixed(2)}%`);
}

main().catch((err) => {
  console.error("full-backtest-insider-random-baseline failed:", err);
  process.exit(1);
});
