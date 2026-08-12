# Phase 2: Regime-Adaptive Filter - Scoping Proposal

Scoping only, per candidate #3 in `PHASE2_SIGNAL_CANDIDATES.md`. No code written. For review/approval before implementation starts.

## 1. What regime distinction actually drove the Phase 1 result?

Reviewed `maCrossoverStrategy` in `server/quant/strategy.js` and the regime comparison in README.md ("Research Phase 1: Findings") and LEARNINGS.md (lesson #2).

`maCrossoverStrategy` is a pure trend-following state machine: it holds a long position from the moment the short MA crosses above the long MA until the short MA crosses back below it, and does nothing else - no regime awareness of any kind today.

The Phase 1 "regime" comparison was **two separate fixed calendar windows given to the identical strategy/parameters**, not a regime *detector* built into the strategy:
- 3-year window (2023-08 to 2026-08, a rising market): 3 of 12 strategy/ticker combos beat buy & hold.
- 2022 calendar year (a down year for US equities): 8 of 12 beat buy & hold.

The mechanism, as documented in LEARNINGS.md lesson #2: trend-following crossovers are structurally suited to catching a *sustained decline* early and exiting, which is exactly what "beating buy & hold in a crash" looks like. In a sustained *uptrend*, that same logic sells into strength and re-buys higher, costing the strategy the parts of the rally it wasn't invested through - buy & hold, with no exits at all, simply captures the whole move.

**The distinction that actually drove the result is market *direction* over an extended period (sustained uptrend vs. sustained downtrend), not volatility level per se.** 2022 was also a higher-volatility year, but nothing in Phase 1 isolated direction from volatility - they were confounded in the two windows tested. This matters for picking a detection method below: the thing to detect is trend direction, and volatility is a plausible but unconfirmed correlate of it, not a substitute for it.

## 2. Regime-detection method: recommendation

Three options were on the table: (a) price vs. a long-period MA, (b) ATR-based volatility percentile/threshold, (c) a combination.

**Recommendation: (a) price relative to a long-period MA, as the first thing to validate.**

Reasoning:
- It directly operationalizes the mechanism identified in §1 (direction), not a correlate of it. An ATR/volatility threshold measures *magnitude* of movement, not *direction* - a volatile-but-still-rising market would read the same as a volatile decline under (b) alone, which doesn't match what Phase 1 actually found mattered.
- It's the simplest option to validate in isolation: one boolean per bar (`close > MA(N)`), reusing `calculateSMA` (or `calculateEMA`) already in `indicators.js` - no new indicator primitive needs to be built, only a new period and a comparison.
- Fewer free parameters than (b), which needs both a lookback window for the percentile and a cutoff threshold - two knobs to tune (and potentially overfit) before it's even been shown that volatility is the right variable to filter on at all.
- (c), a combination, is worth revisiting *after* (a) is validated on its own - combining two untested filters at once makes it impossible to tell which one (if either) is doing the work if the combined result looks good or bad. Same principle as Phase 1's own progression (one variable isolated at a time, per LEARNINGS.md lesson #4).

**Proposed parameter: a 200-period MA** (the conventional "long-term trend" length, and importantly *longer* than the existing crossover strategy's own long period of 50, so the regime filter is a distinct, slower signal rather than a redundant restatement of the entry logic's own long MA). SMA vs. EMA for this filter is a secondary question - SMA is the more conventional choice for a trend filter and is proposed as the default, but this is a cheap thing to A/B once the filter exists.

**Known constraint carried over from Phase 1 (LEARNINGS.md lesson #5):** a 200-period MA needs ~200 trading days of warm-up before it produces its first value - about 4x the 50-period long MA already in use. This has direct consequences for the test plan in §5.

## 3. How the filter gates the strategy: exact behavior

**Proposed: the filter blocks new entries only. Any already-open position continues to be managed by the existing exit logic (the crossover's own SELL signal, plus whatever `risk.js` stop-loss is configured) with zero involvement from the regime filter.**

Concretely: when price is below the 200-period MA (unfavorable regime, for a long-only strategy), a BUY signal that `maCrossoverStrategy` would otherwise emit is dropped instead of acted on. SELL signals are never touched by the filter, regardless of regime.

Rationale:
- Matches the precedent already established in this codebase: `checkDrawdownCircuitBreaker` in `risk.js`/`backtest.js` gates new entries only, never force-closes an open position. Reusing the same shape keeps the mental model consistent - "circuit breakers of any kind stop you from getting in, they don't second-guess a trade already in progress."
- Avoids creating a second, competing exit mechanism. If the filter could also force-close open positions the moment regime flips, a trade could get closed by three different things (crossover SELL, `risk.js` stop-loss, regime flip) with overlapping and sometimes contradictory logic - materially harder to reason about and to attribute results to a specific cause during testing.
- It's the more conservative, easier-to-validate option first. Force-closing on regime flip is a legitimate alternative design, but it's a bigger behavioral change and should only be considered as a documented follow-up once the entry-gate version has been tested and understood on its own.

## 4. Proposed file structure

**New file: `server/quant/regime.js`**, following the exact precedent set by `risk.js` - a standalone, pure module with no dependency on `strategy.js` or `backtest.js`, unit-tested on its own before anything consumes it.

Proposed shape (signatures only, not implementation):
```
calculateRegime(bars, { maPeriod = 200, maType = "sma" } = {})
  -> returns an array aligned to bars, one entry per bar:
     { date, favorable: boolean }  (favorable = close > MA(maPeriod) at that bar; null/skipped
     while the MA hasn't warmed up yet, mirroring how indicators.js already handles warm-up)
```
`test-regime.js` alongside it, same convention as `test-risk.js`: hand-constructed synthetic price series (a clean uptrend, a clean downtrend, a series crossing back and forth) rather than real fetched data, since this is pure math with no external dependency - directly mirrors why `test-risk.js` used synthetic scenarios instead of the real-data convention every other `test-*.js` file uses.

**Wiring point: `strategy.js`, not `backtest.js`.** Proposed: a new exported wrapper function, e.g. `applyRegimeFilter(bars, signals, regime)`, that takes any existing strategy's already-generated signal list and drops BUY signals falling on an unfavorable-regime bar, passing SELL signals through untouched. This is deliberately generic over the *inner* strategy (not crossover-specific) so it could later gate RSI or any future strategy the same way, without new code.

This keeps `backtest.js` completely unchanged. The regime decision is made and applied before signals ever reach `runBacktest` - the backtest engine has no idea a filter was involved, it just receives a shorter signal list. This is the main design choice being flagged for review: the alternative (teaching `backtest.js` about regime directly, the same way it was taught about `risk.js`) was considered and rejected, because wiring `risk.js` into `backtest.js` last session required real, non-obvious correctness fixes to already-working code (the win-rate pairing and time-in-market logic both had to change because a previously-safe invariant broke). Filtering the signal list upstream avoids touching that code a second time and keeps the regime filter trivially testable in isolation - feed it a known signal list and a known regime array, and check what comes out.

## 5. Test plan

Given Phase 1's own lesson (single-period, single-ticker results are misleading - LEARNINGS.md lessons #3 and #4), the validation order proposed is:

1. **`test-regime.js` first, in isolation.** Confirm `calculateRegime` correctly classifies synthetic uptrend/downtrend/choppy series before it touches any real strategy or backtest - same discipline `risk.js` followed.
2. **Single-period sanity check, filtered vs. unfiltered, same signals/tickers/windows already used in Phase 1** (3-year window and the 2022 bear window, AAPL/MSFT/JNJ) - cheap, fast, explicitly treated as a first look only, not evidence, exactly like Phase 1 treated its own step 1.
3. **Walk-forward validation, with a widened window.** This is the step that needs a deliberate change from the existing `walkforward.js` default: a 200-period MA needs ~200 trading days of warm-up, and the existing default 6-month window (~126 trading days) doesn't clear that bar at all - this is the exact same mismatch lesson #5 already documented for a 50-period EMA in a 3-month window, just worse. Proposed window length: something in the 18-24 month range, to leave meaningful "live" time after warm-up for a crossover + regime combination to actually occur more than once or twice - at the cost of fewer independent windows across a fixed historical span, which is a real tension to state up front, not paper over.
4. **Cross-ticker replication**, same 7-ticker set already used to debunk the Phase 1 EMA/AAPL standout (AAPL, MSFT, JNJ, GOOGL, AMZN, NVDA, META) - a promising walk-forward result on 1-2 tickers gets exactly the same skepticism the AAPL EMA result got, not a pass.
5. **Isolate the filter's own effect**, not just "does the filtered strategy beat buy & hold" - run filtered vs. unfiltered on identical signals/tickers/windows (same method already used for the risk-management wiring comparison and the RSI stop-width investigation) and report the delta, not just each variant's absolute numbers.
6. **No-signal windows will likely be more common here, not less** - watch for it explicitly. A regime filter is designed to sit out of unfavorable periods entirely, so whole walk-forward windows with zero trades are an expected, not anomalous, outcome. Reuse the existing no-signal-window exclusion/labeling logic already fixed in `walkforward.js` (the session 6 bug) rather than risk relearning that lesson with a new strategy.

## Not scoped here

No code for `regime.js`, `test-regime.js`, or the `strategy.js` wrapper. No backtest runs. This is a proposal for the four decisions above (detection method, gating behavior, file structure, test plan) to be reviewed and approved before anything gets built.

---

## Implementation (approved, built)

- **`server/quant/regime.js`** - `calculateRegime(bars, { maPeriod = 200 } = {})`, reuses `calculateSMA` from `indicators.js`. One entry per bar: `{ date, favorable }` - `null` during MA warm-up, otherwise `close > MA` (a tie counts as unfavorable).
- **`server/quant/test-regime.js`** - 13 unit tests: basic favorable/unfavorable classification, warm-up nulls (small test period and the real default of 200), the exact-tie boundary, and a crossing series verifying bar-by-bar independence. All 13 pass.
- **`strategy.js`** - added `applyRegimeFilter(signals, regime)`. Drops BUY signals on unfavorable/unknown-regime bars, passes SELL signals through untouched. (One deviation from the signature proposed above: dropped the unused `bars` parameter.)
- **`backtest.js`** - confirmed untouched (`git diff --stat -- server/quant/backtest.js` shows no diff).

### Single-period sanity check (AAPL, 2023-08-06 to 2026-08-06, SMA 20/50)

19 signals (10 BUY / 9 SELL) unfiltered -> 15 (6 BUY / 9 SELL) filtered. SELL count unchanged, as designed. 4 of 10 BUYs blocked: 2 by MA warm-up (this early in the window, the 200-SMA has no value yet), 2 by a genuine unfavorable reading (price below its own 200-day trend line). Confirmed correct via spot-checking both cases against the raw price/MA values.

### Warm-up bar count check - flagged before proceeding

On that same continuous sanity-check window, 199 of 752 bars (**26.46%**) were `favorable: null` due to the 200-period MA's warm-up - above the 15-20% threshold set for this check.

Worse: `walkforward.js`'s `runWalkForward` fetches bars fresh per window with no lookback before `windowStart`, so under the originally-scoped 18-24 month walk-forward window, the MA would have re-warmed from scratch *inside every window* - an estimated 53% (18mo) to 40% (24mo) of each window's own length, worse than the continuous-window number above, not better. Widening the window (the scoping doc's original plan) fixes warm-up for a single continuous backtest but does not fix it for `runWalkForward`'s per-window fetch pattern - this was a real gap in the original scoping.

**Fix applied:** added an optional `lookbackMonths` parameter to `runWalkForward` (default `0`, fully backward-compatible - existing callers `test-walkforward.js` and `ema-crossover-evidence.js` are unaffected). When set, each window fetches an extra `lookbackMonths` of history before `windowStart` so indicators are already warmed from real data by the time the window begins; bars and signals are then filtered back down to the window itself before backtesting, so the lookback period primes indicators but never contributes trades. Set to 11 months here (~231 trading days, comfortably over the 200 needed). Also added `maxDrawdownPercent`/`winRate` per window and `averageMaxDrawdownPercent`/`averageWinRate` to the aggregate - `runBacktest` already computed both, they just weren't surfaced before, and both are needed for this comparison.

**Window length reconsidered:** since lookback now solves warm-up independently of window length, the original 18-24 month range was chosen for the wrong reason (clearing warm-up) - kept the walk-forward at the shorter end, **18 months**, since with warm-up handled separately, a shorter window yields more independent windows across the fixed 2022-01-01-to-today range (3 windows per ticker here) rather than fewer. This is worth revisiting - even shorter windows (e.g. 12 months, more independent samples) may now be viable now that warm-up is decoupled from window length, but that's a further iteration, not done here.

### Full validation: 7 tickers, 18-month windows, 2022-01-01 to 2026-08-12, `maCrossoverStrategy` SMA 20/50, baseline vs. regime-filtered

**Raw comparison - no conclusion drawn yet, this is for review before writing one up together.**

| Variant | Ticker | Avg Sharpe | Avg Max DD % | Avg Win Rate % | Avg Return % | Total Trades | Traded Windows | No-Signal Windows |
|---|---|---|---|---|---|---|---|---|
| baseline | AAPL | 0.132 | 7.66 | 26.11 | 1.96 | 26 | 3 | 0 |
| filtered | AAPL | -0.225 | 4.94 | 11.11 | 0.65 | 16 | 3 | 0 |
| baseline | MSFT | -0.369 | 7.31 | 22.22 | -1.24 | 23 | 3 | 0 |
| filtered | MSFT | -0.078 | 5.13 | 27.78 | 1.00 | 15 | 3 | 0 |
| baseline | JNJ | 0.433 | 5.66 | 41.67 | 5.63 | 22 | 3 | 0 |
| filtered | JNJ | 0.665 | 3.00 | 44.44 | 6.94 | 15 | 3 | 0 |
| baseline | GOOGL | 0.644 | 8.46 | 44.44 | 11.82 | 22 | 3 | 0 |
| filtered | GOOGL | 0.374 | 5.81 | 44.44 | 3.06 | 12 | 3 | 0 |
| baseline | AMZN | 0.396 | 7.27 | 27.78 | 4.02 | 21 | 3 | 0 |
| filtered | AMZN | -0.035 | 5.19 | 27.78 | 1.75 | 16 | 3 | 0 |
| baseline | NVDA | 0.841 | 9.17 | 38.33 | 18.42 | 25 | 3 | 0 |
| filtered | NVDA | 0.937 | 7.72 | 38.33 | 20.37 | 21 | 3 | 0 |
| baseline | META | 0.358 | 8.17 | 11.11 | 15.24 | 18 | 3 | 0 |
| filtered | META | -0.253 | 7.43 | 50.00 | -1.46 | 9 | 2 | 1 |

**Averaged across all 7 tickers:**

| Variant | Avg Sharpe | Avg Max DD % | Avg Win Rate % | Avg Return % | Total Trades |
|---|---|---|---|---|---|
| baseline | 0.348 | 7.67 | 30.24 | 7.98 | 157 |
| filtered | 0.198 | 5.60 | 34.84 | 4.62 | 104 |

**Per-ticker direction of effect (filtered vs. baseline), for reference, not yet interpreted:**
- Sharpe and total return improved together on MSFT, JNJ, NVDA (3 of 7); both got worse on AAPL, GOOGL, AMZN, META (4 of 7).
- Max drawdown improved on all 7 of 7 tickers, no exceptions.
- Win rate improved on 3 (MSFT, JNJ, META - META's jumped from 11.11% to 50.00%), was unchanged on 3 (GOOGL, AMZN, NVDA), and got worse on 1 (AAPL, 26.11% -> 11.11%).
- META is the only ticker where the filter produced a no-signal window (1, vs. 0 for every other ticker/variant) - every candidate entry in that window was blocked.

### Blocked BUY signal breakdown (warm-up vs. genuine unfavorable), full walk-forward

| Ticker | Total BUY signals | Kept | Blocked - warm-up | Blocked - unfavorable |
|---|---|---|---|---|
| AAPL | 14 | 9 | 0 | 5 |
| MSFT | 12 | 8 | 0 | 4 |
| JNJ | 12 | 8 | 0 | 4 |
| GOOGL | 12 | 7 | 0 | 5 |
| AMZN | 11 | 8 | 0 | 3 |
| NVDA | 13 | 11 | 0 | 2 |
| META | 10 | 5 | 0 | 5 |
| **All tickers** | **84** | **56 (66.7%)** | **0 (0.0%)** | **28 (33.3%)** |

**0% of blocks are warm-up-driven** across the entire 7-ticker walk-forward - the lookback fix fully resolved the issue flagged above; every blocked entry in this run reflects an actual unfavorable-regime reading, not missing history. The ~33% overall block rate (and the resulting ~34% drop in total trade count, 157 -> 104) can be read as "the filter is doing what it's designed to do," not as a warm-up artifact.
