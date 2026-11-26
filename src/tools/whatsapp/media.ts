import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";
import { defineTool } from "../define.js";

const MAX_BYTES: Record<string, number> = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  application: 100 * 1024 * 1024,
  text: 100 * 1024 * 1024,
};

export function registerWhatsappMediaTools(server: McpServer, client: MetaClient): void {
  defineTool(server, client, {
    name: "whatsapp_upload_media",
    description: "Download a file from a public URL and upload it to WhatsApp for the account's number. Returns a media_id (valid 30 days) for whatsapp_send_media or template headers.",
    platform: "whatsapp",
    kind: "write",
    errorLabel: "Upload WhatsApp media failed",
    schema: {
      url: z.string().url().describe("Public HTTPS URL of the file"),
      mime_type: z.string().optional().describe("Override the MIME type (default: from the download's Content-Type)"),
      filename: z.string().optional().describe("File name (default: from the URL)"),
    },
    handler: async ({ url, mime_type, filename }, c) => {
      const file = await c.download(url);
      const type = mime_type || file.contentType;
      const limit = MAX_BYTES[type.split("/")[0]];
      if (limit && file.blob.size > limit) {
        throw new Error(`File is ${(file.blob.size / 1024 / 1024).toFixed(1)} MB; WhatsApp allows ${(limit / 1024 / 1024).toFixed(0)} MB for ${type}.`);
      }
      const form = new FormData();
      form.append("messaging_product", "whatsapp");
      form.append("type", type);
      form.append("file", new Blob([await file.blob.arrayBuffer()], { type }), filename || file.filename);
      const { data, rateLimit } = await c.waUpload(`/${c.waPhoneNumberId}/media`, form);
      return { data: { ...(data as object), mime_type: type, size_bytes: file.blob.size }, rateLimit };
    },
  });

  defineTool(server, client, {
    name: "whatsapp_get_media",
    description: "Get a media object's metadata and a download URL (valid for 5 minutes, needs the WhatsApp token to download).",
    platform: "whatsapp",
    kind: "read",
    errorLabel: "Get WhatsApp media failed",
    schema: {
      media_id: z.string().describe("Media ID (from an upload or a received message)"),
    },
    handler: async ({ media_id }, c) => c.wa("GET", `/${media_id}`, { phone_number_id: c.waPhoneNumberId }),
  });

  defineTool(server, client, {
    name: "whatsapp_delete_media",
    description: "Delete an uploaded media object. Irreversible.",
    platform: "whatsapp",
    kind: "destructive",
    errorLabel: "Delete WhatsApp media failed",
    schema: {
      media_id: z.string().describe("Media ID to delete"),
    },
    handler: async ({ media_id }, c) => c.wa("DELETE", `/${media_id}`, { phone_number_id: c.waPhoneNumberId }),
  });
}
