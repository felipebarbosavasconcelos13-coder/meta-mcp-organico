import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";
import { defineTool, withPaging } from "../define.js";

export const IG_PROFILE_FIELDS = "id,name,username,biography,followers_count,follows_count,media_count,profile_picture_url,website";

const TOTAL_VALUE_METRICS = new Set([
  "views", "reposts", "accounts_engaged", "total_interactions", "comments", "likes",
  "profile_links_taps", "replies", "saves", "shares", "follows_and_unfollows",
]);

export function registerIgProfileTools(server: McpServer, client: MetaClient): void {
  defineTool(server, client, {
    name: "ig_get_profile",
    description: "Get Instagram Business/Creator account profile information.",
    platform: "instagram",
    kind: "read",
    errorLabel: "Get profile failed",
    schema: {},
    handler: async (_args, c) => c.ig("GET", `/${c.igUserId}`, { fields: IG_PROFILE_FIELDS }),
  });

  defineTool(server, client, {
    name: "ig_get_account_insights",
    description: "Get Instagram account insights. Note: 'impressions', 'email_contacts', 'phone_call_clicks', 'text_message_clicks', 'get_directions_clicks', 'website_clicks', 'profile_views' were deprecated in v22.0. Use 'views', 'reach', 'follower_count', 'reposts' instead.",
    platform: "instagram",
    kind: "read",
    errorLabel: "Get account insights failed",
    schema: {
      metric: z.string().describe("Comma-separated metrics: views,reach,follower_count,reposts,accounts_engaged,total_interactions"),
      period: z.enum(["day", "week", "days_28", "month", "lifetime"]).describe("Aggregation period"),
      metric_type: z.enum(["time_series", "total_value"]).optional().describe("Aggregation type. Defaults to total_value for metrics that require it, such as views and reposts."),
      breakdown: z.string().optional().describe("Comma-separated breakdowns supported by the metric, e.g. media_product_type, follow_type, age, country"),
      timeframe: z.enum(["last_14_days", "last_30_days", "last_90_days", "prev_month", "this_month", "this_week"]).optional().describe("Required for demographics metrics; do not combine with since or until. Engaged/reached audience demographics only support this_week and this_month; follower demographics support all listed values."),
      since: z.string().optional().describe("Start date (Unix timestamp or ISO 8601)"),
      until: z.string().optional().describe("End date (Unix timestamp or ISO 8601)"),
    },
    handler: async ({ metric, period, metric_type, breakdown, timeframe, since, until }, c) => {
      const params: Record<string, unknown> = { metric, period };
      const metrics = metric.split(",").map((value) => value.trim());
      const demographics = metrics.some((value) => value.endsWith("_demographics"));
      const needsTotalValue = demographics || Boolean(breakdown) || metrics.some((value) => TOTAL_VALUE_METRICS.has(value));
      if (needsTotalValue && metric_type === "time_series") {
        throw new Error("The requested metrics require metric_type=total_value. Query time-series metrics separately.");
      }
      if (demographics && (!timeframe || !breakdown || period !== "lifetime" || since || until)) {
        throw new Error("Demographics require period=lifetime, timeframe, and breakdown, without since or until.");
      }
      if (timeframe && !["this_week", "this_month"].includes(timeframe) && metrics.some((value) => value === "engaged_audience_demographics" || value === "reached_audience_demographics")) {
        throw new Error("Engaged and reached audience demographics only support timeframe=this_week or this_month since Graph API v20. Query follower demographics separately for older timeframes.");
      }
      if (metric_type || needsTotalValue) params.metric_type = metric_type || "total_value";
      if (breakdown) params.breakdown = breakdown;
      if (timeframe) params.timeframe = timeframe;
      if (since) params.since = since;
      if (until) params.until = until;
      return c.ig("GET", `/${c.igUserId}/insights`, params);
    },
  });

  defineTool(server, client, {
    name: "ig_business_discovery",
    description: "Look up another Instagram Business/Creator account's public info by username (read through one of your accounts).",
    platform: "instagram",
    kind: "read",
    errorLabel: "Business discovery failed",
    schema: {
      username: z.string().regex(/^[A-Za-z0-9._]+$/).describe("Instagram username to look up (without @)"),
      fields: z.string().optional().describe("Fields to retrieve (default: id,username,name,biography,followers_count,follows_count,media_count)"),
    },
    handler: async ({ username, fields }, c) =>
      c.ig("GET", `/${c.igUserId}`, {
        fields: `business_discovery.username(${username}){${fields || "id,username,name,biography,followers_count,follows_count,media_count"}}`,
      }),
  });

  defineTool(server, client, {
    name: "ig_get_collaboration_invites",
    description: "Get pending collaboration invites for the Instagram account. Added in December 2025.",
    platform: "instagram",
    kind: "read",
    errorLabel: "Get collaboration invites failed",
    schema: {
      limit: z.number().optional().describe("Number of results"),
      after: z.string().optional().describe("Pagination cursor"),
    },
    handler: async (paging, c) => c.ig("GET", `/${c.igUserId}/collaboration_invites`, withPaging({}, paging)),
  });

  defineTool(server, client, {
    name: "ig_respond_collaboration_invite",
    description: "Accept or decline a collaboration invite. Added in December 2025.",
    platform: "instagram",
    kind: "write",
    errorLabel: "Respond to collaboration invite failed",
    schema: {
      media_id: z.string().optional().describe("Invited media_id returned by ig_get_collaboration_invites"),
      accept: z.boolean().optional().describe("true to accept, false to decline"),
      invite_id: z.string().optional().describe("Legacy alias for media_id"),
      action: z.enum(["accept", "decline"]).optional().describe("Legacy alternative to accept"),
    },
    handler: async ({ media_id, accept, invite_id, action }, c) => {
      if (!media_id && !invite_id) throw new Error("media_id is required.");
      if (media_id && invite_id && media_id !== invite_id) throw new Error("media_id and invite_id must match when both are provided.");
      if (accept === undefined && action === undefined) throw new Error("accept or action is required.");
      if (accept !== undefined && action !== undefined && accept !== (action === "accept")) throw new Error("accept and action must agree.");
      return c.ig("POST", `/${c.igUserId}/collaboration_invites`, {
        media_id: media_id || invite_id,
        accept: accept ?? action === "accept",
      });
    },
  });
}
