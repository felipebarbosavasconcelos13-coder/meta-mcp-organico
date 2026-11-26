import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";
import { defineTool } from "../define.js";

export function registerThreadsLocationTools(server: McpServer, client: MetaClient): void {
  defineTool(server, client, {
    name: "threads_search_locations",
    description: "Search for locations to tag in a Threads post, by query text or by coordinates. Provide q, or latitude+longitude, or both.",
    platform: "threads",
    kind: "read",
    errorLabel: "Search locations failed",
    schema: {
      q: z.string().optional().describe("Query text to search for locations by"),
      latitude: z.number().optional().describe("Latitude of a location (must be used with longitude)"),
      longitude: z.number().optional().describe("Longitude of a location (must be used with latitude)"),
    },
    handler: async ({ q, latitude, longitude }, c) => {
      const coords: Record<string, unknown> = {};
      if (latitude !== undefined) coords.latitude = latitude;
      if (longitude !== undefined) coords.longitude = longitude;

      // Meta's own docs disagree on the text parameter name: the location
      // tagging guide's curl example uses `q`, while the location_search
      // reference table lists `query`. Try `q` first and fall back to
      // `query` so the tool works whichever one the API actually accepts.
      const attempts = q ? [{ q }, { query: q }] : [{}];
      let lastError: unknown;
      for (const textParam of attempts) {
        try {
          return await c.threads("GET", "/location_search", { ...textParam, ...coords });
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError;
    },
  });

  defineTool(server, client, {
    name: "threads_get_location",
    description: "Get a Threads location object by ID (from threads_search_locations or a post's location_id field).",
    platform: "threads",
    kind: "read",
    errorLabel: "Get location failed",
    schema: {
      location_id: z.string().describe("Threads location ID"),
    },
    handler: async ({ location_id }, c) =>
      c.threads("GET", `/${location_id}`, { fields: "id,name,address,city,country,latitude,longitude,postal_code" }),
  });
}
