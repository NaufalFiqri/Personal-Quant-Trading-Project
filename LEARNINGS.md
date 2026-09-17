# Learnings - Research Phase 1

Informal study notes from testing simple technical-indicator strategies (SMA/EMA/WMA crossover, RSI mean-reversion). This is the "why this matters" version of the lessons summarized in [README.md](README.md) - written to review later, not as a polished writeup.

## 1. Win rate alone tells you almost nothing

RSI mean-reversion kept showing up with high win rates - sometimes 100% in a given walk-forward window - and it still lost to buy & hold most of the time. The reason: it traded rarely (low time-in-market, sometimes 1-2 trades in a 6-month window) and captured small moves. Winning 100% of 2 trades where each trade nets you 1-2% doesn't move the needle compared to a stock that just went up 20% on its own.

The lesson isn't "RSI is bad." It's that **win rate and return are answering different questions** - win rate tells you how often you were right, return tells you whether being right mattered. A strategy that's right 90% of the time with tiny wins and occasional huge losses can still lose money overall. Always look at win rate next to average win size / total return, never alone.

## 2. "Does this strategy work?" is the wrong question - "in what regime?" is closer

Same SMA/EMA/WMA crossover strategies, two different answers depending only on which period you tested:
- 3-year rising market (2023-08 to 2026-08): 3 of 12 strategy/ticker combos beat buy & hold.
- 2022 bear market: 8 of 12 beat buy & hold.

Nothing about the strategy logic changed between these two runs - only the market regime did. Trend-following crossovers are structurally suited to catching downtrends early and getting out, which is exactly what "beating buy & hold in a crash" looks like. In a strong bull run, the same logic causes you to sell into strength and re-buy higher, costing you the parts of the rally you were fully invested in.

Takeaway for future testing: **never trust a single-regime backtest.** If I only tested the bull market, I'd have concluded "this doesn't work." If I only tested 2022, I'd have concluded "this is great downside protection." Both would have been true statements about that one period and false as general claims.

## 3. Small samples produce big, fake-looking effects

EMA 20/50 crossover on AAPL, walk-forward tested with 6-month windows: 80% winning windows, +6.97% average return per window, Sharpe 0.949. That's a genuinely exciting-looking result on paper.

The catch: it's built from 5 traded windows. With that few data points, a couple of lucky trades can produce a headline number that looks like skill. When I reran the identical strategy and parameters on 6 other large-cap, similarly liquid tickers (MSFT, JNJ, GOOGL, AMZN, NVDA, META), the win rates came back at 25-50% and Sharpe ratios ranged from -0.53 to 0.58 - nowhere close to AAPL's numbers. That's the signature of noise, not a structural edge: a result that looks strong on one instance and evaporates on replication.

Rule of thumb I'm taking from this: **any result built from fewer than ~10-15 independent trials should be treated as "interesting, not yet evidence."** Replication across time (more windows) or across similar assets (more tickers) is the actual test, not the eye-catching topline number.

> **Caveat added in lesson #9's audit (deferred, unresolved):** the 80% winning windows / Sharpe 0.949 numbers above were computed by `runWalkForward` before it had a lookback buffer (added in lesson #9). Each 6-month window's buy & hold benchmark is measured over the full window, but the strategy structurally couldn't trade during the first ~40% of it (a 50-period MA needs 50 of that window's own bars to produce a value) - an uncorrected head-start bias in the benchmark, not just fewer live days. The qualitative conclusion this lesson draws (a 5-window result is too small to trust, and it didn't replicate across 6 other tickers) likely still holds, since the same bias applied uniformly to AAPL and all 6 comparison tickers - but **these specific absolute numbers (80%, +6.97%, 0.949, and the 25-50%/-0.53-0.58 replication range) should not be cited or relied on until re-verified with `lookbackMonths` set.** Not re-run yet - flagged, not fixed.

## 4. Single-period backtesting overstates confidence; walk-forward + replication is what actually stress-tests a claim

The progression that got to the AAPL finding above:
1. One backtest, one window -> looked bad (underperformed on 2 of 3 stocks).
2. Parameter sweep -> still bad, but ruled out "wrong periods" as the explanation.
3. Multi-regime comparison -> revealed the strategy is regime-dependent, not uniformly bad or good.
4. Walk-forward across many sequential windows -> most results were coin-flip, but one ticker had a standout.
5. Cross-ticker replication of that standout -> it didn't hold up.

Each step could only be reached because the previous step's blind spot became visible. A single backtest genuinely cannot distinguish "this strategy has an edge" from "this strategy got lucky in this window" - you need either more time (walk-forward) or more comparable instances (cross-ticker) to tell the difference. This is the core reason walk-forward testing exists as a standard practice, not just a nice-to-have: it's the only way in this project's method to catch a result like #3 before mistaking it for #4-level evidence.

> **Caveat added in lesson #9's audit (deferred, unresolved):** steps 4 and 5 of this progression (the walk-forward run and its cross-ticker replication) were both computed without a lookback buffer, same issue as lesson #3's caveat above - each window's benchmark had a head start the strategy structurally couldn't use. The *methodology point* this lesson makes (walk-forward + replication catches what single-period backtesting can't) isn't in question - that's independent of this specific bug. What's unverified is whether steps 4-5's exact numbers would look the same with the bias corrected. Not re-run yet - flagged, not fixed.

## 5. A test's time window has to match what the strategy actually needs to work

Tried re-running the walk-forward test with 3-month windows instead of 6, expecting a bigger, more granular sample. Instead, almost every window came back "no signal" (14-17 of 18 per ticker). Why: a 50-period EMA needs 50 trading days of data just to produce its *first* value. A 3-month window has roughly 63 trading days total. That leaves about 13 days for a crossover to actually happen - most of the time, none does.

This wasn't a finding about the strategy at all. It was a test-design bug: I picked a window length shorter than the strategy's own warm-up period. The result (mostly empty windows) looked like data, but it was actually measuring "how often does a 50-day-warmup indicator have time to fire in a 63-day window" - a fact about arithmetic, not about markets.

Practical rule: **a test window needs to be comfortably longer than the slowest indicator's lookback period**, with enough room left over for the behavior being tested (a crossover, a threshold cross) to plausibly occur more than once or twice. For a 50-period MA, a 6-month window (~126 trading days) gives roughly 75 days of "live" indicator time after warm-up - still not huge, but workable. 3 months isn't.

## 6. Risk management changes the risk, not the edge - and a naive "did it beat buy & hold" count will lie about which

Wiring `risk.js` into `backtest.js` (sizing trades off 2% risk-per-trade against a stop-loss, instead of spending 100% of cash) dropped the "beats buy & hold" count on the exact same 12 Phase 1 strategy/ticker combos from 3/12 to 0/12. First instinct: risk management made things worse. That's the wrong read.

Risking 2% against a 5% stop means each trade only deploys roughly 40% of account equity, not 100%. Buy & hold, by construction, is always 100% invested. Comparing a 40%-invested strategy's raw return against a 100%-invested benchmark isn't measuring anything about the trading logic - it's measuring the sizing gap. The metric that actually isolates the effect of risk management is max drawdown, and there it did exactly what it's supposed to: down 8-20 percentage points on every single one of the 12 combos. The machinery worked; the "beats B&H" scoreboard was just the wrong ruler for the job.

Lesson: **when a change alters how much capital is at stake, raw-return comparisons against a fully-invested benchmark stop being meaningful, and you have to switch to a risk-adjusted or capital-normalized metric** (drawdown, Sharpe, return-per-dollar-at-risk) to tell "this got worse" apart from "this got safer and, mechanically, therefore smaller." Same trap as lesson #1 (win rate alone) one level up: a single headline number, read without the context of what else changed underneath it, produces a confident and wrong conclusion.

The one place risk-adjusted return (Sharpe) *did* get consistently worse, not just mechanically smaller, was RSI mean-reversion - all three tickers' Sharpe dropped, and AAPL's win rate collapsed from 100% to 0%. A 5% stop-loss was cutting reversion trades short before the reversion had room to happen; time in market on AAPL fell from 43% to 10%, meaning most trades were getting stopped out almost immediately. That's a real signal, not a ruler problem - it just needs its own replication test before it's trusted as more than a 3-ticker, single-window observation, same caution as lesson #3 above.

## 7. Widening or volatility-adjusting the stop narrows RSI's Sharpe damage but doesn't undo it - this looks like a structural mismatch, not a tuning bug

Direct follow-up to lesson #6's RSI finding: if a 5% stop was "too tight," would a wider or volatility-adjusted stop fix it? Re-ran RSI 14 (30/70) on AAPL/MSFT/JNJ (same 3-year window) five ways - no risk management (baseline), the default 5% percent stop, 8% percent, 10% percent, and ATR-based (`DEFAULT_RISK_CONFIG`'s untouched defaults: 14-period, 2x multiplier) - keeping the crossover strategies and every other setting fixed.

Average Sharpe across the three tickers:

| Variant | Avg Sharpe | Avg Max DD % | Avg Win Rate % |
|---|---|---|---|
| No risk management (baseline) | 0.551 | 22.98 | 80.56 |
| 5% percent stop (current default) | -0.106 | 7.14 | 19.44 |
| 8% percent stop | 0.118 | 5.34 | 38.89 |
| 10% percent stop | 0.337 | 3.85 | 58.33 |
| ATR stop (default period/multiplier) | -0.507 | 7.67 | 11.11 |

Widening the percent stop helps, monotonically - but even the widest one tested (10%) only recovers about 60% of the Sharpe gap back to baseline, not all of it. The average also hides a worse per-ticker story: AAPL's Sharpe is *negative at every stop width tested* (-0.673, 0.033, -0.066 at 5/8/10%) and never gets back to its 0.420 baseline; JNJ is similar (0.489 baseline vs -0.297, -0.178, 0.216). Only MSFT tolerates stops well across the board (0.745 baseline vs 0.653/0.500/0.862) - one out of three tickers recovering isn't enough to call the fix general.

The ATR-based stop - the "obvious" volatility-adjusted fix the original hypothesis pointed at - was the *worst* performer of the five, not the best (JNJ alone cratered to -1.492 Sharpe with a 0% win rate). At its default 2x-ATR multiplier, the ATR stop landed tighter than even the 5% percent stop for these particular RSI trades, doing more damage instead of less. That doesn't rule out ATR-based stops for mean-reversion in general - a wider multiplier might behave completely differently, and that's an untested knob, not a closed question - but it does rule out "just switch to ATR" as an automatic fix; the multiplier needs its own tuning pass to mean anything, which is a separate investigation from this one.

Max drawdown kept improving as the percent stop widened (22.98% -> 7.14% -> 5.34% -> 3.85%) - counterintuitively, the *widest* stop produced the *smallest* observed drawdown of any risk-managed variant. This isn't the stop mechanically capping losses tighter; it's a path-dependency effect - a different stop width changes which trades close when, which changes what the strategy re-enters afterward, and this particular sequence of trades happened to have a shallower drawdown at 10%. Read as "this run's result," not "wider stops are safer" as a general rule - the opposite could easily be true on a different ticker or window.

**Conclusion: no configuration tested (5%, 8%, 10% percent, or default-parameter ATR) restores RSI mean-reversion's Sharpe ratio to its no-risk-management baseline while keeping the drawdown benefit.** The closest (10% percent) still leaves two of three tickers meaningfully degraded. This looks less like "the stop was mistuned" and more like a structural mismatch: this RSI strategy's edge is already thin (per lesson #1 - high win rate, small average win), and it seems to depend on being able to sit through a temporary adverse move without being cut out - which is exactly what any hard price-based stop works against by definition. **Rule to carry forward: "add a stop-loss" is not a strictly-good default to apply uniformly to every strategy.** A mean-reversion signal may need a fundamentally different protection mechanism (a time-based exit, or leaning on position sizing alone rather than a price stop) instead of a wider or smarter price stop. Trend-following crossover strategies (SMA/EMA/WMA, per lesson #6) didn't show this problem - the mismatch tracks the strategy's own trade logic, not stop-losses in general.

### Addendum: why AAPL/JNJ and not MSFT?

Follow-up read-only analysis (no new strategy/backtest runs - reused the same unmodified no-risk-management baseline already behind the table above, plus new volatility stats computed directly from cached price data) to explain the per-ticker split. Two candidate explanations were checked and ruled out before finding the one that actually fits.

**Trade frequency: ruled out.** The baseline produced 3 round trips for AAPL, 3 for MSFT, 4 for JNJ over the 3-year window (~1-1.3/year each) - similar order of magnitude across all three. Small-N amplifies noise for any of them equally; it doesn't explain why two tickers degraded and one didn't.

**Raw volatility: ruled out.** Daily return stdev and average ATR(14)-as-%-of-price:

| Ticker | Daily return stdev | Avg ATR(14) % of price |
|---|---|---|
| AAPL | 1.692% | 2.17% |
| MSFT | 1.643% | 2.03% |
| JNJ | 1.125% | 1.61% |

If raw volatility were the driver, JNJ (the *least* volatile of the three) should have tolerated a fixed stop the *best*, not degraded alongside AAPL. The volatility ranking (AAPL > MSFT > JNJ) doesn't track the degradation pattern (AAPL bad, JNJ bad, MSFT fine) at all - so overall volatility level isn't the explanatory variable.

**What actually explains it: each baseline trade's own max adverse excursion (MAE) - how far the trade dipped underwater before recovering - relative to the stop widths tested.**

| Ticker | Round trip (entry -> exit) | Holding days | MAE % | Return % | Won? |
|---|---|---|---|---|---|
| AAPL | 2024-01-08 -> 2024-05-22 | 94 | 11.62 | 2.77 | WON |
| AAPL | 2025-01-22 -> 2025-08-11 | 138 | 24.44 | 1.40 | WON |
| AAPL | 2026-01-13 -> 2026-06-01 | 95 | 6.80 | 17.22 | WON |
| MSFT | 2024-08-08 -> 2024-12-18 | 92 | 0.73 | 8.51 | WON |
| MSFT | 2025-04-09 -> 2025-05-23 | 31 | 9.62 | 15.17 | WON |
| MSFT | 2025-11-25 -> 2026-04-20 | 98 | 25.34 | -12.44 | lost |
| JNJ | 2023-09-11 -> 2023-12-05 | 60 | 10.93 | -2.62 | lost |
| JNJ | 2024-04-09 -> 2024-07-18 | 69 | 6.06 | 1.95 | WON |
| JNJ | 2024-11-15 -> 2025-02-26 | 67 | 8.70 | 5.79 | WON |
| JNJ | 2026-04-23 -> 2026-06-30 | 46 | 4.50 | 10.00 | WON |

**AAPL: every single winning trade needed a deeper drawdown than every stop width tested.** All three round trips have MAE (6.80%, 11.62%, 24.44%) at or above the 5% stop, and two of three exceed even the 10% stop. There's no stop width in the tested range that would have let any of AAPL's baseline winners survive to their natural exit - which is exactly why AAPL's win rate went to 0% at 5% and stayed weak all the way to 10%. This isn't a mistuned width; none of the tested widths were in the right range for these specific trades.

**MSFT: the opposite pattern by coincidence.** Two of its three trades had shallow MAE (0.73%, 9.62%) that a 5-10% stop mostly survives, and its *one* deep-MAE trade (25.34%) was already the baseline's only *loser* - a stop cutting that one short early is the stop-loss doing its job, not sabotaging a winner. That's why MSFT tolerated stops well and occasionally beat its own baseline Sharpe (0.862 at the 10% stop vs. 0.745 baseline).

**JNJ: in between, and this is where the ATR result gets explained.** Three of JNJ's four trades have MAE under 9% (4.50%, 6.06%, 8.70%), which is why its Sharpe partially recovered as the percent stop widened toward 10%. But JNJ's ATR-based Sharpe (-1.492) was worse than every percent width, including 5% - and the MAE table alone doesn't explain that. The real cause is the ATR stop distance itself: at the default 2x multiplier, `stopLossPercent`-equivalent distance is roughly `2 x avg ATR%` - AAPL ~4.34%, MSFT ~4.06%, **JNJ ~3.22%**. All three are *tighter* than the "already too tight" 5% fixed stop from the main table, and JNJ's is the tightest of the three because JNJ had the lowest ATR% to begin with. The ATR stop wasn't a looser, volatility-adjusted version of the percent stop here - it was a stealthily tighter one, worst on the ticker with the least volatility to build a wider distance from. That's the mechanism, not a new/separate mismatch.

**Answer to the original question: it's neither trade frequency nor raw volatility level - it's whether each ticker's specific reversion trades needed room to draw down beyond whatever stop width was in play, on a trade-by-trade basis.** AAPL's trades structurally needed more room than any width tested gave them. MSFT's trades mostly didn't need much room, so stops were nearly free insurance. JNJ sat in between on the percent stops but got hit by a second, independent problem on the ATR stop: the default multiplier produces a *tighter* stop on lower-ATR%-of-price tickers, not a properly volatility-scaled one. Practical implication for any future ATR-based stop: check the resulting stop distance in percent-of-price terms against what's actually being replaced, rather than assuming "ATR-based" automatically means "wider" or "better adapted."

## 8. A time-based exit isn't a universal fix either - but it fails and succeeds on different tickers than a price-based stop did

Direct test of lesson #7's leftover question: does removing the price dependency entirely - capping how many bars a trade is allowed to run, instead of any price-based stop - avoid the Sharpe degradation every price-based stop showed? Tested RSI 14 (30/70) with the strategy's own SELL signal capped at 10 or 20 bars after entry (whichever comes first, so the cap is a backstop on the natural exit, not a replacement for it), no price stop involved at all, same 3-year AAPL/MSFT/JNJ window, no position-sizing changes (100% cash, matching the no-risk-management baseline exactly, to isolate this one variable).

| Variant | Avg Sharpe | Avg Max DD % | Avg Win Rate % |
|---|---|---|---|
| No risk management (baseline) | 0.551 | 22.98 | 80.56 |
| Time exit, N=10 bars | 0.008 | 8.90 | 55.56 |
| Time exit, N=20 bars | 0.251 | 11.69 | 66.67 |

On average, still below baseline at both cap widths - so no, this doesn't universally fix RSI either. But the average hides the actually interesting result: **AAPL, the worst performer under every price-based stop tested in lesson #7, does *better* under a time cap than its own no-risk-management baseline.** At N=20, AAPL's Sharpe is 0.809 (vs. 0.420 baseline - nearly double), win rate holds at 100%, and max drawdown drops from 30.22% to 5.64%. At N=10, Sharpe is essentially unchanged (0.419 vs. 0.420) with a similarly large drawdown improvement. This is the opposite of every price-based stop result for AAPL, where none of 5%/8%/10%/ATR let a single one of AAPL's baseline winners survive to their natural exit.

MSFT is close to neutral (0.745 baseline vs. 0.691 at N=20, 0.379 at N=10) with a large drawdown improvement either way - similar to how MSFT tolerated price-based stops reasonably well in lesson #7.

JNJ is the new problem case: Sharpe drops to -0.772 (N=10) and -0.746 (N=20) - both clearly worse than baseline, and *not* improving as the cap widens the way JNJ's percent-stop results did in lesson #7. Win rate collapses to 25% at both widths.

**Interpretation: a time-based exit is not a strictly better risk mechanism than a price-based stop for this strategy - it's a *different* one, with its own ticker-dependent failure pattern.** It happens to fix the specific problem lesson #7 found on AAPL (every AAPL trade needed more room in price terms than any stop gave it - but apparently not more *time* than a 10-20 bar cap allows before locking in a result at least as good as the eventual natural exit). It does not fix JNJ, and JNJ's failure under a time cap wasn't diagnosed further in this pass - would need the same per-trade path analysis lesson #7's addendum used for MAE, applied to price-at-each-bar-count instead. **Takeaway to carry forward: "switch from a price stop to a time stop" is exactly as much of a non-answer as "switch from a 5% stop to an ATR stop" was - the fix has to be validated per-strategy-per-ticker, not assumed to generalize from one promising result (here, AAPL) to the whole ticker set.** This reinforces lesson #7's core conclusion rather than overturning it: RSI mean-reversion's relationship with any hard exit rule, price- or time-based, is inconsistent enough across tickers that no single global risk-control setting tested so far is safe to adopt uniformly.

### Addendum: same mechanism as lesson #7, or something else?

Follow-up read-only analysis - no new backtest configuration run. Each baseline round trip's entry point was already known (from lesson #7's addendum); the only new computation is reading that trade's price directly from the already-cached OHLCV data at bar 10 and bar 20 after entry, to see whether it was profitable at the cap point, not just at its eventual natural exit.

| Ticker | Baseline winners | Natural hold range (bars) | Still positive at N=10 | Still positive at N=20 |
|---|---|---|---|---|
| AAPL | 3 | 94-138 | 2/3 | 3/3 |
| MSFT | 2 | 31-92 | 1/2 | 1/2 |
| JNJ | 3 | 46-69 | 1/3 | 1/3 |

**JNJ: consistent with the same mechanism as lesson #7 - these trades need more room, whether measured in price or time.** JNJ's 3 baseline winners took 46-69 bars to naturally resolve; only 1 of them was even positive at bar 10, and still only 1 of 3 at bar 20 - which is exactly why lesson #8's win rate collapsed to 25% under both caps. The correlation between a JNJ trade's MAE and its holding period is weakly positive (Pearson r = 0.420, n=4) - nowhere near strong enough to lean on with 4 data points, but directionally consistent with "the trades that need the deepest price room also take the longest to resolve," which is what a single root cause (JNJ's reversion moves are genuinely slow *and* deep here) would predict.

**AAPL: NOT the same mechanism - a third, distinct pattern.** AAPL's 3 baseline winners took 94-138 bars to naturally resolve - *longer* than JNJ's, not shorter - so the time cap helping AAPL has nothing to do with trades resolving quickly. Instead, AAPL's price moves favorably very early: 2 of 3 trades were already positive by bar 10, and all 3 were positive by bar 20. Cross-referenced with lesson #7 (these same three trades have MAE of 6.80%-24.44% at some point over their full hold), the deep drawdown each one eventually goes through must happen *later* in the hold, after the early gain - a long, choppy middle stretch that a price stop is fully exposed to (it watches price level continuously, so it eventually gets caught by that later dip regardless of width, which is exactly why every price-based stop in lesson #7 hurt AAPL) but a time cap is immune to (it doesn't look at price at all, only elapsed time - so it exits during the early favorable window and is never around for the later chop).

**Conclusion: two distinct patterns, not one mechanism with opposite sign.** JNJ's result plausibly shares lesson #7's root cause - its trades need more room, full stop, in whichever unit you measure it. AAPL's does not: its price-stop problem (lesson #7) and its time-cap benefit (lesson #8) are both explained by the *same* underlying price path (an early gain followed by a long volatile stretch before the RSI's official exit), but a price stop and a time cap are sensitive to different parts of that path - which is why the identical underlying trade can be badly hurt by one risk control and helped by the other. **Sample size caveat, stated plainly: this is 3 trades for AAPL and 4 for JNJ (2 for MSFT), from one 3-year window.** Every claim above, including the "consistent with" language for JNJ, describes this specific window on these specific tickers - it is not a validated general rule about how mean-reversion strategies behave. Confirming it further would take the same walk-forward/cross-ticker replication discipline used everywhere else in this project, not a bigger claim drawn from the same handful of trades.

## 9. A regime filter reliably buys you a smaller drawdown - it does not reliably buy you a better Sharpe

Phase 2 candidate #3: gate `maCrossoverStrategy`'s new entries behind a 200-period-SMA trend filter (`regime.js` + `applyRegimeFilter` in `strategy.js`), blocking a BUY when price is below its own 200-day trend line, letting SELLs and already-open positions run untouched. Validated via `walkforward.js`, 18-month windows, 2022-01-01 to today, filtered vs. unfiltered on the same 7-ticker set used to debunk the Phase 1 EMA/AAPL standout (AAPL, MSFT, JNJ, GOOGL, AMZN, NVDA, META). Full per-ticker numbers are in `PHASE2_REGIME_FILTER_SCOPING.md`.

**The one unambiguous result: max drawdown improved on all 7 of 7 tickers, no exceptions.** That's exactly what a long-only entry filter designed to sit out unfavorable trends should do, and it did it consistently - the strongest and simplest finding here.

**Sharpe and total return did not follow the same pattern - genuinely mixed, ticker-dependent, not a general edge.** Improved on 3 of 7 (MSFT, JNJ, NVDA); got worse on 4 of 7 (AAPL, GOOGL, AMZN, META). The averaged number across all 7 (Sharpe 0.348 -> 0.198) looks like a straightforward decline, but that average is misleading read on its own - it's not "the filter makes Sharpe worse," it's "four losing tickers pulled the average down harder than three winning tickers pulled it up." Same trap as lesson #6 (raw-return comparisons hiding what's actually going on underneath) and lesson #7/#8 (a global setting that helps some tickers and hurts others isn't safe to describe with one number). **Rule to carry forward: when an effect is this ticker-dependent, report the split, not just the average - the average here would have supported a wrong one-line takeaway ("the filter hurts risk-adjusted return") that the per-ticker data doesn't actually back up as a general claim.**

**Win rate improved or was unchanged on 6 of 7 tickers, and got worse on exactly one: AAPL** (26.11% -> 11.11%). Consistent with drawdown, not with Sharpe - most tickers traded less often but more selectively without their per-trade win rate suffering, except AAPL, which is also one of the four tickers where Sharpe/return got worse - worth noting as a pattern (AAPL is a repeat "hard case" across this project: it was also the ticker every price-based RSI stop hurt worst in lesson #7, for unrelated reasons specific to that strategy). Not claiming a unified cause between the RSI and regime-filter AAPL results here - just flagging that AAPL keeps showing up as the ticker where risk controls behave differently, across two unrelated strategies.

**Resolved: META's fully-empty window (2022-01-01 to 2023-07-01) is a genuine extended bear-market regime, not a data or filter bug.** Direct inspection of that window's 375 bars found 0 nulls (ruling out a data/lookback issue outright) and 269 of 375 bars (71.7%) unfavorable - META spent nearly three-quarters of that 18-month window below its own 200-day MA. That window is the 2022 tech-stock crash, and META was hit especially hard by it (roughly $338 down to a ~$88 trough that year, on top of the broader market decline). All 3 `maCrossoverStrategy` BUY signals that fired in this window were counter-trend bounce attempts inside that decline - 2022-04-12 at $214.14, 2022-08-15 at $180.89, 2022-12-19 at $114.48 - and every one of them landed on an unfavorable-regime bar (price still below the 200-day MA, which was elevated by the prior year's much higher prices). The filter blocking all three is the mechanism working exactly as designed: refuse new longs during a sustained downtrend, even when a short-term bounce briefly triggers the crossover's own entry logic. Not every bar in the window was unfavorable (106 of 375 were) - it's a coincidence of timing that none of the 3 signal dates landed in a favorable stretch, not evidence of an overly aggressive filter.

**Conclusion, stated at the same confidence level the data supports: this regime filter is not shown to be a general improvement to `maCrossoverStrategy`.** It reliably reduces drawdown; it does not reliably improve risk-adjusted return, and whether it helps or hurts a given ticker looks tied to something ticker-specific that hasn't been identified yet (same shape of open question as lesson #7/#8's per-ticker splits). Worth treating as "a real drawdown-reduction tool with an unresolved, ticker-dependent cost" rather than either "validated" or "debunked."

### A methodology bug found and fixed along the way, with broader implications

Building this validation surfaced a real bug in `walkforward.js`, unrelated to the regime filter's own merits: `runWalkForward` fetched bars fresh per window with no lookback buffer before `windowStart`, so any indicator with its own multi-bar warm-up period had to re-warm from scratch *inside every window* rather than once across a continuous run. For the regime filter's 200-period MA this meant an estimated 26-53% of bars per window falling into unclassified warm-up, worse than the fraction on one continuous backtest, not better - widening the window length (the original plan) doesn't fix this, since the warm-up requirement resets every window regardless of window size. Fixed with an optional `lookbackMonths` parameter that fetches extra history before each window purely to prime indicators, filtered back out before backtesting - confirmed via the blocked-signal breakdown, which dropped to 0% warm-up-driven blocks after the fix.

**This is worth flagging beyond the regime filter specifically: any prior walk-forward result in this project that used a long-lookback indicator would have the same warm-up contamination, silently.** The strategies actually walk-forward-tested so far (SMA/EMA/WMA 20/50, RSI 14) all use short-to-medium indicator periods (14-50 bars) against 6-month (~126 trading day) windows, so the warm-up fraction there is much smaller than the 200-period regime filter's - but it hasn't been explicitly audited. Not investigated now (out of scope for this entry), but flagged as a specific, concrete thing worth checking before trusting any older walk-forward number that involves an indicator with a long lookback relative to its window length.

## Bonus: a data bug that looked like a strategy result

Separately from the above, found a real bug in the data-caching layer while building the walk-forward test: the cache tracked "what date range do we have" as a single min/max envelope, so two separately-fetched chunks with a real gap between them (2022 fetched in one session, mid-2023-onward in another) got reported as if the whole span including the gap was covered. Requests landing in that gap silently came back with 0 bars - which, fed into the backtest, produced a totally silent "0.00% return, 0 trades" row that looked exactly like a legitimate no-signal window.

Two lessons stacked here:
- **A bug in the data layer can masquerade as a finding in the strategy layer.** Zero trades in a window could mean "the strategy legitimately didn't fire" or "there's no data here" - from the output alone, they're indistinguishable. Had to go check the raw bar count for that window specifically to find this.
- This is also *why* the zero-trade-window exclusion bug (see README Journal, session 6) was worth taking seriously as a category, not a one-off: any time "the strategy did nothing" gets folded into an aggregate the same way as "the strategy did something and it happened to be flat," the aggregate stops meaning what it looks like it means. Two different bugs, same root shape of mistake.

## 10. Volume-confirmed breakout shows no edge over a random-entry baseline once risk management is held constant

Phase 2 candidate #1 (`volumeBreakoutStrategy`: rolling-high breakout + volume confirmation entry, 10-day-low Turtle-style exit, ATR stop-loss via `risk.js`) tested two ways on the same 7-ticker set used throughout this project (AAPL, MSFT, JNJ, GOOGL, AMZN, NVDA, META), 18-month walk-forward windows, `lookbackMonths: 2`, `riskConfig: { stopLossMethod: "atr" }` - both runs using the now-fixed lookback-aware ATR warm-up (see process note below).

**Against buy & hold** (`volume-breakout-vs-bh.js`): the strategy beat B&H in exactly 7 of 21 windows, and all 7 of those wins landed in windows where B&H itself was negative (range -3.51% to -23.50%) - never in a positive-B&H window, including two extreme rising-market windows where B&H returned +216.62% (NVDA, 2023-07 to 2025-01) and +104.71% (META, 2023-07 to 2025-01) and the strategy still lost to it. The strategy isn't capturing upside faster than holding - it's losing less badly than holding when holding itself was a bad idea.

**Against a random-entry baseline with identical everything else** (`volume-breakout-vs-random.js`; `randomEntryStrategy` in `strategy.js` - a seeded 2%-per-eligible-bar coin-flip entry, same Turtle-style exit, same ATR stop wrapper, matched to land in the same 3-10-trades-per-window range the real strategy produces): real beat random in 11 of 21 head-to-head windows (~52%, close to a coin flip), and random entries beat B&H in 8 of 21 windows - slightly *more often* than the real strategy's own 7 of 21. **A random entry timer, wrapped in the same risk management, did marginally better against the benchmark than the strategy's actual entry logic did.**

The per-ticker breakdown of real-vs-random is not uniform - and it's worth being precise about it rather than eyeballing the table, since real total advantage came almost entirely from one ticker:

| Ticker | Real beat random | 
|---|---|
| AAPL | 3/3 |
| MSFT | 2/3 |
| GOOGL | 2/3 |
| NVDA | 2/3 |
| JNJ | 1/3 |
| META | 1/3 |
| AMZN | 0/3 |

AAPL is the one clean case where real's entry logic clearly beat random on every window tested. AMZN is the mirror opposite - random beat real on all 3 windows there. The other five tickers split close to even. This is the same shape of result as lesson #3's AAPL standout: a strong single-ticker result inside an aggregate that doesn't replicate across the other 6 - except here the "standout" is real-vs-random, not strategy-vs-benchmark, and it still doesn't generalize.

**Conclusion: no robust edge demonstrated for volume-confirmed breakout in this dataset.** This lands in the same place as Phase 1's original finding for the indicator-family strategies (lesson #3/#4: results that look real in aggregate don't survive replication) - but for a different underlying reason. Lesson #7's RSI finding was a *strategy-shape-vs-risk-control* mismatch (a real, structural edge undermined by the wrong kind of stop). This is not that: the risk management here is identical between the real and random runs, so what's being tested head-to-head is the entry signal alone, and the entry signal isn't clearly distinguishable from randomly-timed entries once everything else is held fixed. **Rule to carry forward, alongside lesson #3's: a strategy's "beats buy & hold" count is not evidence of a real entry-timing edge by itself - it has to be checked against a random-entry baseline under the identical risk wrapper before crediting the entry logic specifically, the same way lesson #6 required checking capital-at-stake before crediting a return-comparison to the strategy at all.**

### Process note: this session required raw-output verification at every step, and that should be standing practice going forward

Earlier in the session that produced this lesson, three things were reported as completed and verified before any of them were actually checked against the repository: a claimed fix for an ATR stop-loss lookback gap (a `warmupBars` parameter alleged to already exist in `backtest.js`), a full random-entry-vs-real comparison table, and a per-window buy & hold breakdown for the volume breakout strategy. Direct inspection - `git show` on the commit alleged to contain the fix, `git grep`/`git log -S` across the full history for both `warmupBars` and `randomEntryStrategy`, and reading the actual output shape of `volume-breakout-validation.js` - found none of the three existed in any form, committed or not. The `warmupBars` fix was only real once actually implemented and diff'd in this session; `randomEntryStrategy` and the B&H-comparison scripts likewise didn't exist until written and run in this session (see lesson #10 above, and the process that produced it).

Every result trusted afterward in this investigation - the fix's before/after behavior, the B&H table, the real-vs-random table - was only accepted after being produced by a command actually run in this session, with its complete unedited stdout inspected, not summarized or described in advance. That discipline is the reason lesson #10 above is trustworthy where the earlier, unverified claims were not.

**This is a standing practice going forward, not a one-off correction for this session:** any reported result - a fix, a comparison, a table, a "this already works" - gets treated as unverified until the actual command has been run and its raw output inspected directly. "I checked and it's already there" is not itself verification.

## 11. All three Phase 2 signal candidates tested: none demonstrated an entry-timing edge over random, once risk management was held constant

`PHASE2_SIGNAL_CANDIDATES.md` proposed three directions after Phase 1 concluded the indicator-family strategies had no robust edge: a regime-adaptive trend filter (candidate #3), a volume-confirmed breakout (candidate #1), and a multi-condition confluence of the two (candidate #2, trend + breakout + volume). All three have now been built and validated. **None of the three produced an entry signal that beat a matched random-entry baseline by more than a coin flip, once identical risk management sat underneath both sides of the comparison.**

**Volume breakout alone beat a random-entry baseline (identical ATR stop, identical exit rule, matched signal frequency) in 12 of 21 walk-forward windows - 57%, not meaningfully above chance.** (lesson #10, and reconfirmed on a fresh run this session at `lookbackMonths: 11` - `server/quant/confluence-vs-random.js`.)

**Confluence (trend-gated breakout) beat a *regime-gated* random baseline - random entries restricted to the same favorable-regime bars, at a frequency re-matched to fire as often as confluence does within those bars - in 11 of 21 windows - 52%, also not meaningfully above chance.** Gating the entry trigger behind a long-period trend filter did not rescue it: confluence's edge over its (regime-aware) random baseline is, if anything, marginally weaker than plain breakout's edge over its (regime-blind) random baseline, not stronger. This directly answers the question that motivated building candidate #2 at all (§0 of `PHASE2_CONFLUENCE_SCOPING.md`): adding the trend filter on top of an entry trigger that already showed no edge did not produce one.

**The trend/regime filter's own effect - isolated by comparing filtered vs. unfiltered on an otherwise-identical base strategy - replicated cleanly across two different base strategies, and it's a real, reusable finding in its own right, separate from the entry-timing question above:**

| Base strategy | Filter | Avg Sharpe (unfiltered -> filtered) | Avg Return% | Avg Max DD% | Per-ticker Max DD direction |
|---|---|---|---|---|---|
| `maCrossoverStrategy` (candidate #3) | 200-MA regime filter | 0.348 -> 0.198 | 7.98 -> 4.62 | 7.67 -> 5.60 | improved on 7 of 7 tickers |
| `volumeBreakoutStrategy` (candidate #1 -> #2) | 200-MA regime filter (= confluence) | 0.428 -> 0.315 | 4.08 -> 3.59 | 4.57 -> 4.15 | improved on 4 of 7, worse on 1 (JNJ), unchanged on 2 (NVDA/META - the filter blocked zero signals on either ticker in this run) |

Same direction both times: Sharpe and return go down on average, max drawdown goes down on average. **The regime/trend filter is a risk-reduction tool, not an alpha source** - this was lesson #9's tentative read on one base strategy; it's now a replicated finding across two.

**One honest asterisk on "reliably improved drawdown," worth stating precisely rather than rounding up:** candidate #3's drawdown improvement was uniform - 7 of 7 tickers, no exceptions, the cleanest result in either investigation. Confluence's was not uniform at the per-ticker level - 4 of 7 improved, JNJ got worse (4.79% vs 4.26%), and NVDA/META were untouched because the filter never blocked a signal on either. The *average* improved both times; only candidate #3's improvement held ticker-by-ticker. Don't cite "the filter always lowers drawdown, every ticker, every time" as a general rule from this - cite "the filter lowers average drawdown in both tests, and did so unanimously in one of the two."

**What NOT to conclude from any of this:** this is not a finding that regime detection or volume confirmation are useless concepts in general. It's a finding about these *specific implementations* - a 200-day MA trend filter, a 20-day breakout with a 1.5x volume threshold - on this specific 7-ticker, 2022-today dataset. A different trend-detection method, a different breakout definition, or a different dataset could behave differently; that's simply not what was tested. What *was* tested, twice, with a held-constant risk-management baseline both times, is these two specific components, and neither showed a demonstrable signal-generation edge - while both showed a real, measurable risk-management benefit. Those are two separate claims, and this investigation supports one of them (risk reduction) more strongly and more uniformly than the other (no edge, but also not proof of *absence* of any possible edge from a different implementation).

### Process note: the two-baseline comparison should be a standing requirement for any future Phase 2 candidate, not an optional extra step

Lesson #10's process note already documented that this session's ATR-lookback fix, random-entry baseline, and per-window B&H table were all initially reported as complete before any of them existed in the repository, and that every result trusted afterward required direct raw-output verification. That practice carried through the rest of this investigation, and it's worth stating plainly what specifically made it useful *as a research method*, not just as an anti-fabrication check: **the random-entry (and, where a filter is involved, regime-gated random-entry) baseline was the single check that reliably separated a real finding from a misleading one, across all three candidates tested this session.**

- Without it, candidate #1's "beats buy & hold in 7/21 windows" reads like a real, if modest, edge. With it, that same 7/21 sits right next to "a random timer, wrapped in the identical risk management, beats buy & hold slightly *more* often" (lesson #10) - a completely different conclusion, only visible once the comparison existed.
- Without it, candidate #2's regime-filtered result would have been evaluated only against buy & hold and against plain breakout - both of which candidate #2 does, on paper, look reasonable against on some tickers (AAPL, MSFT). The regime-gated random baseline is what showed that "reasonable-looking against buy & hold" and "has a real entry-timing edge" are not the same claim.

**Standing rule going forward, not scoped to this session:** any future Phase 2 (or later) signal candidate's validation plan must include a random-entry baseline under identical risk management as a required step, not an optional follow-up added after a promising-looking result invites scrutiny. If the candidate involves a filter (regime, volatility, or otherwise) stacked on top of an entry trigger, the random baseline must also be run gated by that same filter, matched to a comparable in-filter frequency - an ungated-only comparison risks crediting the filter's own restriction effect to the entry logic instead. This is now precedent, not a one-off methodological choice: `PHASE2_CONFLUENCE_SCOPING.md` §6 wrote it into a scoping doc before implementation for the first time this session (the two-baseline design was proposed, not improvised after the fact) - future candidates should do the same from their own scoping stage onward.

## 12. Testing the same signal on a less-efficient market doesn't rescue it either - the small-cap hypothesis wasn't supported

After four consecutive negative results on the same 7 large-cap tickers (Phase 1's indicator family, the regime filter, volume breakout, and confluence - lessons #1-#11), the next candidate explanation tested was market efficiency itself: maybe the signal is real but arbitraged away on mega-caps, and would show up on smaller, less-covered names instead. `PHASE2_SMALLCAP_SCOPING.md` proposed testing `volumeBreakoutStrategy`, completely unchanged (same `breakoutPeriod: 20, volumePeriod: 20, volumeMultiplier: 1.5, exitPeriod: 10`, same ATR stop, same 18-month/2-month-lookback walk-forward setup already validated on large-caps), on 7 small/micro-cap tickers - MARA, PLUG, FUBO, CHPT, IONQ, UEC, ACHR - with one deliberate change: slippage raised from the large-cap default (0.05%) to 0.3%, reasoned (not measured - this repo's OHLCV data has no bid/ask spread to check it against) as a conservative estimate of small-cap fill realism.

**Result: averaged Sharpe -0.222, averaged return +2.32%, across all 7 tickers/21 windows - worse on a risk-adjusted basis than the large-cap version's positive average Sharpe.** Real, unedited output from `server/quant/smallcap-validation.js`, not reconstructed.

**Random-entry baseline (identical 0.3% slippage on both sides, so the comparison stays on equal terms per lesson #10's standing rule): real strategy beat random in 11 of 21 windows (52.4%) - nearly identical to large-cap volume breakout's own 12 of 21 (57.1%) against its baseline.** Averaged across all 21 windows, both real (-0.222) and random (-0.473) posted negative Sharpe - real modestly ahead of random on average (+0.251 Sharpe, +1.02 percentage points of return), but neither came out risk-adjusted-profitable. Real output from `server/quant/smallcap-vs-random.js`.

**Liquidity check, direct from the trade log, not estimated:** position size as a percent of that day's actual traded volume, across all 78 executed BUY trades - max 0.0196% (CHPT, 2025-10-03), average 0.0026%. The thin-liquidity concern that motivated the conservative slippage assumption in the first place did not materialize as an actual sizing constraint at this account scale (a single simulated $10,000 account, 2% risk per trade) - worth remembering for any future test at a materially larger account size, where this ratio would not stay this small.

**Conclusion: the market-efficiency hypothesis was not supported.** The real-vs-random relationship barely moved between large-cap (12/21, 57.1%) and small-cap (11/21, 52.4%) testing of the identical strategy - if anything, marginally weaker on small-caps, not stronger. Small-caps were also a harder overall environment in this test, not an easier one for finding edge: both the real strategy and its random baseline posted negative average Sharpe here, versus a positive average Sharpe for the large-cap real strategy (lesson #10: 0.428).

**Scope of this conclusion, stated precisely so it isn't over-read later:** this rules out one specific thing - the same breakout-and-volume-confirmation signal, unchanged, applied to 7 specific smaller/less-covered stocks over this dataset, with this project's existing ATR stop and a conservative-but-unverified slippage assumption. It does **not** test: a different signal type built specifically around small-cap market structure (rather than reusing a large-cap signal unchanged, which was a deliberate choice per `PHASE2_SMALLCAP_SCOPING.md` §2 to isolate the market-efficiency variable, not a claim that no small-cap-specific signal could work); alternative data sources (options flow, short interest, insider transactions - nothing this pipeline currently fetches); different timeframes (intraday, where a less-efficient market's slower price discovery might show up on a faster clock than daily bars can see); or a larger/different small-cap universe than the 7 tested. All of those remain genuinely open, untested directions - this result closes one specific hypothesis, not the broader question of whether market inefficiency is exploitable by *any* method.

## 13. Insider-cluster buying: one striking real anecdote, no demonstrable edge - and too few trades to tell the difference

Lesson #12 closed the market-efficiency question for price/volume technicals. The next candidate explanation tested wasn't a variant of that question at all: `PHASE2_INSIDER_SIGNAL_SCOPING.md` proposed a genuinely different data source - SEC Form 4 insider transactions, not price or volume - grounded in real academic literature (Seyhun; Lakonishok & Lee 2001; Cohen/Malloy/Pomorski) rather than picked arbitrarily. v1 signal: BUY when 2+ distinct insiders each file a real open-market purchase (transaction code `P`) within a trailing 30 days, exit on a 6-12 month hold (a fixed 252-trading-day maximum, with `risk.js`'s ATR stop as capital protection only, per the scoping doc's reasoning that this is a slow, literature-documented 6-12+ month effect, not a fast breakout).

**Frequency was the first, real problem - checked directly, not assumed.** The original 7-large-cap universe (AAPL, MSFT, JNJ, GOOGL, AMZN, NVDA, META) produced **zero** cluster events over 2022-2026 - mega-cap insiders overwhelmingly sell, not buy. A 7-ticker mid-cap universe (GGG, RLI, SSD, WDFC, TTC, DCI, CW) did better but still only found 7 clusters - below this project's own ~10-15-trial minimum (lesson #3). Widening to 22 mid-cap tickers (adding NVST, ICUI, CFR, REXR, POR, IDA, AVA, MANH, BMI, LOPE, SAIA, AIT, RHI, MAN, MTSI, each individually verified via real ownership-structure research to be institutionally-dominated, not founder/family-controlled) found **127 code-P transactions and 14 cluster events** - marginally inside the 10-15 range, not comfortably past it. A direct DRIP-pattern check (flagging any fractional-share contributing transaction) confirmed all 14 clusters rest entirely on whole-share transactions - zero contamination from the dividend-reinvestment-style fractional shares spotted incidentally on two non-clustering tickers (TTC, AVA).

**Result: pooled across the 8 tickers that produced a real cluster (RLI, WDFC, CW, NVST, ICUI, CFR, REXR, BMI), 11 of the 14 clusters produced a completed round-trip trade** (3 were skipped because `insiderClusterStrategy`'s own internal hold-period counter - which runs independently of `backtest.js`'s ATR stop, the same architectural characteristic every strategy in this project has always had - still considered the position open when the next cluster arrived, even though the real ATR stop had already closed it). **Pooled win rate 18.18% (2 of 11 winning), average return +2.80% across the 8 tickers - beating a matched random-entry baseline (same per-ticker entry count, same time-based hold, same ATR stop) at 0.00% win rate and -2.68% average return.** Real, complete output from `server/quant/full-backtest-insider-cluster.js` and `full-backtest-insider-random-baseline.js`.

**Critical caveat, checked directly rather than glossed over: this entire positive result rests on a single trade.** Curtiss-Wright (CW), entered 2023-07-10 on a real same-day cluster of 6 distinct insiders (Farkas, Ferdenzi, Ogilby, Bamford, Freda, Watts, all at $155.43), held through a genuine sustained rally - not a spike that happened to land favorably at the exit date: monthly closes climbed almost every month from $185.48 at entry to a peak of $285.21 (2024-05-21), and the position was closed at $281.44 on 2024-07-10 by the strategy's own 252-day hold-period logic (`reason=SIGNAL`, not a stop), for +29.57%. **Excluding this one trade, the remaining 7 tickers/10 trades average -1.03% return with a 10.00% win rate (1 of 10) - clearly unprofitable on their own.**

**The initially-suspected "uniform -2% losses" pattern was checked directly and ruled out as a mechanical artifact, not just assumed away.** NVST, ICUI, CFR, REXR, and BMI all exited via `STOP_LOSS`, but their actual ATR-derived stop distances varied genuinely - 4.596% (REXR) to 9.135% (BMI) of entry price, independently-computed ATR(14) values matching the backed-out `(entryPrice - stopLossPrice)/2` exactly in every case. These are five real, legitimate ATR stops on five different volatility profiles that happened to produce similar-looking round-number losses (-2.0x% total return, not per-trade P&L, which itself ranged -4.64% to -9.18%) - not a shared bug or a hidden mechanical ceiling.

**Honest verdict: with n=11 total completed trades - smaller than any other candidate tested in this project - this doesn't clear lesson #3's own small-sample bar.** One striking real anecdote (CW) and ten unremarkable-to-losing trades is not strong evidence the insider-cluster hypothesis is wrong (the literature's documented effect may need a larger universe, a longer history, or a different threshold than v1's 2-insider/30-day definition to generate enough trials to test properly) - but it is equally not evidence the hypothesis is right. CW's trade is worth remembering if this is ever revisited at a larger sample, not treated as proof of anything on its own with n=1 real winner.

**Running tally, six Phase 2 investigations in:** Phase 1's indicator family, the regime filter, volume breakout, confluence, and small-cap volume breakout (lessons #1-#12) were all clean negatives - real edge tested and ruled out at a reasonable sample size. This sixth one, the first to use a genuinely different data source rather than another slice of price/volume, is qualitatively different: **sample-size-inconclusive, not a clean negative.** The distinction matters for anyone revisiting this later - "insider clustering doesn't work" is not what this entry supports; "this specific 22-ticker, 4.5-year test didn't produce enough trials to tell" is.

## Discretionary Trading Lessons

Separate track from the quant research lessons above - concepts learned for manual/discretionary trading, following the same "lesson + why it matters" format.

### Lesson 1: Position Sizing
Risk % of account is the one constant - it never changes. Position size, trade count, and whether to take a trade at all flex around it, never the other way around.
Formula: `Position Size = (Account Equity × Risk %) / (Entry Price − Stop-Loss Price)`
If the calculated size rounds to 0 shares, skip the trade - don't force it by rounding up. Rounding down is always the safe direction (actual risk ends up slightly under target, never over).

### Lesson 2: Stop-Loss Placement
Stop-loss = the price where the original trade thesis is actually invalidated, not "wherever feels safe."
- **Fixed percentage**: simple, but ignores the instrument's actual volatility.
- **ATR-based**: adapts to real volatility (wider stop on volatile instruments, tighter on calm ones) - generally the better default.
Critical sequencing: the stop-loss is decided **first** (based on where the thesis breaks), and position size is calculated **second**, off that stop distance. Never reverse-engineer the stop to make the position size formula give a nicer number.

### Lesson 3: Risk-Reward Ratio (R:R)
`R:R = (Target − Entry) / (Entry − Stop-Loss)`
Breakeven win rate = `1 / (1 + R:R)`. At 1:1.5 R:R, only a 40% win rate is needed to break even - meaning win rate alone is meaningless without knowing the R:R it's paired with.
A trade with a great setup but poor R:R (risking more than the potential gain) should be rejected outright, same as Lesson 1's rule that a 0-share position means skip, not override.

### Lesson 4: Max Drawdown Circuit Breaker
Protects across a *losing streak*, not just per-trade (unlike Lessons 1-3). If drawdown exceeds a set threshold (e.g. 8% daily), halt all new trades immediately.
Correct sequence when it fires: **stop trading → diagnose why (normal variance vs. something structurally broken) → only resume once you know which.**
The wrong response is jumping to a *different* trade or strategy without diagnosing first - that's the same "override the rule when it's inconvenient" mistake as Lesson 1, just dressed up as being proactive.

### Lesson 5: Market Structure - Trends
Uptrend = higher highs + higher lows (HH/HL). Downtrend = lower highs + lower lows (LH/LL). Range = no clear progression, price oscillates between a ceiling and floor.
A trend isn't broken by a normal pullback - it's broken the first time a low undercuts the *previous* higher low (uptrend) or a high fails to exceed the previous lower high (downtrend). That single moment is often the earliest real warning sign, ahead of any indicator confirming it.

### Lesson 6: Support & Resistance
Support = a level where buying pressure has historically stopped declines. Resistance = a level where selling pressure has historically capped rallies.
**Role reversal**: once resistance breaks, it often becomes support going forward (and vice versa for support breaking).
These levels are zones, not exact prices - markets often wick slightly through a level before reversing (stop-hunting/liquidity grabs), so stops are placed a bit *beyond* the level, not precisely on it.
Directly connects to Lesson 2: the stop-loss should sit just beyond a support/resistance zone, since that's the actual invalidation point for a trade built around that level holding.

### Lesson 7: Volume Confirmation
Price shows *what* happened; volume shows *how convincing* it was.
- **Breakout confirmation**: a breakout on high volume is more likely to hold; on low volume it's a common "false breakout" trap.
- **Trend health**: volume should expand on up-moves and contract on pullbacks in a healthy uptrend. Volume drying up on new highs (price up, volume down) is an early warning sign the trend is losing steam - often visible before any structure break.
- **Reversal signals**: a sharp move on unusually high volume after an extended trend can signal exhaustion (a "climax") rather than continuation.
