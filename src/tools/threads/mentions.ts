import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";
import { defineTool, withPaging } from "../define.js";

export function registerThreadsMentionTools(server: McpServer, client: MetaClient): void {
  defineTool(server, client, {
    name: "threads_get_mentions",
    description: "Get public Threads posts where the account has been @mentioned by another profile. Requires threads_manage_mentions permission (without advanced access, only mentions by app testers are returned).",
    platform: "threads",
    kind: "read",
    errorLabel: "Get mentions failed",
    schema: {
      fields: z.string().optional().describe("Comma-separated fields (default: id,text,username,permalink,timestamp,media_type,media_url,has_replies,is_reply,topic_tag)"),
      limit: z.number().optional().describe("Number of results"),
      after: z.string().optional().describe("Pagination cursor"),
    },
    handler: async ({ fields, ...paging }, c) =>
      c.threads("GET", `/${await c.threadsUserId()}/mentions`, withPaging({
        fields: fields || "id,text,username,permalink,timestamp,media_type,media_url,has_replies,is_reply,topic_tag",
      }, paging)),
  });
}
