import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfig } from "../config.js";

const BASE = { YB_BASE_URL: "https://ts.example.com:22236" };

test("admin mode from key pair (inferred)", () => {
  const c = parseConfig({ ...BASE, YB_API_KEY: "k", YB_SECRET_KEY: "s" });
  assert.equal(c.mode, "admin");
  assert.equal(c.mode === "admin" && c.auth.style, "keys");
});

test("auto mode carries the login auth payload", () => {
  const c = parseConfig({ ...BASE, YB_LOGIN: "100", YB_PASSWORD: "pw" });
  assert.equal(c.mode, "auto");
  if (c.mode === "auto")
    assert.deepEqual(c.auth, { style: "login", login: 100, password: "pw", broker: undefined });
});

test("client token mode via explicit YB_MODE", () => {
  const c = parseConfig({ ...BASE, YB_MODE: "client", YB_API_KEY: "k", YB_SECRET_KEY: "s" });
  assert.equal(c.mode, "client");
  assert.equal(c.mode === "client" && c.auth.style, "token");
});

test("missing YB_BASE_URL throws with variable name in message", () => {
  assert.throws(() => parseConfig({ YB_API_KEY: "k", YB_SECRET_KEY: "s" }), /YB_BASE_URL/);
});

test("admin mode without secret throws listing what admin needs", () => {
  assert.throws(() => parseConfig({ ...BASE, YB_MODE: "admin", YB_API_KEY: "k" }), /YB_SECRET_KEY/);
});

test("client mode with both login and token pair throws (ambiguous)", () => {
  assert.throws(
    () =>
      parseConfig({
        ...BASE,
        YB_MODE: "client",
        YB_LOGIN: "1",
        YB_PASSWORD: "p",
        YB_API_KEY: "k",
        YB_SECRET_KEY: "s",
      }),
    /either YB_LOGIN\/YB_PASSWORD or YB_API_KEY\/YB_SECRET_KEY/,
  );
});

test("no credentials at all throws a help message naming both modes", () => {
  assert.throws(() => parseConfig({ ...BASE }), /No mode could be inferred/);
});

test("non-numeric YB_LOGIN throws", () => {
  assert.throws(() => parseConfig({ ...BASE, YB_LOGIN: "abc", YB_PASSWORD: "p" }), /YB_LOGIN/);
});

test("unknown YB_MODE value throws naming the valid values", () => {
  assert.throws(
    () => parseConfig({ ...BASE, YB_MODE: "trader", YB_API_KEY: "k", YB_SECRET_KEY: "s" }),
    /admin.*client|client.*admin/s,
  );
});

test("broker passthrough in login mode (auto)", () => {
  const c = parseConfig({ ...BASE, YB_LOGIN: "7", YB_PASSWORD: "p", YB_BROKER: "ACME Ltd" });
  assert.ok(c.mode === "auto" && c.auth.style === "login" && c.auth.broker === "ACME Ltd");
});

test("whitespace-only YB_BASE_URL throws with variable name in message", () => {
  assert.throws(
    () => parseConfig({ YB_BASE_URL: "   ", YB_API_KEY: "k", YB_SECRET_KEY: "s" }),
    /YB_BASE_URL/,
  );
});

test("only YB_PASSWORD set (no YB_LOGIN) throws requiring YB_LOGIN", () => {
  assert.throws(() => parseConfig({ ...BASE, YB_PASSWORD: "pw" }), /requires YB_LOGIN/);
});

test("an unsubstituted ${...} placeholder (blank optional .mcpb field) is treated as unset", () => {
  // Claude Desktop injects the literal `${user_config.yb_broker}` when the optional Broker
  // field is left blank; it must NOT become a real broker value (which the server rejects).
  const c = parseConfig({
    ...BASE,
    YB_LOGIN: "100",
    YB_PASSWORD: "pw",
    YB_BROKER: "${user_config.yb_broker}",
  });
  assert.ok(c.mode === "auto" && c.auth.style === "login" && c.auth.broker === undefined);
});

test("requestTimeoutMs defaults to 10000 when unset", () => {
  const c = parseConfig({ ...BASE, YB_API_KEY: "k", YB_SECRET_KEY: "s" });
  assert.equal(c.requestTimeoutMs, 10000);
});

test("YB_REQUEST_TIMEOUT_MS custom value is parsed", () => {
  const c = parseConfig({
    ...BASE,
    YB_API_KEY: "k",
    YB_SECRET_KEY: "s",
    YB_REQUEST_TIMEOUT_MS: "3000",
  });
  assert.equal(c.requestTimeoutMs, 3000);
});

test("non-numeric YB_REQUEST_TIMEOUT_MS throws naming the variable", () => {
  assert.throws(
    () =>
      parseConfig({ ...BASE, YB_API_KEY: "k", YB_SECRET_KEY: "s", YB_REQUEST_TIMEOUT_MS: "abc" }),
    /YB_REQUEST_TIMEOUT_MS/,
  );
});

test("zero or negative YB_REQUEST_TIMEOUT_MS throws", () => {
  assert.throws(
    () => parseConfig({ ...BASE, YB_API_KEY: "k", YB_SECRET_KEY: "s", YB_REQUEST_TIMEOUT_MS: "0" }),
    /positive integer/,
  );
});

test("non-https YB_BASE_URL is rejected by default", () => {
  assert.throws(
    () =>
      parseConfig({
        YB_BASE_URL: "http://ts.example.com:22236",
        YB_API_KEY: "k",
        YB_SECRET_KEY: "s",
      }),
    /must use https:\/\//,
  );
});

test("non-https YB_BASE_URL is allowed when explicitly enabled for local development", () => {
  const c = parseConfig({
    YB_BASE_URL: "http://localhost:22236",
    YB_ALLOW_INSECURE_BASE_URL: "true",
    YB_API_KEY: "k",
    YB_SECRET_KEY: "s",
  });
  assert.equal(c.mode, "admin");
});

test("insecure-mode flag still rejects non-http(s) schemes", () => {
  assert.throws(
    () =>
      parseConfig({
        YB_BASE_URL: "ws://localhost:22236",
        YB_ALLOW_INSECURE_BASE_URL: "true",
        YB_API_KEY: "k",
        YB_SECRET_KEY: "s",
      }),
    /must use http:\/\/ or https:\/\//,
  );
});

test("YB_BASE_URL with embedded credentials is rejected", () => {
  assert.throws(
    () =>
      parseConfig({
        YB_BASE_URL: "https://user@ts.example.com:22236",
        YB_API_KEY: "k",
        YB_SECRET_KEY: "s",
      }),
    /must not include username\/password/,
  );
});

test("malformed YB_BASE_URL is rejected with a clear message", () => {
  assert.throws(
    () => parseConfig({ YB_BASE_URL: "not a url", YB_API_KEY: "k", YB_SECRET_KEY: "s" }),
    /must be a valid URL/,
  );
});

// --- .mcpb dual-mode: the extension omits YB_MODE and injects the literal "${user_config.X}"
// placeholder for a blank optional field, so the mode is auto-detected from which credentials
// are actually filled in. These lock the manifest<->config contract (no YB_MODE needed). ---
const MCPB_BLANK_KEYS = {
  YB_API_KEY: "${user_config.yb_api_key}",
  YB_SECRET_KEY: "${user_config.yb_secret_key}",
};
const MCPB_BLANK_LOGIN = {
  YB_LOGIN: "${user_config.yb_login}",
  YB_PASSWORD: "${user_config.yb_password}",
  YB_BROKER: "${user_config.yb_broker}",
};

test(".mcpb trader shape (login/password filled) resolves to auto mode", () => {
  const c = parseConfig({ ...BASE, YB_LOGIN: "100", YB_PASSWORD: "pw" });
  assert.equal(c.mode, "auto");
  assert.equal(c.mode === "auto" && c.auth.style, "login");
});

test(".mcpb manager shape (key/secret filled, login/password blank) infers admin mode", () => {
  const c = parseConfig({ ...BASE, ...MCPB_BLANK_LOGIN, YB_API_KEY: "k", YB_SECRET_KEY: "s" });
  assert.equal(c.mode, "admin");
});

test(".mcpb both credential sets filled throws (ambiguous, set either not both)", () => {
  assert.throws(
    () =>
      parseConfig({
        ...BASE,
        YB_LOGIN: "100",
        YB_PASSWORD: "pw",
        YB_API_KEY: "k",
        YB_SECRET_KEY: "s",
      }),
    /either YB_LOGIN\/YB_PASSWORD or YB_API_KEY\/YB_SECRET_KEY/,
  );
});

test(".mcpb all credential fields blank throws the no-mode help", () => {
  assert.throws(
    () => parseConfig({ ...BASE, ...MCPB_BLANK_LOGIN, ...MCPB_BLANK_KEYS }),
    /No mode could be inferred/,
  );
});

// --- B12: role auto-detection + admin-via-login ---

test("YB_MODE=admin with login/password is a manager session", () => {
  const c = parseConfig({ ...BASE, YB_MODE: "admin", YB_LOGIN: "1", YB_PASSWORD: "pw" });
  assert.equal(c.mode, "admin");
  assert.equal(c.mode === "admin" && c.auth.style, "login");
});

test("YB_MODE=admin with both credential sets throws (ambiguous)", () => {
  assert.throws(
    () =>
      parseConfig({
        ...BASE,
        YB_MODE: "admin",
        YB_LOGIN: "1",
        YB_PASSWORD: "p",
        YB_API_KEY: "k",
        YB_SECRET_KEY: "s",
      }),
    /either YB_LOGIN\/YB_PASSWORD or YB_API_KEY\/YB_SECRET_KEY/,
  );
});

test("YB_MODE=admin with password but no login throws requiring YB_LOGIN", () => {
  assert.throws(() => parseConfig({ ...BASE, YB_MODE: "admin", YB_PASSWORD: "p" }), /YB_LOGIN/);
});
