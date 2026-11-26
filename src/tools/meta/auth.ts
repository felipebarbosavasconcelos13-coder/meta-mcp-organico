import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";
import { normalizeRef, Platform, summarizeAccount } from "../../services/accounts.js";
import { maskToken } from "../../services/sanitize.js";
import { defineTool } from "../define.js";

/** Mask access tokens in exchange/refresh responses unless META_EXPOSE_TOKENS=true. */
function maskTokens(client: MetaClient, data: unknown): unknown {
  if (client.config.exposeTokens || !data || typeof data !== "object") return data;
  const out = { ...(data as Record<string, unknown>) };
  if (typeof out.access_token === "string") out.access_token = maskToken(out.access_token);
  return out;
}

export function registerMetaAuthTools(server: McpServer, client: MetaClient): void {
  defineTool(server, client, {
    name: "meta_list_accounts",
    description:
      "List every account this server can act on — Instagram accounts discovered from the token, Threads profiles and WhatsApp numbers — with the key/aliases to pass as `account`, which one is the default, and which ones write tools may target. Never returns tokens.",
    kind: "read",
    errorLabel: "List accounts failed",
    openWorld: false,
    schema: {
      platform: z.enum(["instagram", "threads", "whatsapp"]).optional().describe("Only accounts with this platform"),
      search: z.string().optional().describe("Filter by key, alias, username, name or number (substring)"),
      refresh: z.boolean().optional().describe("Re-run discovery now instead of using the cache"),
    },
    handler: async ({ platform, search, refresh }, meta) => {
      const registry = meta.accounts;
      let records = await registry.all({ refresh });
      if (platform) records = records.filter((record) => record[platform as Platform]);
      if (search) {
        const needle = normalizeRef(search);
        records = records.filter((record) =>
          JSON.stringify(summarizeAccount(record, registry)).toLowerCase().includes(needle)
        );
      }
      return {
        data: {
          count: records.length,
          accounts: records.map((record) => summarizeAccount(record, registry)),
          allowed_accounts: registry.allowedAccounts.length ? registry.allowedAccounts : "all",
          warnings: registry.warnings.length ? registry.warnings : undefined,
          errors: registry.errors.length ? registry.errors : undefined,
        },
      };
    },
  });

  defineTool(server, client, {
    name: "meta_whoami",
    description: "Show which account a given `account` value resolves to for a platform (and whether write tools may use it) without calling the platform.",
    kind: "read",
    errorLabel: "Resolve account failed",
    openWorld: false,
    schema: {
      platform: z.enum(["instagram", "threads", "whatsapp"]).describe("Platform to resolve for"),
      account: z.string().optional().describe("Account key, alias, @username, ID or number; omit to see the default"),
    },
    handler: async ({ platform, account }, meta) => {
      const record = await meta.accounts.resolve(account, platform as Platform);
      return { data: summarizeAccount(record, meta.accounts) };
    },
  });

  defineTool(server, client, {
    name: "meta_exchange_token",
    description: "Exchange a short-lived token for a long-lived token (valid ~60 days). Requires META_APP_ID and META_APP_SECRET. The returned token is masked unless META_EXPOSE_TOKENS=true.",
    kind: "write",
    errorLabel: "Token exchange failed",
    schema: {
      short_lived_token: z.string().describe("Short-lived access token to exchange"),
    },
    handler: async ({ short_lived_token }, meta) => {
      const { data, rateLimit } = await meta.exchangeToken(short_lived_token);
      return { data: maskTokens(meta, data), rateLimit };
    },
  });

  defineTool(server, client, {
    name: "meta_refresh_token",
    description: "Extend an Instagram/Facebook user token through the token-exchange flow, or refresh a Threads long-lived token through the Threads refresh endpoint. The returned token is masked unless META_EXPOSE_TOKENS=true.",
    kind: "write",
    errorLabel: "Token refresh failed",
    schema: {
      long_lived_token: z.string().describe("Current long-lived access token to refresh"),
      platform: z
        .enum(["instagram", "threads"])
        .default("instagram")
        .describe("Token platform. Defaults to instagram for backward compatibility."),
    },
    handler: async ({ long_lived_token, platform }, meta) => {
      const { data, rateLimit } = await meta.refreshToken(long_lived_token, platform);
      return { data: maskTokens(meta, data), rateLimit };
    },
  });

  defineTool(server, client, {
    name: "meta_debug_token",
    description: "Debug/inspect an access token to check validity, expiration, scopes and associated user.",
    kind: "read",
    errorLabel: "Token debug failed",
    schema: {
      input_token: z.string().describe("Access token to inspect"),
    },
    handler: async ({ input_token }, meta) => meta.debugToken(input_token),
  });

  defineTool(server, client, {
    name: "meta_get_app_info",
    description: "Get Meta App basic information (name, category, namespace, etc.).",
    kind: "read",
    errorLabel: "Get app info failed",
    schema: {},
    handler: async (_args, meta) =>
      meta.meta("GET", "/app", { fields: "id,name,category,namespace,link,company,description" }),
  });

  defineTool(server, client, {
    name: "meta_subscribe_webhook",
    description: "Subscribe to webhook notifications for an object (e.g., 'instagram', 'page', 'whatsapp_business_account'). Requires META_APP_ID and META_APP_SECRET.",
    kind: "write",
    errorLabel: "Webhook subscribe failed",
    schema: {
      object: z.enum(["instagram", "page", "user", "permissions", "whatsapp_business_account"]).describe("Object type to subscribe to"),
      callback_url: z.string().url().describe("HTTPS webhook endpoint URL"),
      verify_token: z.string().describe("Verification token for the webhook"),
      fields: z.string().describe("Comma-separated list of fields to subscribe (e.g., 'messages,feed')"),
    },
    handler: async ({ object, callback_url, verify_token, fields }, meta) =>
      meta.meta("POST", "/app/subscriptions", { object, callback_url, verify_token, fields }),
  });

  defineTool(server, client, {
    name: "meta_get_webhook_subscriptions",
    description: "List current webhook subscriptions for the Meta App.",
    kind: "read",
    errorLabel: "Get webhooks failed",
    schema: {},
    handler: async (_args, meta) => meta.meta("GET", "/app/subscriptions"),
  });
}
