#!/usr/bin/env node
/**
 * Project-specific env/secret safety checks. Run by CI on every push/PR and
 * usable locally (pnpm check:env). Fails the build if any check fails.
 *
 * Checks:
 *  1. No .env* file is tracked by git (only .env.example may be tracked).
 *  2. .gitignore still ignores .env, .env.local, .env*.local etc.
 *  3. No secret-looking values in tracked files (Stripe/GitHub/Resend keys,
 *     JWTs, private keys). Gitleaks is the second, independent layer.
 *  4. Every process.env.* referenced in src/ exists in .env.example.
 *  5. No secret-like variable name is exposed behind NEXT_PUBLIC_*.
 *  6. .env.example contains no real-looking secret values.
 */
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const errors = [];

// ---------- helpers ----------
function trackedFiles() {
  return execSync("git ls-files", { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (
      ["node_modules", ".next", ".git", "playwright-report", "test-results"].includes(
        name,
      )
    )
      continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// ---------- 1. no tracked .env files ----------
try {
  const bad = trackedFiles().filter(
    (f) =>
      /(^|[/\\])\.env($|\.)/.test(f) &&
      f !== ".env.example" &&
      !f.endsWith(".env.example"),
  );
  if (bad.length) errors.push(`Env files must never be committed: ${bad.join(", ")}`);
} catch (e) {
  errors.push(`git ls-files failed: ${e.message}`);
}

// ---------- 2. .gitignore coverage ----------
if (existsSync(".gitignore")) {
  const gi = readFileSync(".gitignore", "utf8");
  for (const need of [".env", ".env.*", "!.env.example"]) {
    if (!gi.split(/\r?\n/).some((l) => l.trim() === need)) {
      errors.push(`.gitignore missing required line: ${need}`);
    }
  }
} else {
  errors.push(".gitignore is missing");
}

// ---------- 3. secret-looking values in tracked files ----------
const SECRET_PATTERNS = [
  [/\bsk_live_[0-9a-zA-Z]{16,}/, "Stripe LIVE secret key"],
  [/\bwhsec_[0-9a-zA-Z]{16,}/, "Stripe webhook secret"],
  [/\bre_[0-9a-zA-Z]{16,}/, "Resend API key"],
  [/github_pat_[0-9a-zA-Z_]{20,}/, "GitHub fine-grained token"],
  [/\bghp_[0-9a-zA-Z]{30,}/, "GitHub classic PAT"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "Private key block"],
  [
    /eyJ[A-Za-z0-9_-]{25,}\.[A-Za-z0-9_-]{25,}\.[A-Za-z0-9_-]{10,}/,
    "Encoded JWT (Supabase keys are JWTs — keep them in .env)",
  ],
];
const SELF = path.join("scripts", "check-env-safety.mjs"); // patterns live here; gitleaks scans everything
try {
  for (const f of trackedFiles()) {
    if (f === SELF || f === "pnpm-lock.yaml") continue;
    if (!existsSync(f)) continue;
    if (statSync(f).size > 1_000_000) continue;
    let content;
    try {
      content = readFileSync(f, "utf8");
    } catch {
      continue; // binary
    }
    for (const [re, label] of SECRET_PATTERNS) {
      if (re.test(content)) errors.push(`${label} found in tracked file: ${f}`);
    }
  }
} catch (e) {
  errors.push(`secret scan failed: ${e.message}`);
}

// ---------- 4. env usage vs .env.example ----------
const usedVars = new Set();
for (const file of walk(path.join(ROOT, "src"))) {
  if (!/\.(ts|tsx|js|jsx|mjs)$/.test(file)) continue;
  const content = readFileSync(file, "utf8");
  for (const m of content.matchAll(/process\.env\.([A-Z0-9_]+)/g)) usedVars.add(m[1]);
}
const exampleKeys = new Set();
if (existsSync(".env.example")) {
  for (const line of readFileSync(".env.example", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=/);
    if (m) exampleKeys.add(m[1]);
  }
} else {
  errors.push(".env.example is missing");
}
for (const v of usedVars) {
  if (!exampleKeys.has(v)) {
    errors.push(`process.env.${v} used in src/ but not documented in .env.example`);
  }
}

// ---------- 5. no secrets behind NEXT_PUBLIC_ ----------
for (const v of usedVars) {
  if (v.startsWith("NEXT_PUBLIC_") && /SECRET|SERVICE|PRIVATE|STRIPE_SECRET/.test(v)) {
    errors.push(`Secret-looking variable exposed to the browser: ${v}`);
  }
}

// ---------- 6. .env.example must not contain real values ----------
if (existsSync(".env.example")) {
  const content = readFileSync(".env.example", "utf8");
  for (const [re, label] of SECRET_PATTERNS) {
    if (re.test(content))
      errors.push(`${label} value inside .env.example — use placeholders`);
  }
}

// ---------- report ----------
if (errors.length) {
  console.error("check:env FAILED\n");
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log(
  `check:env OK — ${usedVars.size} env var(s) documented, no secrets tracked.`,
);
