---
name: domain-modeling
description: "Build and sharpen Lingxi's domain model. Use when discussing terminology, editing GLOSSARY.md, or recording an ADR."
---

# Domain modeling

Adapted from mattpocock/skills `domain-modeling` (MIT). Use Lingxi's words from `GLOSSARY.md`. This skill changes the model. Reading the glossary during another task is not this skill.

## Files

Single context:

```text
GLOSSARY.md
docs/adr/0001-short-title.md
```

Do not create `GLOSSARY-MAP.md`. Lingxi is one gateway, not a set of bounded contexts with separate glossaries.

Create a file only when there is something to write. The glossary describes what a term is. It does not list routes, tables, or environment variables.

## During the session

- If a word fights the glossary, stop and pick one. "Account" is not a term here: say customer, `lx_` key, or balance.
- Skill pack and agent skill are different. A pack is injected into customer chat. An agent skill is a file under `.agents/skills/`.
- Upstream, upstream key, and `lx_` key are different secrets. Do not collapse them to "API key".
- Micro-credit is the integer unit. One credit is 1,000,000 micro-credits.
- Check the code when someone states how a rule works. If the code disagrees, say so before editing the glossary.
- Update `GLOSSARY.md` when a term is settled, in the same change, using the shape below.

```markdown
**Term**:
One or two sentences that say what it is.
_Avoid_: Other words
```

## ADRs

Offer an ADR only when all three are true: hard to reverse, surprising without the story, and a real trade-off. Keep it short. Number the next file in `docs/adr/`.

```markdown
# Short title

One to three sentences: context, decision, and why.
```
