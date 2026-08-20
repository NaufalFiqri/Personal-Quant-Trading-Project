# Phase 2: Small/Micro-Cap Replication - Scoping Proposal

Scoping only. No implementation, no new strategy code, no backtest runs beyond the data-feasibility check in §1. For review/approval before any walk-forward run starts - same discipline as `PHASE2_VOLUME_BREAKOUT_SCOPING.md`, `PHASE2_REGIME_FILTER_SCOPING.md`, `PHASE2_CONFLUENCE_SCOPING.md`.

## 0. Why this, now

Four consecutive results on the same 7 large-cap tickers (AAPL, MSFT, JNJ, GOOGL, AMZN, NVDA, META) came back negative: Phase 1's indicator family, the regime filter, volume breakout, and their confluence (LEARNINGS.md lessons #1-#11) - none showed a demonstrated entry-timing edge over a matched random-entry baseline once risk management was held constant. One explanation is that the tested signals simply don't work. A second, distinct explanation is that mega-cap large-caps are precisely the names with the most analyst coverage, the most algorithmic participation, and the fastest price discovery in the entire market - if a simple technical signal has an edge anywhere, large-cap efficiency is the least likely place to find it. **This is a test of that second explanation, not a new indicator search** - same signals, smaller/less-covered names, same held-constant-risk-management-and-random-baseline discipline that's already caught misleading results four times.

## 1. Ticker selection

**Checked in practice, not proposed from memory.** Fetched real historical data (`getHistoricalData`, 2022-01-01 to today) for 9 candidate small/micro-cap tickers via `data.js`, unchanged - avoiding pure biotech/binary-event names (an FDA-halt gap is a different risk profile than a data-quality problem, and would confound "is this strategy inefficient-market-sensitive" with "did this name have a news-driven jump") and any post-bankruptcy tickers.

| Ticker | Bars | Coverage | Zero-volume days | Min volume | Max volume | Avg volume | Min close |
|---|---|---|---|---|---|---|---|
| RIOT | 1161 | 99.4% | 0 | 4,296,400 | 127,903,700 | 22,047,934 | $3.29 |
| MARA | 1161 | 99.4% | 0 | 6,768,500 | 213,408,200 | 40,088,508 | $3.15 |
| PLUG | 1161 | 99.4% | 0 | 6,271,700 | 499,502,100 | 50,542,484 | $0.70 |
| FUBO | 1161 | 99.4% | 0 | 258,300 | 56,845,842 | 1,293,068 | $8.09 |
| CHPT | 1161 | 99.4% | 0 | 168,110 | 5,113,285 | 648,376 | $4.51 |
| IONQ | 1161 | 99.4% | 0 | 756,700 | 128,343,800 | 13,610,150 | $3.10 |
| OPEN | 1161 | 99.4% | 0 | 5,829,100 | 1,895,249,600 | 52,405,624 | $0.51 |
| UEC | 1161 | 99.4% | 0 | 1,791,500 | 67,071,000 | 9,619,542 | $2.37 |
| ACHR | 1161 | 99.4% | 0 | 321,100 | 160,904,300 | 18,075,745 | $1.63 |

**All 9 came back clean: identical 99.4% coverage (1161 of ~1168 expected trading days, the same small gap every large-cap ticker in this project also shows, not a small-cap-specific artifact), zero zero-volume days, and minimum volumes in the hundreds of thousands to millions of shares - no gappy or unreliable data on any candidate.** All 9 also traded in genuinely small/micro-cap price territory at some point in this range (closes from $0.51 to $8.09), consistent with real small-cap price action rather than a large-cap that happened to dip.

**Proposed final 7, dropping 2 for redundancy rather than data quality:**

- **MARA** (crypto mining) - kept over **RIOT**, dropped as a closely-correlated same-sector duplicate (both crypto miners, both driven by the same BTC-price factor - including both adds correlated exposure, not independent replication).
- **PLUG** (hydrogen/clean energy)
- **FUBO** (streaming media) - lowest avg volume among the ones kept (1.29M/day) but still comfortably liquid, not a thin-volume risk.
- **CHPT** (EV charging infrastructure) - the thinnest of the 7 kept (648K avg volume) - flagged explicitly as the one ticker in this set where position-size-vs-daily-volume deserves a second look if a large position ever gets sized against it (see §3's note on this).
- **IONQ** (quantum computing)
- **UEC** (uranium/nuclear fuel)
- **ACHR** (eVTOL/aerospace)

**OPEN** (real estate tech) considered and dropped, not for data quality (it's the most liquid of all 9, 52M avg volume) but because its business model (iBuying real estate) makes its price action closer to a leveraged real-estate/rates play than a typical small-cap growth story - keeping it would make "small-cap" partly a proxy for "rate-sensitive," a confound worth avoiding in a first pass. Six sectors across the 7 kept (crypto mining, clean energy, streaming, EV infrastructure, quantum computing, nuclear fuel, aerospace) - deliberately spread, same reasoning the original 7-large-cap set used (AAPL/MSFT tech, JNJ healthcare, GOOGL tech-adjacent, AMZN retail, NVDA semis, META social - not seven names from one sector).

## 2. Which strategy to test first

**Recommended: `volumeBreakoutStrategy`, unchanged - same default parameters already validated on large-caps (`breakoutPeriod: 20, volumePeriod: 20, volumeMultiplier: 1.5, exitPeriod: 10`).** Not `maCrossoverStrategy`, and not a combination, as the first test.

Reasoning:
- The question is "does market inefficiency matter," not "which indicator is best" - reusing a strategy exactly as already built and tested is what isolates that variable. Changing parameters or combining strategies at the same time as changing the ticker universe would confound two questions the same way testing two conditions at once always does in this project (lesson #4's standing rule).
- Of the two single-condition strategies already built, `maCrossoverStrategy` is the more commoditized signal - moving-average crossovers are among the most widely known, widely automated technical signals that exist, and there's no obvious reason a less-covered stock would trade this particular signal away *less* efficiently than a mega-cap does; if anything, MA crossovers are exactly the kind of mechanical, well-known pattern algorithmic market-making would still arbitrage regardless of market-cap tier.
- `volumeBreakoutStrategy`'s underlying theory has a more specific reason to behave differently on thinner names: a breakout confirmed by an above-average volume spike is a bet that real information is moving the price and that participation confirms it. On a large-cap, a volume spike is diluted by enormous baseline liquidity and picked up by algorithmic order flow within seconds. On a thinly-covered small-cap, the same relative volume spike is a much rarer, more discrete event, with fewer participants and slower institutional price discovery - the exact conditions under which a "the crowd hasn't priced this in yet" signal is more plausible than on AAPL. That's a real, specific hypothesis for why this strategy in particular might behave differently here, not just "try the other one too."
- Confluence (candidate #2) is deliberately not proposed as the first test either - it already showed no edge over a regime-gated random baseline on large-caps, and testing the more complex, 3-condition version before the simpler 2-condition version replicates the same "which piece is doing what" ambiguity `PHASE2_CONFLUENCE_SCOPING.md` §0 raised about candidate #2 itself. If breakout alone shows something real on small-caps, confluence becomes a sensible follow-up question; if it doesn't, adding a third condition on top of a signal that already didn't hold up here isn't a promising next step.

`maCrossoverStrategy` is a reasonable second test if `volumeBreakoutStrategy` shows something worth following up - not proposed to run in parallel with it now, for the same one-variable-at-a-time reason.

## 3. Slippage/fee realism

**The existing defaults (`feePercent: 0.001` / 0.10%, `slippagePercent: 0.0005` / 0.05%, `backtest.js`'s `DEFAULT_RISK_CONFIG`-adjacent constants) were never validated against small-cap fill conditions - they were sized for the large-cap universe this project has tested exclusively until now, and carrying them over unchanged would risk a good-looking result that's actually an artifact of assuming large-cap-tight fills on names that don't have them.**

Reasoning: `data.js`'s cached bars are OHLCV only - no bid/ask spread data is available in this pipeline, so the actual spread on any of these 7 tickers isn't something this project can check directly (a real, stated limitation, not glossed over). What's being proposed below is a conservative, order-of-magnitude estimate reasoned from general market-structure knowledge, not a number extracted from this repo's own data - and it should be treated with that same caveat any other unverified assumption in this project gets:

- **A $200+ mega-cap with 20-300M shares/day of volume typically trades a spread of a cent or two - a few basis points at most.** The existing 0.05% slippage default is already generous relative to that, not tight.
- **A sub-$10 stock with hundreds of thousands to tens of millions of shares/day of volume typically trades a spread that's a much larger percentage of price** - a few cents on a $3 stock is 1%+, not a few basis points. Wider percentage spreads, plus genuinely thinner order books at any given price level (more price impact per share traded), are both real and both point the same direction: slippage should be larger, not equal, going into this test.

**Proposed: `slippagePercent: 0.003` (0.3%), roughly 6x the large-cap default, as a starting point - not treated as a validated number, and proposed to be sensitivity-tested (e.g. 0.0015 / 0.003 / 0.005), not run once and trusted.** Rationale for landing on 0.3% specifically: conservative enough to meaningfully punish a strategy that only "works" on unrealistically clean fills, without being so extreme (1%+) that it would mechanically kill every trade regardless of signal quality and make the test uninformative either way. `feePercent` is left unchanged at 0.001 - trading fees are typically a broker/venue function of trade value or a flat commission, not a function of the underlying ticker's market cap, so there's no equivalent small-cap-specific reasoning to inflate it the way there is for slippage.

**A related gap, flagged but explicitly not fixed here:** `calculatePositionSize` in `risk.js` sizes a position purely from account equity, risk percent, and stop distance - it has no concept of the target ticker's own average daily volume, so nothing in this pipeline currently checks whether a sized position is small relative to a name's real liquidity or large enough to move the price itself. For the 7 tickers proposed in §1 (lowest average volume: CHPT at 648K/day), a backtest running a single simulated account is very unlikely to size a position anywhere near a volume-moving fraction of that - but this is worth stating as an assumption being made, not a check being performed, and CHPT specifically is the one ticker in this set where that assumption is least comfortable if it were ever pushed on.

## 4. Lookback requirements

**Unchanged from `volumeBreakoutStrategy`'s own already-established requirement - reused, not re-derived, since the strategy itself is unchanged (per §2).** Per `PHASE2_VOLUME_BREAKOUT_SCOPING.md` §5: breakout eligibility needs 20 prior bars of `high`, volume confirmation needs 20 prior bars of `volume`, exit needs 10 prior bars of `low` - combined warm-up bottleneck of **20 trading days**, and the ATR stop-loss's own warm-up (14-period, `riskConfig.atrPeriod`) is comfortably inside that same 20-day figure.

**Proposed `lookbackMonths: 2`**, identical to `volumeBreakoutStrategy`'s original large-cap validation (`volume-breakout-validation.js`) - same reasoning as that scoping doc (roughly 2x margin over the 20-day requirement) and the same value already used, so any comparison back to the large-cap numbers isn't also confounded by a lookback difference. (This sidesteps the lookback mismatch flagged in this session's candidate #1-vs-#2 comparison, where 2mo vs. 11mo lookback made an otherwise-clean comparison need a caveat - not an issue here since only one strategy, at one lookback value, is being proposed.)

**Window length: proposed unchanged at 18 months**, `minWindowMonths: 3`, same as every walk-forward run in this project since candidate #1. No small-cap-specific reason to change it - the warm-up bottleneck (20 days) is identical to the large-cap case, so the same window-length reasoning applies unchanged.

## 5. Test plan

Same order of operations as every prior candidate, with the two-baseline random-entry comparison specified as a required step from the start - not proposed as an optional add-on the way it effectively was for candidate #1 originally (lesson #10's process note is explicit that this should now be standard practice for every future candidate, and this is the first one scoped since that note was written).

1. **No new unit tests needed for the strategy itself** - `volumeBreakoutStrategy` is unchanged and already has its own test suite (`test-volume-breakout.js`). The data-feasibility check in §1 (already run, real output above) is this step's equivalent of "confirm the inputs are trustworthy before testing the strategy on them," same role `bar.volume`'s reliability check played in the original volume breakout scoping.
2. **Single-ticker sanity check** (one ticker from the proposed 7, one window) - raw signal count, at least one concrete annotated breakout+volume example with the actual price/volume numbers behind it, same format every prior sanity check in this project used.
3. **Full 7-ticker walk-forward** (MARA, PLUG, FUBO, CHPT, IONQ, UEC, ACHR), 18-month windows, `lookbackMonths: 2`, `riskConfig: { stopLossMethod: "atr" }`, `slippagePercent: 0.003` per §3 (plus, time permitting, the sensitivity check across 0.0015/0.003/0.005 named in §3, so a result isn't reported against only one untested slippage assumption). Report the same Sharpe/MaxDD/WinRate/Return/Trades table used for every prior candidate, per-ticker direction of effect stated explicitly alongside the average (lesson #9's standing rule).
4. **Random-entry baseline, required, not optional:** `randomEntryStrategy` (already built, reused unchanged) run through the identical walk-forward setup, same seed/entry-probability-matched-to-signal-frequency approach used in lesson #10, under the same `slippagePercent: 0.003` as the real strategy - comparing a real signal on generous fills against a random signal on realistic fills would reintroduce exactly the kind of asymmetric-comparison mistake lesson #6 already found once (comparing a differently-invested strategy against a benchmark that isn't held to the same terms). No regime filter is in play for this candidate (§2 explicitly excludes confluence from this first test), so only the ungated random baseline is needed here - not the two-baseline design `PHASE2_CONFLUENCE_SCOPING.md` used, which was specifically for a filter-plus-trigger combination this test isn't running.
5. **Report the real vs. random head-to-head count directly** (e.g. "beat random in X of 21 windows"), the same framing used for every large-cap comparison so far, so this result is directly comparable to the 12/21 and 11/21 already on record - the entire point of this test is a like-for-like comparison against the large-cap numbers, not a standalone result read in isolation.
6. **No-signal / low-signal windows watched for and reported explicitly**, same as every prior candidate - a thinner, more volatile ticker universe could plausibly produce more or fewer signals than the large-cap set did, and that's worth reporting on its own rather than folding silently into an average.

## Not scoped here

No code, no backtest runs beyond the data-feasibility check already shown in §1, no strategy modifications. This is a proposal for the decisions above (final ticker list, which strategy to test first and why, the slippage/fee adjustment and its reasoning, lookback, and a test plan with the random-entry baseline built in from the start) to be reviewed and approved before any walk-forward run happens.
