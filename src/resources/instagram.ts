import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../services/meta-client.js";
import { IG_PROFILE_FIELDS } from "../tools/instagram/profile.js";

export function registerInstagramResources(server: McpServer, client: MetaClient) {
  const read = async (uri: URL, account?: string) => {
    const c = await client.scope(account, "instagram");
    const { data } = await c.ig("GET", `/${c.igUserId}`, { fields: IG_PROFILE_FIELDS });
    return {
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ ...(data as object), _account: c.account.key }, null, 2) }],
    };
  };

  server.resource(
    "instagram-profile",
    "instagram://profile",
    { description: "Profile of the default Instagram account", mimeType: "application/json" },
    async (uri) => read(uri)
  );

  server.resource(
    "instagram-account-profile",
    new ResourceTemplate("instagram://profile/{account}", { list: undefined }),
    { description: "Profile of a specific Instagram account (key, alias, @username or ID)", mimeType: "application/json" },
    async (uri, variables) => read(uri, decodeURIComponent(String(variables.account)))
  );
}
