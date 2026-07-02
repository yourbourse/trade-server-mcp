import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// dist/test/manifest.test.js -> ../../manifest.json resolves to the repo root.
const manifest = JSON.parse(readFileSync(new URL("../../manifest.json", import.meta.url), "utf8"));
const env = manifest.server.mcp_config.env;
const uc = manifest.user_config;

test("manifest does not hard-pin YB_MODE (role auto-detected after sign-in)", () => {
  assert.equal(env.YB_MODE, undefined);
});

test("manifest still maps the login env vars", () => {
  assert.equal(env.YB_LOGIN, "${user_config.yb_login}");
  assert.equal(env.YB_PASSWORD, "${user_config.yb_password}");
});

test("manifest does not expose API key/secret — one credential story (login/password)", () => {
  assert.equal(env.YB_API_KEY, undefined);
  assert.equal(env.YB_SECRET_KEY, undefined);
  assert.equal(uc.yb_api_key, undefined);
  assert.equal(uc.yb_secret_key, undefined);
});

test("login and password are required (used by traders AND managers)", () => {
  assert.equal(uc.yb_login.required, true);
  assert.equal(uc.yb_password.required, true);
  assert.equal(uc.yb_password.sensitive, true);
});

test("server address description leads with an example URL and tells managers which address", () => {
  assert.match(uc.yb_base_url.description, /^https:\/\/your-server\.example\.com/);
  assert.match(uc.yb_base_url.description, /[Mm]anagers/);
});
