const fs = require("fs");
const path = require("path");

// Reusable EDGAR Form 4 fetcher/parser - the "data.js for insider
// transactions" flagged as a real infrastructure need in
// PHASE2_INSIDER_SIGNAL_SCOPING.md §5. Extracted from the validated
// reconnaissance scripts (form4-frequency-check-midcap-wide.js and its
// predecessors), including the transactionCode parsing fix confirmed
// against real filings in that doc's Part 2.

const USER_AGENT = "PersonalQuantResearchProject research-contact@example.com";
const CACHE_DIR = path.join(__dirname, "..", "data", "insider");
const CIK_MAP_FILE = path.join(CACHE_DIR, "_cik-map.json");

// --- Rate-limited fetch queue: throttles request *starts* to ~9/sec (SEC's
// limit is 10/sec), while letting multiple requests be in flight at once so
// wall-clock time isn't dominated by round-trip latency. Retries on 429/503
// with exponential backoff - a transient SEC 503 during earlier reconnaissance
// showed this is a real, not hypothetical, need. ---
let lastStart = 0;
const MIN_GAP_MS = 115;
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, lastStart + MIN_GAP_MS - now);
  lastStart = now + wait;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

async function fetchText(url, attempt = 1) {
  await throttle();
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (res.status === 429 || res.status === 503) {
    if (attempt > 5) throw new Error(`${res.status} after 5 retries: ${url}`);
    const backoff = 500 * attempt;
    await new Promise((r) => setTimeout(r, backoff));
    return fetchText(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} fetching ${url}`);
  return res.text();
}

function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : null;
}
function extractValue(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>\\s*<value>([^<]*)</value>`));
  return m ? m[1].trim() : null;
}
// transactionCode is a direct scalar tag inside transactionCoding, NOT
// wrapped in <value> the way transactionDate/transactionShares/
// transactionPricePerShare are - confirmed against a real fetched filing
// (PHASE2_INSIDER_SIGNAL_SCOPING.md Part 2's parsing-quirks note).
// extractValue would silently return null here.
function extractCode(txXml) {
  const coding = txXml.match(/<transactionCoding>([\s\S]*?)<\/transactionCoding>/);
  return coding ? extractTag(coding[1], "transactionCode") : null;
}
function parseTransactions(xml, table) {
  const tableMatch = xml.match(new RegExp(`<${table}>([\\s\\S]*?)</${table}>`));
  if (!tableMatch) return [];
  const txType = table === "nonDerivativeTable" ? "nonDerivativeTransaction" : "derivativeTransaction";
  const entries = [...tableMatch[1].matchAll(new RegExp(`<${txType}>([\\s\\S]*?)</${txType}>`, "g"))];
  return entries.map((m) => ({
    date: extractValue(m[1], "transactionDate"),
    code: extractCode(m[1]),
    shares: extractValue(m[1], "transactionShares"),
    price: extractValue(m[1], "transactionPricePerShare"),
  }));
}

async function loadCikMap() {
  if (fs.existsSync(CIK_MAP_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CIK_MAP_FILE, "utf8"));
    } catch {
      // fall through to refetch
    }
  }
  const json = await fetchText("https://www.sec.gov/files/company_tickers.json");
  const all = JSON.parse(json);
  const map = {};
  for (const entry of Object.values(all)) {
    map[entry.ticker] = String(entry.cik_str).padStart(10, "0");
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(CIK_MAP_FILE, JSON.stringify(map));
  return map;
}

async function resolveCik(ticker) {
  const map = await loadCikMap();
  const cik = map[ticker];
  if (!cik) throw new Error(`No CIK found for ticker "${ticker}"`);
  return cik;
}

async function fetchFilingList(cik, startDate, endDate) {
  let start = 0;
  const filings = [];
  while (true) {
    const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=4&dateb=&owner=include&count=100&start=${start}&output=atom`;
    const xml = await fetchText(url);
    const entries = [...xml.matchAll(/<accession-number>([^<]*)<\/accession-number>\s*<filing-date>([^<]*)<\/filing-date>/g)];
    if (entries.length === 0) break;
    for (const m of entries) filings.push({ accession: m[1], filingDate: m[2] });
    const oldest = entries[entries.length - 1][2];
    if (oldest < startDate) break;
    start += 100;
    if (start > 3000) break; // safety cap
  }
  return filings.filter((f) => f.filingDate >= startDate && f.filingDate <= endDate);
}

async function fetchAndParseFiling(cikNum, accession) {
  const accessionNoDashes = accession.replace(/-/g, "");
  const indexUrl = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accessionNoDashes}/${accession}-index.htm`;
  const indexHtml = await fetchText(indexUrl);
  const rawXmlHref = [...indexHtml.matchAll(/href="([^"]*\.xml)"/g)].map((m) => m[1]).find((h) => !h.includes("xslF"));
  if (!rawXmlHref) return null;
  const xml = await fetchText(`https://www.sec.gov${rawXmlHref}`);

  const ownerName = extractTag(xml, "rptOwnerName");
  const isDirector = extractTag(xml, "isDirector") === "true";
  const isOfficer = extractTag(xml, "isOfficer") === "true";
  const officerTitle = extractTag(xml, "officerTitle");
  const nonDeriv = parseTransactions(xml, "nonDerivativeTable");
  const deriv = parseTransactions(xml, "derivativeTable");
  const allTx = [...nonDeriv, ...deriv];

  return { ownerName, isDirector, isOfficer, officerTitle, transactions: allTx };
}

function cachePathFor(ticker) {
  return path.join(CACHE_DIR, `${ticker}.json`);
}

function readCache(ticker) {
  const file = cachePathFor(ticker);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeCache(ticker, pTransactions, coveredRanges) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(
    cachePathFor(ticker),
    JSON.stringify({ ticker, updatedAt: new Date().toISOString(), coveredRanges, pTransactions }, null, 2)
  );
}

// Same gap-aware interval tracking as data.js's OHLCV cache (not a naive
// min/max envelope) - a fetch covering 2022-2023 and a later fetch covering
// 2025-2026 must not be reported as covering the untouched gap in between.
function cacheCoversRange(cache, startDate, endDate) {
  if (!cache || !cache.coveredRanges) return false;
  return cache.coveredRanges.some((r) => r.start <= startDate && r.end >= endDate);
}

function mergeRanges(ranges) {
  const sorted = ranges.slice().sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const merged = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      if (r.end > last.end) last.end = r.end;
    } else {
      merged.push({ start: r.start, end: r.end });
    }
  }
  return merged;
}

// Fetches every code-P (open-market/private purchase) Form 4 transaction for
// a given ticker/date range, with each transaction's contributing filing's
// insider name/role attached. Caches to server/data/insider/<TICKER>.json,
// gap-aware, so repeated test runs don't re-hit EDGAR or its rate limit.
async function getInsiderPurchases(ticker, startDate, endDate) {
  const cache = readCache(ticker);
  if (cacheCoversRange(cache, startDate, endDate)) {
    console.log(`[insider-data] cache hit for ${ticker} ${startDate}..${endDate}`);
    return cache.pTransactions.filter((t) => t.date >= startDate && t.date <= endDate);
  }

  console.log(`[insider-data] cache miss for ${ticker} ${startDate}..${endDate}, fetching from EDGAR`);
  const cik = await resolveCik(ticker);
  const cikNum = parseInt(cik, 10);
  const filings = await fetchFilingList(cik, startDate, endDate);

  const pTransactions = [];
  for (const f of filings) {
    let parsed;
    try {
      parsed = await fetchAndParseFiling(cikNum, f.accession);
    } catch (err) {
      console.log(`[insider-data] ${ticker} ${f.accession} (${f.filingDate}): FAILED - ${err.message}`);
      continue;
    }
    if (!parsed) continue;
    const pTx = parsed.transactions.filter((t) => t.code === "P");
    for (const t of pTx) {
      pTransactions.push({
        insider: parsed.ownerName,
        role: parsed.isDirector ? parsed.officerTitle || "Director" : parsed.isOfficer ? parsed.officerTitle || "Officer" : "Other",
        date: t.date,
        shares: t.shares,
        price: t.price,
        accession: f.accession,
      });
    }
  }

  const existing = cache ? cache.pTransactions : [];
  const merged = [...existing, ...pTransactions].filter(
    (t, i, arr) => arr.findIndex((o) => o.accession === t.accession && o.date === t.date && o.shares === t.shares) === i
  );
  const coveredRanges = mergeRanges([...(cache ? cache.coveredRanges : []), { start: startDate, end: endDate }]);
  writeCache(ticker, merged, coveredRanges);

  return pTransactions.filter((t) => t.date >= startDate && t.date <= endDate);
}

module.exports = { getInsiderPurchases, resolveCik, fetchFilingList, fetchAndParseFiling };
