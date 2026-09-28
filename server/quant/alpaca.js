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
//
// Normalized (trailing slash and/or an already-included /v2 suffix
// stripped) because every request path below already includes /v2 itself -
// a .env value of ".../v2" would otherwise silently produce ".../v2/v2/..."
// and 404 on every single call. Found this exact bug live during Gate 1
// verification (a real .env had ALPACA_BASE_URL=".../alpaca.markets/v2"),
// so this isn't a hypothetical edge case - it's a real misconfiguration the
// wrapper should tolerate rather than fail on.
const BASE_URL = (process.env.ALPACA_BASE_URL || "https://paper-api.alpaca.markets")
  .replace(/\/+$/, "")
  .replace(/\/v2$/, "");

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
  // Top-level stop_price - for a plain, standalone type:"stop" order (e.g.
  // re-placing a protective stop directly, not nested inside an OTO's
  // stop_loss leg). Distinct from `stopLoss`, which is Alpaca's nested
  // { stop_price } object attached to an order_class:"oto"/"bracket" entry.
  stopPrice,
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
  if (stopPrice) body.stop_price = String(stopPrice);

  return alpacaRequest("/v2/orders", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function getOrder(orderId) {
  return alpacaRequest(`/v2/orders/${orderId}`);
}

// DELETE /v2/orders/{id} returns 204 with no body on success - already
// handled by alpacaRequest's existing `text ? JSON.parse(text) : null`
// (an empty response body resolves to null, not a JSON.parse crash), so no
// special-casing needed here beyond documenting why this is safe.
function cancelOrder(orderId) {
  return alpacaRequest(`/v2/orders/${orderId}`, { method: "DELETE" });
}

function getClock() {
  return alpacaRequest("/v2/clock");
}

// Used by the flatten path to find any standing contingent orders (e.g. an
// OTO entry's stop-loss leg) still open against a symbol, so they can be
// canceled before closing the position - Alpaca typically rejects a sell
// while shares are reserved against an open stop.
function getOrders({ status = "open", symbols } = {}) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (symbols) params.set("symbols", Array.isArray(symbols) ? symbols.join(",") : symbols);
  const qs = params.toString();
  return alpacaRequest(`/v2/orders${qs ? `?${qs}` : ""}`);
}

module.exports = { getAccount, getPositions, getPosition, placeOrder, getOrder, cancelOrder, getClock, getOrders, BASE_URL };
