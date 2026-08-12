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

## 4. Single-period backtesting overstates confidence; walk-forward + replication is what actually stress-tests a claim

The progression that got to the AAPL finding above:
1. One backtest, one window -> looked bad (underperformed on 2 of 3 stocks).
2. Parameter sweep -> still bad, but ruled out "wrong periods" as the explanation.
3. Multi-regime comparison -> revealed the strategy is regime-dependent, not uniformly bad or good.
4. Walk-forward across many sequential windows -> most results were coin-flip, but one ticker had a standout.
5. Cross-ticker replication of that standout -> it didn't hold up.

Each step could only be reached because the previous step's blind spot became visible. A single backtest genuinely cannot distinguish "this strategy has an edge" from "this strategy got lucky in this window" - you need either more time (walk-forward) or more comparable instances (cross-ticker) to tell the difference. This is the core reason walk-forward testing exists as a standard practice, not just a nice-to-have: it's the only way in this project's method to catch a result like #3 before mistaking it for #4-level evidence.

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

**Open question, not yet explained: META was the only ticker where the filter produced a fully empty window** (1 no-signal window, vs. 0 for every other ticker under either variant) - every candidate entry in that window got blocked. Whether that's the regime filter correctly sitting out a genuinely bad stretch for META, or a case where the filter was too aggressive for that ticker's specific price path, hasn't been investigated. Flagged for future work, not guessed at here - the same discipline lesson #7's addendum used (check the mechanism before asserting one) applies, and that check hasn't been done yet for this case.

**Conclusion, stated at the same confidence level the data supports: this regime filter is not shown to be a general improvement to `maCrossoverStrategy`.** It reliably reduces drawdown; it does not reliably improve risk-adjusted return, and whether it helps or hurts a given ticker looks tied to something ticker-specific that hasn't been identified yet (same shape of open question as lesson #7/#8's per-ticker splits). Worth treating as "a real drawdown-reduction tool with an unresolved, ticker-dependent cost" rather than either "validated" or "debunked."

### A methodology bug found and fixed along the way, with broader implications

Building this validation surfaced a real bug in `walkforward.js`, unrelated to the regime filter's own merits: `runWalkForward` fetched bars fresh per window with no lookback buffer before `windowStart`, so any indicator with its own multi-bar warm-up period had to re-warm from scratch *inside every window* rather than once across a continuous run. For the regime filter's 200-period MA this meant an estimated 26-53% of bars per window falling into unclassified warm-up, worse than the fraction on one continuous backtest, not better - widening the window length (the original plan) doesn't fix this, since the warm-up requirement resets every window regardless of window size. Fixed with an optional `lookbackMonths` parameter that fetches extra history before each window purely to prime indicators, filtered back out before backtesting - confirmed via the blocked-signal breakdown, which dropped to 0% warm-up-driven blocks after the fix.

**This is worth flagging beyond the regime filter specifically: any prior walk-forward result in this project that used a long-lookback indicator would have the same warm-up contamination, silently.** The strategies actually walk-forward-tested so far (SMA/EMA/WMA 20/50, RSI 14) all use short-to-medium indicator periods (14-50 bars) against 6-month (~126 trading day) windows, so the warm-up fraction there is much smaller than the 200-period regime filter's - but it hasn't been explicitly audited. Not investigated now (out of scope for this entry), but flagged as a specific, concrete thing worth checking before trusting any older walk-forward number that involves an indicator with a long lookback relative to its window length.

## Bonus: a data bug that looked like a strategy result

Separately from the above, found a real bug in the data-caching layer while building the walk-forward test: the cache tracked "what date range do we have" as a single min/max envelope, so two separately-fetched chunks with a real gap between them (2022 fetched in one session, mid-2023-onward in another) got reported as if the whole span including the gap was covered. Requests landing in that gap silently came back with 0 bars - which, fed into the backtest, produced a totally silent "0.00% return, 0 trades" row that looked exactly like a legitimate no-signal window.

Two lessons stacked here:
- **A bug in the data layer can masquerade as a finding in the strategy layer.** Zero trades in a window could mean "the strategy legitimately didn't fire" or "there's no data here" - from the output alone, they're indistinguishable. Had to go check the raw bar count for that window specifically to find this.
- This is also *why* the zero-trade-window exclusion bug (see README Journal, session 6) was worth taking seriously as a category, not a one-off: any time "the strategy did nothing" gets folded into an aggregate the same way as "the strategy did something and it happened to be flat," the aggregate stops meaning what it looks like it means. Two different bugs, same root shape of mistake.

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
