import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";
import { buildInstagramStoryParams } from "../../services/api-contracts.js";
import {
  createAndPublishIg,
  createIgContainer,
  publishIgContainer,
  waitForIgContainer,
} from "../../services/publishing.js";
import { defineTool } from "../define.js";

const disclosureOptions = {
  is_ai_generated: z.boolean().optional().describe("Apply the AI info label to the published media"),
  is_paid_partnership: z.boolean().optional().describe("Apply the Paid partnership label"),
  branded_content_sponsor_ids: z.array(z.string()).max(2).optional().describe("Instagram user IDs of up to two brand partners"),
};

const collaborators = z
  .array(z.string().regex(/^[A-Za-z0-9._]+$/))
  .max(3)
  .optional()
  .describe("Up to 3 Instagram usernames (without @) invited as collaborators (feed posts, reels and carousels; not stories)");

const userTag = z.object({
  username: z.string().regex(/^[A-Za-z0-9._]+$/),
  x: z.number().min(0).max(1).optional(),
  y: z.number().min(0).max(1).optional(),
});

const userTags = z
  .union([z.string(), z.array(userTag)])
  .optional()
  .describe("Users to tag: array of {username, x, y} (x/y 0-1 for images; omit for videos/reels), or the same as a JSON string");

const trialParams = z.object({
  graduation_strategy: z.enum(["MANUAL", "SS_PERFORMANCE"]),
}).optional().describe("Publish as a Trial Reel; graduate manually or automatically based on performance");

function parseUserTags(value: string | Array<z.infer<typeof userTag>> | undefined) {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error();
    return z.array(userTag).parse(parsed);
  } catch {
    throw new Error("user_tags must be an array of {username, x, y} or its JSON string.");
  }
}

function assign(params: Record<string, unknown>, values: Record<string, unknown>) {
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0)) params[key] = value;
  }
  return params;
}

export function registerIgPublishingTools(server: McpServer, client: MetaClient): void {
  defineTool(server, client, {
    name: "ig_publish_photo",
    description: "Publish a photo to an Instagram account. Creates the container, waits until it is ready, then publishes. Requires image_url (public HTTPS JPEG).",
    platform: "instagram",
    kind: "write",
    errorLabel: "Publish photo failed",
    schema: {
      image_url: z.string().url().describe("Public HTTPS URL of the image (JPEG only)"),
      caption: z.string().max(2200).optional().describe("Post caption (max 2200 chars)"),
      location_id: z.string().optional().describe("Facebook Page location ID"),
      user_tags: userTags,
      collaborators,
      alt_text: z.string().max(1000).optional().describe("Alt text for accessibility (max 1000 chars)"),
      ...disclosureOptions,
    },
    handler: async ({ image_url, caption, location_id, user_tags, collaborators, alt_text, ...disclosures }, c) =>
      createAndPublishIg(c, assign({ image_url, ...disclosures }, {
        caption,
        location_id,
        user_tags: parseUserTags(user_tags),
        collaborators,
        alt_text,
      })),
  });

  defineTool(server, client, {
    name: "ig_publish_video",
    description: "Publish a standalone video as a Reel and share it to the feed. Waits for video processing before publishing.",
    platform: "instagram",
    kind: "write",
    errorLabel: "Publish video failed",
    schema: {
      video_url: z.string().url().describe("Public HTTPS URL of the video"),
      caption: z.string().max(2200).optional().describe("Post caption"),
      thumb_offset: z.number().optional().describe("Thumbnail offset in ms"),
      location_id: z.string().optional().describe("Facebook Page location ID"),
      user_tags: userTags,
      collaborators,
      audio_name: z.string().optional().describe("Name for the Reel's original audio"),
      trial_params: trialParams,
      ...disclosureOptions,
    },
    handler: async ({ video_url, caption, thumb_offset, location_id, user_tags, collaborators, audio_name, ...options }, c) => {
      const params: Record<string, unknown> = { video_url, media_type: "REELS", share_to_feed: true, ...options };
      if (thumb_offset !== undefined) params.thumb_offset = thumb_offset;
      return createAndPublishIg(c, assign(params, {
        caption,
        location_id,
        user_tags: parseUserTags(user_tags),
        collaborators,
        audio_name,
      }));
    },
  });

  defineTool(server, client, {
    name: "ig_publish_carousel",
    description: "Publish a carousel (album) post with 2-10 images/videos. Each item needs a public URL; every child and the album wait for processing before publishing.",
    platform: "instagram",
    kind: "write",
    errorLabel: "Publish carousel failed",
    schema: {
      items: z.array(z.object({
        type: z.enum(["IMAGE", "VIDEO"]).describe("Media type"),
        url: z.string().url().describe("Public HTTPS URL of the media"),
        alt_text: z.string().max(1000).optional().describe("Alt text for this image item"),
        user_tags: z.array(userTag).optional().describe("Users tagged on this image item ({username, x, y})"),
      })).min(2).max(10).describe("Array of media items"),
      caption: z.string().max(2200).optional().describe("Post caption"),
      location_id: z.string().optional().describe("Facebook Page location ID"),
      collaborators,
      ...disclosureOptions,
    },
    handler: async ({ items, caption, location_id, collaborators, ...disclosures }, c) => {
      const childIds: string[] = [];
      for (const item of items) {
        const params: Record<string, unknown> = { is_carousel_item: true };
        if (item.type === "IMAGE") {
          params.image_url = item.url;
          if (item.alt_text) params.alt_text = item.alt_text;
          if (item.user_tags?.length) params.user_tags = item.user_tags;
        } else {
          params.video_url = item.url;
          params.media_type = "VIDEO";
        }
        const childId = await createIgContainer(c, params);
        await waitForIgContainer(c, childId);
        childIds.push(childId);
      }
      const carouselId = await createIgContainer(c, assign(
        { media_type: "CAROUSEL", children: childIds.join(","), ...disclosures },
        { caption, location_id, collaborators }
      ));
      await waitForIgContainer(c, carouselId);
      return publishIgContainer(c, carouselId);
    },
  });

  defineTool(server, client, {
    name: "ig_publish_reel",
    description: "Publish a Reel (short video). Waits for video processing.",
    platform: "instagram",
    kind: "write",
    errorLabel: "Publish reel failed",
    schema: {
      video_url: z.string().url().describe("Public HTTPS URL of the video"),
      caption: z.string().max(2200).optional().describe("Reel caption"),
      cover_url: z.string().optional().describe("Custom cover image URL"),
      share_to_feed: z.boolean().optional().describe("Also share to feed (default true)"),
      thumb_offset: z.number().optional().describe("Thumbnail offset in ms"),
      alt_text: z.string().max(1000).optional().describe("Alt text for accessibility"),
      location_id: z.string().optional().describe("Facebook Page location ID"),
      user_tags: userTags,
      collaborators,
      audio_name: z.string().optional().describe("Name for the Reel's original audio"),
      trial_params: trialParams,
      ...disclosureOptions,
    },
    handler: async ({ video_url, caption, cover_url, share_to_feed, thumb_offset, alt_text, location_id, user_tags, collaborators, audio_name, ...options }, c) => {
      const params: Record<string, unknown> = { video_url, media_type: "REELS", ...options };
      if (share_to_feed !== undefined) params.share_to_feed = share_to_feed;
      if (thumb_offset !== undefined) params.thumb_offset = thumb_offset;
      return createAndPublishIg(c, assign(params, {
        caption,
        cover_url,
        alt_text,
        location_id,
        user_tags: parseUserTags(user_tags),
        collaborators,
        audio_name,
      }));
    },
  });

  defineTool(server, client, {
    name: "ig_publish_story",
    description: "Publish a Story (image or video). Stories disappear after 24 hours.",
    platform: "instagram",
    kind: "write",
    errorLabel: "Publish story failed",
    schema: {
      media_type: z.enum(["IMAGE", "VIDEO"]).describe("Story media type"),
      media_url: z.string().url().describe("Public HTTPS URL of the media"),
      user_tags: userTags,
    },
    handler: async ({ media_type, media_url, user_tags }, c) =>
      createAndPublishIg(c, assign(buildInstagramStoryParams(media_type, media_url), {
        user_tags: parseUserTags(user_tags),
      })),
  });

  defineTool(server, client, {
    name: "ig_get_container_status",
    description: "Check the processing status of a media container: IN_PROGRESS, FINISHED (ready), PUBLISHED, ERROR or EXPIRED. Use it before retrying a publish that failed.",
    platform: "instagram",
    kind: "read",
    errorLabel: "Get container status failed",
    schema: {
      container_id: z.string().describe("Container ID to check"),
    },
    handler: async ({ container_id }, c) => c.ig("GET", `/${container_id}`, { fields: "id,status,status_code" }),
  });

  defineTool(server, client, {
    name: "ig_get_publishing_limit",
    description: "Check how many posts the Instagram account has published in the current 24-hour window and its quota (content_publishing_limit).",
    platform: "instagram",
    kind: "read",
    errorLabel: "Get publishing limit failed",
    schema: {},
    handler: async (_args, c) =>
      c.ig("GET", `/${c.igUserId}/content_publishing_limit`, { fields: "config,quota_usage" }),
  });
}
