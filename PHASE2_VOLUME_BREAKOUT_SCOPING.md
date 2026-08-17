# Phase 2: Volume-Confirmed Breakout Signal - Scoping Proposal

Scoping only, per candidate #1 in `PHASE2_SIGNAL_CANDIDATES.md`. No code written. For review/approval before implementation starts - same discipline as `PHASE2_REGIME_FILTER_SCOPING.md`.

## 1. Is `bar.volume` reliable across the 7-ticker set?

Reviewed `data.js`'s `normalizeQuotes`: a bar is only kept if `open`/`high`/`low`/`close` are all non-null, but `volume` has a silent fallback - `volume: q.volume == null ? 0 : q.volume`. A null volume from Yahoo becomes `0` in the output, indistinguishable from a genuine zero-volume day. That's a latent risk worth knowing about going in, since volume hasn't been a signal input anywhere in this repo before now.

**Checked in practice, not just in theory:** pulled all 7 tickers (AAPL, MSFT, JNJ, GOOGL, AMZN, NVDA, META) over 2022-01-01 to today via the existing cache/fetch path and inspected every bar's volume.

| Ticker | Bars | Zero-volume bars | Min volume | Max volume | Avg volume |
|---|---|---|---|---|---|
| AAPL | 1155 | 0 | 17,910,600 | 318,679,900 | 62,839,336 |
| MSFT | 1155 | 0 | 5,855,900 | 186,201,600 | 27,047,340 |
| JNJ | 1155 | 0 | 2,316,700 | 151,319,500 | 8,580,767 |
| GOOGL | 1155 | 0 | 9,701,400 | 127,490,100 | 32,745,615 |
| AMZN | 1155 | 0 | 11,420,500 | 272,662,000 | 54,406,476 |
| NVDA | 1155 | 0 | 65,528,500 | 1,543,911,000 | 371,962,846 |
| META | 1155 | 0 | 4,726,100 | 232,316,600 | 21,751,363 |

**Zero zero-volume bars across all 7 tickers, all 1155 bars each** (identical bar counts too - no gaps between tickers). Minimums are all in the millions of shares, consistent with genuinely liquid large-caps, not truncated/missing data presenting as small numbers. **Conclusion: volume is reliable in practice for this ticker set over this range.** The `data.js` fallback-to-zero behavior is still a latent gap worth being aware of (it would silently mask a real data problem rather than surface it, if one ever occurred on a different ticker or range), but it isn't live today - not proposing a `data.js` change for a problem that hasn't actually shown up.

## 2. Concrete definition: what counts as a breakout, what counts as volume confirmation

**Breakout:** today's close exceeds the highest **high** of the prior N trading days (not including today) - `close[i] > max(high[i-N..i-1])`. Using the prior-N-days high (a Donchian-channel-style reference), not the prior-N-days close, because a breakout is fundamentally about price clearing an established resistance level - the actual peak reached, not just where prior days happened to close. `bars` already carries OHLC (ATR already consumes `high`/`low`), so this isn't a new data dependency.

**Volume confirmation:** today's volume exceeds its own trailing X-day average by a multiplier - `volume[i] > avgVolume(X)[i] * multiplier`, where `avgVolume(X)` is a plain `calculateSMA` over the volume series (already-existing function, already proven reusable on any numeric array - `regime.js` does exactly this on closes).

**Recommended starting parameters:**
- **N = 20** (breakout lookback). Matches the existing crossover strategy's own short period (20), so it's not an arbitrary new number introduced without precedent in this codebase, and it's short enough to produce a workable number of signals for testing (a 200-style lookback would starve this strategy of trade count the way the regime filter's own MA does).
- **X = 20** (volume average window), same length as N - one fewer independent parameter to justify, and keeps "is this a breakout" and "is this unusual volume" evaluated over the same lookback horizon.
- **multiplier = 1.5x** average volume. A moderate, commonly-cited threshold in breakout-trading literature - meaningfully above "normal" without being so extreme (3x+) that it almost never fires.

Both conditions required (AND, not OR) - a price breakout without volume, or a volume spike without a price breakout, doesn't count. This is worth testing as two separate unit-test cases (see §6) precisely because it's easy to get the boolean logic backwards.

## 3. Entry and exit logic

**Entry:** BUY when not already in a position, breakout is true, and volume confirmation is true on the same bar - a 3-condition state machine, same shape as `maCrossoverStrategy`'s `inPosition` guard.

**Exit - reasoned from strategy shape, not defaulted to whatever's already available.** Lesson #7/#8 (RSI mean-reversion) found that a hard price- or time-based exit hurt a strategy whose whole premise is "the position needs room to be wrong before it's right" - RSI's edge depended on sitting through a temporary adverse move. A breakout/continuation trade is close to the opposite shape: the premise is that price keeps moving in the breakout direction with participation behind it. If it stalls or reverses shortly after entry, that's not "give it more room" - a failed breakout (price breaks a level, then falls back below it quickly) is itself a well-known, meaningful failure signal, not noise to ride through. So unlike RSI, a *responsive* exit is actually well-matched to this strategy's own logic, not a mismatch.

Four options considered:
- **(a) Asymmetric trailing channel exit (recommended): SELL when close falls below the low of the prior M days**, M shorter than N. This is the classic Turtle-Trading-style breakout system shape (20-day entry, 10-day exit) - a well-tested precedent for exactly this strategy family, not an arbitrary choice. It lets a working breakout run (the exit only triggers on an actual trend reversal, not routine noise) while cutting a failed breakout reasonably fast (a shorter exit window than entry window). **Recommended M = 10.**
- (b) Symmetric channel (M = N = 20) - simpler, but exits slower on a failed breakout than (a), giving back more of the gain (or taking a bigger loss) before the strategy's own logic admits the trade failed.
- (c) Fixed price target / R:R exit - rejected. A fixed target fits a strategy with a specific expected magnitude (more of a mean-reversion/range concept); a breakout/continuation strategy's whole premise is capturing an open-ended move, which a fixed target caps arbitrarily.
- (d) No native exit at all, rely entirely on `risk.js`'s stop-loss - rejected as the *sole* mechanism, for the same reason lesson #7/#8 flagged: a generic price/time stop doesn't know anything about the strategy's own trade logic. It's fine as a *secondary* layer (see below), not as the only exit.

**Both layers coexist, exactly like every other strategy already gets:** the strategy emits its own native SELL (the channel breakdown), and `risk.js`'s existing stop-loss/circuit-breaker/position-sizing keeps running underneath it via `backtest.js`, completely unchanged - whichever triggers first, same as `maCrossoverStrategy` and `rsiMeanReversionStrategy` today. One config recommendation worth flagging now (not a code change - just a call-site choice): **`riskConfig: { stopLossMethod: "atr" }` is probably a better fit than the 5% percent-stop default** for this strategy, since breakouts often coincide with a volatility expansion a fixed percent doesn't account for - but this is cheap to A/B once the strategy exists, not a blocking decision now.

## 4. File structure

**`volumeBreakoutStrategy(bars, params)` goes directly in `strategy.js`**, alongside `maCrossoverStrategy` and `rsiMeanReversionStrategy` - not a new standalone module like `regime.js`/`risk.js`. Reasoning: `regime.js` and `risk.js` were split out because they're cross-cutting utilities usable by *any* strategy (a filter, a sizing/stop toolkit) - neither generates its own BUY/SELL signals. This is different: "volume-confirmed breakout" *is* a complete strategy that generates its own entries and exits directly from price+volume, structurally identical in role to the two strategies already living in `strategy.js`. Splitting it into its own file would be inconsistent with why the other two split-outs happened.

**One small, genuinely reusable addition to `indicators.js`: `calculateRollingMax(values, period)` and `calculateRollingMin(values, period)`** (highest/lowest value in a trailing window), mirroring `calculateSMA`'s exact structure and windowing convention (`rollingMax[i]` = max over `values[i-period+1..i]`, *inclusive* of the current index - same as every other function in the file). The volume average needs no new function - `calculateSMA(bars.map(b => b.volume), X)` reuses what already exists, same pattern `regime.js` used on closes.

**Deliberately keeping the indicator inclusive-of-today, and shifting the "don't compare today against itself" logic into the strategy layer instead:** comparing `close[i] > rollingMax(high, N)[i]` directly would be circular - today's own high is part of the window defining today's "breakout level," so a big-range day could trivially "break out" against itself. The strategy should compare against **yesterday's** rolling value: `close[i] > rollingMax(high, N)[i - 1]`. Keeping the indicator function itself following the same convention as `calculateSMA`/`calculateEMA`/`calculateWMA` (rather than building a special "excludes current bar" variant) keeps `indicators.js` internally consistent - anyone reading it later finds one windowing rule, not two - and documents the "compare against yesterday" reasoning at the one place it actually matters (the strategy's entry condition), with a comment explaining why. Flagging this now specifically so it's implemented correctly the first time, not discovered as an off-by-one bug during testing.

Tie handling: a tie (`close[i] === rollingMax[i-1]` exactly) counts as **not** a breakout (strict `>`), same precedent `regime.js` set for its own tie case.

## 5. Lookback / warm-up, accounted for now

- Breakout eligibility needs N = 20 prior bars of `high` history.
- Volume confirmation needs X = 20 prior bars of `volume` history.
- Exit eligibility needs M = 10 prior bars of `low` history, but only matters once already in a position, which can't happen before entry is possible anyway.
- **Combined warm-up bottleneck: 20 trading days** - far shorter than the regime filter's 200-period MA, but still worth being deliberate about after finding the `walkforward.js` lookback bug the hard way once already (LEARNINGS.md lesson #9).

Estimated warm-up fraction without a lookback buffer, same math as the lesson #9 audit: 6-month window (~126 trading days) -> 20/126 ≈ **15.9%**; 18-month window (~378 trading days) -> 20/378 ≈ **5.3%**. Smaller than the crossover's 50-period (39.7%/6mo) or the regime filter's 200-period (52.9%/18mo), but 15.9% on a 6-month window is still above the "workable without a second thought" range this project has already treated with suspicion once.

**When this goes through `runWalkForward`, `lookbackMonths` must be set from the start - not discovered later.** Recommended starting value: **2 months** (~42 trading days at ~21 trading days/month, roughly 2x the 20-day requirement - comfortable margin, similar ratio to the 11-month lookback used for the 200-day regime filter, which gave ~15% margin over the raw 200-day requirement themselves, this errs more generous since 2 calendar months has more slack relative to a 20-day requirement). Revisit if N/X/M change from the values proposed in §2-3.

## 6. Test plan - same rigor as `regime.js`

1. **Unit tests first** (`test-volume-breakout.js` or similar), hand-constructed bars, mirroring `test-regime.js`'s and `test-risk.js`'s conventions:
   - A clean breakout + volume-confirmed bar correctly fires a BUY.
   - A price breakout **without** volume confirmation correctly does **not** fire (tests the AND, not OR, explicitly - easy to get backwards).
   - A volume spike **without** a price breakout correctly does **not** fire.
   - The exit (close below the M-day low) correctly fires a SELL once in a position.
   - Warm-up: no signal possible before bar 20 (both N and X satisfied).
   - Boundary: a tie against yesterday's rolling high counts as no breakout, same as `regime.js`'s tie precedent.
2. **Single-ticker sanity check** (one ticker, one window) - raw signal counts, plus a concrete example of a "breakout on price alone, blocked by volume" near-miss, in the same format as the regime filter's AAPL sanity check (filtered vs. unfiltered signal counts, a couple of annotated examples).
3. **Full walk-forward with the lookback fix applied from the start** (`lookbackMonths: 2`, not retrofitted after the fact) - 7-ticker set (AAPL, MSFT, JNJ, GOOGL, AMZN, NVDA, META), same window-length reasoning as the regime filter (shorter window -> more independent windows now that lookback is decoupled from window length).
4. **Report Sharpe, max drawdown, win rate, and trade count per ticker plus averaged across all 7** - same table format used for the regime filter validation, against buy & hold. Given lesson #9's finding that an averaged number can hide a ticker-dependent split, per-ticker direction of effect gets reported explicitly, not just the average, from the start this time.

## Not scoped here

No code for `indicators.js`'s `calculateRollingMax`/`calculateRollingMin`, `strategy.js`'s `volumeBreakoutStrategy`, or any test file. No backtest runs. This is a proposal for the decisions above (breakout/volume definition and parameters, entry/exit logic, file structure, lookback accounting, test plan) to be reviewed and approved before anything gets built.

---

## Implementation (approved, built)

- **`indicators.js`** - `calculateRollingMax`/`calculateRollingMin`, same inclusive-of-current-bar windowing as `calculateSMA`. 15 unit tests in `test-indicators.js` (up from 13), including a direct demonstration that `rollingMax[i]` includes bar `i`'s own value - the reason `volumeBreakoutStrategy` compares against `rollingMax[i-1]`, not `rollingMax[i]`.
- **`strategy.js`** - `volumeBreakoutStrategy`, exactly as scoped: entry = not-in-position AND `close > rollingMax(20)[i-1]` AND `volume > 1.5 * rollingAvgVolume(20)[i]`; exit = `close < rollingMin(10)[i-1]`. Every BUY signal now also carries `breakoutMarginPercent` (`(close - priorHigh) / priorHigh * 100`) and `volumeRatio` (`volume / (avgVolume * multiplier)` - i.e. multiples of the *confirmation threshold*, not the raw average, so this value is always > 1 by construction for any fired signal). 7 unit tests in `test-volume-breakout.js`: warm-up, breakout-without-volume and volume-without-breakout tested as separate cases (the AND, not OR), the tie boundary, the exit, and a hand-computed check of the new metadata fields.
- **`backtest.js`** - BUY trade records now spread `...signal` before applying the fill-specific overrides (date/action/price/etc.), so any extra fields a strategy attaches to its own signal - `breakoutMarginPercent`/`volumeRatio` here, but generic to any future strategy - carry through to the trade log unchanged. Existing strategies are unaffected (their signals only ever had date/action/price, which get overridden identically either way).
- **`walkforward.js`** - two additive changes: (1) each window result now also carries `tradeLog: backtest.trades`, the full per-trade array, alongside the existing `trades` count field (kept, not renamed, so existing callers summing/printing it are unaffected) - this is what makes breakout-margin data queryable per-trade from walk-forward output, not just visible in console output. (2) an optional `riskConfig` in `options`, passed straight through to the internal `runBacktest` call (`undefined` by default, falling back to `backtest.js`'s own `DEFAULT_RISK_CONFIG` exactly as before) - needed to run this validation with the scoped ATR-based stop, since `runWalkForward` had no way to override risk config at all before this.
- All 57 repo-wide unit tests pass. Backward compatibility re-verified directly (same `AAPL` SMA 20/50 6-month run before/after both `walkforward.js` changes - identical aggregate output).

### A second, smaller instance of the lookback-warm-up issue, found while running this

`lookbackMonths` (used here at 2 months) warms up `volumeBreakoutStrategy`'s **own** indicators correctly - confirmed, 0 warm-up-blocked signals from the strategy side. But `backtest.js`'s ATR-based stop-loss (`riskConfig: { stopLossMethod: "atr" }`, scoped for this strategy) computes its own 14-period ATR from whatever `bars` array `runBacktest` actually receives - which is the **trimmed**, post-lookback window (`fetchedBars.filter(b => b.date >= windowStart)`), not the lookback-extended fetch. `lookbackMonths` was only ever wired to warm up the *strategy's* signal generation, not `backtest.js`'s own internal indicator needs. Result: 3 BUY signals (right at the start of the second 18-month window, 2023-07-18/19/20) were skipped with `"ATR not yet available for stop-loss"`, because ATR had to re-warm from the window's own start same as before the lookback fix existed anywhere.

Small in this run - 3 skipped signals out of 119 total trades across 21 window-runs - but it's the same class of bug as lesson #9's original finding, in a new location: **any future strategy using an ATR-based (or otherwise warmed-up) `risk.js` stop through `runWalkForward` has this same gap**, since `lookbackMonths` doesn't currently reach `backtest.js`'s internal indicator calculations at all. Flagged here, not fixed - same treatment as the original bug's downstream numbers (deferred, noted, not blocking this review).

## Full validation: 7 tickers, 18-month windows, 2022-01-01 to 2026-08-13, ATR-based stop-loss

**Raw comparison - no conclusion drawn yet, for review together, same process as `regime.js`.**

| Ticker | Sharpe | Max DD % | Win Rate % | Return % | Trades | Traded Windows | No-Signal Windows |
|---|---|---|---|---|---|---|---|
| AAPL | 0.770 | 4.84 | 50.00 | 5.21 | 16 | 3 | 0 |
| MSFT | 0.528 | 4.87 | 27.78 | 3.50 | 17 | 3 | 0 |
| JNJ | -0.068 | 4.23 | 33.33 | 0.03 | 16 | 3 | 0 |
| GOOGL | 0.435 | 4.18 | 41.67 | 3.97 | 21 | 3 | 0 |
| AMZN | 0.079 | 5.72 | 16.67 | 0.36 | 23 | 3 | 0 |
| NVDA | 1.271 | 3.92 | 50.00 | 15.87 | 11 | 3 | 0 |
| META | 0.159 | 4.17 | 44.44 | 0.92 | 15 | 3 | 0 |

**Averaged across all 7:** Sharpe 0.453, Max DD 4.56%, Win Rate 37.70%, Return 4.27%, total trades 119.

**Observations, not yet a conclusion:**
- 6 of 7 tickers show a positive Sharpe; only JNJ is negative, and only marginally (-0.068, essentially flat).
- Max drawdown is tightly clustered (3.92%-5.72%) across every ticker - a much narrower spread than the regime filter's drawdown numbers, consistent with both the ATR-based stop and the strategy's own tight 10-day exit channel both doing real work.
- NVDA stands out (Sharpe 1.271, +15.87% return) on the smallest trade count of the 7 (11). That combination - biggest headline number, fewest data points - is exactly the shape lesson #3 warned about (the AAPL EMA standout). Not claiming NVDA is noise, just flagging that it deserves the same skepticism before being treated as a real result, not a pass because the number looks good.
- Win rates are all below 50% except AAPL and NVDA (both exactly 50.00%) - consistent with a strategy that's expected to have more losers than winners but let winners run further (a trend-following shape), but not yet checked against average win/loss size to confirm that's actually what's happening here.

## Breakout margin vs. trade outcome

55 resolved round trips (a BUY matched to a subsequent SELL within the same window) across all 7 tickers, bucketed by `breakoutMarginPercent`:

| Bucket | n | Win rate |
|---|---|---|
| Wide (>1%) | 48 | 41.7% |
| Mid (0.5%-1%) | 1 | 0.0% |
| Thin (<0.5%) | 6 | 0.0% |

**Simple split, not a formal statistical test, and the small-sample caveat applies directly here - especially to the thin and mid buckets.** Thin margin's 0.0% win rate is built from only 6 trades - with a sample that small, a 0% outcome doesn't necessarily mean thin breakouts don't work, it can easily happen by chance even if their true win rate were similar to the strategy's ~38% overall average. The mid bucket (n=1) is not usable for anything - one trade is not a rate. Wide margin's 41.7% (n=48) is a large enough sample to take more seriously on its own, and it happens to run somewhat above the strategy's 37.70% overall average win rate, which is at least directionally consistent with "wider margin breakouts do a bit better" - but with thin/mid both too small to compare against reliably, this reads as suggestive, not established. Full trade-by-trade breakout margin/volume ratio/outcome list is in the `volume-breakout-validation.js` console output for anyone who wants to eyeball the raw data behind this table.

## Out-of-window replication check

Same 7 tickers, same `volumeBreakoutStrategy` config (N=20/X=20/1.5x, unchanged), same 18-month windows/2-month lookback/ATR stop - re-run against an earlier, non-overlapping period to check whether the pattern above is real or specific to 2022-2026.

**Range: 2013-01-01 to 2021-12-31.** Checked `data.js` first: META IPO'd 2012-05-18 (confirmed directly - `getHistoricalData` returns its earliest bar on exactly that date), which is the binding constraint on how far back this 7-ticker set can go as a group. 2013-01-01 gives META ~7.5 months of margin before the lookback buffer even reaches further back. 2021-12-31 sits immediately before the original run's 2022-01-01 start, so the two windows don't overlap. The resulting ~9-year span covers the 2013-2019 bull run, the Feb-Mar 2020 COVID crash, and the 2020-2021 recovery - a genuinely different regime mix than 2022's bear-then-recovery - and yields 6 independent 18-month windows per ticker instead of 3.

Refactored `volume-breakout-validation.js` to take `runValidation(startDate, endDate)` as parameters (defaulting to the original 2022-today range, so the original script's behavior and output are unchanged - re-ran it to confirm byte-identical output) and extracted `printReport` so both runs share identical formatting. New script `volume-breakout-replication-check.js` just calls both with the earlier range.

| Ticker | Sharpe | Max DD % | Win Rate % | Return % | Trades | Traded Windows | No-Signal Windows |
|---|---|---|---|---|---|---|---|
| AAPL | 0.583 | 6.47 | 58.33 | 6.02 | 43 | 6 | 0 |
| MSFT | -0.071 | 5.66 | 35.83 | 0.81 | 44 | 6 | 0 |
| JNJ | 0.198 | 4.61 | 58.89 | 2.67 | 29 | 6 | 0 |
| GOOGL | 0.014 | 6.88 | 36.39 | 0.48 | 60 | 6 | 0 |
| AMZN | 0.439 | 6.90 | 41.94 | 5.83 | 58 | 6 | 0 |
| NVDA | 0.336 | 6.86 | 48.33 | 5.19 | 60 | 6 | 0 |
| META | 0.002 | 5.89 | 44.44 | -0.06 | 58 | 6 | 0 |

**Averaged across all 7:** Sharpe 0.214, Max DD 6.18%, Win Rate 46.31%, Return 2.99%, total trades 352.

### Answering the specific questions

**Does the 6/7-positive-Sharpe pattern hold?** Nominally yes - 6 of 7 are positive again (GOOGL at 0.014 and META at 0.002 are so close to zero they're really coin-flips, not real positives, but they don't flip negative either). **But it's a different ticker that goes negative this time - MSFT (-0.071) here, vs. JNJ (-0.068) in the original window.** No ticker is consistently the "loser" across both windows. And the magnitude roughly halved: average Sharpe 0.453 -> 0.214. Read together, "6 of 7 positive" looks less like a structural property of this strategy and more like "most large-caps produce a mildly-positive number most of the time, and which specific one doesn't is close to arbitrary."

**Does NVDA remain a standout? No.** This is the clearest result of the replication check. NVDA's Sharpe collapses from 1.271 (the highest of the 7, built on the fewest trades - 11) to 0.336 - solidly middle-of-the-pack, unremarkable. This is exactly the outcome flagged as a risk in the original write-up ("biggest headline number, fewest data points... deserves the same skepticism [as] the AAPL EMA standout"). The concern was justified: treat the original NVDA number as noise from an undersized sample, not a real result, the same way lesson #3 treated the AAPL EMA standout once cross-ticker/cross-window replication was checked.

**Breakout margin vs. outcome - does "wider is better" hold? Yes, and more convincingly than the original window.** With a much larger sample (172 resolved trades vs. 55):

| Bucket | n (original) | Win rate (original) | n (replication) | Win rate (replication) |
|---|---|---|---|---|
| Wide (>1%) | 48 | 41.7% | 109 | 46.8% |
| Mid (0.5%-1%) | 1 | 0.0% (unusable) | 27 | 44.4% |
| Thin (<0.5%) | 6 | 0.0% | 36 | 33.3% |

The monotonic ordering (wide > mid > thin) replicated, and the thin bucket in particular went from an unusable n=6 to a much more meaningful n=36 - still the weakest bucket, still clearly below the window's own 46.31% overall win rate (33.3% vs. 46.31%, roughly 13 points lower). This is the single most consistent finding across both windows in this whole investigation - more consistent than the per-ticker Sharpe pattern, which shifted noticeably between windows.

### Updated observations, still not a conclusion

- **NVDA's standout does not replicate - treat the original 2022-2026 number as likely noise.**
- **The 6/7-positive pattern replicates in count but not in composition or magnitude** - it's not clear this represents a real structural property of the strategy vs. an artifact of "most tickers are mildly positive most of the time."
- **The breakout-margin-vs-outcome relationship is the strongest, most replication-backed result** - present in both windows, direction unchanged, and got more (not less) convincing with a 3x larger sample.
- Same small ATR-lookback-gap artifact reappeared here too (4 skipped BUY signals out of 352 trades, same class of issue as the original run) - consistent with it being a persistent, minor, already-flagged gap rather than something new.

## Not investigated further here

Whether the margin/outcome relationship holds at finer bucket resolution (e.g. a proper correlation rather than 3 buckets), whether it holds on a third, non-overlapping window, and the ATR-lookback gap's fix - all flagged, none resolved. No `LEARNINGS.md` entry yet - writing the conclusion together once both windows are in front of us.
