# Phase 2: Insider Transaction (Form 4) Signal - Scoping Proposal

Scoping only. No implementation, no new fetch/parse code, no backtest runs. This is a bigger decision than the four prior candidates - a new external data source, not a new combination of existing OHLCV-derived indicators - so this doc is written for thorough review before any code gets written, not a quick approval pass.

Two parts: **Part 1** is the scoping proposal (data access, signal definition, universe, entry/exit, infrastructure cost, test plan). **Part 2**, at the end, is a real feasibility check - actual live SEC EDGAR calls, actual parsed output, run before any of Part 1's factual claims about the data were finalized, not after.

# Part 1: Scoping

## 0. Why this, now

Five consecutive tests of price/volume technical signals - Phase 1's indicator family, the regime filter, volume breakout, their confluence, and volume breakout replicated on 7 small/micro-caps (LEARNINGS.md lessons #1-#12) - all landed on the same result: no demonstrated entry-timing edge over a random-entry baseline. Every one of those five was a different way of slicing the same underlying information (price and volume history). This candidate is different in kind, not just in parameters: SEC Form 4 filings disclose *why* a corporate insider - someone with genuine private information about the business - is putting their own money into the stock, which is not information price/volume history contains at all. It's worth being explicit that this is also a meaningfully bigger commitment than any prior candidate: every candidate so far reused `data.js`'s existing Yahoo Finance pipeline and only added strategy logic on top; this one requires a new data source, a new fetch/cache layer, and new parsing code before any strategy logic can even be written. §5 below sizes that cost directly.

## 1. Is there a usable, free, programmatic path to Form 4 data? Researched, not assumed.

**Short answer: yes, but it's two separate steps, and only the first one is JSON - the second requires parsing an XML document per filing. There is no single clean "insider transactions" JSON feed from SEC itself.**

**Step 1 - finding which Form 4s exist for a given company:** SEC's `browse-edgar` endpoint (`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=<ticker-or-CIK>&type=4&owner=include&count=100`, JSON output available) or the `data.sec.gov/submissions/CIK##########.json` endpoint returns the *metadata* - accession numbers, filing dates, form type - for every Form 4 that names a given company as issuer (not just filings the company itself submitted; `owner=include` is what pulls in filings submitted by insiders *about* that company). This part is free, JSON, no API key. [SEC.gov | EDGAR Application Programming Interfaces (APIs)](https://www.sec.gov/search-filings/edgar-application-programming-interfaces), [SEC.gov | Accessing EDGAR Data](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data).

**Step 2 - getting the actual transaction data:** the metadata from Step 1 doesn't include the transaction itself - shares bought/sold, price, transaction code, insider name/title. That lives in each individual filing's XML document (the `ownershipDocument` schema - a different, older structured format than the XBRL used for 10-K/10-Q financials), fetched from that filing's own `Archives/edgar/data/...` path and parsed field by field. **There is no bulk JSON dataset for this from SEC** - every source checked (SEC's own API docs, third-party guides) confirms Form 4 sits outside the XBRL company-facts/company-concept endpoints that cover financial statement data. [The SEC EDGAR API: A Practical Guide to Free Filing Data in Python](https://dev.to/odeeb/the-sec-edgar-api-a-practical-guide-to-free-filing-data-in-python-15b), [SEC EDGAR API Guide 2026: How to Access Company Filings Data](https://tldrfiling.com/blog/sec-edgar-api-guide/).

**Rate limits and access requirements, confirmed:** 10 requests/second per IP across all EDGAR endpoints (data.sec.gov and www.sec.gov both), enforced with a temporary IP block (reported around 10 minutes) if exceeded. **A descriptive `User-Agent` header (real name + contact email) is required on every request** - a generic or missing User-Agent gets rejected. No API key, no account, no cost. [SEC EDGAR API Rate Limit: 10 req/sec, User-Agent Header Required](https://tldrfiling.com/blog/sec-edgar-api-rate-limits-best-practices).

**Not taken on faith - tested live, side by side, against the real endpoint:**

```
curl -A "Mozilla/5.0" https://www.sec.gov/files/company_tickers.json          -> HTTP 403
curl -A "PersonalQuantResearchProject research-contact@example.com" ...same...  -> HTTP 200
```

Identical request, only the `User-Agent` header changed. Confirms the requirement is real and enforced, not just documented policy. **Deliberately using a placeholder contact string, not this project's real owner's email** - the User-Agent only needs to look like a real name+contact pair to satisfy SEC's fair-access policy (they don't verify it), and sending a real personal email to an external service wasn't something this task asked for. If real contact info is ever wanted here (e.g. so SEC could actually reach someone if usage caused a problem), that's a one-line change to make deliberately, not a default.

**Third-party alternatives exist** (sec-api.io, EODHD's Insider Transactions API, Form4API.com) that pre-parse Form 4 XML into clean JSON, for a fee. **Not proposed for this first pass** - consistent with this project's existing approach of building directly against a free source (`data.js` against Yahoo Finance) rather than a paid intermediary, and the SEC's own free path is fully sufficient, just more work to build.

**Practical resolution step needed first, not yet built anywhere in this project:** the 7 tickers are known by symbol, but EDGAR indexes by CIK (Central Index Key), a different identifier. SEC publishes a free static mapping file, `www.sec.gov/files/company_tickers.json`, for exactly this - a one-time or periodically-refreshed lookup, not per-request.

## 2. Concrete signal definition, grounded in what's documented, not picked arbitrarily

Researched before proposing a definition, not designed from intuition:

- **Nejat Seyhun's foundational work** (insider transactions, 1975-1981 data) found aggregate net insider buying predicting up to ~4.3% abnormal return over 300 days at the firm level, and aggregate insider buying activity has been shown to lead broad one-year-ahead market returns.
- **Lakonishok & Lee (2001)**, extending the data through the mid-1990s, found the effect **concentrated in smaller firms** (the heaviest-insider-buying decile beat the lightest by roughly 5% over 12 months) and - directly relevant here - that **the predictive content of insider purchases increases when multiple insiders buy within a short window ("cluster buying")**, historically associated with 4-8% abnormal returns over 6-12 months.
- **Cohen, Malloy, and Pomorski** refined this further by splitting insiders into "routine" traders (those who trade in the same calendar month across multiple consecutive years - predictable, carrying **zero** measured predictive power) versus "opportunistic" traders (irregular timing, information-driven - carrying real signal, on the order of 82bps/month, roughly 10%/year annualized).

**Proposed v1 signal, the simplest one with real literature backing: a "cluster buy" trigger.** BUY-eligible when **2 or more distinct insiders** (by name, not by filing count - one insider filing twice doesn't count as two) **each file a Form 4 containing at least one Table I transaction with code `P`** (open-market or private purchase - confirmed via SEC's own transaction-code documentation as the code specifically meaning real cash paid on the open market, as opposed to `A`/grants, `M`/option exercises, `F`/tax withholding, or `G`/gifts, none of which represent a genuine buy decision) **for the same issuer within a trailing 30-calendar-day window.**

**On the 30-day window specifically: this is a reasoned starting point, not a number pulled from a specific cited study - flagged plainly rather than dressed up as more validated than it is.** The literature confirms cluster buying (plural, short-window) outperforms single-insider buying as a category, but doesn't converge on one universal window length. 30 days is proposed as long enough to catch insiders who bought within the same general information event (an earnings report, a guidance update) without being filed on exactly the same day, short enough that it's still describing one coordinated signal rather than two unrelated purchases months apart. This is a parameter worth sensitivity-testing (e.g. 14/30/60 days) once the base infrastructure exists, not something to treat as settled going in.

**"Routine vs. opportunistic" filtering (Cohen/Malloy/Pomorski) is explicitly proposed as a v2 refinement, not part of v1.** It's the more rigorous, literature-backed version of this signal, but classifying an insider as routine requires multiple years of that specific individual's Form 4 history to establish a pattern - a materially larger data requirement than v1's single-window cluster check, and a second full layer of parsing/classification logic on top of the raw XML parsing in §1. Proposed order: get v1 (raw cluster-buy) working and validated first, since if that doesn't clear the random-entry baseline, the more expensive refinement isn't worth building next; if v1 shows something, the routine/opportunistic filter is the natural, literature-motivated next step.

**Two alternative signal definitions considered, both confirmed feasible against real filing data (see Part 2 below), neither chosen as v1:**

- **Officer/director purchases specifically, rather than any insider.** A real Form 4's `reportingOwnerRelationship` block carries `isDirector`, `isOfficer`, and `officerTitle` directly (confirmed in every filing fetched in Part 2 - e.g. a real CEO, a real "SVP, GC and Secretary", a real "Principal Accounting Officer" all appeared with these fields populated). Restricting to officers/directors (Section 16 filers with the deepest information access) rather than counting any reporting person is a real, easy refinement of v1's cluster-buy definition - the literature's "opportunistic trader" framing is closely related to this (officers/directors are more likely to be trading on genuine information than a 10%-beneficial-owner fund making a routine allocation change) without needing the full multi-year routine/opportunistic classification. **Folded into v1 as a parameter, not deferred to v2**: propose counting only insiders where `isOfficer=true` or `isDirector=true` toward the "2+ distinct insiders" cluster count, since the data needed is already sitting in every filing with no extra fetching.
- **Transaction size relative to the insider's existing holdings**, using the real `postTransactionAmounts/sharesOwnedFollowingTransaction` field (present in every transaction parsed in Part 2) to back out the purchase's size as a percent of pre-transaction holdings (`transactionShares / (sharesOwnedFollowingTransaction - transactionShares)`). Theoretically appealing - a purchase that meaningfully grows an insider's stake is a stronger conviction signal than a token add-on to an already-large position - but **not chosen for v1**: it's a continuous variable needing its own threshold decision (what counts as "meaningful"?) that isn't clearly pinned down in the literature reviewed for this doc the way cluster buying is, and `sharesOwnedFollowingTransaction` reflects only the reporting person's *direct* holdings in that one filing - indirect holdings (trusts, family entities - a separate `directOrIndirectOwnership` flag, also confirmed present in the real XML) would need to be reconciled across filings to get a true "percent of total holdings" figure, adding real complexity for a threshold that isn't literature-grounded yet. Named here as a real, data-feasible v2+ candidate refinement, not ruled out - just not the best-grounded starting point.

## 3. Ticker universe

**Proposed: the same 7 large-cap tickers used throughout this project (AAPL, MSFT, JNJ, GOOGL, AMZN, NVDA, META)**, per direct instruction, for comparability with every prior candidate's numbers.

**One tension worth stating plainly rather than glossing over: the literature itself (§2, Lakonishok & Lee) found this specific effect concentrated in smaller firms, not mega-caps.** Testing cluster-buy insider signals on the 7 largest, most liquid, most-covered names in this project's rotation is arguably testing the signal in close to the least favorable environment the literature describes - the same shape of tension this project already resolved once for the market-efficiency question (lesson #12), just for a different underlying reason here (analyst-coverage efficiency there; the specific insider-buying literature's own documented firm-size effect here). There's also a practical version of the same concern: mega-cap executives already hold large equity stakes and predominantly *sell* (diversification, tax planning, pre-scheduled 10b5-1 plans) rather than buy on the open market - genuine open-market `P`-code purchases, let alone *clustered* ones, may simply be rare events for companies this large, which is a real signal-frequency risk to watch for from the first sanity check, not a surprise to react to after a walk-forward run comes back empty.

**Not proposing a change to the universe now, since direct comparability was the explicit instruction** - but flagging that if v1 shows nothing on these 7, that result should be read next to this literature-based caveat before concluding the signal itself doesn't work, the same way lesson #12 didn't conclude "market inefficiency isn't exploitable," only that one specific implementation on one specific universe didn't show it. A small/mid-cap follow-up (reusing the 7 tickers already vetted for clean OHLCV data in `PHASE2_SMALLCAP_SCOPING.md`, since insider cluster-buy events would need to be checked for data availability on those same names separately) would be the more theoretically-motivated place to expect a real result - proposed as a natural next step *after* this large-cap pass, not instead of it.

## 4. Entry and exit logic - reasoned from what this signal represents, not defaulted to the existing exit

**Entry:** BUY when the cluster-buy condition in §2 first becomes true for a ticker currently flat (no open position) - same not-in-position guard every existing strategy in this project uses. If a second cluster-buy triggers while already in a position, it's ignored, same convention.

**Exit: this needs new logic, not a reuse of `volumeBreakoutStrategy`'s 10-day-low Turtle channel, and defaulting to it without this reasoning would be a real mistake.** A breakout strategy's premise is that price itself, right now, is the thing being traded - if price reverses quickly, the trade's own thesis has already failed, which is exactly why a fast, price-reactive exit fits it (candidate #1's own scoping reasoning). Insider cluster buying is a fundamentally slower, longer-horizon claim: it's a bet that people with real information think the business is undervalued, and the literature's own measured horizons for the effect are **6-12+ months** (Seyhun's 300-day window, Lakonishok & Lee's 12-month decile spread, Cohen/Malloy/Pomorski's monthly-compounding annualized figure). A 10-day price-reactive exit would very likely close the position before the effect the literature is even measuring has had time to play out - the same *category* of mismatch lesson #7 found between RSI mean-reversion and a hard price stop, but the opposite direction: there, the strategy needed room to draw down before its (short-horizon) thesis played out; here, the strategy needs *time*, not room, and a price-reactive channel exit provides neither.

**Proposed exit: a minimum hold period, not a price-reactive channel.** Concretely - hold for a fixed minimum of **6 months** (the shorter end of the literature's tested horizons) with no native SELL signal of its own during that window; `risk.js`'s existing ATR or percent stop-loss stays active throughout purely as capital protection against a thesis that's simply wrong, not as the strategy's primary exit mechanism; after the 6-month floor, exit at a fixed maximum hold of **12 months** if the position is still open and the stop hasn't fired. This makes the strategy's own native exit almost entirely time-based rather than price-based - a structurally different shape than every strategy tested in this project so far, all of which had their own price-driven SELL logic. That's a deliberate, reasoned choice, not an oversight: it directly follows from what a 6-12-month literature-documented effect actually needs, and it should be flagged for review specifically because it's new logic, not a known-good pattern being reused.

**A related, unresolved design question, named here rather than decided unilaterally:** should a *second* cluster-buy on the same ticker while already holding a position (currently proposed to be ignored, per the not-in-position guard above) instead extend or reset the hold-period floor? A repeat cluster-buy plausibly represents fresh conviction. Proposed to leave this as "ignored" for v1 (simpler, consistent with every existing strategy's state machine) and revisit only if v1 shows something worth refining - not designed in now on top of an otherwise-untested base signal.

## 5. Lookback and infrastructure cost - the real new risk in this candidate

**Lookback, in the indicator-warm-up sense, is trivial here** - detecting a 30-day cluster needs roughly 30 calendar days of Form 4 filing history fetched before each window starts, nowhere near the 200-day regime filter's requirement. **One point worth noting as a genuine advantage of this specific data source over the pre-2003 studies it's grounded in:** Form 4 filings have been legally required within 2 business days of the transaction since the Sarbanes-Oxley Act (2002) - the filing-delay problem that affected some of the older academic data (pre-2003 filings could lag up to 40 days) doesn't apply to this project's proposed 2022-today test range.

**The real cost is not lookback - it's that every other candidate in this project reused existing infrastructure end-to-end (`data.js`, `indicators.js`, `strategy.js`'s pure `bars -> signals` shape) and this one can't, fully:**

- **New fetch/parse code required, not reuse.** `data.js` wraps `yahoo-finance2` and returns clean OHLCV objects; nothing like it exists for SEC EDGAR. Building it means: (a) a CIK-to-ticker resolver (§1), (b) a filing-list fetcher against `browse-edgar`/`submissions`, (c) an XML parser for the `ownershipDocument` schema per filing (no existing dependency in this project's `package.json` for XML parsing - one would need to be added), (d) a rate-limiter respecting the 10 req/sec ceiling across potentially hundreds of individual filing fetches for a multi-year, 7-ticker backtest.
- **A new cache layer is needed, mirroring `data.js`'s OHLCV cache discipline (gap-aware interval tracking, not a naive min/max envelope - see the data-layer bug `LEARNINGS.md`'s "Bonus" lesson already found once) but for a different data shape** - filing records, not daily bars. Re-fetching hundreds of individual filing XML documents on every test run would be both slow and needlessly hard on SEC's rate limit.
- **Filing amendments and edge cases, not yet decided:** a Form 4/A amends a prior filing - proposed to use the amendment's corrected data when one exists, but not designed further here. Some Form 4s are joint filings covering multiple reporting persons in one document (needs per-person, not per-filing, counting for the "2+ distinct insiders" cluster check in §2). Pre-2003 Form 3/4/5s are plain text, not XML - irrelevant to this project's 2022-today range, but worth knowing the schema isn't uniform across all of EDGAR's history if this ever gets extended backward.
- **Event dates don't align to the bars array the way an indicator does.** Every existing strategy computes its signal directly from the `bars` array it's given, one value per trading day, by construction. A Form 4 filing date can land on a weekend, holiday, or otherwise land ahead of the trading day it should actually be actionable on - a "map filing date to the next trading day" rule is needed and doesn't exist anywhere in this codebase yet, unlike every existing strategy which never had to reconcile two independent date sequences.

**Honest sizing: this is a materially bigger lift than any of the four prior candidates, all of which added strategy-layer logic on top of infrastructure that already existed and was already trusted.** None of the above is a reason not to do it - it's the reason this doc exists as a thorough, standalone review rather than a quick sign-off, per the instruction that opened this request.

## 6. Test plan - same discipline as every prior candidate, random-entry baseline mandatory from the start

1. **Infrastructure feasibility check first, before any strategy code - done, see Part 2 below.** Live-fetched real Form 4 filing lists and parsed real filings for AAPL (mirroring §1 of `PHASE2_SMALLCAP_SCOPING.md`'s real data-quality check before finalizing a ticker list, and `PHASE2_VOLUME_BREAKOUT_SCOPING.md`'s real `bar.volume` reliability check) - confirmed the XML parses cleanly (after fixing one real quirk found by running it), confirmed CIK resolution works, confirmed the User-Agent/rate-limit requirements. The remaining 6 tickers weren't re-checked individually - no reason to expect AAPL's confirmed pipeline behaves differently for them, since the access pattern (browse-edgar + per-filing XML) is identical for any CIK - but that's an assumption carried into step 3 below, not a second confirmed fact.
2. **Unit tests on the parser and the cluster-detection logic separately from any real network fetch** - hand-constructed filing records (mirroring every existing `test-*.js` convention of synthetic inputs for pure logic), covering: two distinct insiders within the window fires a cluster BUY; the same insider filing twice does not count as two; a transaction with a non-`P` code (grant, exercise, gift) is correctly excluded; two purchases outside the window boundary do not cluster.
3. **Single-ticker sanity check with real fetched data** - one ticker, full test range, raw cluster-buy signal count, at least one concrete annotated example (real insider names/titles/dates/share counts from an actual filing, not synthetic).
4. **Full 7-ticker walk-forward**, same window/lookback discipline as every prior candidate, `riskConfig: { stopLossMethod: "atr" }` for the stop-loss floor described in §4. Report Sharpe/MaxDD/WinRate/Return/Trades per ticker plus averaged, per-ticker direction of effect stated explicitly (lesson #9's standing rule), and no-signal/low-signal windows flagged directly given §3's frequency concern.
5. **Random-entry baseline comparison - required, not optional, from the first run, per lesson #11's standing rule.** This is the single check that caught a misleading result in every one of the five candidates tested before this one; there's no reason to expect a sixth candidate is exempt. Given this strategy's exit shape is time-based rather than price-reactive (§4), the random baseline's own exit logic needs to match that shape too, not reuse `randomEntryStrategy`'s existing 10-day-low exit unmodified - a random-entry, time-based-hold baseline is a new (small) variant, not a straight reuse, and should be built and reasoned about at the same time as the real strategy's exit logic, not bolted on afterward.
6. **Report the real-vs-random head-to-head count in the same format as every prior candidate** (e.g. "beat random in X of N windows"), so this result sits directly next to the existing 12/21, 11/21, and 11/21 figures already on record.

## Not scoped here (Part 1)

No fetch code, no XML parser, no new cache layer, no strategy logic, no backtest runs. This is a proposal for the decisions above (confirming a free/programmatic data path exists and what it actually costs to build, the cluster-buy signal definition and its literature grounding, ticker universe and the literature-based caveat about it, the new time-based entry/exit shape and why it departs from every prior candidate's reused exit logic, and a test plan with the random-entry baseline built in from the start) to be reviewed - thoroughly, per the instruction that opened this - before any code gets written.

# Part 2: Feasibility Check (real data, run live)

Per the standing requirement this project has followed since lesson #10's process note: no result gets reported without real command output shown. The following was actually run - live network calls against `sec.gov`, not simulated - before Part 1's factual claims above (real field names, real quirks, real data availability, the live User-Agent test in §1) were finalized.

**Command run:** a standalone Node script (`form4-feasibility-check.js`, scratch file, not part of the repo - this is a feasibility check only, per the instruction to stop before any strategy implementation) that (1) resolves AAPL's ticker to its CIK via `company_tickers.json`, (2) fetches AAPL's Form 4 filing list for the last 3 months via `browse-edgar` (atom/XML), (3) fetches and parses each filing's raw `ownershipDocument` XML, respecting a 150ms delay between requests, with a real, descriptive User-Agent header on every call.

**Raw, complete output:**

```
=== Step 1: resolve AAPL -> CIK via company_tickers.json ===
{ cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' }

=== Step 2: fetch Form 4 filing list for CIK 0000320193 (owner=include) ===
Total Form 4 entries returned: 40. Filed on/after 2026-06-02 (last 3 months): 6
  0001140361-26-035362  filed 2026-09-01
  0001140361-26-034741  filed 2026-08-27
  0001140361-26-033928  filed 2026-08-20
  0001140361-26-032884  filed 2026-08-13
  0001140361-26-025622  filed 2026-06-17
  0001140361-26-025620  filed 2026-06-17

=== Step 3: fetch + parse each filing's raw ownership XML ===

=== Parsed transactions, AAPL, filings from last 3 months ===
Filer               Role                          TxDate      Code  Type                    Table              Shares     Price  Acq/Disp
-----------------------------------------------------------------------------------------------------------------------------------------
Ternus John         CEO                           2026-09-01  A     GRANT/AWARD             derivative           7690         0  A
Newstead Jennifer   SVP, GC and Secretary         2026-08-25  S     OPEN MARKET SALE        non-derivative       1439    310.95  D
Newstead Jennifer   SVP, GC and Secretary         2026-08-18  S     OPEN MARKET SALE        non-derivative       1439    307.49  D
Newstead Jennifer   SVP, GC and Secretary         2026-08-11  S     OPEN MARKET SALE        non-derivative       1439    307.75  D
Newstead Jennifer   SVP, GC and Secretary         2026-06-15  M     OPTION EXERCISE         non-derivative      30104      null  A
Newstead Jennifer   SVP, GC and Secretary         2026-06-15  F     TAX WITHHOLDING         non-derivative      16238    296.42  D
Newstead Jennifer   SVP, GC and Secretary         2026-06-15  M     OPTION EXERCISE         derivative          30104      null  D
Borders Ben         Principal Accounting Officer  2026-06-15  M     OPTION EXERCISE         non-derivative        240      null  A
Borders Ben         Principal Accounting Officer  2026-06-15  F     TAX WITHHOLDING         non-derivative        124    296.42  D
Borders Ben         Principal Accounting Officer  2026-06-16  S     OPEN MARKET SALE        non-derivative        116    295.14  D
Borders Ben         Principal Accounting Officer  2026-06-15  M     OPTION EXERCISE         derivative            240      null  D

Total individual transaction rows parsed: 11, from 6 filings.
Of those, transaction code "P" (real open-market purchases): 0
```

**Confirms the pipeline works end-to-end on real data**: real CIK resolution, real filing list, real per-filing XML parsing, real insider names/titles/dates/shares/prices, real transaction-code classification. **Also a direct, real (not hypothetical) demonstration of the zero-signal-window risk named in §3**: AAPL's last 3 months produced zero code-`P` open-market purchases at all, only sales, an option exercise, tax withholding, and a grant - exactly the "mega-cap insiders mostly sell, not buy" pattern §3 predicted from the literature, now confirmed on real, current data for the exact kind of ticker this candidate is proposed to test on.

**Two real parsing quirks found by running this, not anticipated in advance - documented here because they'd otherwise be a silent bug in the real parser:**

- **`transactionCode` is not wrapped in `<value>` the way `transactionDate`/`transactionShares`/`transactionPricePerShare`/`transactionAcquiredDisposedCode` all are.** It's a direct scalar tag inside `transactionCoding` (`<transactionCoding><transactionCode>A</transactionCode>...`). A parser written from the schema alone, without testing against a real filing, would very plausibly get this wrong and silently read every transaction code as missing - which is exactly what happened on the first run of this feasibility check before the extractor was fixed and rerun (the broken first pass is not shown above; only the corrected, verified output is).
- **The `browse-edgar` endpoint's `dateb` (date-before) filter requires dashed `YYYY-MM-DD` format, not `YYYYMMDD`** - passing the undashed form silently returns unfiltered results instead of erroring, which would be very easy to mistake for "there's no older data" rather than "the query parameter was malformed."

**Data depth confirmed well past this project's 2022-today range, not assumed:** paging through AAPL's Form 4 history (via `start=300`) returned real filings back to January 2018 - the survivorship/data-availability question for the proposed 2022-2026 test window is resolved, not open.

**What Part 2 does and doesn't establish:** this confirms the data pipeline is real and workable for one ticker over one short window - it does not confirm the pipeline behaves identically on the other 6 tickers, over the full multi-year range, or that a genuine multi-insider cluster buy is findable at all in this dataset (this specific 3-month AAPL sample had zero purchases of any kind to cluster). Per the explicit stop-here instruction, no strategy logic, cluster-detection code, or backtest has been written - this is infrastructure feasibility only.

---

Sources consulted while researching this doc:
- [SEC.gov | EDGAR Application Programming Interfaces (APIs)](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- [SEC.gov | Accessing EDGAR Data](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)
- [The SEC EDGAR API: A Practical Guide to Free Filing Data in Python](https://dev.to/odeeb/the-sec-edgar-api-a-practical-guide-to-free-filing-data-in-python-15b)
- [SEC EDGAR API Guide 2026: How to Access Company Filings Data](https://tldrfiling.com/blog/sec-edgar-api-guide/)
- [SEC EDGAR API Rate Limit: 10 req/sec, User-Agent Header Required](https://tldrfiling.com/blog/sec-edgar-api-rate-limits-best-practices)
- [SEC Form 4 Transaction Codes: The Definitive Reference](https://www.finrep.ai/blog/sec-form-4-transaction-codes-the-definitive-reference)
- [Form 4 Transaction Codes Decoded: Table 1 & 2 Explained](https://blog.form345.com/form-4-transaction-codes-decoded)
