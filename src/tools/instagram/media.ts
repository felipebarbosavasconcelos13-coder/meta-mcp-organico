import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";
import { defineTool, withPaging } from "../define.js";

const MEDIA_FIELDS = "id,caption,media_type,media_product_type,media_url,permalink,thumbnail_url,timestamp,like_count,comments_count";

export function registerIgMediaTools(server: McpServer, client: MetaClient): void {
  defineTool(server, client, {
    name: "ig_get_media_list",
    description: "Get the media published on an Instagram account (feed posts and reels; stories are listed by ig_get_stories).",
    platform: "instagram",
    kind: "read",
    errorLabel: "Get media list failed",
    schema: {
      limit: z.number().optional().describe("Number of results (max 100, default 25)"),
      after: z.string().optional().describe("Pagination cursor for next page"),
      before: z.string().optional().describe("Pagination cursor for previous page"),
      since: z.string().optional().describe("Only media after this date (Unix timestamp or ISO 8601)"),
      until: z.string().optional().describe("Only media before this date (Unix timestamp or ISO 8601)"),
    },
    handler: async (args, c) =>
      c.ig("GET", `/${c.igUserId}/media`, withPaging({ fields: MEDIA_FIELDS }, args)),
  });

  defineTool(server, client, {
    name: "ig_get_stories",
    description: "Get the account's currently live Stories (last 24h). Story insights must be read while the story is live.",
    platform: "instagram",
    kind: "read",
    errorLabel: "Get stories failed",
    schema: {
      fields: z.string().optional().describe("Comma-separated fields (default: id,media_type,media_url,permalink,thumbnail_url,timestamp)"),
    },
    handler: async ({ fields }, c) =>
      c.ig("GET", `/${c.igUserId}/stories`, {
        fields: fields || "id,media_type,media_url,permalink,thumbnail_url,timestamp",
      }),
  });

  defineTool(server, client, {
    name: "ig_get_media",
    description: "Get details of a specific Instagram media post.",
    platform: "instagram",
    kind: "read",
    errorLabel: "Get media failed",
    schema: {
      media_id: z.string().describe("Media ID"),
      fields: z.string().optional().describe(`Comma-separated fields (default: ${MEDIA_FIELDS}). Also available: children{media_url,media_type}, collaborators, shortcode, is_shared_to_feed`),
    },
    handler: async ({ media_id, fields }, c) => c.ig("GET", `/${media_id}`, { fields: fields || MEDIA_FIELDS }),
  });

  defineTool(server, client, {
    name: "ig_delete_media",
    description: "Delete an Instagram media post (posts, carousels, reels, stories). This action is irreversible. Requires instagram_manage_contents permission.",
    platform: "instagram",
    kind: "destructive",
    errorLabel: "Delete media failed",
    schema: {
      media_id: z.string().describe("Media ID to delete"),
    },
    handler: async ({ media_id }, c) => {
      const { data, rateLimit } = await c.ig("DELETE", `/${media_id}`);
      return { data: { success: true, ...(data as object) }, rateLimit };
    },
  });

  defineTool(server, client, {
    name: "ig_get_media_insights",
    description:
      "Get insights for a media post. Feed/carousel: views,reach,saved,shares,likes,comments,total_interactions,reposts,profile_visits,follows. Reels add reels_skip_rate,ig_reels_avg_watch_time,ig_reels_video_view_total_time,crossposted_views,facebook_views. Stories: views,reach,replies,navigation,shares,link_clicks (read while live). Deprecated: impressions, plays, video_views (use views).",
    platform: "instagram",
    kind: "read",
    errorLabel: "Get media insights failed",
    schema: {
      media_id: z.string().describe("Media ID"),
      metric: z.string().optional().describe("Comma-separated metrics (default: views,reach,saved,shares)"),
      breakdown: z.string().optional().describe("Breakdown supported by the metric, e.g. action_type for navigation"),
    },
    handler: async ({ media_id, metric, breakdown }, c) => {
      const params: Record<string, unknown> = { metric: metric || "views,reach,saved,shares" };
      if (breakdown) params.breakdown = breakdown;
      return c.ig("GET", `/${media_id}/insights`, params);
    },
  });

  defineTool(server, client, {
    name: "ig_toggle_comments",
    description: "Enable or disable comments on an Instagram media post.",
    platform: "instagram",
    kind: "write",
    errorLabel: "Toggle comments failed",
    schema: {
      media_id: z.string().describe("Media ID"),
      enabled: z.boolean().describe("true to enable comments, false to disable"),
    },
    handler: async ({ media_id, enabled }, c) => {
      const { data, rateLimit } = await c.ig("POST", `/${media_id}`, { comment_enabled: enabled });
      return { data: { success: true, comment_enabled: enabled, ...(data as object) }, rateLimit };
    },
  });

  defineTool(server, client, {
    name: "ig_get_collaborative_media",
    description: "Get media where the account is a collaborator (collab posts).",
    platform: "instagram",
    kind: "read",
    errorLabel: "Get collaborative media failed",
    schema: {
      limit: z.number().optional().describe("Number of results"),
      after: z.string().optional().describe("Pagination cursor"),
    },
    handler: async (args, c) =>
      c.ig("GET", `/${c.igUserId}/collaborative_media`, withPaging({ fields: "id,caption,media_type,media_url,permalink,timestamp,username" }, args)),
  });
}
