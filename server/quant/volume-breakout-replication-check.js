const { runValidation, printReport } = require("./volume-breakout-validation");

// Same 7-ticker set, same volumeBreakoutStrategy config (N=20/X=20/1.5x),
// same 18-month windows/2-month lookback/ATR stop as
// volume-breakout-validation.js - only the date range changes, to check
// whether the 2022-2026 result replicates against an earlier, meaningfully
// different market regime rather than being specific to this one stretch.
//
// Range chosen: META IPO'd 2012-05-18 (checked directly against data.js),
// which is the binding constraint on how far back this 7-ticker set can go
// as a group. 2013-01-01 gives META ~7.5 months of trading history margin
// before the lookback buffer even starts reaching back further. End date
// 2021-12-31 sits right before the original validation's 2022-01-01 start,
// so the two windows don't overlap. The resulting ~9-year span covers the
// 2013-2019 bull run, the Feb-Mar 2020 COVID crash, and the 2020-2021
// recovery/bull run - a genuinely different regime mix than 2022's bear
// market followed by recovery, and long enough for 6 independent 18-month
// windows per ticker (vs. 3 in the original run).
const START_DATE = "2013-01-01";
const END_DATE = "2021-12-31";

async function main() {
  const { startDate, endDate, results } = await runValidation(START_DATE, END_DATE);
  printReport(startDate, endDate, results);
}

main().catch((err) => {
  console.error("Volume breakout replication check failed:", err);
  process.exit(1);
});
