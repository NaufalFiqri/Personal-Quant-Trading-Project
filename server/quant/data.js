const fs = require("fs");
const path = require("path");
const YahooFinance = require("yahoo-finance2").default;

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const CACHE_DIR = path.join(__dirname, "..", "data", "ohlcv");

const TICKER_RE = /^[A-Z0-9.\-]+$/;

function validateTicker(ticker) {
  if (typeof ticker !== "string" || !TICKER_RE.test(ticker)) {
    throw new Error(
      `Invalid ticker "${ticker}": must be uppercase alphanumeric plus "." or "-"`
    );
  }
}

function validateDateRange(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start.getTime())) {
    throw new Error(`Invalid startDate: ${startDate}`);
  }
  if (isNaN(end.getTime())) {
    throw new Error(`Invalid endDate: ${endDate}`);
  }
  if (start >= end) {
    throw new Error(
      `startDate (${startDate}) must be before endDate (${endDate})`
    );
  }
  return { start, end };
}

function cachePathFor(ticker) {
  return path.join(CACHE_DIR, `${ticker}.json`);
}

function readCache(ticker) {
  const file = cachePathFor(ticker);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeCache(ticker, bars, coveredRanges) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const file = cachePathFor(ticker);
  const payload = {
    ticker,
    updatedAt: new Date().toISOString(),
    coveredRanges,
    bars,
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
}

function addDaysToDateStr(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Coverage is tracked as a set of explicitly-queried date intervals, not a
// single min/max envelope: two fetches for non-adjacent periods (e.g. all
// of 2022, then Aug 2023 onward) leave a real gap between them that was
// never queried. A single rangeStart/rangeEnd envelope would wrongly claim
// the whole span in between is covered too. Adjacent/overlapping intervals
// (within 1 day) are coalesced into one; a real gap stays as two intervals,
// so a request spanning the gap correctly misses the cache.
function mergeRanges(ranges) {
  const sorted = ranges.slice().sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const merged = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.start <= addDaysToDateStr(last.end, 1)) {
      if (r.end > last.end) last.end = r.end;
    } else {
      merged.push({ start: r.start, end: r.end });
    }
  }
  return merged;
}

function getCoveredRanges(cache) {
  if (!cache) return [];
  if (cache.coveredRanges) return cache.coveredRanges;
  // Back-compat with the older single rangeStart/rangeEnd cache format.
  if (cache.rangeStart && cache.rangeEnd) {
    return [{ start: cache.rangeStart, end: cache.rangeEnd }];
  }
  return [];
}

function mergeBars(existingBars, newBars) {
  const byDate = new Map();
  for (const bar of existingBars) byDate.set(bar.date, bar);
  for (const bar of newBars) byDate.set(bar.date, bar);
  return Array.from(byDate.values()).sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  );
}

function toDateOnly(date) {
  return date instanceof Date ? date.toISOString().slice(0, 10) : date;
}

function normalizeQuotes(quotes) {
  const bars = [];
  for (const q of quotes) {
    if (
      q.open == null ||
      q.high == null ||
      q.low == null ||
      q.close == null
    ) {
      continue;
    }
    bars.push({
      date: toDateOnly(q.date),
      open: q.open,
      high: q.high,
      low: q.low,
      close: q.close,
      volume: q.volume == null ? 0 : q.volume,
    });
  }
  return bars;
}

// A request is covered only if some single queried interval fully contains
// it - not just if the outer min/max of all queried intervals does.
function cacheCoversRange(cache, startDateStr, endDateStr) {
  const ranges = getCoveredRanges(cache);
  return ranges.some((r) => r.start <= startDateStr && r.end >= endDateStr);
}

async function getHistoricalData(ticker, startDate, endDate) {
  validateTicker(ticker);
  const { start, end } = validateDateRange(startDate, endDate);

  const startDateStr = toDateOnly(start);
  const endDateStr = toDateOnly(end);

  const cache = readCache(ticker);
  if (cacheCoversRange(cache, startDateStr, endDateStr)) {
    console.log(`[data] cache hit for ${ticker} ${startDateStr}..${endDateStr}`);
    return cache.bars.filter(
      (b) => b.date >= startDateStr && b.date <= endDateStr
    );
  }

  console.log(`[data] cache miss for ${ticker} ${startDateStr}..${endDateStr}, fetching from Yahoo`);
  const result = await yahooFinance.chart(ticker, {
    period1: start,
    period2: end,
    interval: "1d",
  });

  const freshBars = normalizeQuotes(result.quotes || []);
  const mergedBars = cache ? mergeBars(cache.bars, freshBars) : freshBars;

  const coveredRanges = mergeRanges([
    ...getCoveredRanges(cache),
    { start: startDateStr, end: endDateStr },
  ]);

  writeCache(ticker, mergedBars, coveredRanges);

  return mergedBars.filter(
    (b) => b.date >= startDateStr && b.date <= endDateStr
  );
}

module.exports = { getHistoricalData };
