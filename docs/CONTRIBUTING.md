# Contributing

Thanks for working on the Trade Server MCP. This guide covers the development setup, the
project's one non-negotiable design policy, how to add a tool, and the conventions for tests,
commits, and pull requests.

## Development setup

You need Node.js 18+ and git.

```bash
git clone https://github.com/yourbourse/trade-server-mcp.git
cd trade-server-mcp
npm ci
npm test
```

Always install with `npm ci` (not `npm install`) so you build against the committed lockfile —
this is part of the project's supply-chain stance (see [Security](./SECURITY.md)).

The scripts you'll use:

| Command | What it does |
|---|---|
| `npm test` | Compiles TypeScript and runs the full test suite (`node --test`). |
| `npm run build` | Compiles `src/` to `dist/`. |
| `npm run lint` | ESLint over the repo. |
| `npm run format` / `npm run format:check` | Prettier write / check on `src/**/*.ts`. |
| `npm run type-check` | `tsc --noEmit`. |
| `npm run dev` | TypeScript watch mode. |

CI runs lint, format check, type-check, and the tests on every push and pull request — all
four must pass.

> **Note:** `npm test` compiles into `dist/` and runs the compiled tests from
> `dist/test/`. If you rename or delete a test file, remove the stale compiled copy (or wipe
> `dist/` entirely) before trusting the results — CI does `rm -rf dist` before testing for
> exactly this reason.

There is also a live regression harness, `scripts/regression-admin.mjs`, which drives the
built server over stdio against a real Trade Server (`node scripts/regression-admin.mjs admin`
or `client`, credentials via the same `YB_*` environment variables). It is not part of CI —
it needs a live server.

## The hand-written-tools policy

This project deliberately does **not** generate tools from the OpenAPI spec, and pull requests
that introduce codegen will be declined. The reasoning:

- AI clients work dramatically better with a curated set of **task-shaped tools** — friendly
  parameter names, intent-rich descriptions, and composites that match what a user actually
  asks for — than with one auto-generated tool per endpoint.
- The Trade Server wire format is terse (single-letter keys, microsecond timestamps). The
  translation from friendly parameters to wire format is exactly the value this project adds,
  and it is asserted by tests.

`reference/openapi.json` stays in the repo as the **contract to check against**: when you add
or change a tool, verify the endpoint, method, and body shape against it. It is documentation
for humans, not input for a generator.

## How to add a tool

Say you're adding a new client-mode tool:

1. **Implement it in the right module** under `src/tools/client/` (`trading.ts`,
   `account.ts`, or `market-data.ts` — admin tools live in `src/tools/admin/`). Export a pair:
   a zod schema with a `.describe()` on every parameter, and an async function
   `(client, params) => client.post(...)` that maps the friendly parameters to the wire
   format. Check the endpoint against `reference/openapi.json`.
2. **Think about the retry policy.** If the call places an order (or is otherwise
   non-idempotent), pass `{ retryOnConnectionError: false }` so a connection failure cannot
   cause a duplicate fill — see the `NO_TRANSPORT_RETRY` pattern in
   `src/tools/client/trading.ts`.
3. **Register it** in `src/register-client.ts` (or `src/register-admin.ts`): name,
   description, `schema.shape`, and the handler wrapped in `toolHandler` (client mode also
   wraps with `withHint`). The description is what the AI reads — write it to disambiguate
   from neighboring tools and to steer correct usage (the existing descriptions are the
   style guide).
4. **Update the counts.** Bump `CLIENT_TOOL_COUNT` in `src/register-client.ts` and the
   expected counts in `src/test/registration.test.ts` (client tools, or the admin 42/4
   assertions). The count test exists so a tool can't silently appear in or vanish from a
   mode.
5. **Add an endpoint-mapping test** in the matching `src/test/` file asserting the exact URL,
   HTTP method, and request body your tool produces (see the test conventions below).
6. **Document it** in [docs/TOOLS_REFERENCE.md](./TOOLS_REFERENCE.md): the registered
   description copied verbatim, a parameter table matching the zod schema, and one realistic
   example. Update the per-mode tool counts everywhere they appear if they changed.
7. Run `npm test`, `npm run lint`, `npm run format:check`.

## Test conventions

The suite uses **`node:test`** with `node:assert/strict` — no test framework dependency. The
conventions, all visible in `src/test/`:

- **Mock the network, never call it.** Tests replace `globalThis.fetch` with a stub that
  captures `{ url, method, body }` into an array and returns a canned `Response`. Assertions
  then check the exact endpoint and the exact wire-format body the tool produced. See
  `src/test/client-trading.test.ts` for the pattern.
- **Golden vectors for crypto.** The HMAC signature test (`src/test/auth.test.ts`) pins an
  exact known-good signature for a fixed secret/body/timestamp. If a crypto test fails, the
  code is wrong — **never adjust a golden expectation to make a failing test pass**; recompute
  the vector independently if you intentionally change the scheme.
- **Registration counts are pinned** (`src/test/registration.test.ts`): client mode registers
  exactly `CLIENT_TOOL_COUNT` (30) tools and none of them may expose an `accountId`
  parameter; admin mode registers exactly 42 tools and 4 resources.
- **Failure paths are first-class.** Auth lifecycle tests cover single-flight token rotation,
  refresh scheduling, 401 recovery, and the sign-in failure hints — including the case where
  an old server closes the connection instead of answering. New behavior with a failure mode
  should come with a failure-path test.
- Tests live in `src/test/*.test.ts` and run compiled, via `npm test`.

## Commit conventions

Conventional-commit style, matching the existing history:

```
feat: client-mode market data tools (8)
fix: single-flight token rotation, pinned HMAC tests, timer hardening
chore: lint/format configs, package metadata for 1.0.0
docs: troubleshooting and FAQ
```

- Prefixes in use: `feat:`, `fix:`, `chore:`, `docs:`.
- Lower-case, imperative, concise; one logical change per commit.
- **No AI attribution trailers** (no `Co-Authored-By: <AI tool>` or similar) — repo policy.

## Pull request checklist

- [ ] CI green: `npm test`, `npm run lint`, `npm run format:check`, `npm run type-check`.
- [ ] New/changed tools: endpoint verified against `reference/openapi.json`, endpoint-mapping
      test added, registration count test updated.
- [ ] Docs updated — at minimum [TOOLS_REFERENCE.md](./TOOLS_REFERENCE.md) for any tool
      change; tool counts consistent across all docs.
- [ ] **No new runtime dependencies without prior discussion.** The dependency footprint is
      deliberately small (4 runtime deps) for supply-chain reasons — open an issue first.
- [ ] No credentials, real hostnames, or account data in code, tests, or docs — placeholders
      only.

## Where next

- [Architecture](./ARCHITECTURE.md) — how the pieces fit together
- [Tools Reference](./TOOLS_REFERENCE.md) — the documentation your change must keep accurate
- [Security](./SECURITY.md) — the supply-chain stance behind the dependency rule
