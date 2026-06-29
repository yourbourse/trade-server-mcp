# Authentication

This is the deep-dive into how the Trade Server MCP authenticates with your YourBourse
Trade Server: how requests are signed, how each of the three credential setups works, and
exactly what happens on timeouts, expired sessions, and dropped connections.

You don't need any of this to use the server — credential setup is covered in
[Configuration](./CONFIGURATION.md). Read on if you want to know what is happening on the
wire, or if you are integrating with the Trade Server API yourself.

## Request signing: HMAC-SHA256

Every write request is signed. The signature is an **HMAC-SHA256** over a two-line message
built from the request body and a microsecond timestamp:

```
Content=<request body>
Timestamp=<microseconds since epoch>
```

The two lines are joined with a single `\n` (LF). The HMAC digest is then encoded as
**base64url without padding** — standard base64 with `+` replaced by `-`, `/` replaced by
`_`, and trailing `=` stripped. The result goes into the `X-YB-Sign` header, and the same
timestamp goes into `X-YB-Timestamp`. If a request has no body, `Content=` is signed with
an empty value.

Which key is used as the HMAC secret depends on the setup — see the flows below.

### Worked example

These are the exact values from this project's test suite
([`src/test/auth.test.ts`](../src/test/auth.test.ts)), so you can use them to verify your
own implementation:

| Input | Value |
|---|---|
| Secret | `test-secret` |
| Request body | `{"login":1}` |
| Timestamp (µs) | `1781032371788983` |

The message that gets signed (two lines, LF-separated):

```
Content={"login":1}
Timestamp=1781032371788983
```

Resulting signature:

```
VHro3dxIVYvD29rENMhg772MfN3hipqzVn4tilRnOnI
```

Equivalent Node.js:

```javascript
const { createHmac } = require("crypto");
const message = 'Content={"login":1}\nTimestamp=1781032371788983';
const sig = createHmac("sha256", "test-secret")
  .update(message)
  .digest("base64")
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/g, "");
// => "VHro3dxIVYvD29rENMhg772MfN3hipqzVn4tilRnOnI"
```

## Header reference

| Header | Value | GET | Writes (POST / PUT / DELETE) |
|---|---|---|---|
| `X-YB-API-Key` | The API key — admin key, client token-pair key, or the session token issued at sign-in | Yes | Yes |
| `X-YB-Timestamp` | Microseconds since the Unix epoch (milliseconds × 1000) | No | Yes |
| `X-YB-Sign` | base64url HMAC-SHA256 of the `Content`/`Timestamp` message above | No | Yes |

In short: **GET requests carry only the API key; writes carry all three headers.** Reads
are authenticated by the key alone, while anything that can change state must also prove
possession of the signing secret and carry a fresh timestamp.

## The three credential flows

### Admin mode: static key pair

The simplest flow. The broker-issued admin pair (`YB_API_KEY` + `YB_SECRET_KEY`) is used
directly for the lifetime of the process:

- `X-YB-API-Key` is always the configured API key.
- Writes are signed with the configured secret key as the HMAC secret.
- There is no sign-in step, no session token, and no refresh cycle. Nothing expires.

The secret key never leaves your machine — it is only used locally to compute signatures.

### Client mode, login/password

With `YB_LOGIN` + `YB_PASSWORD`, the MCP signs in to obtain a short-lived session token
pair and then manages that session automatically:

```
 MCP server                                          Trade Server
     |                                                    |
     |  POST /api/v1/authorize                            |
     |  body: {"login":<login>}   (+ broker, if set)      |
     |  signed with: YOUR PASSWORD as the HMAC secret     |
     |  (no X-YB-API-Key yet — password never sent)       |
     |--------------------------------------------------->|
     |                                                    |
     |  { account, token, signingToken, expiration(µs) }  |
     |<---------------------------------------------------|
     |                                                    |
     |  All subsequent calls:                             |
     |    X-YB-API-Key:  token                            |
     |    X-YB-Sign:     HMAC with signingToken           |
     |--------------------------------------------------->|
     |                                                    |
     |  ... at ~80% of the token lifetime (background):   |
     |  POST /api/v1/refresh  -> new token pair           |
     |  (single-flight: concurrent triggers share one     |
     |   request; if refresh fails, full re-authorize)    |
     |--------------------------------------------------->|
     |                                                    |
     |  ... if any call ever returns 401:                 |
     |  re-authorize once, retry that call once           |
     |  (a second 401 is reported, not retried)           |
     |--------------------------------------------------->|
```

Step by step:

1. **Sign-in.** The MCP sends `POST /authorize` with your account number (and broker name,
   if configured) in the body. The request is signed using **your password as the HMAC
   secret** — the password itself is never transmitted, logged, or echoed back into the
   conversation (see [Security](./SECURITY.md)).
2. **Session tokens.** The server responds with a `token` (used as the API key from then
   on), a `signingToken` (used as the HMAC secret from then on), the confirmed account
   number, and an expiration timestamp in microseconds.
3. **Background refresh.** A timer fires at about **80% of the remaining token lifetime**
   (never sooner than 5 seconds out) and rotates the pair via `POST /refresh`, signed with
   the current signing token. The timer never keeps the process alive on its own. If the
   refresh fails, the MCP falls back to a full re-sign-in with your login and password.
4. **Single-flight.** Sign-in and refresh are de-duplicated: if several things trigger
   re-authentication at the same moment, they all await the **same** in-flight request —
   the server never sees a burst of parallel sign-ins from one MCP instance.
5. **401 recovery.** If any request comes back `401 Unauthorized` (for example after a
   server restart invalidates the session), the MCP re-authorizes from scratch **once** and
   retries that request **once**. A second 401 — or a failed re-authorization — surfaces as
   an error instead of looping.

A malformed sign-in response (missing token, signing token, or expiration) is rejected
outright rather than half-applied, so the session is never left in a partial state.

### Client mode, token pair

If your broker issued you a public API token pair and you configured
`YB_API_KEY` + `YB_SECRET_KEY` with `YB_MODE=client`, the flow is the same as admin mode
mechanically: the pair is static, used as-is, with no sign-in step and no refresh cycle.
The difference is scope — the pair is bound to your trading account, so the server only
ever lets it see and act on that account.

## Timeouts and retries

The exact rules, all of them deliberate:

- **Sign-in and refresh requests time out after 10 seconds.** A hung `/authorize` or
  `/refresh` call is aborted rather than stalling your conversation; the failure is
  reported with a targeted hint (credentials, server version, or connectivity — see
  [Client Mode](./CLIENT_MODE.md#when-sign-in-fails)).
- **One 401 renew-and-retry, ever.** On a 401, credentials are renewed once and the failed
  request is retried once. A second 401 propagates as an error — there is no retry loop.
  If renewal itself fails, the original 401 is reported.
- **Transport retry on connection errors — except order placements.** If a write request
  (POST/PUT) fails at the connection level (connection reset, socket hang-up) before an
  HTTP response arrives, it is retried once — **unless it places an order**. Order
  placements (the money-mover commits `place_order_commit`, `close_position_commit`,
  `close_by_commit`, `close_all_positions_commit`) are never resent, because a dropped
  connection does not prove the server never received the order, and resending could fill you
  twice. HTTP-level errors (4xx/5xx) are never
  retried at the transport layer.

## Where next

- [Configuration](./CONFIGURATION.md) — setting up each credential style
- [Security](./SECURITY.md) — credential-handling guarantees and recommendations
- [Client Mode](./CLIENT_MODE.md) — the sign-in lifecycle from a trader's point of view
- [Troubleshooting](./TROUBLESHOOTING.md) — symptom-first fixes for auth failures
