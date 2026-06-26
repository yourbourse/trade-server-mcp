import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfig } from "../config.js";

const BASE = { YB_BASE_URL: "https://ts.example.com:22236" };

test("admin mode from key pair (inferred)", () => {
  const c = parseConfig({ ...BASE, YB_API_KEY: "k", YB_SECRET_KEY: "s" });
  assert.equal(c.mode, "admin");
});

test("client mode inferred from login", () => {
  const c = parseConfig({ ...BASE, YB_LOGIN: "100", YB_PASSWORD: "pw" });
  assert.equal(c.mode, "client");
  if (c.mode === "client")
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

test("broker passthrough in client login mode", () => {
  const c = parseConfig({ ...BASE, YB_LOGIN: "7", YB_PASSWORD: "p", YB_BROKER: "ACME Ltd" });
  assert.ok(c.mode === "client" && c.auth.style === "login" && c.auth.broker === "ACME Ltd");
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
  assert.ok(c.mode === "client" && c.auth.style === "login" && c.auth.broker === undefined);
});
