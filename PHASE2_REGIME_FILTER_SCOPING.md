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
