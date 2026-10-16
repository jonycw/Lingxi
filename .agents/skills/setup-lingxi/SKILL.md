---
name: setup-lingxi
description: "Confirm Lingxi's issue tracker, triage posture, and domain-doc layout. Use when those files are missing or the user wants to change where issues or glossary docs live."
disable-model-invocation: true
---

# Setup Lingxi maintainer skills

Adapted from mattpocock/skills `setup-matt-pocock-skills` (MIT). This copy is the Lingxi procedure. Edit it here. Do not add a git submodule.

Lingxi is already set up:

- Issue tracker: GitHub `jonycw/Lingxi`, recorded in `docs/agents/issue-tracker.md`. PRs are not a triage surface.
- Domain docs: single-context. `GLOSSARY.md` at the repo root, ADRs in `docs/adr/`. Rules are in `docs/agents/domain.md`.
- Agent entry point: `AGENTS.md`. There is no `CLAUDE.md`. Do not create one unless the user asks.
- This is one Node package, not a monorepo. Do not add a glossary map.

## When to run

Run only if the user wants to change that layout, or if those files are missing. If the files exist, read them and stop. Do not overwrite user edits.

## Process

1. Read `AGENTS.md`, `GLOSSARY.md`, `docs/agents/issue-tracker.md`, and `docs/agents/domain.md`.
2. Summarise what is present. Ask one question at a time only for a real choice (GitHub vs another tracker, single-context vs a glossary map).
3. Default answers for this repo: GitHub issues, no triage-label file (the triage skill is not vendored), single-context glossary.
4. Update `AGENTS.md`'s "Agent skills" section in place. Write tracker and domain files from the user's answers. Do not create labels on GitHub unless the user asks.

## Done

Tell the user which files changed. Other skills read `GLOSSARY.md`, `docs/agents/issue-tracker.md`, and `docs/agents/domain.md` directly.
