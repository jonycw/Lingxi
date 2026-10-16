---
name: grill-with-docs
description: "Interview the user about a Lingxi design and write the settled terms into GLOSSARY.md or an ADR. Use when the user wants a plan stress-tested before implementation."
disable-model-invocation: true
---

# Grill with docs

Adapted from mattpocock/skills `grill-with-docs`, `grilling`, and `domain-modeling` (MIT).

Use this when the design is still open. Do not use it to stall a bugfix or a specified task.

## Loop

Work in rounds. The frontier is every decision you can ask now without guessing an earlier answer.

Each round:

1. Number the frontier questions.
2. Give a recommended answer, worded so "yes" accepts it.
3. Stop and wait. Do not implement.

Look up facts in the repo yourself. Ask the user only for decisions.

Use the glossary while you challenge words. Follow `domain-modeling`: update `GLOSSARY.md` when a term settles, and write an ADR only when it is hard to reverse, surprising, and a real trade-off.

## Stop

Stop when the frontier is empty and the user agrees the model is shared. Then implement only if they ask, using `tdd`.
