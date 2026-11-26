import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";
import { defineTool, withPaging } from "../define.js";

export const THREADS_PROFILE_FIELDS = "id,username,name,threads_profile_picture_url,threads_biography,is_verified";

export function registerThreadsProfileTools(server: McpServer, client: MetaClient): void {
  defineTool(server, client, {
    name: "threads_get_profile",
    description: "Get the account's Threads profile information including verification status.",
    platform: "threads",
    kind: "read",
    errorLabel: "Get profile failed",
    schema: {},
    handler: async (_args, c) => c.threads("GET", `/${await c.threadsUserId()}`, { fields: THREADS_PROFILE_FIELDS }),
  });

  defineTool(server, client, {
    name: "threads_lookup_profile",
    description: "Look up a public Threads user's profile by username (Profile Discovery). Requires threads_profile_discovery permission and target must have >=100 followers; with standard access, only @meta, @threads, @instagram, and @facebook are queryable.",
    platform: "threads",
    kind: "read",
    errorLabel: "Profile lookup failed",
    schema: {
      username: z.string().describe("Threads username to look up (exact match, without @)"),
    },
    handler: async ({ username }, c) => c.threads("GET", "/profile_lookup", { username: username.replace(/^@/, "") }),
  });

  defineTool(server, client, {
    name: "threads_get_user_threads",
    description: "Get all threads published by the account (lighter field set than threads_get_posts).",
    platform: "threads",
    kind: "read",
    errorLabel: "Get user threads failed",
    schema: {
      limit: z.number().optional().describe("Number of results"),
      since: z.string().optional().describe("Start date (ISO 8601 or Unix timestamp)"),
      until: z.string().optional().describe("End date (ISO 8601 or Unix timestamp)"),
      after: z.string().optional().describe("Pagination cursor"),
    },
    handler: async (paging, c) =>
      c.threads("GET", `/${await c.threadsUserId()}/threads`, withPaging({
        fields: "id,media_product_type,media_type,text,permalink,timestamp,shortcode,is_quote_post,topic_tag",
      }, paging)),
  });
}
