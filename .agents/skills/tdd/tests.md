# Tests in Lingxi

## Good

A test boots the app with `createTestContext`, issues an `lx_` key or the admin token, and asserts the HTTP behavior.

```ts
const res = await chatRequest(ctx.app, key.key, {
  model: 'lingxi-fast',
  messages: [{ role: 'user', content: 'hello' }],
});
expect(res.status).toBe(200);
```

Proxy-mode tests pass a `fetchImpl` and read `ctx.fetchCalls`. Assert the mapped model, the upstream key, and that the customer `lx_` key was not forwarded. Assert secrets are absent from `ctx.logs`.

Use a temporary SQLite file. Do not point tests at a real upstream or commit a key.

## Poor fit

- Expecting a private function to have been called.
- Recomputing a micro-credit total with the production formula and comparing the test to itself.
- Reading the SQLite file to prove a behavior the JSON response already returns. The exception already in the suite is the test that the plaintext `lx_` key is not stored.

## Mocking

Stub the upstream with `fetchImpl`. Leave billing, auth, and the database real. Mock mode (empty upstream key) is the default in `testEnv`.
