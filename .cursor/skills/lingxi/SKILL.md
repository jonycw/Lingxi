---
name: lingxi
description: "Lingxi gateway context. Use when changing the gateway, billing, consoles, upstream proxy, or skill packs in this repository."
---

# Lingxi

Read `AGENTS.md` and `GLOSSARY.md` before editing.

Maintainer skills live in `.agents/skills/`. They are adapted from mattpocock/skills and edited in this repo. Start with the skill that matches the task (`tdd`, `diagnosing-bugs`, `code-review`, `implement`, `pr`, `domain-modeling`, `grill-with-docs`, `codebase-design`, `setup-lingxi`).

Product skill packs are different. An admin stores them in the database and a customer selects them on a chat request. The gateway injects the pack body into the system prompt. Do not confuse a pack with an agent skill file.
