const { getHistoricalData } = require("./data");
const { volumeBreakoutStrategy } = require("./strategy");
const { runWalkForward } = require("./walkforward");

// Per PHASE2_SMALLCAP_SCOPING.md §1.
const TICKERS = ["MARA", "PLUG", "FUBO", "CHPT", "IONQ", "UEC", "ACHR"];

const START_DATE = "2022-01-01";
const WINDOW_MONTHS = 18;
const MIN_WINDOW_MONTHS = 3;
const LOOKBACK_MONTHS = 2; // unchanged from the large-cap volume breakout setup, per §4

const STRATEGY_PARAMS = { breakoutPeriod: 20, volumePeriod: 20, volumeMultiplier: 1.5, exitPeriod: 10 };
const RISK_CONFIG = { stopLossMethod: "atr" };
// Proposed small-cap slippage default, per §3 - not the large-cap 0.0005.
const SLIPPAGE_PERCENT = 0.003;
const FEE_PERCENT = 0.001; // unchanged, per §3

function padNum(n, width, decimals = 2) {
  return n.toFixed(decimals).padStart(width);
}

function header() {
  const h =
    "Ticker".padEnd(8) +
    "Sharpe".padStart(9) +
    "MaxDD%".padStart(10) +
    "WinRate%".padStart(10) +
    "Return%".padStart(10) +
    "Trades".padStart(8) +
    "TradedWin".padStart(10) +
    "NoSigWin".padStart(10);
  console.log(h);
  console.log("-".repeat(h.length));
}

async function main() {
  const endDate = new Date().toISOString().slice(0, 10);
  console.log(`Small/micro-cap volume breakout walk-forward validation`);
  console.log(`Tickers: ${TICKERS.join(", ")}`);
  console.log(
    `Range: ${START_DATE} to ${endDate}, window=${WINDOW_MONTHS}mo, minWindow=${MIN_WINDOW_MONTHS}mo, lookback=${LOOKBACK_MONTHS}mo, ` +
      `riskConfig=${JSON.stringify(RISK_CONFIG)}, slippagePercent=${SLIPPAGE_PERCENT}, feePercent=${FEE_PERCENT}, params=${JSON.stringify(STRATEGY_PARAMS)}\n`
  );

  header();

  let totalTrades = 0;
  const results = [];
  // date -> volume lookup per ticker, built from a single full-range fetch,
  // used purely to report position-size-vs-daily-volume after the fact -
  // not fed back into sizing or the backtest itself.
  const volumeByTicker = {};

  for (const ticker of TICKERS) {
    const fullBars = await getHistoricalData(ticker, START_DATE, endDate);
    volumeByTicker[ticker] = new Map(fullBars.map((b) => [b.date, b.volume]));

    const result = await runWalkForward(ticker, volumeBreakoutStrategy, STRATEGY_PARAMS, {
      startDate: START_DATE,
      endDate,
      windowMonths: WINDOW_MONTHS,
      minWindowMonths: MIN_WINDOW_MONTHS,
      lookbackMonths: LOOKBACK_MONTHS,
      riskConfig: RISK_CONFIG,
      slippagePercent: SLIPPAGE_PERCENT,
      feePercent: FEE_PERCENT,
    });
    results.push({ ticker, ...result });

    const agg = result.aggregate;
    const tickerTrades = result.windowResults.reduce((s, w) => s + w.trades, 0);
    totalTrades += tickerTrades;
    console.log(
      ticker.padEnd(8) +
        padNum(agg.averageSharpe, 9, 3) +
        padNum(agg.averageMaxDrawdownPercent, 10) +
        padNum(agg.averageWinRate, 10) +
        padNum(agg.averageReturnPercent, 10) +
        String(tickerTrades).padStart(8) +
        String(agg.windowsWithSignal).padStart(10) +
        String(agg.windowsWithoutSignal).padStart(10)
    );
  }

  console.log("\n=== Averaged across all 7 tickers ===");
  const aggs = results.map((r) => r.aggregate);
  const avgSharpe = aggs.reduce((s, a) => s + a.averageSharpe, 0) / aggs.length;
  const avgDD = aggs.reduce((s, a) => s + a.averageMaxDrawdownPercent, 0) / aggs.length;
  const avgWinRate = aggs.reduce((s, a) => s + a.averageWinRate, 0) / aggs.length;
  const avgReturn = aggs.reduce((s, a) => s + a.averageReturnPercent, 0) / aggs.length;
  console.log(
    `avgSharpe ${avgSharpe.toFixed(3)}  avgMaxDD ${avgDD.toFixed(2)}%  avgWinRate ${avgWinRate.toFixed(2)}%  avgReturn ${avgReturn.toFixed(2)}%  totalTrades ${totalTrades}`
  );

  console.log("\n=== Per-window trade counts (flagging zero/low-signal windows explicitly) ===");
  for (const r of results) {
    for (const w of r.windowResults) {
      const flag = w.trades === 0 ? "  <- ZERO SIGNAL" : w.trades <= 2 ? "  <- LOW SIGNAL (<=2 trades)" : "";
      console.log(
        `${r.ticker.padEnd(8)}${w.windowStart} to ${w.windowEnd}  trades=${String(w.trades).padStart(2)}  hasSignal=${String(w.hasSignal).padEnd(5)}${flag}`
      );
    }
  }

  console.log("\n=== Position size vs. that day's actual volume, every executed BUY (visibility only, not a sizing check) ===");
  const ratios = [];
  for (const r of results) {
    for (const w of r.windowResults) {
      for (const t of w.tradeLog) {
        if (t.action !== "BUY") continue;
        const dayVolume = volumeByTicker[r.ticker].get(t.date);
        if (dayVolume == null || dayVolume === 0) {
          console.log(`${r.ticker.padEnd(8)}${t.date}  shares=${t.shares}  dayVolume=UNKNOWN - skipped from ratio stats`);
          continue;
        }
        const pct = (t.shares / dayVolume) * 100;
        ratios.push({ ticker: r.ticker, date: t.date, shares: t.shares, dayVolume, pct });
        console.log(
          `${r.ticker.padEnd(8)}${t.date}  shares=${String(t.shares).padStart(6)}  dayVolume=${dayVolume.toLocaleString().padStart(12)}  ` +
            `positionPctOfDayVolume=${pct.toFixed(4)}%`
        );
      }
    }
  }

  const maxRatio = ratios.reduce((m, r) => Math.max(m, r.pct), 0);
  const avgRatio = ratios.length ? ratios.reduce((s, r) => s + r.pct, 0) / ratios.length : 0;
  const maxEntry = ratios.find((r) => r.pct === maxRatio);
  console.log(
    `\nAcross ${ratios.length} BUY trades: max positionPctOfDayVolume = ${maxRatio.toFixed(4)}% ` +
      `(${maxEntry ? `${maxEntry.ticker} ${maxEntry.date}` : "n/a"}), average = ${avgRatio.toFixed(4)}%`
  );
}

main().catch((err) => {
  console.error("smallcap-validation failed:", err);
  process.exit(1);
});
