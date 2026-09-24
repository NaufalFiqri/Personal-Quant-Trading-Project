const { loadEnvFile, requireEnv } = require("./env");

loadEnvFile();

// Fails immediately at require-time, not on first real call - a script that
// requires this module with no .env set (or missing keys in it) should
// crash loudly before doing anything else, not silently send an empty
// Authorization header to Alpaca and get a confusing 401 later.
const API_KEY = requireEnv("ALPACA_API_KEY");
const API_SECRET = requireEnv("ALPACA_API_SECRET");
// Defaults to the paper domain specifically (the safe direction) rather
// than requiring it - if ALPACA_BASE_URL is ever unset, that should never
// silently resolve to the live-trading domain.
const BASE_URL = process.env.ALPACA_BASE_URL || "https://paper-api.alpaca.markets";

async function alpacaRequest(pathSuffix, options = {}) {
  const res = await fetch(`${BASE_URL}${pathSuffix}`, {
    ...options,
    headers: {
      "APCA-API-KEY-ID": API_KEY,
      "APCA-API-SECRET-KEY": API_SECRET,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!res.ok) {
    const message = body && body.message ? body.message : JSON.stringify(body);
    throw new Error(`Alpaca API ${res.status} ${res.statusText} on ${pathSuffix}: ${message}`);
  }

  return body;
}

function getAccount() {
  return alpacaRequest("/v2/account");
}

function getPositions() {
  return alpacaRequest("/v2/positions");
}

// Returns null (not a thrown error) when there's no open position for this
// symbol - "flat" is a normal, expected state for this function to report,
// not a failure. Alpaca itself returns 404 for "no position", which this
// distinguishes from every other error status.
async function getPosition(symbol) {
  try {
    return await alpacaRequest(`/v2/positions/${symbol}`);
  } catch (err) {
    if (err.message.includes("404")) return null;
    throw err;
  }
}

function placeOrder({
  symbol,
  qty,
  side,
  type = "market",
  timeInForce = "day",
  orderClass,
  stopLoss,
  takeProfit,
}) {
  const body = {
    symbol,
    qty: String(qty),
    side,
    type,
    time_in_force: timeInForce,
  };
  if (orderClass) body.order_class = orderClass;
  if (stopLoss) body.stop_loss = stopLoss;
  if (takeProfit) body.take_profit = takeProfit;

  return alpacaRequest("/v2/orders", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

module.exports = { getAccount, getPositions, getPosition, placeOrder, BASE_URL };
