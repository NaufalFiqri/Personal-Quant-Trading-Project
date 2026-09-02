// Standalone feasibility check ONLY - not part of the strategy pipeline.
// Fetches real Form 4 filings for AAPL over the last 3 months directly from
// SEC EDGAR and prints the raw parsed transaction data. Confirms the two-step
// (filing-list JSON/Atom -> per-filing XML) access pattern described in
// PHASE2_INSIDER_SIGNAL_SCOPING.md actually works before any strategy code
// gets written.
//
// User-Agent note: SEC requires a descriptive User-Agent (name + contact) on
// every request or it 403s (confirmed live - see session transcript). A
// placeholder contact is used here deliberately, not the project owner's
// real email, since sending that to an external service wasn't requested.

const USER_AGENT = "PersonalQuantResearchProject research-contact@example.com";

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} fetching ${url}`);
  return res.text();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Minimal, purpose-built extraction (not a general XML parser) - pulls just
// the fields this check needs directly out of the raw XML text via regex,
// good enough to confirm the data is real and parseable, not proposed as
// how the real strategy's parser would be built.
function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? match[1].trim() : null;
}

function extractValue(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}>\\s*<value>([^<]*)</value>`));
  return match ? match[1].trim() : null;
}

function parseTransactions(xml, table) {
  const tableMatch = xml.match(new RegExp(`<${table}>([\\s\\S]*?)</${table}>`));
  if (!tableMatch) return [];
  const tableXml = tableMatch[1];
  const txType = table === "nonDerivativeTable" ? "nonDerivativeTransaction" : "derivativeTransaction";
  const entries = [...tableXml.matchAll(new RegExp(`<${txType}>([\\s\\S]*?)</${txType}>`, "g"))];
  return entries.map((m) => {
    const tx = m[1];
    return {
      table: table === "nonDerivativeTable" ? "non-derivative" : "derivative",
      date: extractValue(tx, "transactionDate"),
      // Unlike transactionDate/transactionShares/etc., transactionCode is a
      // direct scalar tag inside transactionCoding, NOT wrapped in <value> -
      // confirmed against a real fetched filing (see PHASE2_INSIDER_SIGNAL_
      // SCOPING.md's parsing-quirks note). extractValue would silently
      // return null here.
      code: extractTag(tx.match(/<transactionCoding>([\s\S]*?)<\/transactionCoding>/)?.[1] || "", "transactionCode"),
      shares: extractValue(tx, "transactionShares"),
      pricePerShare: extractValue(tx, "transactionPricePerShare"),
      acquiredDisposed: extractValue(tx, "transactionAcquiredDisposedCode"),
    };
  });
}

const TRANSACTION_CODE_LABELS = {
  P: "OPEN MARKET PURCHASE",
  S: "OPEN MARKET SALE",
  A: "GRANT/AWARD",
  M: "OPTION EXERCISE",
  F: "TAX WITHHOLDING",
  G: "GIFT",
  D: "SALE TO ISSUER",
};

async function main() {
  console.log("=== Step 1: resolve AAPL -> CIK via company_tickers.json ===");
  const tickersJson = await fetchText("https://www.sec.gov/files/company_tickers.json");
  const tickers = JSON.parse(tickersJson);
  const aapl = Object.values(tickers).find((t) => t.ticker === "AAPL");
  console.log(aapl);
  const cik = String(aapl.cik_str).padStart(10, "0");

  console.log(`\n=== Step 2: fetch Form 4 filing list for CIK ${cik} (owner=include) ===`);
  const listUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=4&dateb=&owner=include&count=40&output=atom`;
  const listXml = await fetchText(listUrl);

  const entries = [...listXml.matchAll(/<accession-number>([^<]*)<\/accession-number>\s*<filing-date>([^<]*)<\/filing-date>/g)].map(
    (m) => ({ accession: m[1], filingDate: m[2] })
  );

  const today = new Date();
  const threeMonthsAgo = new Date(today);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const cutoff = threeMonthsAgo.toISOString().slice(0, 10);

  const recent = entries.filter((e) => e.filingDate >= cutoff);
  console.log(`Total Form 4 entries returned: ${entries.length}. Filed on/after ${cutoff} (last 3 months): ${recent.length}`);
  for (const e of recent) console.log(`  ${e.accession}  filed ${e.filingDate}`);

  console.log(`\n=== Step 3: fetch + parse each filing's raw ownership XML ===`);
  const results = [];
  for (const e of recent) {
    const accessionNoDashes = e.accession.replace(/-/g, "");
    const xmlUrl = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${accessionNoDashes}/${e.accession}-index.htm`;
    // Find the actual xml filename from the index page first.
    await sleep(150);
    const indexHtml = await fetchText(xmlUrl);
    const xmlMatch = indexHtml.match(/href="([^"]*\/[^"/]+\.xml)"(?![^<]*xslF)/);
    // Prefer the non-xsl (raw) xml link - filter out the human-readable xslF345 rendering.
    const rawXmlHref = [...indexHtml.matchAll(/href="([^"]*\.xml)"/g)]
      .map((m) => m[1])
      .find((href) => !href.includes("xslF"));
    if (!rawXmlHref) {
      console.log(`  ${e.accession}: no raw XML found, skipping`);
      continue;
    }
    const docUrl = `https://www.sec.gov${rawXmlHref}`;
    await sleep(150);
    const xml = await fetchText(docUrl);

    const ownerName = extractTag(xml, "rptOwnerName");
    const isDirector = extractTag(xml, "isDirector");
    const isOfficer = extractTag(xml, "isOfficer");
    const officerTitle = extractTag(xml, "officerTitle");
    const periodOfReport = extractTag(xml, "periodOfReport");

    const nonDeriv = parseTransactions(xml, "nonDerivativeTable");
    const deriv = parseTransactions(xml, "derivativeTable");

    for (const tx of [...nonDeriv, ...deriv]) {
      results.push({
        accession: e.accession,
        filingDate: e.filingDate,
        periodOfReport,
        ownerName,
        role: isDirector === "true" ? (officerTitle || "Director") : isOfficer === "true" ? officerTitle || "Officer" : "Other",
        ...tx,
      });
    }
  }

  console.log(`\n=== Parsed transactions, AAPL, filings from last 3 months ===`);
  const header =
    "Filer".padEnd(20) +
    "Role".padEnd(30) +
    "TxDate".padEnd(12) +
    "Code".padEnd(6) +
    "Type".padEnd(24) +
    "Table".padEnd(15) +
    "Shares".padStart(10) +
    "Price".padStart(10) +
    "  Acq/Disp";
  console.log(header);
  console.log("-".repeat(header.length));
  for (const r of results) {
    const label = TRANSACTION_CODE_LABELS[r.code] || `(code ${r.code})`;
    console.log(
      (r.ownerName || "?").padEnd(20) +
        (r.role || "?").padEnd(30) +
        (r.date || "?").padEnd(12) +
        (r.code || "?").padEnd(6) +
        label.padEnd(24) +
        r.table.padEnd(15) +
        String(r.shares).padStart(10) +
        String(r.pricePerShare).padStart(10) +
        `  ${r.acquiredDisposed}`
    );
  }
  console.log(`\nTotal individual transaction rows parsed: ${results.length}, from ${recent.length} filings.`);
  const codeP = results.filter((r) => r.code === "P");
  console.log(`Of those, transaction code "P" (real open-market purchases): ${codeP.length}`);
}

main().catch((err) => {
  console.error("form4-feasibility-check failed:", err);
  process.exit(1);
});
