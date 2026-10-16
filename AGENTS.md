# Lingxi agent notes

Lingxi is a private OpenAI-compatible gateway. Customers call it with an `lx_` key. The process forwards chat to an upstream service with the operator's upstream key, or answers locally in mock mode.

Read `GLOSSARY.md` before naming domain concepts. Decisions that are hard to reverse live in `docs/adr/`. Issue tracking is described in `docs/agents/issue-tracker.md`.

## Agent skills

Maintainer skills are vendored under `.agents/skills/` and edited in this repo. They are adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT). They are not product skill packs, and they are not sent to upstream models.

| Skill | Use when |
| --- | --- |
| `setup-lingxi` | The issue tracker or domain-doc layout needs to change |
| `grill-with-docs` | A design needs to be sharpened and written into the glossary or an ADR |
| `domain-modeling` | Terminology or an ADR is being decided |
| `codebase-design` | A module interface, seam, or depth question comes up |
| `tdd` | Behavior is being added or changed test-first |
| `diagnosing-bugs` | Something is broken, failing, or slow |
| `implement` | A spec or ticket is ready to build |
| `code-review` | A diff needs a standards pass and a spec pass |
| `pr` | A pull request body is being written |

Cursor can also start from `.cursor/skills/lingxi/SKILL.md`, which points here.

### Issue tracker

GitHub issues in `jonycw/Lingxi`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single context: root `GLOSSARY.md` and `docs/adr/`. See `docs/agents/domain.md`.

## Modules

Keep these interfaces small. Callers should not need the implementation to use the behavior.

| Module | Interface |
| --- | --- |
| `src/routes/openai.ts` | OpenAI-compatible customer surface |
| `src/routes/admin.ts` | Admin surface, same admin token as the other admin routes |
| `src/routes/ui.ts` | Home, admin console, customer console |
| `src/auth.ts` | `lx_` key and admin token checks |
| `src/billing.ts` | Admission: balance, quota, per-minute limits |
| `src/billingCost.ts` | Integer micro-credit prices |
| `src/upstream.ts` | Proxy and mock completion |
| `src/skills.ts` | Skill packs: validation, storage policy, prompt injection, stripping gateway fields |
| `src/db/` | SQLite and Postgres persistence |

Route modules should not import each other. Shared response shapes live next to the domain types.

Tests cross the HTTP seam through `createTestContext` in `tests/helpers.ts`. `npm test` uses a temporary SQLite file and does not need an upstream key.

Node.js 22 is required (`node:sqlite`). Do not commit `.env`, upstream keys, admin tokens, or customer `lx_` keys.
