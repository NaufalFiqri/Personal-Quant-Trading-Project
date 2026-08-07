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

## Bonus: a data bug that looked like a strategy result

Separately from the above, found a real bug in the data-caching layer while building the walk-forward test: the cache tracked "what date range do we have" as a single min/max envelope, so two separately-fetched chunks with a real gap between them (2022 fetched in one session, mid-2023-onward in another) got reported as if the whole span including the gap was covered. Requests landing in that gap silently came back with 0 bars - which, fed into the backtest, produced a totally silent "0.00% return, 0 trades" row that looked exactly like a legitimate no-signal window.

Two lessons stacked here:
- **A bug in the data layer can masquerade as a finding in the strategy layer.** Zero trades in a window could mean "the strategy legitimately didn't fire" or "there's no data here" - from the output alone, they're indistinguishable. Had to go check the raw bar count for that window specifically to find this.
- This is also *why* the zero-trade-window exclusion bug (see README Journal, session 6) was worth taking seriously as a category, not a one-off: any time "the strategy did nothing" gets folded into an aggregate the same way as "the strategy did something and it happened to be flat," the aggregate stops meaning what it looks like it means. Two different bugs, same root shape of mistake.
