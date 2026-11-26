/**
 * Helpers that keep access tokens out of anything returned to the model,
 * logged, or embedded in error messages.
 */

const TOKEN_PARAM = /([?&](?:access_token|input_token|fb_exchange_token|client_secret)=)[^&\s"'#]+/gi;

/** Replace token-bearing query parameters inside a string (URLs in paging links, error bodies). */
export function redactTokenParams(text: string): string {
  return text.replace(TOKEN_PARAM, "$1REDACTED");
}

/** Remove known secret values (and token query parameters) from free text. */
export function redactSecrets(text: string, secrets: Iterable<string | undefined>): string {
  let out = redactTokenParams(text);
  for (const secret of secrets) {
    if (secret && secret.length >= 8) {
      out = out.split(secret).join("REDACTED");
    }
  }
  return out;
}

/** Deep-copy a JSON value, redacting token query parameters in every string. */
export function sanitizeValue<T>(value: T): T {
  if (typeof value === "string") {
    return (value.includes("=") ? redactTokenParams(value) : value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item)) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = sanitizeValue(item);
    }
    return out as T;
  }
  return value;
}

/** Show only the edges of a token so a person can tell tokens apart without exposing them. */
export function maskToken(token: string): string {
  if (!token) return token;
  if (token.length <= 12) return "***";
  return `${token.slice(0, 6)}…${token.slice(-4)} (${token.length} chars, masked; set META_EXPOSE_TOKENS=true to return it in full)`;
}
