import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// dist/test/manifest.test.js -> ../../manifest.json resolves to the repo root.
const manifest = JSON.parse(readFileSync(new URL("../../manifest.json", import.meta.url), "utf8"));
const env = manifest.server.mcp_config.env;
const uc = manifest.user_config;

test("manifest does not hard-pin YB_MODE (mode auto-detected from credentials)", () => {
  assert.equal(env.YB_MODE, undefined);
});

test("manifest maps the API key/secret env vars for manager (admin) mode", () => {
  assert.equal(env.YB_API_KEY, "${user_config.yb_api_key}");
  assert.equal(env.YB_SECRET_KEY, "${user_config.yb_secret_key}");
});

test("manifest still maps the trader (client) login env vars", () => {
  assert.equal(env.YB_LOGIN, "${user_config.yb_login}");
  assert.equal(env.YB_PASSWORD, "${user_config.yb_password}");
});

test("API key and secret fields are sensitive and optional", () => {
  assert.equal(uc.yb_api_key.sensitive, true);
  assert.equal(uc.yb_api_key.required ?? false, false);
  assert.equal(uc.yb_secret_key.sensitive, true);
  assert.equal(uc.yb_secret_key.required ?? false, false);
});

test("login and password are optional so a manager can leave them blank", () => {
  assert.equal(uc.yb_login.required ?? false, false);
  assert.equal(uc.yb_password.required ?? false, false);
});
