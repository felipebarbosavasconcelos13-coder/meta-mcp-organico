import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";
import { defineTool, withPaging } from "../define.js";

export const THREADS_POST_FIELDS = "id,media_product_type,media_type,media_url,permalink,text,timestamp,shortcode,is_quote_post,has_replies,reply_audience,topic_tag,link_attachment_url,poll_attachment,alt_text,is_verified,profile_picture_url,location_id";

export function registerThreadsMediaTools(server: McpServer, client: MetaClient): void {
  defineTool(server, client, {
    name: "threads_get_posts",
    description: "Get a list of the account's published Threads posts.",
    platform: "threads",
    kind: "read",
    errorLabel: "Get posts failed",
    schema: {
      limit: z.number().optional().describe("Number of results (default 25)"),
      since: z.string().optional().describe("Start date (ISO 8601 or Unix timestamp)"),
      until: z.string().optional().describe("End date (ISO 8601 or Unix timestamp)"),
      after: z.string().optional().describe("Pagination cursor"),
      before: z.string().optional().describe("Pagination cursor"),
    },
    handler: async (paging, c) =>
      c.threads("GET", `/${await c.threadsUserId()}/threads`, withPaging({ fields: THREADS_POST_FIELDS }, paging)),
  });

  defineTool(server, client, {
    name: "threads_get_post",
    description: "Get details of a specific Threads post.",
    platform: "threads",
    kind: "read",
    errorLabel: "Get post failed",
    schema: {
      post_id: z.string().describe("Threads post ID"),
      fields: z.string().optional().describe("Comma-separated fields"),
    },
    handler: async ({ post_id, fields }, c) => c.threads("GET", `/${post_id}`, { fields: fields || THREADS_POST_FIELDS }),
  });

  defineTool(server, client, {
    name: "threads_get_profile_posts",
    description: "Get a public profile's posts by username (Profile Discovery). Requires threads_profile_discovery permission; with standard access, only @meta, @threads, @instagram, and @facebook are queryable.",
    platform: "threads",
    kind: "read",
    errorLabel: "Get profile posts failed",
    schema: {
      username: z.string().describe("Threads username to look up (without @)"),
      limit: z.number().optional().describe("Number of results"),
      since: z.string().optional().describe("Start date (ISO 8601 or Unix timestamp)"),
      until: z.string().optional().describe("End date (ISO 8601 or Unix timestamp)"),
      after: z.string().optional().describe("Pagination cursor"),
    },
    handler: async ({ username, ...paging }, c) =>
      c.threads("GET", "/profile_posts", withPaging({
        username: username.replace(/^@/, ""),
        fields: "id,media_product_type,media_type,media_url,permalink,text,timestamp,shortcode,is_quote_post,has_replies,topic_tag,alt_text,is_verified,profile_picture_url",
      }, paging)),
  });

  defineTool(server, client, {
    name: "threads_search_posts",
    description: "Search for public Threads posts by keyword or topic tag via the /keyword_search endpoint. Results can be filtered by media type, author and date.",
    platform: "threads",
    kind: "read",
    errorLabel: "Search posts failed",
    schema: {
      q: z.string().describe("Search keyword or topic tag to query"),
      search_mode: z.enum(["KEYWORD", "TAG"]).optional().describe("Treat q as a keyword or a topic tag (default: KEYWORD)"),
      search_type: z.enum(["TOP", "RECENT"]).optional().describe("Return most popular or most recent results (default: TOP)"),
      media_type: z.enum(["TEXT", "IMAGE", "VIDEO"]).optional().describe("Filter results by media type"),
      author_username: z.string().optional().describe("Filter results to an exact author username (no @)"),
      since: z.string().optional().describe("Start date (Unix timestamp, must be >= 1688540400)"),
      until: z.string().optional().describe("End date (Unix timestamp)"),
      limit: z.number().optional().describe("Number of results (default 25, max 100)"),
    },
    handler: async ({ q, search_mode, search_type, media_type, author_username, ...paging }, c) => {
      const params = withPaging({
        q,
        fields: "id,text,username,permalink,timestamp,media_type,media_url,topic_tag,has_replies,is_quote_post,is_reply",
      }, paging);
      if (search_mode) params.search_mode = search_mode;
      if (search_type) params.search_type = search_type;
      if (media_type) params.media_type = media_type;
      if (author_username) params.author_username = author_username.replace(/^@/, "");
      return c.threads("GET", "/keyword_search", params);
    },
  });
}
