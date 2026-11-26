import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";
import {
  buildInstagramConversationParams,
  buildInstagramMessageBody,
} from "../../services/api-contracts.js";
import { defineTool, withPaging } from "../define.js";

const MESSAGING_REQUIREMENTS =
  "Uses Instagram Messaging with Facebook Login: the account's Page access token (discovered or configured), instagram_manage_messages, and the MESSAGE task on the Page.";

export function registerIgMessagingTools(server: McpServer, client: MetaClient): void {
  defineTool(server, client, {
    name: "ig_get_conversations",
    description: `Get Instagram DM conversations of the account. ${MESSAGING_REQUIREMENTS}`,
    platform: "instagram",
    kind: "read",
    errorLabel: "Get conversations failed",
    schema: {
      folder: z.enum(["inbox", "spam"]).optional().describe("Folder to retrieve (default: inbox)"),
      limit: z.number().optional().describe("Number of conversations"),
      after: z.string().optional().describe("Pagination cursor"),
    },
    handler: async ({ folder, limit, after }, c) =>
      c.igMessaging("GET", `/${c.instagramPageId}/conversations`, buildInstagramConversationParams(folder, limit, after)),
  });

  defineTool(server, client, {
    name: "ig_get_messages",
    description: "Get messages in a specific DM conversation.",
    platform: "instagram",
    kind: "read",
    errorLabel: "Get messages failed",
    schema: {
      conversation_id: z.string().describe("Conversation ID"),
      limit: z.number().optional().describe("Number of messages"),
      after: z.string().optional().describe("Pagination cursor"),
    },
    handler: async ({ conversation_id, ...paging }, c) =>
      c.igMessaging("GET", `/${conversation_id}/messages`, withPaging({ fields: "id,message,from,to,created_time,attachments" }, paging)),
  });

  defineTool(server, client, {
    name: "ig_get_message",
    description: "Get details of a specific DM message.",
    platform: "instagram",
    kind: "read",
    errorLabel: "Get message failed",
    schema: {
      message_id: z.string().describe("Message ID"),
    },
    handler: async ({ message_id }, c) =>
      c.igMessaging("GET", `/${message_id}`, { fields: "id,message,from,to,created_time,attachments" }),
  });

  defineTool(server, client, {
    name: "ig_send_message",
    description: `Send an Instagram DM: text (optionally with quick replies or as a reply to a message) or one attachment (image, video, audio or file, by public URL or attachment_id). The recipient must have messaged the account within 24 hours; set human_agent=true to answer up to 7 days later with the HUMAN_AGENT tag (needs that permission). ${MESSAGING_REQUIREMENTS}`,
    platform: "instagram",
    kind: "write",
    errorLabel: "Send message failed",
    schema: {
      recipient_id: z.string().describe("Instagram-scoped user ID of the recipient"),
      message: z.string().max(1000).optional().describe("Message text"),
      attachment: z.object({
        type: z.enum(["image", "video", "audio", "file"]),
        url: z.string().url().optional().describe("Public URL of the file"),
        attachment_id: z.string().optional().describe("ID from the Attachment Upload API"),
      }).optional().describe("Send one attachment instead of text"),
      quick_replies: z.array(z.object({
        title: z.string().max(20),
        payload: z.string().max(1000),
      })).max(13).optional().describe("Quick reply buttons (text messages only)"),
      reply_to_message_id: z.string().optional().describe("Message ID (mid) this message replies to"),
      human_agent: z.boolean().optional().describe("Use the HUMAN_AGENT tag (reply within 7 days instead of 24h)"),
    },
    handler: async ({ recipient_id, message, attachment, quick_replies, reply_to_message_id, human_agent }, c) =>
      c.igMessaging("POST", `/${c.instagramPageId}/messages`, buildInstagramMessageBody(recipient_id, message, {
        attachment,
        quickReplies: quick_replies,
        replyToMessageId: reply_to_message_id,
        humanAgent: human_agent,
      })),
  });

  defineTool(server, client, {
    name: "ig_private_reply",
    description: `Reply privately (in the DM inbox) to someone who commented on the account's post or reel. One private reply per comment, within 7 days of the comment. ${MESSAGING_REQUIREMENTS}`,
    platform: "instagram",
    kind: "write",
    errorLabel: "Private reply failed",
    schema: {
      comment_id: z.string().describe("Comment ID to reply to privately"),
      message: z.string().max(1000).describe("Message text"),
    },
    handler: async ({ comment_id, message }, c) =>
      c.igMessaging("POST", `/${c.instagramPageId}/messages`, buildInstagramMessageBody("", message, {
        recipientCommentId: comment_id,
      })),
  });

  defineTool(server, client, {
    name: "ig_send_reaction",
    description: "React to (or remove the reaction from) a message in an Instagram DM conversation.",
    platform: "instagram",
    kind: "write",
    errorLabel: "Send reaction failed",
    schema: {
      recipient_id: z.string().describe("Instagram-scoped user ID of the conversation participant"),
      message_id: z.string().describe("Message ID (mid) to react to"),
      action: z.enum(["react", "unreact"]).default("react").describe("Add or remove the reaction"),
      reaction: z.string().default("love").describe("Reaction type (Instagram supports love)"),
    },
    handler: async ({ recipient_id, message_id, action, reaction }, c) =>
      c.igMessaging("POST", `/${c.instagramPageId}/messages`, {
        recipient: { id: recipient_id },
        sender_action: action,
        payload: action === "react" ? { message_id, reaction } : { message_id },
      }),
  });

  defineTool(server, client, {
    name: "ig_sender_action",
    description: "Show a typing indicator or mark the conversation as seen in an Instagram DM.",
    platform: "instagram",
    kind: "write",
    errorLabel: "Sender action failed",
    schema: {
      recipient_id: z.string().describe("Instagram-scoped user ID of the conversation participant"),
      action: z.enum(["typing_on", "typing_off", "mark_seen"]).describe("Sender action"),
    },
    handler: async ({ recipient_id, action }, c) =>
      c.igMessaging("POST", `/${c.instagramPageId}/messages`, {
        recipient: { id: recipient_id },
        sender_action: action,
      }),
  });
}
