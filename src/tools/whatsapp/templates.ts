import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";
import { defineTool, withPaging } from "../define.js";

const TEMPLATE_FIELDS = "id,name,status,category,language,components,quality_score,rejected_reason,parameter_format";

export function registerWhatsappTemplateTools(server: McpServer, client: MetaClient): void {
  defineTool(server, client, {
    name: "whatsapp_list_templates",
    description: "List the message templates of the account's WhatsApp Business Account with status (APPROVED, PENDING, REJECTED, PAUSED…), category, language and quality. name/status filter the returned page.",
    platform: "whatsapp",
    kind: "read",
    errorLabel: "List WhatsApp templates failed",
    schema: {
      name: z.string().optional().describe("Only templates whose name contains this text"),
      status: z.string().optional().describe("Only templates with this status, e.g. APPROVED"),
      limit: z.number().max(250).optional().describe("Page size (default 100)"),
      after: z.string().optional().describe("Pagination cursor"),
    },
    handler: async ({ name, status, limit, after }, c) => {
      const { data, rateLimit } = await c.wa("GET", `/${c.wabaId}/message_templates`, withPaging({ fields: TEMPLATE_FIELDS }, { limit: limit ?? 100, after }));
      const body = data as { data?: Array<{ name?: string; status?: string }> };
      if ((name || status) && Array.isArray(body.data)) {
        body.data = body.data.filter(
          (template) =>
            (!name || template.name?.toLowerCase().includes(name.toLowerCase())) &&
            (!status || template.status?.toUpperCase() === status.toUpperCase())
        );
      }
      return { data: body, rateLimit };
    },
  });

  defineTool(server, client, {
    name: "whatsapp_get_template",
    description: "Get one message template by its ID.",
    platform: "whatsapp",
    kind: "read",
    errorLabel: "Get WhatsApp template failed",
    schema: {
      template_id: z.string().describe("Template ID"),
    },
    handler: async ({ template_id }, c) => c.wa("GET", `/${template_id}`, { fields: TEMPLATE_FIELDS }),
  });

  defineTool(server, client, {
    name: "whatsapp_create_template",
    description:
      "Submit a new message template for Meta review (status starts as PENDING). name: lowercase letters, numbers and underscores. Components follow the Cloud API format, e.g. [{type:'BODY', text:'Olá {{1}}, sua consulta é amanhã.', example:{body_text:[['Ana']]}}]. Limit 100 creations per hour.",
    platform: "whatsapp",
    kind: "write",
    errorLabel: "Create WhatsApp template failed",
    schema: {
      name: z.string().regex(/^[a-z0-9_]{1,512}$/).describe("Template name (lowercase, digits, underscores)"),
      language: z.string().describe("Language code, e.g. pt_BR"),
      category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]).describe("Template category (affects price and review)"),
      components: z.array(z.record(z.string(), z.unknown())).min(1).describe("HEADER/BODY/FOOTER/BUTTONS components"),
      parameter_format: z.enum(["POSITIONAL", "NAMED"]).optional().describe("Variable style: {{1}} (default) or {{name}}"),
      allow_category_change: z.boolean().optional().describe("Let Meta recategorize instead of rejecting"),
    },
    handler: async ({ name, language, category, components, parameter_format, allow_category_change }, c) => {
      const body: Record<string, unknown> = { name, language, category, components };
      if (parameter_format) body.parameter_format = parameter_format;
      if (allow_category_change !== undefined) body.allow_category_change = allow_category_change;
      return c.wa("POST", `/${c.wabaId}/message_templates`, body);
    },
  });

  defineTool(server, client, {
    name: "whatsapp_delete_template",
    description: "Delete a message template. With only name, every language of that template is deleted; pass template_id too to delete just one language. Irreversible, and the name cannot be reused for 30 days.",
    platform: "whatsapp",
    kind: "destructive",
    errorLabel: "Delete WhatsApp template failed",
    schema: {
      name: z.string().describe("Template name"),
      template_id: z.string().optional().describe("Template ID (hsm_id) to delete a single language"),
    },
    handler: async ({ name, template_id }, c) =>
      c.wa("DELETE", `/${c.wabaId}/message_templates`, { name, ...(template_id ? { hsm_id: template_id } : {}) }),
  });
}
