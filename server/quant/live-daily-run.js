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

async function main() {
  log(`=== Daily run start, ticker=${TICKER}, dryRun=${DRY_RUN}${AS_OF_ARG ? `, asOf=${AS_OF_DATE} (TESTING OVERRIDE, not a real date)` : ""} ===`);

  const endDate = AS_OF_DATE;
  const startDate = new Date(new Date(endDate).getTime() - 200 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10); // ~200 calendar days of lookback, comfortably over the 20-day strategy warm-up + 14-day ATR warm-up
  const bars = await getHistoricalData(TICKER, startDate, endDate);

  if (bars.length === 0) {
    log("No bars returned - nothing to do (market holiday, or data unavailable). No action.");
    return;
  }

  const today = bars[bars.length - 1].date;
  log(`Latest bar: ${today}, close=$${bars[bars.length - 1].close.toFixed(2)}`);

  const signals = volumeBreakoutStrategy(bars, STRATEGY_PARAMS);
  const todaysSignal = signals.find((s) => s.date === today);
  log(`Signal check: ${todaysSignal ? `${todaysSignal.action} fired on ${today}` : "no signal fired on " + today}`);

  const { position: realPosition, source: positionSource } = await getRealPositionOrFallback();
  log(`Real position state (${positionSource}): ${realPosition ? `HOLDING ${realPosition.qty} shares` : "FLAT"}`);

  let action = "NO_ACTION";
  let reason = "no matching signal/position-state combination today";
  let orderPayload = null;

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
        orderPayload = {
          symbol: TICKER,
          qty,
          side: "buy",
          type: "market",
          timeInForce: "day",
          // Stop-loss-only exit (this strategy has no fixed take-profit) -
          // Alpaca requires order_class "oto" for a single-leg contingent
          // order; "bracket" would be rejected since it mandates BOTH
          // take_profit and stop_loss legs. Confirmed against Alpaca's own
          // docs before writing this, not assumed.
          orderClass: "oto",
          stopLoss: { stop_price: stopLossPrice.toFixed(2) },
        };
        log(`Constructed order payload: ${JSON.stringify(orderPayload)}`);
        log(`  (entryPrice=$${entryPrice.toFixed(2)}, ATR(${ATR_PERIOD})=${atrToday.toFixed(4)}, stopDistance=${(entryPrice - stopLossPrice).toFixed(4)} = ${(((entryPrice - stopLossPrice) / entryPrice) * 100).toFixed(3)}% of entry, dollarRisk=$${sized.dollarRisk.toFixed(2)})`);
      }
    }
  } else if (todaysSignal && todaysSignal.action === "SELL" && realPosition) {
    action = "EXIT";
    reason = `fresh SELL signal on ${today} and account is holding a position`;
    orderPayload = {
      symbol: TICKER,
      qty: realPosition.qty,
      side: "sell",
      type: "market",
      timeInForce: "day",
    };
    log(`Constructed order payload: ${JSON.stringify(orderPayload)}`);
  }

  log(`Decision: ${action} (${reason})`);

  if (orderPayload) {
    if (DRY_RUN) {
      log(`--dry-run set: NOT calling placeOrder. Order payload above is what would have been sent.`);
    } else {
      const alpaca = require("./alpaca");
      const result = await alpaca.placeOrder(orderPayload);
      log(`Order placed. Alpaca response: ${JSON.stringify(result)}`);
    }
  }

  log(`=== Daily run end ===\n`);
}

main().catch((err) => {
  log(`FATAL ERROR: ${err.message}`);
  console.error(err);
  process.exit(1);
});
