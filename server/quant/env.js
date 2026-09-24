const fs = require("fs");
const path = require("path");

// Minimal, dependency-free .env loader - deliberately not the `dotenv`
// package and not Node's --env-file flag. This session found the active
// Node version inconsistent even within one interactive session (v19.9.0
// reported by every yahoo-finance2 warning earlier, v22.16.0 confirmed live
// when checking --env-file support) - if the scheduled task that runs the
// live trading script ends up invoking a different node.exe than expected,
// a flag- or version-dependent approach could silently break. Plain `fs`
// works identically on any Node version, which is the more reliable choice
// here given that uncertainty.
//
// Only sets a variable if it isn't already present in process.env, so a
// real environment variable (e.g. one Task Scheduler is configured to pass
// directly) always takes precedence over .env - same precedence convention
// the `dotenv` package itself uses.
function loadEnvFile(envPath = path.join(__dirname, "..", "..", ".env")) {
  if (!fs.existsSync(envPath)) return;

  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    // Strip a single layer of matching quotes, same convention dotenv uses.
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

// Reads a required env var, throwing a clear, specific error (naming the
// exact variable and where to set it) instead of letting a missing value
// flow through as `undefined` - which for an API credential would mean
// silently sending an empty/invalid Authorization header rather than
// failing loudly at startup.
function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable "${name}". Create a .env file at the project root ` +
        `(copy .env.example to .env and fill in real values) or set it directly in your environment.`
    );
  }
  return value;
}

module.exports = { loadEnvFile, requireEnv };
