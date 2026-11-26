import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";
import { defineTool, withPaging } from "../define.js";

export function registerIgCommentTools(server: McpServer, client: MetaClient): void {
  defineTool(server, client, {
    name: "ig_get_comments",
    description: "Get comments on a specific Instagram media post.",
    platform: "instagram",
    kind: "read",
    errorLabel: "Get comments failed",
    schema: {
      media_id: z.string().describe("Media ID"),
      limit: z.number().optional().describe("Number of comments to return"),
      after: z.string().optional().describe("Pagination cursor"),
    },
    handler: async ({ media_id, ...paging }, c) =>
      c.ig("GET", `/${media_id}/comments`, withPaging({
        fields: "id,text,username,timestamp,like_count,hidden,from,replies{id,text,username,timestamp}",
      }, paging)),
  });

  defineTool(server, client, {
    name: "ig_get_comment",
    description: "Get details of a specific comment.",
    platform: "instagram",
    kind: "read",
    errorLabel: "Get comment failed",
    schema: {
      comment_id: z.string().describe("Comment ID"),
    },
    handler: async ({ comment_id }, c) =>
      c.ig("GET", `/${comment_id}`, { fields: "id,text,username,timestamp,like_count,hidden,parent_id,from,media" }),
  });

  defineTool(server, client, {
    name: "ig_post_comment",
    description: "Post a top-level comment on a media post as the account.",
    platform: "instagram",
    kind: "write",
    errorLabel: "Post comment failed",
    schema: {
      media_id: z.string().describe("Media ID to comment on"),
      message: z.string().describe("Comment text"),
    },
    handler: async ({ media_id, message }, c) => c.ig("POST", `/${media_id}/comments`, { message }),
  });

  defineTool(server, client, {
    name: "ig_get_replies",
    description: "Get replies to a specific comment.",
    platform: "instagram",
    kind: "read",
    errorLabel: "Get replies failed",
    schema: {
      comment_id: z.string().describe("Comment ID to get replies for"),
      limit: z.number().optional().describe("Number of replies to return"),
      after: z.string().optional().describe("Pagination cursor"),
    },
    handler: async ({ comment_id, ...paging }, c) =>
      c.ig("GET", `/${comment_id}/replies`, withPaging({ fields: "id,text,username,timestamp,like_count" }, paging)),
  });

  defineTool(server, client, {
    name: "ig_reply_to_comment",
    description: "Reply publicly to a specific comment. To answer privately in the DM inbox, use ig_private_reply.",
    platform: "instagram",
    kind: "write",
    errorLabel: "Reply failed",
    schema: {
      comment_id: z.string().describe("Comment ID to reply to"),
      message: z.string().describe("Reply text"),
    },
    handler: async ({ comment_id, message }, c) => c.ig("POST", `/${comment_id}/replies`, { message }),
  });

  defineTool(server, client, {
    name: "ig_hide_comment",
    description: "Hide or unhide a comment on your post.",
    platform: "instagram",
    kind: "destructive",
    errorLabel: "Hide comment failed",
    schema: {
      comment_id: z.string().describe("Comment ID"),
      hide: z.boolean().describe("true to hide, false to unhide"),
    },
    handler: async ({ comment_id, hide }, c) => {
      const { data, rateLimit } = await c.ig("POST", `/${comment_id}`, { hide });
      return { data: { success: true, hidden: hide, ...(data as object) }, rateLimit };
    },
  });

  defineTool(server, client, {
    name: "ig_delete_comment",
    description: "Delete a comment from your media post. This action is irreversible.",
    platform: "instagram",
    kind: "destructive",
    errorLabel: "Delete comment failed",
    schema: {
      comment_id: z.string().describe("Comment ID to delete"),
    },
    handler: async ({ comment_id }, c) => {
      const { data, rateLimit } = await c.ig("DELETE", `/${comment_id}`);
      return { data: { success: true, ...(data as object) }, rateLimit };
    },
  });

  defineTool(server, client, {
    name: "ig_like",
    description: "Like a media post or comment as the account (Instagram engagement API, April 2026). Requires instagram_manage_engagement.",
    platform: "instagram",
    kind: "write",
    errorLabel: "Like failed",
    schema: {
      target_id: z.string().describe("Media ID or comment ID to like"),
    },
    handler: async ({ target_id }, c) => c.ig("POST", `/${c.igUserId}/likes`, { target_id }),
  });

  defineTool(server, client, {
    name: "ig_unlike",
    description: "Remove the account's like from a media post or comment. Requires instagram_manage_engagement.",
    platform: "instagram",
    kind: "destructive",
    errorLabel: "Unlike failed",
    schema: {
      target_id: z.string().describe("Media ID or comment ID to unlike"),
    },
    handler: async ({ target_id }, c) => c.ig("DELETE", `/${c.igUserId}/likes`, { target_id }),
  });
}
