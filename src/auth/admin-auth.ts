import { createHmac } from "crypto";

/**
 * Generate HMAC-SHA256 signature for POST/PUT/DELETE requests.
 * Uses timestamp method: Content=<body>\nTimestamp=<ts>
 */
export function generateSignature(secretKey: string, body: string, timestamp: number): string {
  const message = `Content=${body}\nTimestamp=${timestamp}`;
  const b64 = createHmac("sha256", secretKey).update(message).digest("base64");
  // Convert to base64url: replace + with -, / with _, strip trailing =
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** Anything that can supply auth material for RestClient requests. */
export interface CredentialsProvider {
  getApiKey(): string;
  getSigningSecret(): string;
  /** Return true if credentials were renewed and the request should be retried once. */
  handleUnauthorized?(): Promise<boolean>;
}

/** Static key pair — admin mode and client token mode. */
export class StaticCredentials implements CredentialsProvider {
  constructor(
    private apiKey: string,
    private secretKey: string,
  ) {}
  getApiKey() {
    return this.apiKey;
  }
  getSigningSecret() {
    return this.secretKey;
  }
}
