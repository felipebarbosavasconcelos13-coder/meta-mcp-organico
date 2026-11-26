import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";
import { buildThreadsUserInsightParams } from "../../services/api-contracts.js";
import { defineTool } from "../define.js";

export function registerThreadsInsightTools(server: McpServer, client: MetaClient): void {
  defineTool(server, client, {
    name: "threads_get_post_insights",
    description: "Get insights for a specific Threads post (views, likes, replies, reposts, quotes, shares).",
    platform: "threads",
    kind: "read",
    errorLabel: "Get post insights failed",
    schema: {
      post_id: z.string().describe("Threads post ID"),
      metric: z.string().optional().describe("Comma-separated metrics (default: views,likes,replies,reposts,quotes)"),
    },
    handler: async ({ post_id, metric }, c) =>
      c.threads("GET", `/${post_id}/insights`, { metric: metric || "views,likes,replies,reposts,quotes" }),
  });

  defineTool(server, client, {
    name: "threads_get_user_insights",
    description: "Get account-level Threads insights: views, likes, replies, reposts, quotes, clicks (link clicks, returned as link_total_values), followers_count, follower_demographics (needs breakdown and 100+ followers).",
    platform: "threads",
    kind: "read",
    errorLabel: "Get user insights failed",
    schema: {
      metric: z.string().describe("Comma-separated metrics: views,likes,replies,reposts,quotes,clicks,followers_count,follower_demographics"),
      since: z.string().optional().describe("Start date (Unix timestamp)"),
      until: z.string().optional().describe("End date (Unix timestamp)"),
      breakdown: z.enum(["country", "city", "age", "gender"]).optional().describe("Required when requesting follower_demographics"),
    },
    handler: async ({ metric, since, until, breakdown }, c) =>
      c.threads(
        "GET",
        `/${await c.threadsUserId()}/threads_insights`,
        buildThreadsUserInsightParams(metric, since, until, breakdown)
      ),
  });
}
