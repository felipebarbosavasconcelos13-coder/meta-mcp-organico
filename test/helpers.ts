import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../src/services/meta-client.js";
import { emptyConfig, MetaConfig } from "../src/config.js";

export type Registrar = (server: McpServer, client: MetaClient) => void;

interface RegisteredTool {
  schema: z.ZodRawShape;
  annotations?: Record<string, unknown>;
  handler: (args: any) => Promise<any>;
}

/** Collect tools registered through server.registerTool and run them with schema validation. */
export function captureTools(client: MetaClient, ...registrars: Registrar[]) {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    registerTool(name: string, config: { inputSchema: z.ZodRawShape; annotations?: Record<string, unknown> }, handler: (args: any) => Promise<any>) {
      tools.set(name, { schema: config.inputSchema, annotations: config.annotations, handler });
    },
  } as unknown as McpServer;
  for (const register of registrars) register(server, client);
  return {
    tools,
    async run(name: string, args: Record<string, unknown> = {}) {
      const tool = tools.get(name);
      if (!tool) throw new Error(`Tool ${name} not registered`);
      return tool.handler(z.object(tool.schema).parse(args));
    },
  };
}

export interface FakeCall {
  method: string;
  url: URL;
  body?: any;
  headers: Record<string, string>;
}

/**
 * A fetch stand-in: `route` gets each call and returns a JSON body (or a Response).
 * Throwing from route simulates a network failure.
 */
export function fakeFetch(route: (call: FakeCall) => unknown) {
  const calls: FakeCall[] = [];
  const fetchImpl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const headers = (init.headers || {}) as Record<string, string>;
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    const call: FakeCall = { method: init.method || "GET", url, body, headers };
    calls.push(call);
    const result = route(call);
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result ?? {}), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

export function graphError(status: number, code: number, message = "error", extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ error: { message, code, type: "OAuthException", ...extra } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function makeClient(overrides: Partial<MetaConfig>, route: (call: FakeCall) => unknown, extra: { env?: NodeJS.ProcessEnv; files?: Record<string, string> } = {}) {
  const { calls, fetchImpl } = fakeFetch(route);
  const client = new MetaClient(
    { ...emptyConfig(), ...overrides },
    {
      fetch: fetchImpl,
      sleep: async () => undefined,
      env: extra.env ?? {},
      readFile: (path) => {
        const content = extra.files?.[path];
        if (content === undefined) throw new Error(`ENOENT ${path}`);
        return content;
      },
    }
  );
  return { client, calls };
}

export function text(result: { content: Array<{ text: string }> }): string {
  return result.content[0].text;
}

export function json(result: { content: Array<{ text: string }> }): any {
  return JSON.parse(text(result));
}
