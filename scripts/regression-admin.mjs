#!/usr/bin/env node
// Live stdio regression for trade-server-mcp — drives the built server
// (dist/index.js) over raw newline-delimited JSON-RPC, exactly like an MCP client.
//
// Usage (credentials/env supplied by the caller, never hardcoded here):
//   admin:  YB_API_KEY=... YB_SECRET_KEY=... YB_BASE_URL=... node scripts/regression-admin.mjs admin
//           (optional: REGRESSION_ACCOUNT_ID=<existing account> enables the account-info check)
//   client: YB_MODE=client YB_LOGIN=... YB_PASSWORD=... YB_BASE_URL=... node scripts/regression-admin.mjs client
//
// Exit code 0 = all checks passed. Non-zero = regression. Part of the release checklist.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const MODE = process.argv[2] === "client" ? "client" : "admin";
const TIMEOUT_MS = 30_000;
const SERVER = fileURLToPath(new URL("../dist/index.js", import.meta.url));

const child = spawn(process.execPath, [SERVER], {
  env: process.env,
  stdio: ["pipe", "pipe", "pipe"],
});

let stderrBuf = "";
child.stderr.on("data", (d) => { stderrBuf += d.toString(); });

// --- newline-delimited JSON-RPC plumbing -----------------------------------
const pending = new Map(); // id -> resolve
let stdoutBuf = "";
child.stdout.on("data", (d) => {
  stdoutBuf += d.toString();
  let nl;
  while ((nl = stdoutBuf.indexOf("\n")) >= 0) {
    const line = stdoutBuf.slice(0, nl).trim();
    stdoutBuf = stdoutBuf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id != null && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

function send(msg) {
  child.stdin.write(JSON.stringify(msg) + "\n");
}

function request(id, method, params) {
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    send({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) });
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout waiting for id ${id} (${method})`)); }
    }, TIMEOUT_MS).unref();
  });
}

// --- assertions --------------------------------------------------------------
let failures = 0;
function check(label, ok, detail = "") {
  const tag = ok ? "PASS" : "FAIL";
  if (!ok) failures++;
  console.log(`[${tag}] ${label}${detail ? ` — ${detail}` : ""}`);
}

function toolText(callResult) {
  return (callResult.result?.content ?? []).map((c) => c.text ?? "").join("\n");
}

// --- main --------------------------------------------------------------------
const overall = setTimeout(() => {
  console.error("OVERALL TIMEOUT (30s) — killing server");
  child.kill();
  process.exit(2);
}, TIMEOUT_MS);

try {
  const init = await request(1, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "regression", version: "0" },
  });
  check("initialize", !!init.result?.serverInfo, init.result?.serverInfo?.name);
  send({ jsonrpc: "2.0", method: "notifications/initialized" });

  const list = await request(2, "tools/list");
  const tools = list.result?.tools ?? [];
  const names = new Set(tools.map((t) => t.name));

  if (MODE === "admin") {
    check("tools/list count == 43", tools.length === 43, `got ${tools.length}`);
    for (const n of [
      "place_order_plan",
      "place_order_commit",
      "cash_transfer_plan",
      "cash_transfer_commit",
      "get_order_routing",
      "get_indicator",
    ]) {
      check(`tool present: ${n}`, names.has(n));
    }
    const placeOrderPlan = tools.find((t) => t.name === "place_order_plan");
    check("place_order_plan inputSchema has accountId (admin mode)",
      !!placeOrderPlan?.inputSchema?.properties?.accountId);

    const health = await request(3, "tools/call", { name: "health_check", arguments: {} });
    const healthText = toolText(health);
    check("health_check ok (server time)", !health.result?.isError && /\d{4}-\d{2}-\d{2}|\d{10,}/.test(healthText), healthText.slice(0, 120));

    const regAccount = Number(process.env.REGRESSION_ACCOUNT_ID);
    if (Number.isInteger(regAccount) && regAccount > 0) {
      const acct = await request(4, "tools/call", { name: "get_account_info", arguments: { accountId: regAccount } });
      const acctText = toolText(acct);
      let acctJson = null;
      try { acctJson = JSON.parse(acctText); } catch { /* keep null */ }
      const payload = acctJson?.data ?? acctJson ?? {};
      check(`get_account_info(${regAccount}): returns the requested account`,
        !acct.result?.isError && payload.id === regAccount, `id=${payload.id}`);
    } else {
      console.log("  get_account_info check skipped (set REGRESSION_ACCOUNT_ID to enable)");
    }
  } else {
    check("tools/list count == 30", tools.length === 30, `got ${tools.length}`);
    check("client mode: place_order_plan has NO accountId",
      !tools.find((t) => t.name === "place_order_plan")?.inputSchema?.properties?.accountId);

    const health = await request(3, "tools/call", { name: "health_check", arguments: {} });
    check("health_check ok (no auth needed)", !health.result?.isError, toolText(health).slice(0, 120));

    const state = await request(4, "tools/call", { name: "get_account_state", arguments: {} });
    const stateText = toolText(state);
    // Matches the current sign-in-failure hint from authFailureHint() (rewritten in v2.2.0).
    const hintRe = /Sign-in was rejected by the Trade Server/;
    check("get_account_state isError (old server expected)", state.result?.isError === true);
    check("get_account_state result contains sign-in-failure hint", hintRe.test(stateText));
    console.log("--- observed tool-result text ---");
    console.log(stateText);
    console.log("--- observed stderr (startup hint) ---");
    console.log(stderrBuf.trim());
    check("stderr contains sign-in-failure hint", hintRe.test(stderrBuf));
  }
} catch (err) {
  failures++;
  console.error(`[FAIL] ${err.message}`);
} finally {
  clearTimeout(overall);
  child.kill();
}

console.log(failures === 0 ? `\n${MODE.toUpperCase()} REGRESSION: ALL CHECKS PASSED` : `\n${MODE.toUpperCase()} REGRESSION: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
