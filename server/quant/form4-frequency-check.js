// Pure data-frequency reconnaissance, per the explicit instruction: no
// strategy/backtest logic. Reuses the exact fetch/parse approach validated
// in the AAPL feasibility check (including the transactionCode fix), across
// all 7 tickers and the full 2022-01-01 to 2026-08-20 window.

const fs = require("fs");
const path = require("path");

const USER_AGENT = "PersonalQuantResearchProject research-contact@example.com";
const TICKERS = ["AAPL", "MSFT", "JNJ", "GOOGL", "AMZN", "NVDA", "META"];
const START_DATE = "2022-01-01";
const END_DATE = "2026-08-20";
const CLUSTER_WINDOW_DAYS = 30;
const OUT_FILE = path.join(__dirname, "form4-frequency-results.json");

// --- Rate-limited fetch queue: throttles request *starts* to ~9/sec (SEC's
// limit is 10/sec), while letting multiple requests be in flight at once so
// wall-clock time isn't dominated by round-trip latency. Retries on 429/503
// with exponential backoff - a transient SEC 503 during the count-only pass
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

async function resolveCik(ticker) {
  const json = await fetchText("https://www.sec.gov/files/company_tickers.json");
  const all = JSON.parse(json);
  const entry = Object.values(all).find((v) => v.ticker === ticker);
  return String(entry.cik_str).padStart(10, "0");
}

async function fetchFilingList(cik) {
  let start = 0;
  const filings = [];
  while (true) {
    const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=4&dateb=&owner=include&count=100&start=${start}&output=atom`;
    const xml = await fetchText(url);
    const entries = [...xml.matchAll(/<accession-number>([^<]*)<\/accession-number>\s*<filing-date>([^<]*)<\/filing-date>/g)];
    if (entries.length === 0) break;
    for (const m of entries) filings.push({ accession: m[1], filingDate: m[2] });
    const oldest = entries[entries.length - 1][2];
    if (oldest < START_DATE) break;
    start += 100;
    if (start > 3000) break; // safety cap
  }
  return filings.filter((f) => f.filingDate >= START_DATE && f.filingDate <= END_DATE);
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

// Cluster-event approximation, mirroring how an actual entry signal would
// fire: walk P-transactions chronologically; a cluster "triggers" the first
// time 2+ distinct insiders have a P transaction within the trailing 30
// days, and doesn't re-trigger on every subsequent day the condition stays
// true (same "fires once, not every day" convention every strategy in this
// project already uses) - resets once the trailing window drops back below
// 2 distinct insiders.
function countClusterEvents(pTransactions) {
  const byDate = [...pTransactions].sort((a, b) => a.date.localeCompare(b.date));
  const uniqueDates = [...new Set(byDate.map((t) => t.date))];
  let inCluster = false;
  let clusterCount = 0;
  const clusterDates = [];

  for (const date of uniqueDates) {
    const windowStart = new Date(date);
    windowStart.setDate(windowStart.getDate() - CLUSTER_WINDOW_DAYS);
    const windowStartStr = windowStart.toISOString().slice(0, 10);

    const distinctInsiders = new Set(
      byDate.filter((t) => t.date >= windowStartStr && t.date <= date).map((t) => t.insider)
    );

    if (distinctInsiders.size >= 2) {
      if (!inCluster) {
        clusterCount++;
        clusterDates.push(date);
        inCluster = true;
      }
    } else {
      inCluster = false;
    }
  }
  return { clusterCount, clusterDates };
}

async function main() {
  console.log(`Form 4 code-P frequency check, ${START_DATE} to ${END_DATE}, tickers: ${TICKERS.join(", ")}\n`);

  const results = {};
  let grandTotalClusters = 0;

  for (const ticker of TICKERS) {
    console.log(`\n${"=".repeat(70)}\n${ticker}\n${"=".repeat(70)}`);
    const cik = await resolveCik(ticker);
    const cikNum = parseInt(cik, 10);
    const filings = await fetchFilingList(cik);
    console.log(`Total Form 4 filings in range: ${filings.length} (fetching+parsing each...)`);

    const pTransactions = [];
    let filingsWithP = 0;
    let parsedCount = 0;

    for (const f of filings) {
      let parsed;
      try {
        parsed = await fetchAndParseFiling(cikNum, f.accession);
      } catch (err) {
        console.log(`  ${f.accession} (${f.filingDate}): FAILED - ${err.message}`);
        continue;
      }
      parsedCount++;
      if (!parsed) continue;
      const pTx = parsed.transactions.filter((t) => t.code === "P");
      if (pTx.length > 0) {
        filingsWithP++;
        for (const t of pTx) {
          pTransactions.push({
            insider: parsed.ownerName,
            role: parsed.isDirector ? parsed.officerTitle || "Director" : parsed.isOfficer ? parsed.officerTitle || "Officer" : "Other",
            date: t.date,
            shares: t.shares,
            price: t.price,
            accession: f.accession,
          });
          console.log(
            `  P-TRANSACTION: ${(parsed.ownerName || "?").padEnd(22)} ${(t.date || "?").padEnd(12)} shares=${String(t.shares).padStart(8)} price=${t.price}  (${f.accession})`
          );
        }
      }
      if (parsedCount % 25 === 0) console.log(`  ...${parsedCount}/${filings.length} filings parsed so far`);
    }

    const distinctInsiders = new Set(pTransactions.map((t) => t.insider));
    const { clusterCount, clusterDates } = countClusterEvents(pTransactions);
    grandTotalClusters += clusterCount;

    console.log(`\n${ticker} SUMMARY:`);
    console.log(`  Total Form 4 filings in range: ${filings.length} (${parsedCount} successfully parsed)`);
    console.log(`  Filings containing >=1 code-P transaction: ${filingsWithP}`);
    console.log(`  Total code-P transaction rows: ${pTransactions.length}`);
    console.log(`  Distinct insiders with a code-P purchase: ${distinctInsiders.size} (${[...distinctInsiders].join(", ") || "none"})`);
    console.log(`  Cluster events (2+ distinct insiders within ${CLUSTER_WINDOW_DAYS}d, v1 definition): ${clusterCount}`);
    if (clusterDates.length) console.log(`  Cluster trigger dates: ${clusterDates.join(", ")}`);

    results[ticker] = {
      totalFilings: filings.length,
      parsedCount,
      filingsWithP,
      pTransactions,
      distinctInsiders: [...distinctInsiders],
      clusterCount,
      clusterDates,
    };
  }

  console.log(`\n${"=".repeat(70)}\nGRAND TOTAL ACROSS ALL 7 TICKERS\n${"=".repeat(70)}`);
  const totalP = Object.values(results).reduce((s, r) => s + r.pTransactions.length, 0);
  console.log(`Total code-P transactions across all 7 tickers: ${totalP}`);
  console.log(`Total cluster events (v1 tradeable signals) across all 7 tickers: ${grandTotalClusters}`);

  fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2));
  console.log(`\nFull results written to ${OUT_FILE}`);
}

main().catch((err) => {
  console.error("form4-frequency-check failed:", err);
  process.exit(1);
});
