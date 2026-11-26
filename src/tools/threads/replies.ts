import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";
import { createAndPublishThreads } from "../../services/publishing.js";
import { defineTool, withPaging } from "../define.js";

const REPLY_FIELDS = "id,text,username,permalink,timestamp,media_type,media_url,has_replies,hide_status,root_post,replied_to,is_reply,reply_audience,topic_tag,is_verified,profile_picture_url";

export function registerThreadsReplyTools(server: McpServer, client: MetaClient): void {
  defineTool(server, client, {
    name: "threads_get_replies",
    description: "Get top-level replies to a specific Threads post.",
    platform: "threads",
    kind: "read",
    errorLabel: "Get replies failed",
    schema: {
      post_id: z.string().describe("Threads post ID to get replies for"),
      reverse: z.boolean().optional().describe("Reverse chronological order"),
      limit: z.number().optional().describe("Number of replies"),
      after: z.string().optional().describe("Pagination cursor"),
    },
    handler: async ({ post_id, reverse, ...paging }, c) => {
      const params = withPaging({ fields: REPLY_FIELDS }, paging);
      if (reverse !== undefined) params.reverse = reverse;
      return c.threads("GET", `/${post_id}/replies`, params);
    },
  });

  defineTool(server, client, {
    name: "threads_get_conversation",
    description: "Get a flattened list of all replies (top-level and nested) to a Threads post, in chronological or reverse-chronological order.",
    platform: "threads",
    kind: "read",
    errorLabel: "Get conversation failed",
    schema: {
      post_id: z.string().describe("Root Threads post ID to get the conversation for"),
      reverse: z.boolean().optional().describe("Reverse chronological order (default true)"),
      limit: z.number().optional().describe("Number of replies"),
      after: z.string().optional().describe("Pagination cursor"),
    },
    handler: async ({ post_id, reverse, ...paging }, c) => {
      const params = withPaging({ fields: REPLY_FIELDS }, paging);
      if (reverse !== undefined) params.reverse = reverse;
      return c.threads("GET", `/${post_id}/conversation`, params);
    },
  });

  defineTool(server, client, {
    name: "threads_reply",
    description: "Reply to a Threads post or another reply as the account. Waits until the reply container is ready (text included) before publishing.",
    platform: "threads",
    kind: "write",
    errorLabel: "Reply failed",
    schema: {
      reply_to_id: z.string().describe("Post ID to reply to"),
      text: z.string().max(500).describe("Reply text"),
      image_url: z.string().url().optional().describe("Optional image URL to attach"),
      video_url: z.string().url().optional().describe("Optional video URL to attach"),
    },
    handler: async ({ reply_to_id, text, image_url, video_url }, c) => {
      if (image_url && video_url) {
        throw new Error("A reply can include either image_url or video_url, not both.");
      }
      const params: Record<string, unknown> = {
        media_type: image_url ? "IMAGE" : video_url ? "VIDEO" : "TEXT",
        text,
        reply_to_id,
      };
      if (image_url) params.image_url = image_url;
      if (video_url) params.video_url = video_url;
      return createAndPublishThreads(c, params);
    },
  });

  for (const [name, hide, description, errorLabel] of [
    ["threads_hide_reply", true, "Hide a reply on your Threads post. Hidden replies are still visible if directly accessed.", "Hide reply failed"],
    ["threads_unhide_reply", false, "Unhide a previously hidden reply on your Threads post.", "Unhide reply failed"],
  ] as const) {
    defineTool(server, client, {
      name,
      description,
      platform: "threads",
      kind: "destructive",
      errorLabel,
      schema: {
        reply_id: z.string().describe(hide ? "Reply ID to hide" : "Reply ID to unhide"),
      },
      handler: async ({ reply_id }, c) => {
        const { data, rateLimit } = await c.threads("POST", `/${reply_id}/manage_reply`, { hide });
        return { data: { success: true, hidden: hide, ...(data as object) }, rateLimit };
      },
    });
  }

  defineTool(server, client, {
    name: "threads_get_pending_replies",
    description: "Get pending/ignored replies awaiting approval on a post that has reply approvals enabled (enable_reply_approvals).",
    platform: "threads",
    kind: "read",
    errorLabel: "Get pending replies failed",
    schema: {
      post_id: z.string().describe("Threads post ID with reply approvals enabled"),
      approval_status: z.enum(["pending", "ignored"]).optional().describe("Filter by approval status (default: all)"),
      reverse: z.boolean().optional().describe("Reverse chronological order (default true)"),
    },
    handler: async ({ post_id, approval_status, reverse }, c) => {
      const params: Record<string, unknown> = {
        fields: "id,text,topic_tag,timestamp,media_product_type,media_type,media_url,shortcode,thumbnail_url,children,has_replies,root_post,replied_to,is_reply,hide_status,reply_approval_status",
      };
      if (approval_status) params.approval_status = approval_status;
      if (reverse !== undefined) params.reverse = reverse;
      return c.threads("GET", `/${post_id}/pending_replies`, params);
    },
  });

  defineTool(server, client, {
    name: "threads_manage_pending_reply",
    description: "Approve or ignore a pending reply on a post with reply approvals enabled. Ignored replies can still be approved later.",
    platform: "threads",
    kind: "write",
    errorLabel: "Manage pending reply failed",
    schema: {
      reply_id: z.string().describe("Pending reply ID"),
      approve: z.boolean().describe("true to approve and publish the reply, false to ignore it"),
    },
    handler: async ({ reply_id, approve }, c) => c.threads("POST", `/${reply_id}/manage_pending_reply`, { approve }),
  });
}
