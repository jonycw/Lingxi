# Lingxi

The private gateway that sits between a customer and an upstream OpenAI-compatible service.

## Language

**Customer**:
The tenant that holds a balance and one or more `lx_` keys.
_Avoid_: User, account, client

**lx_ key**:
A customer credential issued by Lingxi. It authenticates that customer to Lingxi.
_Avoid_: API key, token, upstream key

**Admin token**:
The operator credential for management routes and the admin console.
_Avoid_: lx_ key, upstream key

**Upstream**:
The OpenAI-compatible service Lingxi calls with the operator's own key.
_Avoid_: Provider, backend, vendor

**Upstream key**:
The operator credential sent only to the upstream. Customers never receive it.
_Avoid_: lx_ key, admin token

**Mock mode**:
The gateway state in which chat is answered locally, because no upstream key is in effect or because mock is forced.
_Avoid_: Offline mode, demo mode

**Public model**:
The model id a customer sends to Lingxi.
_Avoid_: Upstream model

**Model mapping**:
The relation from a public model to the upstream model name.
_Avoid_: Alias

**Micro-credit**:
The integer unit of balance and price. One credit is 1,000,000 micro-credits.
_Avoid_: Cent, dollar, token

**Skill pack**:
A named instruction, stored by Lingxi, that a customer may select so the gateway adds it to that chat.
_Avoid_: Agent skill, prompt template, system prompt

**Agent skill**:
A maintainer instruction file in this repository. It guides coding agents and is not sent to the upstream.
_Avoid_: Skill pack
