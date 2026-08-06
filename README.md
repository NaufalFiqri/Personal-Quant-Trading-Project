# Personal Quant Trading Project

A personal project to learn systematic/quantitative trading from the ground up. Each piece - data fetching, indicators, strategy logic, backtesting, parameter tuning - is built and tested in isolation before the next one is added, so the pipeline stays verifiable at every stage instead of becoming a black box.

**This is an educational/personal project, not financial advice. No real money has been traded.**

## Current status

**Infrastructure: complete and tested.** Data pipeline, indicators, strategy signal generation, backtesting engine, parameter sweep, multi-regime comparison, and walk-forward validation are all built and working. See Architecture below for the file-by-file breakdown.

**Research Phase 1: CONCLUDED, negative result.** Phase 1 tested a family of simple technical indicator strategies (SMA/EMA/WMA crossover, RSI mean-reversion) across single-period backtests, a parameter sweep, a bull-vs-bear regime comparison, and walk-forward validation with cross-ticker replication on 7 large-cap stocks (AAPL, MSFT, JNJ, GOOGL, AMZN, NVDA, META). **No strategy in this family showed a robust, replicable edge over buy & hold.** See "Research Phase 1: Findings" below for the numbers.

**No strategy is currently recommended for real capital.** No paper trading or live trading has occurred - nothing in this repo places real trades. Everything runs against historical data offline.

**Research Phase 2: IN PROGRESS.** Direction chosen: generic risk-management infrastructure first, before any new signal strategy. `server/quant/risk.js` (position sizing, stop-loss calculation, risk/reward validation, drawdown circuit breaker) is built and unit-tested, standalone and not yet wired into any strategy or backtest run.

**Not built yet:**
- Paper trading (simulated live execution)
- Live trading (real orders, real money)
- Any frontend/UI
- A Phase 2 signal strategy that uses `risk.js`
- Wiring `risk.js` into `backtest.js` (currently invests 100% of cash on every BUY signal with no position sizing or stop-loss)

## Architecture

Pipeline: **raw data -> indicators -> strategy signals -> backtest simulation -> parameter sweep / strategy comparison / walk-forward testing**

- `server/quant/data.js` - fetches historical daily OHLCV bars from Yahoo Finance, caches them to `server/data/ohlcv/<TICKER>.json` so repeated runs don't re-fetch the same range. Coverage is tracked as a set of explicitly-queried date intervals (not a single min/max envelope), so a gap between two separately-fetched periods is correctly detected as a cache miss instead of silently returning no data for the gap.
- `server/quant/indicators.js` - pure functions computing technical indicators (SMA, EMA, WMA, RSI, ATR) from a price series (ATR from OHLC bars instead, since it needs high/low as well as close).
- `server/quant/strategy.js` - consumes bars + indicators and produces a list of BUY/SELL signals. Includes `maCrossoverStrategy` (SMA/EMA/WMA crossover, selectable via `maType`) and `rsiMeanReversionStrategy` (buy on recovery from oversold, sell on drop from overbought).
- `server/quant/backtest.js` - replays a strategy's signals against historical bars day by day, simulating a portfolio with fees and slippage, and reports return, drawdown, win rate, Sharpe ratio (return per unit of volatility, annualized, risk-free rate assumed 0), time-in-market percent, and an equity curve.
- `server/quant/sweep.js` - runs the SMA crossover strategy + backtest across a grid of short/long period combinations and tickers.
- `server/quant/compare-strategies.js` - runs SMA/EMA/WMA crossover and RSI mean-reversion strategies through the same backtest across tickers. Exports `runComparison(startDate, endDate)` so the same fixed strategy/parameter/ticker set can be re-run over different date ranges.
- `server/quant/compare-strategies-2022-bear.js` - re-runs `compare-strategies.js`'s comparison over the 2022-01-01 to 2022-12-31 window (a down year for US equities), unchanged strategies/parameters, to isolate the effect of market regime.
- `server/quant/walkforward.js` - `runWalkForward(ticker, strategyFn, strategyParams, options)` splits a date range into sequential non-overlapping windows (default 6 months, dropping a trailing window shorter than `minWindowMonths`) and runs the same fixed strategy/parameters independently on each one, with no per-window fitting or tuning. Returns per-window results plus aggregate stats: percent of windows that beat buy & hold, average return, average Sharpe, and a consistency score (standard deviation of per-window returns). Zero-trade windows are excluded from the aggregates but still shown per-window, labeled.
- `server/quant/ema-crossover-evidence.js` - runs `walkforward.js` with EMA 20/50 crossover across 7 tickers at both 6-month and 3-month window granularity, to test whether a standout single-ticker result replicates.
- `server/quant/risk.js` - standalone, long-only risk-management logic, not tied to any specific strategy. `calculatePositionSize` sizes a position from account equity, a configurable risk-per-trade percent, and the stop-loss distance (with an optional `maxPositionPercent` hard cap). `calculateStopLoss` supports `"percent"` and `"atr"` methods. `validateRiskReward` rejects trades below a configurable minimum reward:risk ratio. `checkDrawdownCircuitBreaker` takes an equity curve (same `{ date, value }` shape `backtest.js` already produces) and flags whether daily or weekly loss has breached a configurable threshold - recomputed fresh from the tail of the curve each call rather than kept as hidden state, so it works the same way in a backtest loop and a future live/paper-trading loop.

Each stage has a matching `test-*.js` file that exercises it against real fetched data and prints results for manual inspection, except `test-risk.js`, which uses hand-constructed price/equity scenarios (no network fetch needed) since risk.js is pure math with no external data dependency.

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
node server/quant/test-walkforward.js   # walk-forward: SMA/EMA/WMA/RSI across sequential 6-month windows, 2022-today
node server/quant/ema-crossover-evidence.js # EMA 20/50 walk-forward across 7 tickers, 6-month and 3-month windows
node server/quant/test-risk.js          # risk-management unit tests: position sizing, stop-loss, R:R, circuit breaker
```

## Research Phase 1: Methodology

Each step was added because the previous one couldn't answer the question that came up next - the progression, in order:

1. **Single-period backtest** (SMA 20/50 crossover, one 3-year window, AAPL/MSFT/JNJ). Question: does this strategy beat buy & hold at all? Answer: no, on 2 of 3 stocks. But a single backtest on a single parameter set can't say whether that's a property of the strategy or just an unlucky parameter choice.
2. **Parameter sweep** (6 period combinations x 3 tickers = 18 tests). Question: is there a better short/long period pair being missed? Answer: still only 2 of 18 beat buy & hold. This shifted the question from "which parameters" to "is the moving-average type or the underlying logic (trend-following vs mean-reversion) the bigger lever" - which a period sweep alone can't answer.
3. **Multi-strategy, multi-regime comparison** (SMA/EMA/WMA crossover + RSI mean-reversion, 3-year rising-market window, then the same fixed strategies/parameters re-run on the 2022 bear-market window). Question: does strategy type matter more than tuning, and does market regime change the answer? Answer: yes to both - only 3 of 12 beat buy & hold in the rising market, but 8 of 12 did in the 2022 bear market. A comparison run over one regime can't tell you if a result is regime-specific.
4. **Walk-forward validation** (same fixed strategies/parameters, sequential 6-month windows spanning both regimes in one continuous run, 2022 to today). Question: does performance hold up consistently across many real sequential periods, or did the regime comparison just get lucky with which windows it picked? Answer: mostly coin-flip win rates and near-zero/negative Sharpe ratios - except one standout (EMA 20/50 on AAPL, 80% winning windows, Sharpe 0.949). But that result came from only 5 traded windows - too few to trust on its own, which a single-ticker walk-forward can't resolve.
5. **Cross-ticker replication** (EMA 20/50 walk-forward repeated on 4 more comparable large-cap tickers, plus a finer 3-month window granularity check). Question: does the AAPL standout generalize, or was it specific to that one ticker's price path? Answer: it did not replicate - see Findings below.

## Research Phase 1: Findings

**SMA/EMA/WMA crossover (20/50), rising market only (3-year window, AAPL/MSFT/JNJ):** 3 of 12 tests beat buy & hold, all on JNJ - none of the three MA types beat buy & hold on AAPL or MSFT in this window.

**Same strategies, 2022 bear market:** 8 of 12 beat buy & hold - the same strategies that looked weak in a rising market showed real downside protection in a down year. This is a regime effect, not evidence the strategies are "better" in an absolute sense (see Key Lessons Learned).

**RSI 14 mean-reversion (30/70 thresholds):** Often posted very high win rates (up to 100% in some 2022-bear-market windows) but low total return, because it traded infrequently and captured small moves rather than large ones. High win rate did not imply good returns for this strategy.

**Walk-forward validation (6-month windows, 2022-today, corrected aggregates):** Across SMA/EMA/WMA/RSI on AAPL/MSFT/JNJ, winning-window rates clustered close to a coin flip (37.5%-83.3%) and average Sharpe ratios were mostly near zero or negative. The one standout was EMA 20/50 on AAPL: 80% winning windows, +6.97% average return per window, Sharpe 0.949 - but based on only 5 traded windows.

**Cross-ticker replication of the AAPL EMA result (6-month windows, 7 tickers):** AAPL 80% (5 traded windows) did not replicate - MSFT and JNJ came in at 50%, GOOGL/AMZN/NVDA at 42.86%, META at 25%. Average returns and Sharpe ratios for the other 6 tickers were also well below AAPL's. **Conclusion: the AAPL result was very likely a coincidence specific to that one ticker's price path in that period, not a real structural edge.**

**Documented methodology bug:** an earlier version of the walk-forward aggregate stats counted zero-trade windows (the strategy never fired in that window) as if their 0.00% return were a real outcome, which counted "never traded" as a win whenever the benchmark happened to be negative that window. This inflated win rates until it was found and fixed - no-signal windows are now excluded from all aggregate calculations but still shown, labeled, in the per-window table. This is documented as a specific example in Key Lessons Learned, since it's a mistake worth remembering rather than just a bug that got fixed.

## Key Lessons Learned

- **Win rate alone is not a reliable metric.** RSI mean-reversion posted high win rates (sometimes 100% in a given window) while still underperforming buy & hold overall, because it traded rarely and captured small moves. A strategy can be "right" most of the time it acts and still not be a good strategy.
- **Performance is regime-dependent.** The same trend-following strategies underperformed buy & hold in a 3-year rising market (3/12 beat B&H) and outperformed it in the 2022 bear market (8/12 beat B&H). Testing only one regime would have produced a confidently wrong conclusion in either direction.
- **Small sample sizes produce misleadingly extreme results.** EMA 20/50 on AAPL looked like a genuine edge (80% win rate, Sharpe 0.949) on 5 traded windows. Replicating the same test on 6 comparable tickers showed win rates of 25-50% and Sharpe ratios from -0.53 to 0.58 - the AAPL number was very likely noise dressed up as a result.
- **Out-of-sample/walk-forward testing catches what single-period backtesting can't.** A single 3-year backtest and even a 6-combination parameter sweep both understated how much the results depended on exactly which period was chosen. Walk-forward testing across many sequential windows, and then replicating across tickers, is what actually exposed the AAPL result as unreliable.
- **Test window length has to match the strategy's own time horizon.** Re-running the walk-forward test with 3-month windows instead of 6 produced mostly "no signal" results (14-17 of 18 windows per ticker), because a 50-period EMA needs ~50 trading days just to produce its first value, leaving almost no room in a ~63-day window for a crossover to occur. The 3-month test wasn't evidence the strategy failed - it was evidence the test design didn't fit the strategy being tested.

See [LEARNINGS.md](LEARNINGS.md) for a more detailed, informal writeup of these lessons.

## What's Next

**Phase 2 direction chosen:** generic risk-management infrastructure first (`risk.js`, done - see Architecture above), before any new signal strategy. Rationale: Phase 1 showed the tested indicator family has no robust edge on its own; risk management (position sizing, stop-losses, a drawdown circuit breaker) is useful under any future strategy regardless of what that strategy turns out to be, so it doesn't need a signal decision made first.

Not yet decided:
- **New signal types** - moving beyond simple technical indicator crossovers/thresholds toward something with a different theoretical basis, to actually use `risk.js` against.
- Whether/how to wire `risk.js` into `backtest.js` before or after a new strategy exists.

## Journal

### 2026-08-06 (session 8)
- Started Research Phase 2. Chose direction: build generic risk-management infrastructure before any new signal strategy, since it's useful under any future strategy and doesn't require a signal decision first (see What's Next).
- Added `calculateATR` to `indicators.js` (Wilder-smoothed, same recurrence pattern `calculateRSI` already uses for avgGain/avgLoss), needed to support ATR-based stop-losses.
- Built `risk.js`: standalone, long-only, not tied to any strategy.
  - `calculatePositionSize` - sizes a position from account equity, a configurable risk-per-trade percent, and stop-loss distance; optional `maxPositionPercent` hard cap for when a very tight stop would otherwise size a position larger than the account.
  - `calculateStopLoss` - `"percent"` and `"atr"` methods.
  - `validateRiskReward` - rejects trades below a configurable minimum reward:risk ratio.
  - `checkDrawdownCircuitBreaker` - flags a daily or weekly loss-threshold breach from an equity curve (same shape `backtest.js` produces), recomputed fresh from the curve's tail each call rather than kept as internal state, so the same function works in a backtest loop today and a live/paper-trading loop later without changing shape.
  - Design decision: stayed long-only (no `direction` param) rather than supporting short positions now, since nothing in the repo shorts yet (backtest.js is long-only) and Phase 1's whole methodology was building only what's needed at each step rather than for hypothetical future requirements. Revisit if/when a short-capable strategy or live short-selling is actually built.
- `test-risk.js`: 24 hand-constructed price/equity scenarios (no network fetch, unlike the other `test-*.js` files), covering normal sizing, the max-position cap, both stop-loss methods, valid/invalid R:R at different minimums, and the circuit breaker under a calm curve, a single-day crash, a gradual multi-day grind-down, a rising curve, and a curve too short for the weekly lookback. `test-indicators.js` got 2 new ATR checks (hand-computed constant-true-range values, and a volatility-spike reaction check in the same style as the existing EMA/WMA reaction-speed test). All 33 checks across both files pass.
- Not done yet: `risk.js` is not wired into `backtest.js` or any strategy - `backtest.js` still invests 100% of cash on every BUY with no sizing or stop-loss. That's deliberate for now (see What's Next) - risk.js was built and tested in isolation first, same pattern Phase 1 used for indicators/strategy/backtest.

### 2026-08-02 (session 7)
- Evidence-gathering step, prompted by the session 6 walk-forward result: EMA 20/50 crossover on AAPL stood out (80% winning windows, +6.97% avg return/window, Sharpe 0.949) but on only 5 traded windows - too small a sample to trust on its own. Built `ema-crossover-evidence.js` to gather more evidence before treating it as anything more than a candidate finding, not to confirm or debunk it.
- Part A: re-ran EMA 20/50 walk-forward (6-month windows, 2022-01-01 to today) on AAPL/MSFT/JNJ plus 4 additional large-cap, liquid, moderate-to-high volatility tech/growth-adjacent tickers (GOOGL, AMZN, NVDA, META), same exclusion logic for zero-trade windows. AAPL/MSFT/JNJ numbers matched the session 6 run exactly, confirming nothing broke.
  - Ticker / traded windows / no-signal windows / winning windows% / avg return% / avg Sharpe / consistency (stdDev):
  - AAPL 5/4 - 80.00 / 6.97 / 0.949 / 7.84
  - MSFT 8/1 - 50.00 / 0.10 / 0.092 / 8.66
  - JNJ 6/3 - 50.00 / 0.03 / -0.526 / 3.56
  - GOOGL 7/2 - 42.86 / 6.85 / 0.512 / 10.02
  - AMZN 7/2 - 42.86 / 5.73 / 0.583 / 13.69
  - NVDA 7/2 - 42.86 / -2.26 / -0.416 / 11.81
  - META 4/5 - 25.00 / 3.46 / 0.435 / 8.77
- Part B: same 7 tickers, same date range, `windowMonths = 3` instead of 6. Note on interpreting this table: a 50-period EMA needs ~50 trading days just to produce its first value, and a 3-month window only has ~63 trading days total - so most windows here have almost no room left for a crossover to actually occur. That's why the no-signal counts are very high (14-17 of 18 windows per ticker) and traded-window counts are very low (1-4) - this is a mismatch between window length and the strategy's own warm-up period, not a statement about the strategy's quality.
  - Ticker / traded windows / no-signal windows / winning windows% / avg return% / avg Sharpe / consistency (stdDev):
  - AAPL 2/16 - 50.00 / -0.67 / -1.690 / 0.35
  - MSFT 1/17 - 0.00 / -0.15 / -2.000 / 0.00
  - JNJ 1/17 - 0.00 / 1.00 / 1.773 / 0.00
  - GOOGL 4/14 - 25.00 / 1.51 / 0.834 / 1.98
  - AMZN 4/14 - 50.00 / -0.44 / -1.058 / 3.25
  - NVDA 1/17 - 100.00 / -5.48 / -2.505 / 0.00
  - META 1/17 - 0.00 / -0.70 / -0.252 / 0.00
  - Given how few traded windows most tickers have at 3-month granularity, this table is not read as a reliable comparison point to the 6-month table - it mainly shows that 3-month windows are too short for this indicator's warm-up period to leave a usable sample.
- **End of session 7: Research Phase 1 concluded.** AAPL's 6-month EMA standout did not replicate across 6 comparable tickers - see Findings and Key Lessons Learned above for the writeup. This README was restructured into a capstone document for the phase; a `LEARNINGS.md` study-notes file was added alongside it.

### 2026-08-02 (session 6)
- Fixed a methodology bug in `walkforward.js`'s aggregate stats, found by inspecting the session 5 output: about 31% of all windows had 0 trades (the strategy never generated a signal in that 6-month slice), yet those windows' 0.00% return was still being counted in `winningWindowsPercent`, `averageReturnPercent`, and `consistencyScore`. Since `beatBenchmark` was computed as `return > buyAndHold`, a 0-trade window counted as a "win" any time the benchmark itself was negative - misrepresenting "the strategy never traded" as "the strategy made a defensive call and avoided a loss." Two different things were being conflated: not trading, and successfully avoiding a loss by trading defensively. Only the latter is a real signal about the strategy; the former is just an inactive window.
- Fix: no-signal windows (`trades === 0`) are now excluded from all four aggregate calculations (`winningWindowsPercent`, `averageReturnPercent`, `averageSharpe` - same issue applied here too, so excluded for consistency - and `consistencyScore`), but still appear in the per-window table, labeled `no signal` in the Beat B&H column instead of YES/no, so "how often did this strategy even do something" isn't hidden.
- Also fixed the final window in every ticker's series: because 2022-01-01 to today doesn't divide evenly by 6 months, the last window was only ~1 month long and not really comparable to the rest. `buildWindows` now drops a trailing window shorter than `minWindowMonths` (default 3) instead of keeping a stunted window.
- Re-ran walk-forward after the fix. The aggregate numbers changed meaningfully once no-signal windows were excluded, confirming this wasn't just noise - e.g. EMA 20/50 on AAPL went from "60.00% winning windows, avg return 3.49%" (session 5, no-signal windows counted, 10 windows incl. the ~1-month trailing one) to "80.00% winning windows (4 of 5 traded windows), avg return 6.97%" (session 6, corrected, 9 windows total after dropping the trailing one, 4 excluded as no-signal). The session 5 numbers above are left as-is for the record but are superseded by these.
- Corrected aggregate stats per combo (traded windows / excluded no-signal / winning windows% / avg return% / avg Sharpe / consistency stdDev):
  - SMA 20/50: AAPL 7/2 - 57.14 / 0.62 / -0.125 / 10.20 - MSFT 8/1 - 50.00 / -1.88 / -0.076 / 9.98 - JNJ 6/3 - 50.00 / 0.65 / -0.061 / 4.35
  - EMA 20/50: AAPL 5/4 - 80.00 / 6.97 / 0.949 / 7.84 - MSFT 8/1 - 50.00 / 0.10 / 0.092 / 8.66 - JNJ 6/3 - 50.00 / 0.03 / -0.526 / 3.56
  - WMA 20/50: AAPL 7/2 - 71.43 / 1.51 / 0.056 / 9.56 - MSFT 8/1 - 37.50 / -0.28 / 0.176 / 8.45 - JNJ 6/3 - 66.67 / -0.67 / -0.478 / 4.48
  - RSI 14 (30/70): AAPL 6/3 - 66.67 / -0.32 / 0.341 / 13.13 - MSFT 6/3 - 83.33 / -0.12 / 0.312 / 9.58 - JNJ 7/2 - 71.43 / 1.32 / 0.064 / 5.41
  - No strategy is described as "validated" here; these are raw corrected numbers for discussion. This is a good example of a backtesting methodology bug: the code wasn't wrong about what happened (0 trades really did happen), but the aggregate math was silently treating "did nothing" the same as "made a good defensive decision," which would have overstated how often these strategies actually protected capital through action.

### 2026-08-02 (session 5)
- Built `walkforward.js`: splits a date range into sequential non-overlapping windows (default 6 months) and runs a fixed strategy/parameter set independently per window - no per-window fitting or tuning, since the point is testing consistency across many real periods rather than optimizing anything.
- While building `test-walkforward.js`, found and fixed a real bug in `data.js`'s cache: it tracked coverage as a single min/max `rangeStart`/`rangeEnd` envelope, so two separately-fetched periods with a gap between them (2022 fetched in one session, 2023-08-onward fetched in another, leaving 2022-12-30 to 2023-08-02 never actually queried) were wrongly reported as fully covered. Requests landing in that gap silently returned 0 bars instead of fetching, which would have shown up as bogus "0.00% return, 0 trades" rows for that window across every strategy and ticker. Fixed by tracking coverage as a set of explicitly-queried intervals instead of one envelope, so a real gap correctly causes a cache miss. Verified the fix directly (fetching across a known gap now triggers a fetch and returns real bars) and by re-running the full test suite before generating results below.
- Ran walk-forward with 6-month windows over 2022-01-01 to 2026-08-02 (10 windows, the last partial) for SMA/EMA/WMA 20/50 and RSI 14 (30/70), on AAPL, MSFT, JNJ (12 strategy/ticker combos, 120 window-results total). This span includes both the 2022 bear period and the subsequent rising market as consecutive windows in one continuous run.
- Aggregate stats per combo (winning windows% / avg return% / avg Sharpe / consistency stdDev):
  - SMA 20/50: AAPL 40.00 / -0.08 / -0.140 / 7.71 - MSFT 40.00 / -1.61 / -0.069 / 9.00 - JNJ 50.00 / 0.39 / -0.037 / 3.38
  - EMA 20/50: AAPL 60.00 / 3.49 / 0.475 / 6.55 - MSFT 40.00 / 0.08 / 0.073 / 7.75 - JNJ 50.00 / 0.02 / -0.316 / 2.76
  - WMA 20/50: AAPL 50.00 / 1.06 / 0.039 / 8.03 - MSFT 30.00 / -0.22 / 0.141 / 7.56 - JNJ 50.00 / -0.40 / -0.287 / 3.48
  - RSI 14 (30/70): AAPL 40.00 / -0.19 / 0.205 / 10.18 - MSFT 50.00 / -0.07 / 0.187 / 7.42 - JNJ 50.00 / 0.93 / 0.045 / 4.56
  - Full per-window breakdown (each window's return%, buy&hold%, Sharpe, trades, beat-B&H) is in the script output, not reproduced here - re-run `test-walkforward.js` to see it. No strategy is described as "validated" here; these are raw numbers for discussion.

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
