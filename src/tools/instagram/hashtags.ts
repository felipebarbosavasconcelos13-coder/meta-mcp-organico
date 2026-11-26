import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";
import { defineTool, withPaging } from "../define.js";

const HASHTAG_MEDIA_FIELDS = "id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count";

export function registerIgHashtagTools(server: McpServer, client: MetaClient): void {
  defineTool(server, client, {
    name: "ig_search_hashtag",
    description: "Search for a hashtag ID by name. Required before querying hashtag media. Each account can query 30 unique hashtags per rolling 7 days.",
    platform: "instagram",
    kind: "read",
    errorLabel: "Hashtag search failed",
    schema: {
      q: z.string().describe("Hashtag name to search (without #)"),
    },
    handler: async ({ q }, c) => c.ig("GET", "/ig_hashtag_search", { q: q.replace(/^#/, ""), user_id: c.igUserId }),
  });

  defineTool(server, client, {
    name: "ig_get_hashtag",
    description: "Get hashtag information by ID.",
    platform: "instagram",
    kind: "read",
    errorLabel: "Get hashtag failed",
    schema: {
      hashtag_id: z.string().describe("Hashtag ID (from ig_search_hashtag)"),
    },
    handler: async ({ hashtag_id }, c) => c.ig("GET", `/${hashtag_id}`, { fields: "id,name" }),
  });

  const edges = [
    ["ig_get_hashtag_recent", "recent_media", "Get recent media (last 24h) tagged with a specific hashtag.", "Get hashtag recent failed"],
    ["ig_get_hashtag_top", "top_media", "Get top (most popular) media tagged with a specific hashtag.", "Get hashtag top failed"],
  ] as const;
  for (const [name, edge, description, errorLabel] of edges) {
    defineTool(server, client, {
      name,
      description,
      platform: "instagram",
      kind: "read",
      errorLabel,
      schema: {
        hashtag_id: z.string().describe("Hashtag ID"),
        limit: z.number().optional().describe("Number of results"),
        after: z.string().optional().describe("Pagination cursor"),
      },
      handler: async ({ hashtag_id, ...paging }, c) =>
        c.ig("GET", `/${hashtag_id}/${edge}`, withPaging({ user_id: c.igUserId, fields: HASHTAG_MEDIA_FIELDS }, paging)),
    });
  }
}
