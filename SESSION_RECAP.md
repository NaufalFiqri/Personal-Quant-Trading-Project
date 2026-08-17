# Session Recap - 2026-08-07 follow-up (auto mode, unattended)

Factual summary of everything done this session. Not a rewrite of LEARNINGS.md - see there for the actual findings writeup.

## What was done

1. **Per-ticker RSI baseline pulled individually** (Sharpe, max DD, win rate, trades) for AAPL/MSFT/JNJ, same 3-year window (2023-08-06 to 2026-08-06) as the original lesson #7 investigation. Read-only: reused the existing unmodified backtest/strategy code, no new configurations tested.
2. **Checked volatility as an explanation** (daily return stdev, avg ATR(14) as % of price) per ticker - ruled out. JNJ is the least volatile of the three but degraded under stops anyway; volatility ranking doesn't track the degradation pattern.
3. **Checked trade frequency as an explanation** - ruled out. Round-trip counts were similar across tickers (AAPL 3, MSFT 3, JNJ 4 over 3 years).
4. **Found the actual explanation**: each ticker's baseline trades' max adverse excursion (MAE) relative to the stop widths tested. AAPL's winning trades all needed a deeper drawdown than every stop width tested (so none of them survived); MSFT's shallow-MAE trades tolerated stops well, and its one deep-MAE trade was already a loser (so a stop there helped, not hurt); JNJ was in between on percent stops but got hit separately by the ATR stop's default multiplier producing a *tighter* stop distance than 5% on all three tickers, tightest on JNJ specifically (lowest ATR%).
5. **Wrote up the addendum** under LEARNINGS.md lesson #7 (new "Addendum: why AAPL/JNJ and not MSFT?" subsection, with the full per-ticker MAE table).
6. **Committed** the addendum (see Git state below).
7. **Scoped 3 candidate directions** for the next Phase 2 signal strategy, grounded in what Phase 1 and this session's investigation already ruled out - written to `PHASE2_SIGNAL_CANDIDATES.md`. No code written for any of them.

## Findings, in one line each

- RSI's stop-loss problem isn't about volatility level or trade count - it's whether that ticker's specific trades needed to draw down further than the stop allowed.
- The ATR stop's default 2x multiplier was tighter than the 5% percent stop on all three tickers tested (JNJ tightest) - "ATR-based" didn't mean "wider" here, worth checking in percent-of-price terms before assuming it does elsewhere.

## Git state - what's committed / staged / pushed / waiting on you

| Item | State |
|---|---|
| `server/quant/backtest.js` risk-management wiring | Committed (`e844ea0`), from a prior session |
| `LEARNINGS.md` lesson #7 (5-variant RSI comparison) + this session's addendum | Committed together (`a22ac10`) - see note below |
| Local branch vs. `origin/main` | 2 commits ahead, **not pushed** (as instructed) |
| `README.md` (session 10 journal entry + "What's Next" update, from the prior turn) | Still uncommitted, unstaged - untouched this session, same as when you last saw it |
| `PHASE2_SIGNAL_CANDIDATES.md` | New, **untracked** (not staged, not committed) - scoping doc for you to review |
| `SESSION_RECAP.md` (this file) | New, untracked |

**Note on the `a22ac10` commit:** you asked to commit "this" (the addendum) as its own commit. It turned out lesson #7's base write-up (the original 5-variant comparison) was still sitting uncommitted from the prior turn, and the addendum doesn't stand alone without it (it references "the table above"), so both went into `a22ac10` together under the addendum-focused message you gave. `README.md`'s matching journal entry was deliberately left out and remains unstaged - it's a separate, self-contained piece you hadn't signed off on committing yet.

## Waiting on your review

- `README.md`'s uncommitted session-10 changes (journal + What's Next) - decide whether to commit, edit, or discard.
- `PHASE2_SIGNAL_CANDIDATES.md` - pick a direction (or none) for the next Phase 2 signal strategy. Nothing has been implemented.
- The 2 local commits ahead of `origin/main` - not pushed, per your instruction.
