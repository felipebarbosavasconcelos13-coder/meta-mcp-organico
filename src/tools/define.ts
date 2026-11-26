import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient, ScopedClient } from "../services/meta-client.js";
import { Platform } from "../services/accounts.js";
import { RateLimit } from "../types.js";

export const accountParam = z
  .string()
  .optional()
  .describe(
    "Which account to use: key, alias, @username, account ID or WhatsApp number (see meta_list_accounts). Optional for reads (uses the default account). Required for write tools when more than one account is available."
  );

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export interface HandlerOutput {
  data: unknown;
  rateLimit?: RateLimit;
}

type Kind = "read" | "write" | "destructive";

/** Parsed handler arguments for a raw zod shape. */
type Args<S extends z.ZodRawShape> = z.infer<z.ZodObject<S>>;

interface BaseSpec<S extends z.ZodRawShape> {
  name: string;
  description: string;
  schema: S;
  /** read: no changes; write: creates/changes data; destructive: deletes or hides data. */
  kind: Kind;
  /** Prefix for error messages, e.g. "Publish photo failed". */
  errorLabel: string;
  /** Mark tools that talk to the outside world beyond the user's own accounts (default true). */
  openWorld?: boolean;
}

interface ScopedSpec<S extends z.ZodRawShape> extends BaseSpec<S> {
  platform: Platform;
  handler: (args: Args<S>, c: ScopedClient) => Promise<HandlerOutput>;
}

interface GlobalSpec<S extends z.ZodRawShape> extends BaseSpec<S> {
  platform?: undefined;
  handler: (args: Args<S>, client: MetaClient) => Promise<HandlerOutput>;
}

export function ok(output: HandlerOutput, account?: { key: string; label?: string }): ToolResult {
  const data = output.data;
  const body =
    data && typeof data === "object" && !Array.isArray(data)
      ? { ...(data as object) }
      : { result: data };
  const payload: Record<string, unknown> = body;
  if (account) payload._account = account.key;
  if (output.rateLimit) payload._rateLimit = output.rateLimit;
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

export function fail(label: string, error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: `${label}: ${message}` }], isError: true };
}

/**
 * Register a tool. Scoped tools get an `account` parameter and a client bound to the
 * resolved account; write tools refuse to guess the account when several are available.
 */
export function defineTool<S extends z.ZodRawShape>(
  server: McpServer,
  client: MetaClient,
  spec: ScopedSpec<S> | GlobalSpec<S>
): void {
  const inputSchema = spec.platform ? { ...spec.schema, account: accountParam } : spec.schema;
  server.registerTool(
    spec.name,
    {
      description: spec.description,
      inputSchema,
      annotations: {
        readOnlyHint: spec.kind === "read",
        destructiveHint: spec.kind === "destructive",
        idempotentHint: spec.kind === "read",
        openWorldHint: spec.openWorld ?? true,
      },
    },
    (async (rawArgs: Record<string, unknown>) => {
      try {
        if (spec.platform) {
          const { account, ...args } = rawArgs as { account?: string };
          const scoped = await client.scope(account, spec.platform, { write: spec.kind !== "read" });
          const output = await spec.handler(args as Args<S>, scoped);
          return ok(output, scoped.account);
        }
        const output = await (spec as GlobalSpec<S>).handler(rawArgs as Args<S>, client);
        return ok(output);
      } catch (error) {
        return fail(spec.errorLabel, error);
      }
    }) as never
  );
}

/** Add optional pagination/limit values to a params object. */
export function withPaging(
  params: Record<string, unknown>,
  values: { limit?: number; after?: string; before?: string; since?: string; until?: string }
): Record<string, unknown> {
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") params[key] = value;
  }
  return params;
}
