# Lingxi 灵犀

Lingxi（灵犀）是一个私有的 OpenAI 兼容 API 网关。你在一台自己的服务器上运行它，用自己的上游密钥（例如 Cursor 或其它 OpenAI 兼容接口）对外提供 `/v1/chat/completions`。客户只拿到 Lingxi 签发的 `lx_` 密钥，看不到上游密钥。

适合作为大陆网络环境下的私人中转：客户请求打到你的 Lingxi，Lingxi 再带着 `UPSTREAM_API_KEY` 访问 `UPSTREAM_BASE_URL`。密钥只来自环境变量，仓库和示例配置里没有真实密钥。

## 功能

- OpenAI 兼容接口：`POST /v1/chat/completions`（普通 JSON 与 SSE 流式）、`GET /v1/models`、`GET /v1/usage`
- 多租户：管理员签发 / 吊销客户 API Key，客户请求使用 `Authorization: Bearer`
- 计费 MVP：按 token 扣余额、每分钟请求/Token 速率限制、软配额（告警）与硬配额（拒绝）
- 用量流水、余额账本、模型价格覆盖
- 上游模型名映射（`config/models.json`）
- 未配置上游密钥时自动进入本地模拟模式，便于先跑通鉴权与记账
- 管理接口使用 `ADMIN_TOKEN`
- 可选 HMAC 支付回调，便于以后接支付宝 / 微信支付
- SQLite 开箱即用，同一套 SQL 可切到 Postgres

## 环境要求

- Node.js 22 或更新版本（使用内置 `node:sqlite`，Windows 上不需要编译原生模块）
- 可选：Docker / Docker Compose

## 快速开始

### Windows

在资源管理器中进入项目目录，然后在 PowerShell 里执行：

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

也可以用命令提示符：

```bat
copy .env.example .env
npm install
npm run dev
```

浏览器或另一个终端访问 `http://127.0.0.1:8787/health`。看到 `"service":"lingxi"` 即表示已启动。

生产式启动（先编译）：

```powershell
npm run build
npm start
```

### macOS / Linux

```bash
cp .env.example .env
npm install
npm run dev
```

健康检查：

```bash
curl -s http://127.0.0.1:8787/health
```

### 第一次调用

`.env` 里的 `ADMIN_TOKEN` 默认是 `dev-admin-token-change-me`。只适合本机。对外服务前请换成足够长的随机字符串。`UPSTREAM_API_KEY` 留空时，聊天接口返回本地模拟回复，同时仍会记账。

```bash
# 1. 创建客户并充值 10 个积分（1 积分 = 1_000_000 micros）
curl -s http://127.0.0.1:8787/admin/customers \
  -H "Authorization: Bearer dev-admin-token-change-me" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"demo\",\"initial_credits\":10}"

# 2. 签发密钥。响应里的 key 只出现这一次。
curl -s http://127.0.0.1:8787/admin/customers/<CUSTOMER_ID>/keys \
  -H "Authorization: Bearer dev-admin-token-change-me" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"laptop\"}"

# 3. 客户调用
curl -s http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer lx_替换成刚签发的密钥" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"lingxi-fast\",\"messages\":[{\"role\":\"user\",\"content\":\"你好\"}]}"
```

PowerShell 示例：

```powershell
$admin = @{ Authorization = "Bearer dev-admin-token-change-me" }
$customer = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8787/admin/customers -Headers $admin -ContentType "application/json" -Body '{"name":"demo","initial_credits":10}'
$key = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8787/admin/customers/$($customer.id)/keys" -Headers $admin -ContentType "application/json" -Body '{"name":"laptop"}'
$chatHeaders = @{ Authorization = "Bearer $($key.key)" }
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8787/v1/chat/completions -Headers $chatHeaders -ContentType "application/json" -Body '{"model":"lingxi-fast","messages":[{"role":"user","content":"你好"}]}'
```

流式请求把 JSON 里的 `"stream"` 设为 `true`。响应是 `text/event-stream`，以 `data: [DONE]` 结束。

### Docker

```bash
cp .env.example .env
docker compose up --build
```

容器内数据库文件在卷 `lingxi-data` 的 `/data/lingxi.sqlite`。Compose 会把 `DATABASE_URL` 指到这个路径。健康检查走 `GET /health`。

可选 Postgres（本地默认口令是 `lingxi`，仅限本机，正式环境请改掉）：

```bash
POSTGRES_PASSWORD=change-me docker compose --profile postgres up
```

然后把 `.env` 中的 `DATABASE_URL` 设为 `postgres://lingxi:change-me@postgres:5432/lingxi` 并重启 Lingxi。应用启动时会执行同一套建表语句。

## 配置

复制 `.env.example` 为 `.env`。已存在于进程环境中的变量不会被 `.env` 覆盖。

| 变量 | 作用 |
| --- | --- |
| `PORT` | 监听端口，默认 `8787` |
| `LINGXI_HOST` | 监听地址，默认 `0.0.0.0` |
| `DATABASE_URL` | `file:./data/lingxi.sqlite`，或 `postgres://...` / `postgresql://...` |
| `UPSTREAM_BASE_URL` | 上游 OpenAI 兼容根路径，需包含 `/v1`，例如 `https://api.openai.com/v1` |
| `UPSTREAM_API_KEY` | 上游密钥。留空则进入模拟模式 |
| `UPSTREAM_MOCK` | `true` 时即使有密钥也走模拟 |
| `UPSTREAM_TIMEOUT_MS` | 上游超时，默认 120000 |
| `ADMIN_TOKEN` | 管理接口 Bearer。`NODE_ENV=production` 时拒绝示例值和短于 16 字符的值 |
| `CORS_ORIGINS` | `*`、逗号分隔的源，或留空以关闭 CORS |
| `MAX_BODY_BYTES` | 请求体上限，默认 1 MiB |
| `MAX_MESSAGES` | 单次 `messages` 条数上限 |
| `MAX_COMPLETION_TOKENS` | `max_tokens` / `max_completion_tokens` 上限 |
| `AUTH_FAIL_LIMIT` | 每个 IP 每分钟允许的鉴权失败次数 |
| `TRUST_PROXY` | 为 `true` 时才信任 `X-Forwarded-For` |
| `KEY_HASH_PEPPER` | 可选。参与客户密钥哈希，设置后旧密钥全部失效 |
| `MODEL_CONFIG_PATH` | 模型目录，默认 `./config/models.json` |
| `ALLOW_PASSTHROUGH_MODELS` | `true` 时未登记的模型名会原样转发，并使用默认价格 |
| `PAYMENT_WEBHOOK_SECRET` | 非空时启用 `POST /admin/payments/webhook` |
| `USAGE_RETENTION_DAYS` | 启动时删除更早的用量。`0` 表示保留 |
| `LOG_LEVEL` | `debug` / `info` / `warn` / `error` |

金额单位是 **micro-credit**：`1` 积分 = `1_000_000` micros。价格是「每 1,000,000 tokens 多少 micros」。示例价格只是占位，不是任何厂商的官方价。

## 客户接口

除 `/health`、`/healthz` 和 `/` 以外，`/v1/*` 都需要客户密钥：

```http
Authorization: Bearer lx_...
```

错误体与 OpenAI 相近：

```json
{ "error": { "message": "Invalid API key", "type": "authentication_error", "code": "invalid_api_key" } }
```

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/health` | 进程、数据库、上游模式（`mock` 或 `proxy`） |
| `GET` | `/v1/models` | 当前启用的公开模型。不返回上游真实模型名 |
| `POST` | `/v1/chat/completions` | 聊天补全。`stream: true` 为 SSE |
| `GET` | `/v1/usage` | 当前密钥的余额、配额和最近用量 |

成功的非流式响应会带上：

- `X-Lingxi-Balance-Micros`：扣费后余额
- `X-Lingxi-Cost-Micros`：本次费用
- `X-Lingxi-Quota-Status`：`ok` 或 `soft-exceeded`
- `X-Lingxi-Quota-Used` / `X-Lingxi-Quota-Limit`
- `X-RateLimit-Limit` / `X-RateLimit-Remaining`

流式响应在开始输出前只能带上配额和速率限制头；扣费发生在流结束后，余额以 `GET /v1/usage` 为准。

## 管理接口

全部使用 `Authorization: Bearer <ADMIN_TOKEN>`。客户密钥不能调用管理接口。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/admin/customers` | `{ "name", "email?", "initial_credits?" }` 或 `initial_balance_micros` |
| `GET` | `/admin/customers` | 客户列表 |
| `GET` | `/admin/customers/:id` | 客户详情和密钥元数据 |
| `PATCH` | `/admin/customers/:id` | 修改 `name` / `email` / `status`（`active` 或 `suspended`） |
| `POST` | `/admin/customers/:id/credit` | `{ "credits" }` 或 `{ "amount_micros", "note?" }` 人工加款 |
| `GET` | `/admin/customers/:id/ledger` | 余额流水 |
| `POST` | `/admin/customers/:id/keys` | 签发密钥。明文只返回一次 |
| `GET` | `/admin/customers/:id/keys` | 只返回前缀和限额，不返回密钥 |
| `PATCH` | `/admin/keys/:id` | 修改名称、`rate_limit_rpm`、`rate_limit_tpm`、软/硬配额、`quota_period` |
| `POST` | `/admin/keys/:id/revoke` | 吊销 |
| `GET` | `/admin/usage` | 用量明细。可用 `customer_id`、`api_key_id`、`from`、`to` |
| `GET` | `/admin/usage/summary` | 按客户、密钥、模型汇总 |
| `GET` | `/admin/models` | 目录、上游映射、文件价、覆盖价、生效价 |
| `GET` | `/admin/prices` | 同上 |
| `PUT` | `/admin/prices` | 覆盖价格或 `enabled`。字段传 `null` 表示恢复文件默认 |
| `DELETE` | `/admin/prices/:model` | 删除覆盖 |
| `POST` | `/admin/payments/webhook` | 仅在配置了 `PAYMENT_WEBHOOK_SECRET` 时存在。不使用管理员令牌 |

签发密钥的默认限额：每分钟 60 次请求、每分钟 100000 tokens、配额周期为自然月（UTC）、不设软/硬配额。

## 计费与配额

一次成功的聊天请求：

1. 校验密钥、客户状态、模型是否启用
2. 余额必须大于 0，否则 `402 insufficient_balance`
3. 当前周期已用 token 达到硬配额则 `429 quota_exceeded`
4. 计入本分钟请求数；超过 `rate_limit_rpm` 则 `429`，并返回 `Retry-After`
5. 本分钟已记录 token 达到 `rate_limit_tpm` 则拒绝
6. 请求上游（或模拟器）
7. 按提示与补全 token 分别计价，写入用量，扣减余额，累加配额

费用计算是整数运算：`ceil(tokens * micros_per_million / 1_000_000)`。已通过余额检查的请求如果实际费用超过剩余余额，余额可以略微变为负数，下一笔请求会被拒绝。硬配额也是在请求开始前检查，单次回复可能使用量略超过上限，之后的请求会被挡住。

软配额只增加响应头 `X-Lingxi-Quota-Status: soft-exceeded`，不拒绝请求。`quota_period` 为 `month`（UTC `YYYY-MM`）或 `total`。

上游失败不计费，但会记一条 `status: "error"` 的用量，便于排查。速率限制是固定一分钟窗口，并且是尽力而为：SQLite 下请求串行，Postgres 下并发的 token 上限可能被同时通过的请求略微突破。

模型文件 `config/models.json` 把客户看到的 id 映射到上游模型名。修改文件后按 mtime 自动重新加载，不必重启。公开的 `/v1/models` 不暴露 `upstream` 字段。

## 支付扩展

当前 MVP 的入账方式是管理员调用 `POST /admin/customers/:id/credit`。自动入账预留了 HMAC Webhook，不绑定某一家支付公司。

启用：

```bash
PAYMENT_WEBHOOK_SECRET=一段足够长的随机串
```

你的支付服务（支付宝、微信支付或其它渠道）在确认收款后，向 Lingxi 发送：

```http
POST /admin/payments/webhook
Content-Type: application/json
X-Lingxi-Signature: sha256=<hex hmac of the raw body>
```

```json
{
  "external_id": "alipay-20261014-001",
  "customer_id": "客户 UUID",
  "amount_micros": 10000000,
  "provider": "alipay",
  "note": "订单号"
}
```

签名是原始 body 的 HMAC-SHA256，十六进制，前缀 `sha256=`。`external_id` 全局唯一。重复通知返回 `applied: false`，不会重复加款。实现位于 `src/payments.ts` 的 `signWebhook` / `verifyWebhookSignature`。

接入建议：

1. 支付渠道的异步通知先进入你自己的服务，完成渠道验签、金额和订单校验。
2. 用订单里保存的 `customer_id` 调用上面的 Webhook，或直接在进程内调用仓库的 `applyPayment`。
3. 不要把渠道密钥写进 Lingxi 日志。Lingxi 只保存 `external_id`、金额和可选备注。
4. 需要第二种验签方式时，在 `src/payments.ts` 增加一个 provider，并在路由注册前替换校验函数。不要从请求体动态加载代码。

未设置 `PAYMENT_WEBHOOK_SECRET` 时，该路径返回 404。

## Postgres

SQLite 与 Postgres 共用 `src/db/schema.ts`。驱动选择只看 `DATABASE_URL` 前缀：

- `file:...` 或普通路径：SQLite（`src/db/sqlite.ts`）
- `postgres://` 或 `postgresql://`：`pg` 连接池（`src/db/postgres.ts`）

占位符在 Postgres 驱动里从 `?` 转成 `$1`。金额和计数使用 `BIGINT`。连接串里如果带口令，启动失败时的日志会把整段 URL 抹掉。

## 安全

- 客户密钥只存 SHA-256（可加 `KEY_HASH_PEPPER`）。数据库和日志里没有完整密钥，列表接口只给前缀。
- 日志会脱敏 `Bearer`、长 `lx_` / `sk-` 密钥，以及配置中的管理员令牌、上游密钥、Webhook 密钥。请求体默认不记录。
- 管理令牌使用固定时间比较。
- 鉴权失败按 IP 限速。只有 `TRUST_PROXY=true` 时才使用 `X-Forwarded-For`。
- 限制请求体大小、消息条数和 `max_tokens`。
- 客户请求不会把客户密钥转发给上游。上游只收到 `UPSTREAM_API_KEY` 和映射后的模型名。
- `NODE_ENV=production` 时拒绝 `.env.example` 里的管理员令牌。
- CORS 默认由环境变量控制。示例文件为了本地调试使用 `*`，对外部署请改成明确的源或留空。

## 开发

```bash
npm test
npm run typecheck
npm run build
```

测试覆盖鉴权、吊销、暂停、速率限制、软/硬配额、余额、模拟与上游代理、流式记账、密钥不落库、价格覆盖和支付回调幂等。测试使用临时 SQLite，不需要上游密钥。

目录：

```text
src/index.ts           进程入口、加载 .env、优雅退出
src/app.ts             Hono 应用、CORS、体积限制、请求日志
src/config.ts          环境变量
src/auth.ts            客户密钥与管理员令牌
src/billing.ts         准入：余额、配额、速率
src/billingCost.ts     整数计价
src/upstream.ts        上游代理与本地模拟
src/payments.ts        HMAC 支付回调
src/db/                SQLite、Postgres 和共用 SQL
config/models.json     公开模型名到上游模型名
```

## English

Lingxi is a private OpenAI-compatible gateway. Customers send `Authorization: Bearer lx_...` to your server. Lingxi forwards chat requests to `UPSTREAM_BASE_URL` with `UPSTREAM_API_KEY`. Those values come only from the environment. This repository does not contain a real upstream key.

### Run locally

Node.js 22 or newer is required.

Windows PowerShell:

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

macOS / Linux:

```bash
cp .env.example .env
npm install
npm run dev
curl -s http://127.0.0.1:8787/health
```

`npm run dev` reloads TypeScript. `npm run build && npm start` runs the compiled server. Docker: `cp .env.example .env && docker compose up --build`.

Leave `UPSTREAM_API_KEY` empty to boot in mock mode. Mock completions are still authenticated, rate limited, and billed. Set the key and `UPSTREAM_MOCK=false` to proxy. `UPSTREAM_BASE_URL` must include the `/v1` prefix (`https://api.openai.com/v1` is the example). Point it at whatever OpenAI-compatible base URL your Cursor or other upstream account uses, and map public model ids in `config/models.json`.

Change `ADMIN_TOKEN` before exposing the port. Production mode refuses the example token.

### Issue a key and call the API

```bash
curl -s http://127.0.0.1:8787/admin/customers \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"demo","initial_credits":10}'

curl -s http://127.0.0.1:8787/admin/customers/$CUSTOMER_ID/keys \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"laptop"}'

curl -s http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer $LINGXI_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"lingxi-fast","messages":[{"role":"user","content":"hello"}]}'
```

The plaintext `lx_` key is returned once. Later admin reads show only a prefix. Revoke with `POST /admin/keys/:id/revoke`.

### Billing

Balances and prices use micro-credits (`1` credit = `1_000_000` micros). Prices are micros per 1,000,000 tokens. A request needs a positive balance (`402` otherwise) and must be under the key's hard quota and per-minute request/token limits (`429`). Soft quota adds `X-Lingxi-Quota-Status: soft-exceeded` and still allows the call. One in-flight response may push the balance slightly negative or the period usage slightly past the hard quota; the next call is rejected.

Manual top-ups: `POST /admin/customers/:id/credit` with `{ "credits": 10 }` or `{ "amount_micros": 10000000 }`. Ledger: `GET /admin/customers/:id/ledger`. Usage: `GET /admin/usage` and `GET /v1/usage`.

### Payments

Set `PAYMENT_WEBHOOK_SECRET`, then `POST /admin/payments/webhook` with raw-body HMAC-SHA256 in `X-Lingxi-Signature: sha256=<hex>`. JSON fields: `external_id`, `customer_id`, `amount_micros`, optional `provider` and `note`. Replays of the same `external_id` do not credit twice. Verify the provider notification in your own service first, then call this webhook. The hook stays `404` until the secret is set. See `src/payments.ts`.

### Postgres

Use `DATABASE_URL=postgres://user:pass@host:5432/lingxi`. The same schema runs on SQLite and Postgres. An optional Compose profile is in `docker-compose.yml`; its default database password is only for local use.

### Security

Secrets are not logged. Customer keys are stored as SHA-256 hashes. CORS, body size, auth-failure throttling, and `max_tokens` limits are configurable. Customer credentials are not forwarded upstream.

### Tests

```bash
npm test
npm run typecheck
```
