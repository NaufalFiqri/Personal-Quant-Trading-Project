// Daily live (paper) trading run for volumeBreakoutStrategy on a single
// ticker, per the architecture scoped in this session's paper-trading plan.
// Intended to run once/day, shortly after market close, via a scheduled
// task - not continuously.
//
// Design principle carried over directly from the insider-cluster
// investigation (LEARNINGS.md lesson #13): a strategy's own internal
// position tracking can silently drift from what's actually true at the
// broker (there, a stop-loss the strategy's signal generator never knew
// about). This script never trusts volumeBreakoutStrategy's own inPosition
// state to decide whether to place an order - only whether a fresh
// BUY/SELL condition fired on today's bar. Whether that translates into a
// real order depends entirely on the REAL Alpaca position, fetched fresh
// every run.

const fs = require("fs");
const path = require("path");
const { getHistoricalData } = require("./data");
const { volumeBreakoutStrategy } = require("./strategy");
const { calculateATR } = require("./indicators");
const { calculateStopLoss, calculatePositionSize } = require("./risk");

const TICKER = "AAPL";
const STRATEGY_PARAMS = { breakoutPeriod: 20, volumePeriod: 20, volumeMultiplier: 1.5, exitPeriod: 10 };
const ATR_PERIOD = 14;
const ATR_MULTIPLIER = 2;
const RISK_PERCENT = 2;
const FALLBACK_ACCOUNT_EQUITY = 10000; // only used when Alpaca isn't reachable/configured, always logged as such
const LOG_FILE = path.join(__dirname, "..", "data", "live-trading.log");

const DRY_RUN = process.argv.includes("--dry-run");
// Testing/verification aid only, not used in normal daily runs: overrides
// "today" to a specific historical date, so the full signal-check ->
// order-construction path can be exercised end-to-end against a real,
// already-known signal date without waiting for a live one to occur.
const AS_OF_ARG = process.argv.find((a) => a.startsWith("--as-of="));
const AS_OF_DATE = AS_OF_ARG ? AS_OF_ARG.split("=")[1] : new Date().toISOString().slice(0, 10);

// Extracted so any test/verification script can build the exact same entry
// order payload this script would really send, rather than hand-copying the
// shape and risking the two silently drifting apart.
function buildEntryOrderPayload({ symbol, qty, stopLossPrice }) {
  return {
    symbol,
    qty,
    side: "buy",
    type: "market",
    // gtc, not day - the attached stop-loss leg needs to stand until this
    // strategy's own exit condition fires (the 10-day channel break, checked
    // once per day by this script), which can be many days after entry. A
    // "day" time-in-force stop would have silently expired at the end of the
    // entry day, leaving the position completely unprotected for every day
    // after that until the script's own next check - a real gap, not a
    // cosmetic default, now fixed before it ever mattered.
    timeInForce: "gtc",
    // Stop-loss-only exit (this strategy has no fixed take-profit) - Alpaca
    // requires order_class "oto" for a single-leg contingent order;
    // "bracket" would be rejected since it mandates BOTH take_profit and
    // stop_loss legs. Confirmed against Alpaca's own docs before writing
    // this, not assumed.
    orderClass: "oto",
    stopLoss: { stop_price: stopLossPrice.toFixed(2) },
  };
}

function log(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  console.log(stamped);
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, stamped + "\n");
}

// Both the real position check and the real account-equity check degrade
// gracefully to a clearly-logged assumption ONLY in --dry-run mode, so the
// full pipeline is testable with no Alpaca credentials configured yet. A
// real (non-dry-run) run never falls back silently - if alpaca.js can't
// load or the API call fails, it throws and the script stops, exactly as
// alpaca.js's own fail-fast design intends.
async function getRealPositionOrFallback() {
  try {
    const alpaca = require("./alpaca");
    return { position: await alpaca.getPosition(TICKER), source: "real Alpaca account" };
  } catch (err) {
    if (!DRY_RUN) throw err;
    log(`Alpaca not reachable/configured (${err.message}) - dry-run continuing with ASSUMED position state: FLAT`);
    return { position: null, source: "ASSUMED (Alpaca not configured, dry-run only)" };
  }
}

async function getAccountEquityOrFallback() {
  try {
    const alpaca = require("./alpaca");
    const account = await alpaca.getAccount();
    return { equity: parseFloat(account.equity), source: "real Alpaca account" };
  } catch (err) {
    if (!DRY_RUN) throw err;
    log(`Alpaca not reachable/configured (${err.message}) - dry-run continuing with ASSUMED equity: $${FALLBACK_ACCOUNT_EQUITY} (backtest.js's own default)`);
    return { equity: FALLBACK_ACCOUNT_EQUITY, source: "ASSUMED (Alpaca not configured, dry-run only)" };
  }
}

// Real, read-only call - always attempted even in dry-run, since dry-run's
// whole point is to report accurately on real current conditions. Only
// degrades to a fallback (treated as "closed", the conservative direction -
// never drop a bar based on a guess) if Alpaca truly isn't reachable.
async function getClockOrFallback() {
  try {
    const alpaca = require("./alpaca");
    return { clock: await alpaca.getClock(), source: "real Alpaca account" };
  } catch (err) {
    log(`Alpaca not reachable/configured (${err.message}) - cannot determine market status, assuming CLOSED (the conservative direction - never drop a bar based on a guess)`);
    return { clock: { is_open: false, timestamp: new Date().toISOString() }, source: "ASSUMED (Alpaca not configured)" };
  }
}

// Pure, unit-testable: if the market is currently open, the most recent bar
// data.js returned is today's PARTIAL intraday bar (Yahoo updates it live
// during the session) - not the final, settled daily bar this strategy's
// breakout/volume conditions were designed against. Dropping it whenever
// clock.is_open is true means the strategy only ever sees fully-closed days,
// so a partial, still-changing intraday bar can never trigger a signal.
// clock.timestamp is Alpaca's own server time, already ET-offset (e.g.
// "...T04:20:10-04:00") - its own date portion IS today's ET calendar date,
// no separate timezone conversion needed.
function dropIntradayBarIfMarketOpen(bars, clock) {
  if (!clock.is_open) return bars;
  const todayET = clock.timestamp.slice(0, 10);
  return bars.filter((b) => b.date !== todayET);
}

// EXIT sequencing, per the explicit design requirement: an OTO entry leaves
// a standing stop-loss order open against the position. Alpaca's single-
// symbol close-position endpoint (DELETE /v2/positions/{symbol}) does not
// document a cancel_orders option (that only exists on the bulk close-ALL-
// positions endpoint) and its behavior toward existing open orders on that
// symbol isn't documented either - checked before writing this, not
// assumed. So this does it explicitly, in a controlled order: list open
// orders -> cancel each -> confirm each canceled -> close with a market
// sell of the REAL held qty from getPosition() (never from strategy state,
// per this file's own top-of-file design principle).
//
// alpacaClient is injectable (defaults to the real module) specifically so
// this exact sequencing can be unit-tested with a mock, without needing a
// real open position or touching the live API.
async function flattenPosition(symbol, { alpacaClient, dryRun = DRY_RUN } = {}) {
  const alpaca = alpacaClient || require("./alpaca");

  const position = await alpaca.getPosition(symbol);
  if (!position) {
    log(`flattenPosition(${symbol}): no open position - nothing to do.`);
    return { skipped: true };
  }
  const heldQty = position.qty;
  log(`flattenPosition(${symbol}): real held qty from getPosition() = ${heldQty}`);

  const openOrders = await alpaca.getOrders({ status: "open", symbols: symbol });
  log(`flattenPosition(${symbol}): ${openOrders.length} open order(s) found: ${JSON.stringify(openOrders.map((o) => ({ id: o.id, type: o.type, side: o.side, stop_price: o.stop_price })))}`);

  if (dryRun) {
    log(`--dry-run: would call cancelOrder() for each of the ${openOrders.length} order(s) above, confirm each is canceled, then placeOrder({ symbol: "${symbol}", qty: "${heldQty}", side: "sell", type: "market", timeInForce: "day" }). No mutating calls made.`);
    return { dryRun: true, wouldCancel: openOrders.map((o) => o.id), wouldSellQty: heldQty };
  }

  const canceledIds = [];
  try {
    for (const order of openOrders) {
      await alpaca.cancelOrder(order.id);
      const confirmed = await alpaca.getOrder(order.id);
      if (confirmed.status !== "canceled") {
        throw new Error(`order ${order.id} did not confirm status "canceled" (got "${confirmed.status}")`);
      }
      canceledIds.push(order.id);
      log(`flattenPosition(${symbol}): canceled and confirmed order ${order.id} (was ${order.type}/${order.side}).`);
    }
  } catch (err) {
    // Cancel failed (or didn't confirm) - the position's EXISTING protection
    // is still intact (we haven't touched the close side at all), so the
    // safe response is to abort the whole exit attempt here rather than
    // proceed to close against an uncertain order-book state. Logged
    // loudly; a future run will simply retry from scratch.
    log(`flattenPosition(${symbol}): FAILED during cancel step (${err.message}). Aborting exit - existing order(s) may or may not still be protecting the position; NOT attempting to close. Manual review recommended.`);
    throw err;
  }

  // Capture the stop price(s) from the orders just canceled, BEFORE
  // attempting the close - if the close fails below, this is exactly what's
  // needed to re-place equivalent protection immediately, using a known-
  // good value rather than guessing a new one.
  const canceledStopOrders = openOrders.filter((o) => o.type === "stop" && o.stop_price);

  try {
    const sellOrder = await alpaca.placeOrder({ symbol, qty: heldQty, side: "sell", type: "market", timeInForce: "day" });
    log(`flattenPosition(${symbol}): close order placed. Response: ${JSON.stringify(sellOrder)}`);
    return { canceled: canceledIds, sellOrder };
  } catch (closeErr) {
    // The critical partial-failure case: cancel succeeded, close failed.
    // The position is now completely unprotected (no stop, no pending
    // close) - restoring protection takes priority over anything else, so
    // this immediately attempts to re-place an equivalent stop using the
    // stop_price(s) captured above, THEN surfaces loudly regardless of
    // whether that re-place itself succeeds - an abnormal state either way,
    // worth a human looking at it even if auto-recovery worked.
    log(`flattenPosition(${symbol}): CRITICAL - cancel succeeded but the closing sell FAILED (${closeErr.message}). Position qty=${heldQty} is UNPROTECTED.`);

    if (canceledStopOrders.length === 0) {
      log(`flattenPosition(${symbol}): CRITICAL - no stop_price captured from the canceled order(s) to restore. Manual intervention required immediately.`);
      throw closeErr;
    }

    for (const stopOrder of canceledStopOrders) {
      try {
        const replaced = await alpaca.placeOrder({
          symbol,
          qty: heldQty,
          side: "sell",
          type: "stop",
          stopPrice: stopOrder.stop_price,
          timeInForce: "gtc",
        });
        log(`flattenPosition(${symbol}): re-placed protective stop at $${stopOrder.stop_price} (order ${replaced.id}). CRITICAL EVENT LOGGED - close still failed and needs manual review even though protection was restored.`);
      } catch (reprotectErr) {
        log(`flattenPosition(${symbol}): CRITICAL - re-placing protective stop ALSO FAILED (${reprotectErr.message}). Position qty=${heldQty} remains genuinely UNPROTECTED. Manual intervention required immediately.`);
      }
    }
    throw closeErr;
  }
}

async function main() {
  log(`=== Daily run start, ticker=${TICKER}, dryRun=${DRY_RUN}${AS_OF_ARG ? `, asOf=${AS_OF_DATE} (TESTING OVERRIDE, not a real date)` : ""} ===`);

  const endDate = AS_OF_DATE;
  const startDate = new Date(new Date(endDate).getTime() - 200 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10); // ~200 calendar days of lookback, comfortably over the 20-day strategy warm-up + 14-day ATR warm-up
  let bars = await getHistoricalData(TICKER, startDate, endDate);

  if (bars.length === 0) {
    log("No bars returned - nothing to do (market holiday, or data unavailable). No action.");
    return;
  }

  const { clock, source: clockSource } = await getClockOrFallback();
  const barsBefore = bars.length;
  bars = dropIntradayBarIfMarketOpen(bars, clock);
  if (bars.length < barsBefore) {
    log(`Market is open (${clockSource}, ET date=${clock.timestamp.slice(0, 10)}) - dropped ${barsBefore - bars.length} partial intraday bar(s) before running the strategy.`);
  } else {
    log(`Market status (${clockSource}): is_open=${clock.is_open} - no intraday bar to drop.`);
  }

  if (bars.length === 0) {
    log("No bars remain after dropping today's partial bar - nothing to do.");
    return;
  }

  const today = bars[bars.length - 1].date;
  log(`Latest (settled) bar: ${today}, close=$${bars[bars.length - 1].close.toFixed(2)}`);

  const signals = volumeBreakoutStrategy(bars, STRATEGY_PARAMS);
  const todaysSignal = signals.find((s) => s.date === today);
  log(`Signal check: ${todaysSignal ? `${todaysSignal.action} fired on ${today}` : "no signal fired on " + today}`);

  const { position: realPosition, source: positionSource } = await getRealPositionOrFallback();
  log(`Real position state (${positionSource}): ${realPosition ? `HOLDING ${realPosition.qty} shares` : "FLAT"}`);

  let action = "NO_ACTION";
  let reason = "no matching signal/position-state combination today";
  let entryOrderPayload = null;

  if (todaysSignal && todaysSignal.action === "BUY" && !realPosition) {
    action = "ENTER";
    reason = `fresh BUY signal on ${today} and account is flat`;

    const atrValues = calculateATR(bars, ATR_PERIOD);
    const atrToday = atrValues[atrValues.length - 1];
    const entryPrice = todaysSignal.price;

    if (atrToday == null) {
      action = "NO_ACTION";
      reason = "BUY signal fired but ATR not yet warmed up - skipping (matches backtest.js's own guard)";
    } else {
      const stopLossPrice = calculateStopLoss({ entryPrice, method: "atr", atr: atrToday, atrMultiplier: ATR_MULTIPLIER });
      const { equity, source: equitySource } = await getAccountEquityOrFallback();
      log(`Account equity used for sizing (${equitySource}): $${equity.toFixed(2)}`);

      const sized = calculatePositionSize({ accountEquity: equity, riskPercent: RISK_PERCENT, entryPrice, stopLossPrice });
      const qty = Math.floor(sized.shares);

      if (qty <= 0) {
        action = "NO_ACTION";
        reason = `sized position rounds to 0 shares (${RISK_PERCENT}% risk of $${equity.toFixed(2)} equity, entry $${entryPrice.toFixed(2)}, stop $${stopLossPrice.toFixed(2)}) - skipping`;
      } else {
        entryOrderPayload = buildEntryOrderPayload({ symbol: TICKER, qty, stopLossPrice });
        log(`Constructed order payload: ${JSON.stringify(entryOrderPayload)}`);
        log(`  (entryPrice=$${entryPrice.toFixed(2)}, ATR(${ATR_PERIOD})=${atrToday.toFixed(4)}, stopDistance=${(entryPrice - stopLossPrice).toFixed(4)} = ${(((entryPrice - stopLossPrice) / entryPrice) * 100).toFixed(3)}% of entry, dollarRisk=$${sized.dollarRisk.toFixed(2)})`);
      }
    }
  } else if (todaysSignal && todaysSignal.action === "SELL" && realPosition) {
    action = "EXIT";
    reason = `fresh SELL signal on ${today} and account is holding a position`;
  }

  log(`Decision: ${action} (${reason})`);

  if (action === "ENTER" && entryOrderPayload) {
    if (DRY_RUN) {
      log(`--dry-run set: NOT calling placeOrder. Order payload above is what would have been sent.`);
    } else {
      const alpaca = require("./alpaca");
      const result = await alpaca.placeOrder(entryOrderPayload);
      log(`Order placed. Alpaca response: ${JSON.stringify(result)}`);
    }
  } else if (action === "EXIT") {
    await flattenPosition(TICKER);
  }

  log(`=== Daily run end ===\n`);
}

if (require.main === module) {
  main().catch((err) => {
    log(`FATAL ERROR: ${err.message}`);
    console.error(err);
    process.exit(1);
  });
}

module.exports = { buildEntryOrderPayload, dropIntradayBarIfMarketOpen, flattenPosition };
