import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";
import { defineTool } from "../define.js";

/** Accept Unix seconds or a date (YYYY-MM-DD / ISO 8601) and return Unix seconds. */
export function toUnix(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`Invalid date: ${value}`);
  return Math.floor(ms / 1000);
}

const dateParam = (label: string) => z.string().describe(`${label} (Unix timestamp or YYYY-MM-DD)`);

export function registerWhatsappAnalyticsTools(server: McpServer, client: MetaClient): void {
  defineTool(server, client, {
    name: "whatsapp_get_messaging_analytics",
    description:
      "Messaging analytics for the account's WhatsApp Business Account. kind=messages: messages sent and delivered (granularity HALF_HOUR, DAY, MONTH). kind=pricing: volume and cost per pricing category (MARKETING, UTILITY, AUTHENTICATION, SERVICE…), the source of truth for spend since per-message pricing (granularity HALF_HOUR, DAILY, MONTHLY). Conversation analytics were retired by Meta on 2026-11-01. Lookback is 1 year.",
    platform: "whatsapp",
    kind: "read",
    errorLabel: "Get WhatsApp analytics failed",
    schema: {
      kind: z.enum(["messages", "pricing"]).describe("messages (sent/delivered) or pricing (volume and cost)"),
      start: dateParam("Start"),
      end: dateParam("End"),
      granularity: z.enum(["HALF_HOUR", "DAY", "MONTH", "DAILY", "MONTHLY"]).optional().describe("Default DAY (messages) / DAILY (pricing)"),
      only_this_number: z.boolean().optional().describe("Restrict to the account's phone number instead of the whole WABA"),
      country_codes: z.array(z.string().length(2)).optional().describe("ISO country codes to include"),
      dimensions: z.array(z.enum(["COUNTRY", "PHONE", "PRICING_CATEGORY", "PRICING_TYPE", "TIER"])).optional().describe("kind=pricing: group results by these dimensions (default PRICING_CATEGORY)"),
    },
    handler: async ({ kind, start, end, granularity, only_this_number, country_codes, dimensions }, c) => {
      const map: Record<string, string> = kind === "messages"
        ? { DAILY: "DAY", MONTHLY: "MONTH" }
        : { DAY: "DAILY", MONTH: "MONTHLY" };
      const g = granularity ? map[granularity] ?? granularity : kind === "messages" ? "DAY" : "DAILY";
      const parts = [`${kind === "messages" ? "analytics" : "pricing_analytics"}.start(${toUnix(start)}).end(${toUnix(end)}).granularity(${g})`];
      if (only_this_number) {
        const digits = (c.record.whatsapp?.displayNumber || "").replace(/\D/g, "");
        if (!digits) throw new Error("The account's display number is unknown; omit only_this_number.");
        parts.push(`phone_numbers(["${digits}"])`);
      }
      // Meta's examples: analytics takes JSON arrays, pricing_analytics takes bare comma lists.
      const listArg = (values: string[]) => (kind === "messages" ? JSON.stringify(values) : values.join(","));
      if (country_codes?.length) parts.push(`country_codes(${listArg(country_codes.map((code) => code.toUpperCase()))})`);
      if (kind === "pricing") parts.push(`dimensions(${listArg(dimensions?.length ? dimensions : ["PRICING_CATEGORY"])})`);
      return c.wa("GET", `/${c.wabaId}`, { fields: parts.join(".") });
    },
  });

  defineTool(server, client, {
    name: "whatsapp_get_template_analytics",
    description:
      "Daily performance of up to 10 templates: sent, delivered, read, clicked (marketing/utility) and cost. Lookback 90 days. Template insights must be enabled once on the WABA (whatsapp_enable_template_insights).",
    platform: "whatsapp",
    kind: "read",
    errorLabel: "Get WhatsApp template analytics failed",
    schema: {
      template_ids: z.array(z.string()).min(1).max(10).describe("Template IDs (from whatsapp_list_templates)"),
      start: dateParam("Start"),
      end: dateParam("End"),
      metric_types: z.array(z.enum(["SENT", "DELIVERED", "READ", "CLICKED", "COST"])).optional().describe("Default: all"),
    },
    handler: async ({ template_ids, start, end, metric_types }, c) =>
      c.wa("GET", `/${c.wabaId}/template_analytics`, {
        start: toUnix(start),
        end: toUnix(end),
        granularity: "DAILY",
        template_ids,
        metric_types: metric_types?.length ? metric_types : ["SENT", "DELIVERED", "READ", "CLICKED", "COST"],
      }),
  });

  defineTool(server, client, {
    name: "whatsapp_enable_template_insights",
    description: "Turn on template analytics for the account's WhatsApp Business Account. Meta does not allow turning it off again.",
    platform: "whatsapp",
    kind: "write",
    errorLabel: "Enable WhatsApp template insights failed",
    schema: {},
    handler: async (_args, c) => c.wa("POST", `/${c.wabaId}`, { is_enabled_for_insights: true }),
  });
}
