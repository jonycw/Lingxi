---
name: codebase-design
description: "Vocabulary for Lingxi module shape: module, interface, depth, seam, adapter. Use when deciding where a behavior should live. Reference only; do not start a redesign."
---

# Codebase design

Adapted from mattpocock/skills `codebase-design` (MIT). This is a reference. Do not survey the repo, spawn design agents, or move files just because this skill was mentioned.

## Words

| Term | Meaning | Do not say |
| --- | --- | --- |
| Module | Something with an interface and an implementation. A function, a file, or a folder. | unit, component, service |
| Interface | What a caller must know: types, invariants, errors, ordering. | API, signature |
| Depth | How much behavior a caller gets per unit of interface. Deep means a lot of behavior behind a small interface. | |
| Seam | Where you can change behavior without editing that place. The HTTP routes and `createTestContext` are the usual test seam. | boundary |
| Adapter | A concrete thing behind an interface. SQLite and Postgres are adapters for the database executor. | |
| Leverage | What callers get from depth. | |
| Locality | A change and its tests stay in one module. | |

## Rules for this repo

- Depth is a property of the interface. `src/skills.ts` owns skill-pack policy. Routes only adapt HTTP onto it.
- Route files do not import each other. Shared JSON shapes live with the domain types.
- The deletion test: if removing a module makes its complexity reappear in every caller, it was doing real work. If the complexity vanishes, it was a pass-through.
- One adapter is not a reason to add a seam. SQLite and Postgres already justify the `Db` executor seam.
- Lingxi is one package. Do not introduce `src/packages`, barrel files, or dependency-cruiser unless the user asks.
- Tests call the HTTP interface. They should not lock private helpers.

Read `AGENTS.md` for the module map and `GLOSSARY.md` for product words.
