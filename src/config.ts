export type ServerConfig =
  | { mode: "admin"; baseUrl: string; apiKey: string; secretKey: string }
  | {
      mode: "client";
      baseUrl: string;
      auth:
        | { style: "login"; login: number; password: string; broker?: string }
        | { style: "token"; apiKey: string; secretKey: string };
    };

const HELP = `Trade Server MCP configuration:
  Admin mode  (brokers): YB_BASE_URL + YB_API_KEY + YB_SECRET_KEY [+ YB_MODE=admin] (set YB_MODE explicitly if mixing credential variables)
  Client mode (traders): YB_BASE_URL + YB_LOGIN + YB_PASSWORD [+ YB_BROKER] + YB_MODE=client
  Client mode (token):   YB_BASE_URL + YB_API_KEY + YB_SECRET_KEY + YB_MODE=client`;

export function parseConfig(env: Record<string, string | undefined>): ServerConfig {
  const v = (name: string) => {
    const raw = env[name];
    if (raw === undefined) return undefined;
    const t = raw.trim();
    // An unsubstituted manifest placeholder (e.g. "${user_config.yb_broker}", which Claude
    // Desktop injects for an empty optional .mcpb field) is treated as unset — otherwise the
    // literal string is sent as a real value and the server rejects the request.
    if (t === "" || /^\$\{[^}]*\}$/.test(t)) return undefined;
    return t;
  };

  const baseUrl = v("YB_BASE_URL");
  if (!baseUrl) throw new Error(`Missing YB_BASE_URL.\n${HELP}`);

  const mode_raw = v("YB_MODE");
  const login_raw = v("YB_LOGIN");
  const password_raw = v("YB_PASSWORD");
  const apiKey_raw = v("YB_API_KEY");
  const secretKey_raw = v("YB_SECRET_KEY");
  const broker_raw = v("YB_BROKER");

  const hasLogin = login_raw !== undefined || password_raw !== undefined;
  const hasKeys = apiKey_raw !== undefined || secretKey_raw !== undefined;
  const mode = mode_raw ?? (hasLogin ? "client" : hasKeys ? "admin" : undefined);

  if (mode === "admin") {
    if (!apiKey_raw) throw new Error(`Admin mode requires YB_API_KEY.\n${HELP}`);
    if (!secretKey_raw) throw new Error(`Admin mode requires YB_SECRET_KEY.\n${HELP}`);
    return { mode: "admin", baseUrl, apiKey: apiKey_raw, secretKey: secretKey_raw };
  }

  if (mode === "client") {
    if (hasLogin && hasKeys) {
      throw new Error(
        `Client mode: set either YB_LOGIN/YB_PASSWORD or YB_API_KEY/YB_SECRET_KEY, not both.\n${HELP}`,
      );
    }
    if (hasLogin) {
      if (!login_raw) throw new Error(`Client login mode requires YB_LOGIN.\n${HELP}`);
      const login = Number(login_raw);
      if (!Number.isInteger(login) || login <= 0) {
        throw new Error(`YB_LOGIN must be a positive integer (got "${login_raw}").\n${HELP}`);
      }
      if (!password_raw) throw new Error(`Client login mode requires YB_PASSWORD.\n${HELP}`);
      return {
        mode: "client",
        baseUrl,
        auth: { style: "login", login, password: password_raw, broker: broker_raw },
      };
    }
    if (hasKeys) {
      if (!apiKey_raw || !secretKey_raw) {
        throw new Error(`Client token mode requires both YB_API_KEY and YB_SECRET_KEY.\n${HELP}`);
      }
      return {
        mode: "client",
        baseUrl,
        auth: { style: "token", apiKey: apiKey_raw, secretKey: secretKey_raw },
      };
    }
    throw new Error(`Client mode requires credentials.\n${HELP}`);
  }

  if (mode !== undefined) {
    throw new Error(`Unknown YB_MODE "${mode_raw}". Valid values: admin, client.\n${HELP}`);
  }
  throw new Error(
    `No mode could be inferred — set either YB_API_KEY + YB_SECRET_KEY (admin) or YB_LOGIN + YB_PASSWORD (client).\n${HELP}`,
  );
}
