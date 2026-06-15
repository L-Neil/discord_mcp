/**
 * Generate connection bearer tokens for the Discord MCP server.
 *
 *   npm run gen-tokens                 # 14 tokens, names person01..person14
 *   npm run gen-tokens -- 14           # explicit count
 *   npm run gen-tokens -- alice bob …  # one token per provided name
 *
 * Outputs three things:
 *   1. stdout summary
 *   2. tokens-env.txt   -> a single line "MCP_AUTH_TOKENS=tok1,tok2,..." to paste into env/Secret
 *   3. tokens-map.csv   -> name,token distribution table to track who got what
 *
 * tokens-env.txt / tokens-map.csv are git-ignored. Treat them as secrets.
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const DEFAULT_COUNT = 14;
const TOKEN_BYTES = 32; // 256-bit, base64url => 43 chars

function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

function parseArgs(argv: string[]): string[] {
  const args = argv.slice(2);
  if (args.length === 0) {
    return defaultNames(DEFAULT_COUNT);
  }
  // Single numeric arg => that many default names.
  if (args.length === 1 && /^\d+$/.test(args[0])) {
    return defaultNames(parseInt(args[0], 10));
  }
  // Otherwise treat args as explicit names.
  return args;
}

function defaultNames(count: number): string[] {
  return Array.from({ length: count }, (_, i) =>
    `person${String(i + 1).padStart(2, "0")}`,
  );
}

const names = parseArgs(process.argv);
const entries = names.map((name) => ({ name, token: generateToken() }));

// 1) env line
const envLine = `MCP_AUTH_TOKENS=${entries.map((e) => e.token).join(",")}`;
writeFileSync("tokens-env.txt", envLine + "\n", { mode: 0o600 });

// 2) distribution table (CSV)
const csv =
  "name,token\n" +
  entries.map((e) => `${csvEscape(e.name)},${e.token}`).join("\n") +
  "\n";
writeFileSync("tokens-map.csv", csv, { mode: 0o600 });

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// 3) stdout summary
console.log(`Generated ${entries.length} token(s).\n`);
console.log("=== Distribution table ===");
for (const e of entries) {
  console.log(`  ${e.name.padEnd(12)} ${e.token}`);
}
console.log("\n=== Paste into env / Secret (also written to tokens-env.txt) ===");
console.log(envLine);
console.log(
  "\nWrote: tokens-env.txt (env line), tokens-map.csv (name<->token table).",
);
console.log("These files are git-ignored. Keep them secret; delete once distributed.");
