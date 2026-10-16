---
name: pr
description: "Write a Lingxi pull request body. Use when opening or updating a PR."
---

# Pull request

Adapted from mattpocock/skills `pr` (MIT). The section shape comes from the Humanlayer `show-me` skill by Dex Horthy: https://github.com/humanlayer/skills/blob/main/plugins/show-me/skills/show-me/SKILL.md

Use the glossary. Say customer, `lx_` key, upstream, mock mode, micro-credit, and skill pack when those are the things that changed.

```markdown
## Summary

<the smallest diagram, diff, or tree that shows the change>

## Evidence

- **Before:** <failing check or previous behavior>
  **After:** <command output or the behavior a customer can see>

## Merge Danger

**Door:** <one-way or two-way>

**Blast Radius:** <who is affected>
```

Skip the preamble. Summary shows the flow, the files, or a short diff of the behavior. Evidence is a command that was run, or a console step. A two-way door can be reverted without a data migration. A one-way door changes stored data or a client contract in a way that is awkward to undo. Blast radius names customers, operators, or both.

Do not paste secrets, tokens, or upstream keys into the body.
