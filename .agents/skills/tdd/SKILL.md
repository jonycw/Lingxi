---
name: tdd
description: "Test-driven development for Lingxi. Use when adding behavior or fixing a bug test-first, or when the user mentions red-green-refactor."
---

# Test-driven development

Adapted from mattpocock/skills `tdd` (MIT). See `tests.md` in this folder.

Read `GLOSSARY.md` so test names use customer, `lx_` key, upstream, mock mode, micro-credit, and skill pack correctly. Read ADRs in `docs/adr/` when the change touches that decision.

## Loop

Red, then green, one slice at a time. Write one failing test at an agreed seam, then only enough code to pass it. Refactor after the slice is green, not instead of the test.

Run the single file with `npx vitest run tests/<file>.test.ts`. Run `npm test` before finishing. Node.js 22 is required.

## Seam

The public seam is HTTP through `createTestContext` in `tests/helpers.ts`. A good test issues a customer or admin request and asserts status, JSON, and headers.

Agree the seam before adding tests. For chat, that is `POST /v1/chat/completions`, including what the upstream fetch received in proxy mode. For admin changes, that is the admin route. Do not assert by querying private tables when the HTTP response already shows the behavior.

`codebase-design` is the vocabulary when the open question is where the seam should sit. It is a reference, not a redesign session.

## Anti-patterns

- A test that mocks an internal collaborator, or that breaks when the implementation moves but the response stays the same.
- An expected value computed by the same formula as the code. Use a literal.
- Writing the whole suite first, then the implementation. One test, then the code that makes it pass.
