---
name: code-review
description: "Review a Lingxi diff on two axes: standards and spec. Use when the user wants a review of a branch, a PR, or uncommitted work."
---

# Code review

Adapted from mattpocock/skills `code-review` (MIT).

Review the diff between `HEAD` and a fixed point the user names (branch, tag, or SHA). If they do not name one, ask. Compare with `git diff <fixed-point>...HEAD` after `git rev-parse` succeeds. An empty diff stops the review.

Report the axes separately. Do not average them into one score.

## Spec

Look for the spec in this order: an issue id in the commits (`gh issue view` per `docs/agents/issue-tracker.md`), a path the user gave, a file under `docs/` or `docs/adr/`. If there is no spec, say so and skip this axis.

Report missing or partial requirements, behavior nobody asked for, and requirements that look implemented but wrong. Quote the spec line. Stay under 400 words.

## Standards

Standards sources for this repo:

- `AGENTS.md` (module boundaries, Node 22, no secrets in the tree)
- `GLOSSARY.md` (names in new domain types and docs)
- `docs/adr/` when the diff touches a recorded decision

The repo's documented rule wins over the smell list below. Smells are judgement calls, not hard failures. Skip anything TypeScript or the tests already enforce.

- **Mysterious name**: the name hides what the value is. Rename it, using the glossary when it is a domain term.
- **Duplicated code**: the same shape appears twice in the diff. Extract it once.
- **Feature envy**: a function uses another module's data more than its own. Move the behavior.
- **Data clump**: the same fields travel together. Give them one type.
- **Primitive obsession**: a string stands in for a domain concept that already has a name.
- **Repeated switches**: the same cascade appears twice. Share one map.
- **Shotgun surgery**: one change edits many modules. Pull the change into the module that should own it.
- **Divergent change**: one file changes for unrelated reasons. Split it.
- **Speculative generality**: a parameter or hook the spec does not need. Delete it.
- **Message chain**: callers walk a long path. Offer one function on the first module.
- **Middle man**: a function only forwards. Call the target.
- **Refused bequest**: an implementer ignores most of what it inherits. Use composition.

If the harness can run two passes in parallel, do that so the axes do not share a draft. Otherwise write the standards pass, then the spec pass, without editing the first to match the second.

## Report

Use the headings `## Standards` and `## Spec`. End with one line per axis: how many findings, and the worst one on that axis.
