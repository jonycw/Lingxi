---
name: implement
description: "Implement a Lingxi spec or ticket test-first, then review the diff."
disable-model-invocation: true
---

# Implement

Adapted from mattpocock/skills `implement` (MIT).

If the user passes a GitHub issue number, read it with `gh issue view` and state the title before coding. Follow `docs/agents/issue-tracker.md`.

Use `tdd` at the HTTP seam. Read `GLOSSARY.md` and any ADR the change depends on.

While you work, run the focused vitest file and `npm run typecheck`. Run `npm test` once at the end. Node.js 22 is required.

Do not commit `.env`, `data/`, or any real upstream key.

When the behavior is green, review the diff with `code-review` against the spec you implemented. Commit on the current branch with a message that says what changed for the customer or the operator.
