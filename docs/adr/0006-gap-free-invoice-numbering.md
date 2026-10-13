# ADR-0006: Gap-free sequential invoice numbering at send time

- **Status:** accepted (2026-10-13, Phase 3)
- **Decider:** yassine808 + agent, per build brief ("gap-free per-org
  sequential numbering `INV-2026-0001`")

## Context

Tax regimes and bookkeeping expectations treat invoice numbers as a
sequence that must not lose values — but the _practical_ definition of
"gap-free" that matters (and that the brief's R6 risk entry targets)
is: **a number is consumed exactly once per successful send, and a
rolled-back send returns its number to the pool.** Numbers must be
per-organization, restart yearly, and safe under concurrent sends from
two browser tabs.

## Decision

**Allocate the number inside the `draft → sent` transition, from a
per-`(org, year)` counter row locked by the same statement that
increments it.**

- `invoice_counters (org_id, year, last_number)` with a composite
  primary key. The send trigger does
  `insert … on conflict do update set last_number = last_number + 1
returning last_number` — the upsert's row lock serializes concurrent
  sends for that org+year; the loser waits, then sees the committed
  value. Numbers are assigned in commit order with no gaps.
- Rollback safety comes for free from transactional semantics: the
  counter increment lives in the same transaction as the status
  change, so an aborted send un-consumes its number. The pgTAP test
  proves this with a savepoint rollback (070), which is the strongest
  interleaving we can express in a single-connection test file; true
  parallelism is guaranteed by the row lock, which is standard
  Postgres behavior.
- Drafts are never numbered (`status = 'draft'` ⇒ `number is null`,
  enforced by CHECK). Abandoned drafts therefore can never burn a
  number — the main real-world source of "gaps".
- Format `INV-<year>-<nnnn>` (`year` from `issue_date`, `lpad` to 4
  digits, longer numbers allowed by regex as volume grows). Number and
  `sent_at` appear together or not at all (paired CHECKs); `number`
  carries no update grant, so it is immutable after allocation.
- The counter table is invisible to the app: RLS enabled with zero
  policies and zero grants. Only the definer trigger (and superuser
  tests) can touch it.

## Alternatives considered

- **Postgres `serial`/identity per org:** gap-free across _all_ orgs
  is wrong per the brief, and per-org identity needs the same counter
  machinery underneath. Rejected.
- **UUID/ULID invoice numbers:** collision-proof without coordination,
  but not sequential — the brief explicitly requires `INV-2026-0001`.
  Rejected.
- **Number at draft creation:** numbers burned by abandoned drafts
  (the classic gap source), and void-before-send leaves holes anyway.
  Rejected.
- **Advisory locks (`pg_advisory_xact_lock`) instead of the counter
  row:** works identically, but adds a second locking mechanism to
  reason about when the counter row already provides the lock. Rejected.

## Consequences

- Sending is the only irreversible-ish action on an invoice's
  identity: voiding a sent invoice keeps its number (a sent invoice is
  a record), which is also the conservative tax reading.
- pgTAP 070 pins: sequence order, the savepoint rollback reuse, and
  that drafts/voids never allocate.
- Phase 5 PDFs and Phase 6 exports can rely on `number` being present
  and unique per org-year by construction.
