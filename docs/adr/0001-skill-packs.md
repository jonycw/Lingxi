# Skill packs are stored in the database and stripped before the upstream

Operators need to add instructions for customer chats without redeploying. Lingxi stores each skill pack in the database and injects the selected bodies into a system message on `POST /v1/chat/completions`.

The request may name packs with `lingxi_skills` or, when that field is absent, `metadata.skills`. Both are removed before the upstream sees the body, because an OpenAI-compatible upstream can reject unknown fields. The customer list returns names and descriptions only. The pack body stays on the gateway until injection.

Files on disk would have required a redeploy for every edit. Leaving `lingxi_skills` on the forwarded body would have made the extension part of the upstream contract.
