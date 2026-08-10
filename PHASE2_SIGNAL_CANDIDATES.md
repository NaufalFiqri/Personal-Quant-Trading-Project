# Phase 2: Next Signal Strategy - Candidate Scoping

Scoping only - no implementation. For review; pick one (or none) before any code gets written.

## What's already ruled out

**Phase 1** (see README.md "Research Phase 1: Findings" and LEARNINGS.md): a family of single-condition, price-only technical indicator strategies - SMA/EMA/WMA crossover and RSI mean-reversion, all computed purely from closing price - showed no robust, replicable edge over buy & hold. Walk-forward testing and cross-ticker replication both mattered: single-period and single-ticker results looked promising and didn't hold up. The one consistent, *reliable* finding was that performance is regime-dependent (trend-following did well in the 2022 bear market, poorly in a 3-year rising market) - but Phase 1 never tried to detect or adapt to regime, it just observed that the same fixed strategy behaved differently in different regimes.

**This session** (LEARNINGS.md lesson #7 + addendum): pairing RSI mean-reversion with a hard, fixed-width, price-based stop-loss - percent (5/8/10%) or default-parameter ATR - doesn't fix its risk-managed Sharpe degradation. The mechanism: RSI's reversion trades need room to draw down before reverting, and any hard stop tested worked against that by construction. This isn't necessarily true of every strategy shape - trend-following crossovers didn't show the same problem - but it's a concrete data point that "the strategy's own trade logic" and "how it gets stopped out" need to be considered together, not bolted on independently.

## Candidates

### 1. Volume-confirmed breakout/trend signal

Use volume (already in every cached OHLCV bar via `data.js` - `bar.volume` - but never used as a signal input by any Phase 1 strategy) to confirm a price move rather than acting on price geometry alone. E.g., enter on a price breakout above a recent range only when same-day volume is meaningfully above its own recent average; the theory being a move backed by above-average participation is more likely to continue than one that isn't.

**Rationale:** Every Phase 1 strategy was derived purely from closing price. Volume is a fundamentally different data source already sitting unused in the pipeline - genuinely new information, not a new way of slicing the same input, and zero new data-fetching infrastructure needed. It's also structurally a breakout/continuation idea rather than mean-reversion, which plausibly pairs better with a hard stop than RSI did (a breakout expects immediate follow-through, so a stop a modest distance below entry doesn't fight the strategy's own logic the way it did for a reversion trade that needs room to be wrong first).

### 2. Multi-condition confluence strategy

Require two or three independent conditions to agree before taking a trade, instead of one indicator crossing one threshold - e.g., a long-period trend filter (price above/below a 200-period MA) plus an RSI entry trigger plus a volume check, all built from indicators that already exist in `indicators.js`/`strategy.js`.

**Rationale:** Every Phase 1 strategy committed to a single-condition trigger, and lesson #3 (small samples produce misleadingly extreme results) is partly a symptom of one noisy indicator acting alone. Confluence is a genuinely different structural hypothesis - "do independent signals agreeing produce a more reliable trade than any one of them alone" - not a variant of the same single-indicator family already ruled out, and it's cheap to build since it reuses existing building blocks rather than requiring a new indicator.

### 3. Regime-adaptive strategy (volatility or trend-regime filter)

Classify the current market regime (e.g., ATR-based volatility percentile, or price position relative to a long-term MA, "trending" vs. "choppy") and only take trend-following trades - reusing the already-built, already-tested `maCrossoverStrategy` - when the regime filter says conditions favor it; sit out otherwise.

**Rationale:** This is Phase 1's single most robust finding taken seriously and acted on, rather than left as an observation. Phase 1 proved regime matters a lot (3/12 beat B&H in a rising market vs. 8/12 in the 2022 bear market) but never built anything to detect regime and adapt - it just ran one fixed strategy blind to regime and watched the result swing. This is lower-risk to build than #1 or #2 in one sense (it's a filter on top of an existing, validated strategy rather than a wholly new signal with unknown behavior) but it's also the candidate most directly aimed at turning an already-observed effect into something exploitable, rather than searching for a new effect from scratch.

## A smaller, orthogonal option worth naming (not a new signal)

Rather than a new signal, directly address this session's RSI/stop-loss finding: keep RSI mean-reversion as-is but replace the hard price stop with a non-price exit mechanism - a time-based exit (close the position after N bars regardless of price) or drop the stop-loss for that strategy entirely and rely on position sizing alone for risk control. This wouldn't produce a new edge, but it would settle whether RSI's *risk management*, not RSI's *signal*, was the actual problem. Smaller scope than 1-3, and answers a different question ("can RSI be made to coexist with `risk.js`" vs. "is there a new source of edge") - worth keeping in mind but not counted as one of the three signal candidates above.

## Not scoped here

No code, no new indicator functions, no new strategy file, no backtest runs against any of these. This file is for picking a direction; implementation is a separate step once one is chosen.
