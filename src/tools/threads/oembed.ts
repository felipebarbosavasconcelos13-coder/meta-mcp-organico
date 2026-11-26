import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";
import { defineTool } from "../define.js";

export function registerThreadsOembedTools(server: McpServer, client: MetaClient): void {
  defineTool(server, client, {
    name: "threads_get_oembed",
    description: "Get the embed HTML and metadata for a public Threads post, for rendering a rich preview on an external site. No access token required.",
    kind: "read",
    errorLabel: "Get oEmbed failed",
    schema: {
      url: z.string().url().describe("Permalink of the post, e.g. https://www.threads.com/@user/post/{shortcode} or https://www.threads.com/t/{shortcode}"),
      maxwidth: z.number().min(320).max(658).optional().describe("Maximum width of the returned embed in pixels (320-658)"),
    },
    handler: async ({ url, maxwidth }, meta) => {
      const params: Record<string, unknown> = { url };
      if (maxwidth) params.maxwidth = maxwidth;
      return meta.threadsOembed(params);
    },
  });
}
