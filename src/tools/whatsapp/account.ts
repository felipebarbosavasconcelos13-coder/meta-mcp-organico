import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";
import { defineTool } from "../define.js";

const PROFILE_FIELDS = "about,address,description,email,profile_picture_url,websites,vertical";

export function registerWhatsappAccountTools(server: McpServer, client: MetaClient): void {
  defineTool(server, client, {
    name: "whatsapp_list_phone_numbers",
    description: "List the phone numbers of the account's WhatsApp Business Account with verified name, quality rating (GREEN/YELLOW/RED), name status and connection status.",
    platform: "whatsapp",
    kind: "read",
    errorLabel: "List WhatsApp phone numbers failed",
    schema: {},
    handler: async (_args, c) =>
      c.wa("GET", `/${c.wabaId}/phone_numbers`, {
        fields: "id,display_phone_number,verified_name,quality_rating,code_verification_status,name_status,status,throughput",
      }),
  });

  defineTool(server, client, {
    name: "whatsapp_get_business_profile",
    description: "Get the WhatsApp business profile (about, address, description, email, websites, vertical, photo) of the account's number.",
    platform: "whatsapp",
    kind: "read",
    errorLabel: "Get WhatsApp business profile failed",
    schema: {},
    handler: async (_args, c) => c.wa("GET", `/${c.waPhoneNumberId}/whatsapp_business_profile`, { fields: PROFILE_FIELDS }),
  });

  defineTool(server, client, {
    name: "whatsapp_update_business_profile",
    description: "Update the WhatsApp business profile of the account's number. Only the fields passed change.",
    platform: "whatsapp",
    kind: "write",
    errorLabel: "Update WhatsApp business profile failed",
    schema: {
      about: z.string().max(139).optional().describe("Short 'About' text"),
      address: z.string().max(256).optional(),
      description: z.string().max(512).optional(),
      email: z.string().email().max(128).optional(),
      websites: z.array(z.string().url()).max(2).optional().describe("Up to 2 websites"),
      vertical: z.string().optional().describe("Business category, e.g. RETAIL, HEALTH, BEAUTY, PROF_SERVICES"),
    },
    handler: async (fields, c) => {
      const body = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
      if (Object.keys(body).length === 0) throw new Error("Pass at least one field to update.");
      return c.wa("POST", `/${c.waPhoneNumberId}/whatsapp_business_profile`, { messaging_product: "whatsapp", ...body });
    },
  });
}
