# Personal Quant Trading Project

A personal project to learn systematic/quantitative trading from the ground up. Each piece - data fetching, indicators, strategy logic, backtesting, parameter tuning - is built and tested in isolation before the next one is added, so the pipeline stays verifiable at every stage instead of becoming a black box.

**This is an educational/personal project, not financial advice. No real money has been traded.**

## Current status

**Built and tested:**
- Historical OHLCV data pipeline with local caching (`data.js`)
- Technical indicators: SMA, EMA, WMA, RSI (`indicators.js`)
- Moving-average crossover strategy, configurable to SMA/EMA/WMA (`strategy.js`)
- RSI mean-reversion strategy (`strategy.js`)
- Backtesting engine with fees, slippage, drawdown, win rate, Sharpe ratio, and time-in-market stats (`backtest.js`)
- Parameter sweep across multiple SMA period combinations and tickers (`sweep.js`)
- Cross-strategy comparison (SMA/EMA/WMA crossover vs RSI mean-reversion) across tickers, reusable across date ranges (`compare-strategies.js`)
- Same cross-strategy comparison re-run on a 2022 bear-market window (`compare-strategies-2022-bear.js`)

**Not built yet:**
- Paper trading (simulated live execution)
- Live trading (real orders, real money)
- Any frontend/UI

Nothing in this repo places real trades. Everything runs against historical data offline.

## Architecture

Pipeline: **raw data -> indicators -> strategy signals -> backtest simulation -> parameter sweep / strategy comparison**

- `server/quant/data.js` - fetches historical daily OHLCV bars from Yahoo Finance, caches them to `server/data/ohlcv/<TICKER>.json` so repeated runs don't re-fetch the same range.
- `server/quant/indicators.js` - pure functions computing technical indicators (SMA, EMA, WMA, RSI) from a price series.
- `server/quant/strategy.js` - consumes bars + indicators and produces a list of BUY/SELL signals. Includes `maCrossoverStrategy` (SMA/EMA/WMA crossover, selectable via `maType`) and `rsiMeanReversionStrategy` (buy on recovery from oversold, sell on drop from overbought).
- `server/quant/backtest.js` - replays a strategy's signals against historical bars day by day, simulating a portfolio with fees and slippage, and reports return, drawdown, win rate, Sharpe ratio (return per unit of volatility, annualized, risk-free rate assumed 0), time-in-market percent, and an equity curve.
- `server/quant/sweep.js` - runs the SMA crossover strategy + backtest across a grid of short/long period combinations and tickers.
- `server/quant/compare-strategies.js` - runs SMA/EMA/WMA crossover and RSI mean-reversion strategies through the same backtest across tickers. Exports `runComparison(startDate, endDate)` so the same fixed strategy/parameter/ticker set can be re-run over different date ranges.
- `server/quant/compare-strategies-2022-bear.js` - re-runs `compare-strategies.js`'s comparison over the 2022-01-01 to 2022-12-31 window (a down year for US equities), unchanged strategies/parameters, to isolate the effect of market regime from the earlier 3-year (rising-market) results.

Each stage has a matching `test-*.js` file that exercises it against real fetched data and prints results for manual inspection.

## How to run it

```bash
npm install
```

Run each stage independently:

```bash
node server/quant/test-data.js          # fetch/cache check
node server/quant/test-indicators.js    # indicator sanity check (SMA, EMA, WMA, RSI)
node server/quant/test-strategy.js      # signal generation on AAPL
node server/quant/test-backtest.js      # full backtest on AAPL, MSFT, JNJ
node server/quant/sweep.js              # SMA parameter sweep across combos + tickers
node server/quant/compare-strategies.js # SMA vs EMA vs WMA vs RSI, across tickers (3-year window)
node server/quant/compare-strategies-2022-bear.js # same comparison, 2022 bear-market window
```

## Key learnings

The first backtest (20/50 SMA crossover, 3-year window, $10k start, with fees + slippage) underperformed buy & hold on 2 of 3 tested stocks (AAPL, MSFT) and only slightly beat it on the third (JNJ). That result is why the next step was a parameter sweep across multiple short/long period combinations rather than assuming the first configuration tried was representative - a single backtest on a single parameter set doesn't tell you much about whether an approach generalizes.

The parameter sweep (6 period combinations x 3 tickers = 18 tests) still only beat buy & hold in 2 of 18 cases, both on JNJ. This pointed at a different question than "which parameters are best": whether the moving-average type itself, or the underlying strategy logic (trend-following crossover vs mean-reversion), matters more than tuning periods on a single approach. That's why EMA/WMA variants and an RSI mean-reversion strategy were added next, and compared across the same tickers rather than assuming the SMA crossover shape was the right one to keep tuning.

## Journal

### 2026-08-02 (session 4)
- Added `sharpeRatio` and `timeInMarketPercent` to `backtest.js`'s summary stats. Sharpe is computed from the equity curve's daily returns (mean / stdDev, annualized by sqrt(252)), risk-free rate assumed 0. Time-in-market is the percent of bars where the strategy held shares rather than cash.
- Confirmed on the existing 3-year AAPL/MSFT/JNJ backtest (same as prior sessions): Sharpe = 0.510 (AAPL), 0.013 (MSFT), 1.167 (JNJ); time in market = 56.65% / 50.13% / 51.99% respectively. Total return, buy & hold, max drawdown, and win rate numbers were unchanged by this addition, as expected.
- Generalized `compare-strategies.js` to export `runComparison(startDate, endDate)` and re-ran the exact same strategy/parameter set (SMA/EMA/WMA 20/50, RSI 14 30/70) on the exact same 3 tickers (AAPL, MSFT, JNJ) over 2022-01-01 to 2022-12-31 (a down year for US equities), via new script `compare-strategies-2022-bear.js`. No strategy logic or parameters changed between this run and the earlier 3-year run.
- 2022 bear-market results (return% / buy&hold% / max drawdown% / win rate% / Sharpe / time in market% / trades / beat B&H):
  - SMA 20/50: AAPL -22.32 / -28.61 / 24.90 / 25.00 / -1.403 / 29.48 / 8 / YES
  - SMA 20/50: MSFT -28.90 / -28.36 / 30.47 / 0.00 / -2.167 / 28.29 / 7 / no
  - SMA 20/50: JNJ 1.01 / 2.98 / 8.81 / 50.00 / 0.152 / 37.85 / 5 / no
  - EMA 20/50: AAPL -5.09 / -28.61 / 13.66 / 50.00 / -0.318 / 19.92 / 4 / YES
  - EMA 20/50: MSFT -22.19 / -28.36 / 22.19 / 0.00 / -2.147 / 17.93 / 6 / YES
  - EMA 20/50: JNJ -2.39 / 2.98 / 6.48 / 0.00 / -0.323 / 22.31 / 3 / no
  - WMA 20/50: AAPL -11.92 / -28.61 / 16.43 / 33.33 / -0.765 / 29.88 / 6 / YES
  - WMA 20/50: MSFT -18.53 / -28.36 / 21.28 / 0.00 / -1.270 / 28.69 / 8 / YES
  - WMA 20/50: JNJ -1.53 / 2.98 / 5.65 / 0.00 / -0.192 / 23.11 / 3 / no
  - RSI 14 (30/70): AAPL -13.90 / -28.61 / 27.32 / 0.00 / -0.317 / 75.30 / 3 / YES
  - RSI 14 (30/70): MSFT -22.32 / -28.36 / 32.07 / 0.00 / -0.571 / 92.83 / 1 / YES
  - RSI 14 (30/70): JNJ 3.47 / 2.98 / 13.88 / 100.00 / 0.295 / 76.89 / 2 / YES
  - 8 of 12 tests beat buy & hold in this window (versus 3 of 12 in the earlier 3-year rising-market window). Interpretation of what this means (market-regime dependence, etc.) is being worked through separately, not concluded here.

### 2026-08-02 (later session)
- Added `calculateEMA` and `calculateWMA` to `indicators.js`, with tests confirming both react faster than SMA to a sudden price change. Note: EMA is not reliably faster than WMA - WMA's window is finite and fully converges to a new price after exactly `period` bars, while EMA's influence from old data decays but never fully disappears. The test reports this instead of asserting a fixed ordering.
- Generalized the SMA crossover into `maCrossoverStrategy(bars, { shortPeriod, longPeriod, maType })`, supporting `sma`/`ema`/`wma`; `smaCrossoverStrategy` now delegates to it. Crossover/state-machine logic unchanged.
- Added `rsiMeanReversionStrategy`: buys on RSI recovering back above the oversold threshold, sells on RSI dropping back below the overbought threshold.
- Built `compare-strategies.js`: ran SMA/EMA/WMA crossover (20/50) and RSI mean-reversion (14-period, 30/70) across AAPL, MSFT, JNJ, same 3-year window as prior tests (12 tests total). Result: 3 of 12 beat buy & hold (SMA/JNJ, EMA/JNJ, WMA/JNJ - all JNJ, no combination beat buy & hold on AAPL or MSFT in this comparison). No strategy was picked as a winner.

### 2026-08-02
- Connected the local project to the GitHub repo.
- Built `sweep.js`: tested 6 SMA period combinations (10/30, 10/50, 15/40, 20/50, 20/100, 50/200) across AAPL, MSFT, and JNJ over the same 3-year window used in the step 4 backtest - 18 tests total.
- Result: 2 of 18 combinations beat buy & hold in this sample. No combination was picked as a "winner" - the full table is left for manual interpretation.
- Wrote this README to track project status going forward.

### Earlier (steps 1-4)
- Built and tested the data pipeline, indicators, SMA crossover strategy, and backtest engine (see Current Status above).
