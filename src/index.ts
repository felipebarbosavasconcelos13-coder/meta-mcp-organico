#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { emptyConfig, loadConfig, MetaConfig } from "./config.js";
import { ClientOptions, MetaClient } from "./services/meta-client.js";

// Meta platform tools
import { registerMetaAuthTools } from "./tools/meta/auth.js";

// Instagram tools
import { registerIgPublishingTools } from "./tools/instagram/publishing.js";
import { registerIgMediaTools } from "./tools/instagram/media.js";
import { registerIgCommentTools } from "./tools/instagram/comments.js";
import { registerIgProfileTools } from "./tools/instagram/profile.js";
import { registerIgHashtagTools } from "./tools/instagram/hashtags.js";
import { registerIgMentionTools } from "./tools/instagram/mentions.js";
import { registerIgMessagingTools } from "./tools/instagram/messaging.js";

// Threads tools
import { registerThreadsPublishingTools } from "./tools/threads/publishing.js";
import { registerThreadsMediaTools } from "./tools/threads/media.js";
import { registerThreadsReplyTools } from "./tools/threads/replies.js";
import { registerThreadsProfileTools } from "./tools/threads/profile.js";
import { registerThreadsInsightTools } from "./tools/threads/insights.js";
import { registerThreadsMentionTools } from "./tools/threads/mentions.js";
import { registerThreadsLocationTools } from "./tools/threads/locations.js";
import { registerThreadsOembedTools } from "./tools/threads/oembed.js";

// WhatsApp tools
import { registerWhatsappMessageTools } from "./tools/whatsapp/messages.js";
import { registerWhatsappMediaTools } from "./tools/whatsapp/media.js";
import { registerWhatsappTemplateTools } from "./tools/whatsapp/templates.js";
import { registerWhatsappAccountTools } from "./tools/whatsapp/account.js";
import { registerWhatsappAnalyticsTools } from "./tools/whatsapp/analytics.js";

// Resources & Prompts
import { registerInstagramResources } from "./resources/instagram.js";
import { registerThreadsResources } from "./resources/threads.js";
import { registerPrompts } from "./prompts/index.js";

const { version } = createRequire(import.meta.url)("../package.json");

/** Build a server with every tool, resource and prompt registered. */
export function createServer(config: MetaConfig = loadConfig(), options: ClientOptions = {}): { server: McpServer; client: MetaClient } {
  const server = new McpServer({ name: "meta-mcp", version });
  const client = new MetaClient(config, options);

  registerMetaAuthTools(server, client);
  registerIgPublishingTools(server, client);
  registerIgMediaTools(server, client);
  registerIgCommentTools(server, client);
  registerIgProfileTools(server, client);
  registerIgHashtagTools(server, client);
  registerIgMentionTools(server, client);
  registerIgMessagingTools(server, client);
  registerThreadsPublishingTools(server, client);
  registerThreadsMediaTools(server, client);
  registerThreadsReplyTools(server, client);
  registerThreadsProfileTools(server, client);
  registerThreadsInsightTools(server, client);
  registerThreadsMentionTools(server, client);
  registerThreadsLocationTools(server, client);
  registerThreadsOembedTools(server, client);
  registerWhatsappMessageTools(server, client);
  registerWhatsappMediaTools(server, client);
  registerWhatsappTemplateTools(server, client);
  registerWhatsappAccountTools(server, client);
  registerWhatsappAnalyticsTools(server, client);
  registerInstagramResources(server, client);
  registerThreadsResources(server, client);
  registerPrompts(server);

  return { server, client };
}

// ── Smithery Sandbox ──
export function createSandboxServer() {
  return createServer(emptyConfig()).server;
}

async function main() {
  const { server } = createServer();
  await server.connect(new StdioServerTransport());
}

function isEntrypoint(): boolean {
  if (!process.argv[1]) return false;
  try {
    // npx/bin links point at a symlink; compare real paths.
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  }
}

if (isEntrypoint()) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
