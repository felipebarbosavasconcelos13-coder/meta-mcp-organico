import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient, ScopedClient } from "../../services/meta-client.js";
import { defineTool } from "../define.js";

const to = z
  .string()
  .regex(/^\+?[\d\s().-]{8,20}$/)
  .describe("Recipient phone number in international format, e.g. +5511999990000");

const replyTo = z.string().optional().describe("WhatsApp message ID (wamid) to quote as a reply");

function recipient(value: string): string {
  return value.replace(/\D/g, "");
}

async function send(c: ScopedClient, toNumber: string, type: string, payload: Record<string, unknown>, contextId?: string) {
  const body: Record<string, unknown> = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: recipient(toNumber),
    type,
    [type]: payload,
  };
  if (contextId) body.context = { message_id: contextId };
  return c.wa("POST", `/${c.waPhoneNumberId}/messages`, body);
}

const WINDOW_NOTE =
  "Free-form messages are delivered only within 24 hours of the customer's last message; outside that window use whatsapp_send_template.";

export function registerWhatsappMessageTools(server: McpServer, client: MetaClient): void {
  defineTool(server, client, {
    name: "whatsapp_send_text",
    description: `Send a WhatsApp text message from the account's number. ${WINDOW_NOTE}`,
    platform: "whatsapp",
    kind: "write",
    errorLabel: "Send WhatsApp text failed",
    schema: {
      to,
      text: z.string().min(1).max(4096).describe("Message text (max 4096 chars)"),
      preview_url: z.boolean().optional().describe("Render a preview for the first URL in the text"),
      reply_to_message_id: replyTo,
    },
    handler: async ({ to: number, text, preview_url, reply_to_message_id }, c) =>
      send(c, number, "text", { body: text, ...(preview_url !== undefined ? { preview_url } : {}) }, reply_to_message_id),
  });

  defineTool(server, client, {
    name: "whatsapp_send_template",
    description:
      "Send an approved WhatsApp message template (works outside the 24-hour window; billed per message by category). Pass components with the template's variables, e.g. [{type:'body', parameters:[{type:'text', text:'Ana'}]}]. List templates with whatsapp_list_templates.",
    platform: "whatsapp",
    kind: "write",
    errorLabel: "Send WhatsApp template failed",
    schema: {
      to,
      template_name: z.string().describe("Approved template name"),
      language: z.string().describe("Template language code, e.g. pt_BR, en_US"),
      components: z.array(z.record(z.string(), z.unknown())).optional().describe("Template components with parameters (header, body, button)"),
      reply_to_message_id: replyTo,
    },
    handler: async ({ to: number, template_name, language, components, reply_to_message_id }, c) =>
      send(c, number, "template", {
        name: template_name,
        language: { code: language },
        ...(components?.length ? { components } : {}),
      }, reply_to_message_id),
  });

  defineTool(server, client, {
    name: "whatsapp_send_media",
    description: `Send an image, video, audio, document or sticker by public link or by media_id (from whatsapp_upload_media). Limits: image 5 MB (JPEG/PNG), video 16 MB (MP4/3GP), audio 16 MB, document 100 MB, sticker WebP 100 KB static / 500 KB animated. ${WINDOW_NOTE}`,
    platform: "whatsapp",
    kind: "write",
    errorLabel: "Send WhatsApp media failed",
    schema: {
      to,
      media_type: z.enum(["image", "video", "audio", "document", "sticker"]).describe("Media type"),
      link: z.string().url().optional().describe("Public HTTPS URL of the file"),
      media_id: z.string().optional().describe("Media ID from whatsapp_upload_media"),
      caption: z.string().max(1024).optional().describe("Caption (image, video, document)"),
      filename: z.string().optional().describe("File name shown for documents"),
      reply_to_message_id: replyTo,
    },
    handler: async ({ to: number, media_type, link, media_id, caption, filename, reply_to_message_id }, c) => {
      if (!link === !media_id) throw new Error("Pass exactly one of link or media_id.");
      if (caption && (media_type === "audio" || media_type === "sticker")) {
        throw new Error(`${media_type} messages do not support a caption.`);
      }
      const payload: Record<string, unknown> = link ? { link } : { id: media_id };
      if (caption) payload.caption = caption;
      if (filename && media_type === "document") payload.filename = filename;
      return send(c, number, media_type, payload, reply_to_message_id);
    },
  });

  defineTool(server, client, {
    name: "whatsapp_send_interactive",
    description: `Send an interactive message: reply buttons (up to 3, titles ≤20 chars), a list (up to 10 rows in total, row titles ≤24 chars), or a call-to-action URL button. ${WINDOW_NOTE}`,
    platform: "whatsapp",
    kind: "write",
    errorLabel: "Send WhatsApp interactive failed",
    schema: {
      to,
      kind: z.enum(["button", "list", "cta_url"]).describe("Interactive message type"),
      body: z.string().min(1).max(1024).describe("Main text"),
      header: z.string().max(60).optional().describe("Optional text header"),
      footer: z.string().max(60).optional().describe("Optional footer"),
      buttons: z.array(z.object({
        id: z.string().max(256),
        title: z.string().max(20),
      })).min(1).max(3).optional().describe("Reply buttons (kind=button)"),
      list_button: z.string().max(20).optional().describe("Text of the button that opens the list (kind=list)"),
      sections: z.array(z.object({
        title: z.string().max(24).optional(),
        rows: z.array(z.object({
          id: z.string().max(200),
          title: z.string().max(24),
          description: z.string().max(72).optional(),
        })).min(1),
      })).min(1).max(10).optional().describe("List sections (kind=list)"),
      cta_text: z.string().max(20).optional().describe("Button text (kind=cta_url)"),
      cta_url: z.string().url().optional().describe("URL opened by the button (kind=cta_url)"),
      reply_to_message_id: replyTo,
    },
    handler: async ({ to: number, kind, body, header, footer, buttons, list_button, sections, cta_text, cta_url, reply_to_message_id }, c) => {
      const interactive: Record<string, unknown> = { type: kind, body: { text: body } };
      if (header) interactive.header = { type: "text", text: header };
      if (footer) interactive.footer = { text: footer };
      if (kind === "button") {
        if (!buttons?.length) throw new Error("buttons is required for kind=button.");
        interactive.action = { buttons: buttons.map((button) => ({ type: "reply", reply: button })) };
      } else if (kind === "list") {
        if (!list_button || !sections?.length) throw new Error("list_button and sections are required for kind=list.");
        const rows = sections.reduce((total, section) => total + section.rows.length, 0);
        if (rows > 10) throw new Error(`A list can have at most 10 rows in total (got ${rows}).`);
        interactive.action = { button: list_button, sections };
      } else {
        if (!cta_text || !cta_url) throw new Error("cta_text and cta_url are required for kind=cta_url.");
        interactive.action = { name: "cta_url", parameters: { display_text: cta_text, url: cta_url } };
      }
      return send(c, number, "interactive", interactive, reply_to_message_id);
    },
  });

  defineTool(server, client, {
    name: "whatsapp_send_location",
    description: `Send a location pin. ${WINDOW_NOTE}`,
    platform: "whatsapp",
    kind: "write",
    errorLabel: "Send WhatsApp location failed",
    schema: {
      to,
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      name: z.string().optional().describe("Place name"),
      address: z.string().optional().describe("Address"),
      reply_to_message_id: replyTo,
    },
    handler: async ({ to: number, latitude, longitude, name, address, reply_to_message_id }, c) =>
      send(c, number, "location", {
        latitude,
        longitude,
        ...(name ? { name } : {}),
        ...(address ? { address } : {}),
      }, reply_to_message_id),
  });

  defineTool(server, client, {
    name: "whatsapp_send_reaction",
    description: "React to a customer's message with an emoji (empty emoji removes the reaction).",
    platform: "whatsapp",
    kind: "write",
    errorLabel: "Send WhatsApp reaction failed",
    schema: {
      to,
      message_id: z.string().describe("WhatsApp message ID (wamid) to react to"),
      emoji: z.string().max(8).describe("Emoji, or empty string to remove the reaction"),
    },
    handler: async ({ to: number, message_id, emoji }, c) => send(c, number, "reaction", { message_id, emoji }),
  });

  defineTool(server, client, {
    name: "whatsapp_mark_as_read",
    description: "Mark a received message (and the earlier ones in the chat) as read; optionally show a typing indicator for up to 25 seconds.",
    platform: "whatsapp",
    kind: "write",
    errorLabel: "Mark WhatsApp message as read failed",
    schema: {
      message_id: z.string().describe("WhatsApp message ID (wamid) received from the customer"),
      typing_indicator: z.boolean().optional().describe("Also show the typing indicator"),
    },
    handler: async ({ message_id, typing_indicator }, c) =>
      c.wa("POST", `/${c.waPhoneNumberId}/messages`, {
        messaging_product: "whatsapp",
        status: "read",
        message_id,
        ...(typing_indicator ? { typing_indicator: { type: "text" } } : {}),
      }),
  });
}
