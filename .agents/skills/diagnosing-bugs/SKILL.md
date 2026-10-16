---
name: diagnosing-bugs
description: "Diagnosis loop for Lingxi bugs and performance regressions. Use when something is broken, throwing, failing, or slow."
---

# Diagnosing bugs

Adapted from mattpocock/skills `diagnosing-bugs` (MIT).

Read `GLOSSARY.md` before naming the failing module. Skip a phase only when you can say why.

## Redact

Show commands and output only after secrets are replaced with `<REDACTED>`. That includes the admin token, the upstream key, customer `lx_` keys, `KEY_HASH_PEPPER`, and `PAYMENT_WEBHOOK_SECRET`. Do not print a request that still contains `Authorization`. Quote the status, error code, and the lines that show the symptom.

If the redacted output is not enough, say so. Do not ask the user to paste a live key.

## Phase 1: Feedback loop

Build a tight pass/fail signal before theorising.

Prefer, in order:

1. A failing `vitest` test at the HTTP seam (`npx vitest run tests/<file>.test.ts`).
2. `curl` against `npm run dev` on `127.0.0.1:8787`, with secrets only in the environment.
3. A tiny script that boots `createTestContext` and prints the status and error code.
4. For a UI-only bug, a browser pass on `/admin/ui` or `/console` after the API test is green.

This repo has no human-in-the-loop script. Do not add production logging that records bodies or keys.

The loop is done when one command, already run once, goes red on this symptom, is deterministic, and finishes in seconds. A flaky failure needs a higher reproduction rate before you explain it.

## Phase 2: Reproduce and shrink

Confirm the red result is the user's symptom. Remove inputs until every remaining piece is required for the failure.

## Phase 3: Hypothesise

Write 3 to 5 falsifiable hypotheses before changing code. Rank them. Each one says what change would make the bug disappear or get worse.

## Phase 4: Instrument

Change one variable at a time. Tag temporary logs with a unique prefix such as `[DEBUG-a4f2]` and delete them before finishing. Never log an `lx_` key or an upstream key. For slowness, measure first.

## Phase 5: Fix

Turn the smallest repro into a regression test at the HTTP seam, watch it fail, then fix it and watch it pass. Re-run the original loop.

If no seam can express the bug, say that. Do not add a test of a private helper that cannot see the real failure.

## Phase 6: Cleanup

The original loop is green, the regression test passes, debug prefixes are gone, and the winning hypothesis is in the commit or pull request.
