/**
 * Role detection for login/password sign-ins: a manager's session token authorizes the
 * admin API, a trader's does not. GET /admin/managers/get/{account} answers 200 for a
 * manager; for a trader the origin typically 404s or drops the connection, but the
 * contract is broader — fail-closed: ANY non-200 outcome (any HTTP error status,
 * network drop, timeout) resolves to "not a manager", so a detection hiccup can only
 * ever yield the narrower client tool set — never admin.
 */
export async function detectManager(
  client: { get(path: string): Promise<unknown> },
  account: number,
): Promise<boolean> {
  try {
    await client.get(`/admin/managers/get/${account}`);
    return true;
  } catch (err) {
    console.error(
      `Trade Server MCP: role probe → trader (${err instanceof Error ? err.message : String(err)})`,
    );
    return false;
  }
}
