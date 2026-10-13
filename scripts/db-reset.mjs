#!/usr/bin/env node
/**
 * Reset the LOCAL Supabase database (drop + re-apply all migrations + seed).
 * Refuses to run when CI is unset only if SUPABASE_DB_URL looks like a
 * remote/production URL — local dev is the default target.
 */
import { execSync } from "node:child_process";

const dbUrl = process.env.SUPABASE_DB_URL ?? "";
if (dbUrl && !/127\.0\.0\.1|localhost/.test(dbUrl)) {
  console.error(
    `db:reset REFUSED — SUPABASE_DB_URL points at a non-local host: ${dbUrl.replace(/:[^:@]*@/, ":***@")}`,
  );
  process.exit(1);
}

try {
  execSync("npx supabase db reset", { stdio: "inherit" });
  console.log("db:reset OK");
} catch {
  console.error("db:reset FAILED — see output above (is `pnpm db:start` running?)");
  process.exit(1);
}
