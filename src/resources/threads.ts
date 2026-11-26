import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../services/meta-client.js";
import { THREADS_PROFILE_FIELDS } from "../tools/threads/profile.js";

export function registerThreadsResources(server: McpServer, client: MetaClient) {
  const read = async (uri: URL, account?: string) => {
    const c = await client.scope(account, "threads");
    const { data } = await c.threads("GET", `/${await c.threadsUserId()}`, { fields: THREADS_PROFILE_FIELDS });
    return {
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ ...(data as object), _account: c.account.key }, null, 2) }],
    };
  };

  server.resource(
    "threads-profile",
    "threads://profile",
    { description: "Profile of the default Threads account", mimeType: "application/json" },
    async (uri) => read(uri)
  );

  server.resource(
    "threads-account-profile",
    new ResourceTemplate("threads://profile/{account}", { list: undefined }),
    { description: "Profile of a specific Threads account (key, alias or @username)", mimeType: "application/json" },
    async (uri, variables) => read(uri, decodeURIComponent(String(variables.account)))
  );
}
