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

## Bonus: a data bug that looked like a strategy result

Separately from the above, found a real bug in the data-caching layer while building the walk-forward test: the cache tracked "what date range do we have" as a single min/max envelope, so two separately-fetched chunks with a real gap between them (2022 fetched in one session, mid-2023-onward in another) got reported as if the whole span including the gap was covered. Requests landing in that gap silently came back with 0 bars - which, fed into the backtest, produced a totally silent "0.00% return, 0 trades" row that looked exactly like a legitimate no-signal window.

Two lessons stacked here:
- **A bug in the data layer can masquerade as a finding in the strategy layer.** Zero trades in a window could mean "the strategy legitimately didn't fire" or "there's no data here" - from the output alone, they're indistinguishable. Had to go check the raw bar count for that window specifically to find this.
- This is also *why* the zero-trade-window exclusion bug (see README Journal, session 6) was worth taking seriously as a category, not a one-off: any time "the strategy did nothing" gets folded into an aggregate the same way as "the strategy did something and it happened to be flat," the aggregate stops meaning what it looks like it means. Two different bugs, same root shape of mistake.
