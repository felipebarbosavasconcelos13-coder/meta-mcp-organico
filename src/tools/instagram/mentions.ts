import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";
import { defineTool, withPaging } from "../define.js";

export function registerIgMentionTools(server: McpServer, client: MetaClient): void {
  defineTool(server, client, {
    name: "ig_get_mentioned_comments",
    description: "Get a comment where the account was @mentioned (comment ID from a mention webhook). Returns the media and comment details.",
    platform: "instagram",
    kind: "read",
    errorLabel: "Get mentioned comments failed",
    schema: {
      comment_id: z.string().regex(/^\d+$/).describe("Comment ID from a mention notification"),
      fields: z.string().optional().describe("Mentioned comment fields (default: id,text,timestamp,media{id,media_url,media_type})"),
    },
    handler: async ({ comment_id, fields }, c) =>
      c.ig("GET", `/${c.igUserId}`, {
        fields: `mentioned_comment.comment_id(${comment_id}){${fields || "id,text,timestamp,media{id,media_url,media_type}"}}`,
      }),
  });

  defineTool(server, client, {
    name: "ig_get_mentioned_media",
    description: "Get a media post whose caption @mentions the account (media ID from a mention webhook).",
    platform: "instagram",
    kind: "read",
    errorLabel: "Get mentioned media failed",
    schema: {
      media_id: z.string().regex(/^\d+$/).describe("Media ID from a mention notification"),
      fields: z.string().optional().describe("Mentioned media fields (default: id,caption,media_type,media_url,permalink,timestamp,username,comments_count,like_count)"),
    },
    handler: async ({ media_id, fields }, c) =>
      c.ig("GET", `/${c.igUserId}`, {
        fields: `mentioned_media.media_id(${media_id}){${fields || "id,caption,media_type,media_url,permalink,timestamp,username,comments_count,like_count"}}`,
      }),
  });

  defineTool(server, client, {
    name: "ig_reply_to_mention",
    description: "Comment on a post (or reply to a comment) where the account was @mentioned. Pass media_id alone to comment on the mentioning post, or media_id + comment_id to reply to a mentioning comment. Not available for story mentions.",
    platform: "instagram",
    kind: "write",
    errorLabel: "Reply to mention failed",
    schema: {
      media_id: z.string().regex(/^\d+$/).describe("Media ID where the mention happened"),
      comment_id: z.string().regex(/^\d+$/).optional().describe("Comment ID, when the mention is in a comment"),
      message: z.string().describe("Reply text"),
    },
    handler: async ({ media_id, comment_id, message }, c) => {
      const params: Record<string, unknown> = { media_id, message };
      if (comment_id) params.comment_id = comment_id;
      return c.ig("POST", `/${c.igUserId}/mentions`, params);
    },
  });

  defineTool(server, client, {
    name: "ig_get_tagged_media",
    description: "Get media where the account is tagged (photo tags, not @mentions).",
    platform: "instagram",
    kind: "read",
    errorLabel: "Get tagged media failed",
    schema: {
      limit: z.number().optional().describe("Number of results"),
      after: z.string().optional().describe("Pagination cursor"),
    },
    handler: async (paging, c) =>
      c.ig("GET", `/${c.igUserId}/tags`, withPaging({ fields: "id,caption,media_type,media_url,permalink,timestamp,username" }, paging)),
  });
}
