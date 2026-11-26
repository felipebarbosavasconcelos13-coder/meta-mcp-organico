import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";
import {
  buildThreadsPollAttachment,
  buildThreadsTextEntities,
} from "../../services/api-contracts.js";
import {
  createAndPublishThreads,
  createThreadsContainer,
  publishThreadsContainer,
  waitForThreadsContainer,
} from "../../services/publishing.js";
import { defineTool } from "../define.js";

const replyControl = z
  .enum(["everyone", "accounts_you_follow", "mentioned_only", "parent_post_author_only", "followers_only"])
  .optional()
  .describe("Who can reply");

const commonOptions = {
  reply_control: replyControl,
  topic_tag: z.string().max(50).optional().describe("Topic tag for the post (1-50 chars, no periods or ampersands)"),
  quote_post_id: z.string().optional().describe("ID of a post to quote"),
  enable_reply_approvals: z.boolean().optional().describe("Require replies to be approved before they're published"),
  location_id: z.string().optional().describe("Location ID to tag (from threads_search_locations)"),
  crossreshare_to_ig: z.boolean().optional().describe("Also share this post to the account's linked Instagram as a Story"),
  crossreshare_to_ig_dark_mode: z.boolean().optional().describe("Cross-share to Instagram Stories in dark mode"),
};

type CommonOptions = {
  reply_control?: string;
  topic_tag?: string;
  quote_post_id?: string;
  enable_reply_approvals?: boolean;
  location_id?: string;
  crossreshare_to_ig?: boolean;
  crossreshare_to_ig_dark_mode?: boolean;
};

function applyCommon(params: Record<string, unknown>, options: CommonOptions): Record<string, unknown> {
  if (options.reply_control) params.reply_control = options.reply_control;
  if (options.topic_tag) params.topic_tag = options.topic_tag;
  if (options.quote_post_id) params.quote_post_id = options.quote_post_id;
  if (options.enable_reply_approvals) params.enable_reply_approvals = true;
  if (options.location_id) params.location_id = options.location_id;
  if (options.crossreshare_to_ig) params.crossreshare_to_ig = true;
  if (options.crossreshare_to_ig_dark_mode) params.crossreshare_to_ig_dark_mode = true;
  return params;
}

export function registerThreadsPublishingTools(server: McpServer, client: MetaClient): void {
  defineTool(server, client, {
    name: "threads_publish_text",
    description: "Publish a text-only post on Threads. Supports optional link attachment, poll, GIF, topic tag, and quote post. Waits for the container to be ready before publishing.",
    platform: "threads",
    kind: "write",
    errorLabel: "Publish text failed",
    schema: {
      text: z.string().max(500).describe("Post text (max 500 chars)"),
      link_attachment: z.string().url().optional().describe("URL to attach as a link preview card (max 5 links per post)"),
      poll_options: z.array(z.string().min(1).max(25)).min(2).max(4).optional().describe("Poll options (2-4 choices, each 1-25 characters). Creates a poll attachment."),
      gif_id: z.string().optional().describe("GIF ID from GIPHY (id field from GIPHY's API response). GIPHY is currently the only supported GIF provider (Tenor was sunset March 31, 2026)."),
      alt_text: z.string().max(1000).optional().describe("Alt text for accessibility (max 1000 chars)"),
      is_spoiler: z.boolean().optional().describe("Mark content as spoiler"),
      spoiler_ranges: z.array(z.object({
        offset: z.number().int().min(0),
        length: z.number().int().positive(),
      })).min(1).max(10).optional().describe("Up to 10 exact spoiler ranges within text. If omitted and is_spoiler=true, the entire text is marked as a spoiler."),
      is_ghost_post: z.boolean().optional().describe("Create a ghost post (auto-archived after 24h). Text-only, and per Meta's docs the only other feature supported alongside it is is_spoiler — do not combine with polls, GIFs, links, topic tags, location, reply approvals, or cross-sharing. Ghost posts also cannot be used to reply to a post."),
      ...commonOptions,
    },
    handler: async ({ text, link_attachment, poll_options, gif_id, alt_text, is_spoiler, spoiler_ranges, is_ghost_post, ...options }, c) => {
      const params: Record<string, unknown> = { media_type: "TEXT", text };
      if (link_attachment) params.link_attachment = link_attachment;
      if (poll_options) params.poll_attachment = buildThreadsPollAttachment(poll_options);
      if (gif_id) params.gif_attachment = JSON.stringify({ gif_id, provider: "GIPHY" });
      if (alt_text) params.alt_text = alt_text;
      const textEntities = buildThreadsTextEntities(text, is_spoiler === true, spoiler_ranges);
      if (textEntities) params.text_entities = textEntities;
      if (is_ghost_post) params.is_ghost_post = true;
      return createAndPublishThreads(c, applyCommon(params, options));
    },
  });

  defineTool(server, client, {
    name: "threads_publish_image",
    description: "Publish an image post on Threads. Supports topic tag, quote post, alt text, and spoiler flag.",
    platform: "threads",
    kind: "write",
    errorLabel: "Publish image failed",
    schema: {
      image_url: z.string().url().describe("Public HTTPS URL of the image (JPEG/PNG, max 8MB)"),
      text: z.string().max(500).optional().describe("Caption text"),
      alt_text: z.string().max(1000).optional().describe("Alt text for accessibility (max 1000 chars)"),
      is_spoiler: z.boolean().optional().describe("Mark content as spoiler"),
      ...commonOptions,
    },
    handler: async ({ image_url, text, alt_text, is_spoiler, ...options }, c) => {
      const params: Record<string, unknown> = { media_type: "IMAGE", image_url };
      if (text) params.text = text;
      if (alt_text) params.alt_text = alt_text;
      if (is_spoiler) params.is_spoiler_media = true;
      return createAndPublishThreads(c, applyCommon(params, options));
    },
  });

  defineTool(server, client, {
    name: "threads_publish_video",
    description: "Publish a video post on Threads. Waits for video processing. Supports topic tag, quote post, alt text, and spoiler flag.",
    platform: "threads",
    kind: "write",
    errorLabel: "Publish video failed",
    schema: {
      video_url: z.string().url().describe("Public HTTPS URL of the video (MP4/MOV, max 1GB, up to 5 min)"),
      text: z.string().max(500).optional().describe("Caption text"),
      alt_text: z.string().max(1000).optional().describe("Alt text for accessibility (max 1000 chars)"),
      is_spoiler: z.boolean().optional().describe("Mark content as spoiler"),
      ...commonOptions,
    },
    handler: async ({ video_url, text, alt_text, is_spoiler, ...options }, c) => {
      const params: Record<string, unknown> = { media_type: "VIDEO", video_url };
      if (text) params.text = text;
      if (alt_text) params.alt_text = alt_text;
      if (is_spoiler) params.is_spoiler_media = true;
      return createAndPublishThreads(c, applyCommon(params, options));
    },
  });

  defineTool(server, client, {
    name: "threads_publish_carousel",
    description: "Publish a carousel post on Threads with 2-20 images/videos.",
    platform: "threads",
    kind: "write",
    errorLabel: "Publish carousel failed",
    schema: {
      items: z.array(z.object({
        type: z.enum(["IMAGE", "VIDEO"]).describe("Media type"),
        url: z.string().url().describe("Public HTTPS URL"),
        alt_text: z.string().max(1000).optional().describe("Alt text for this item"),
      })).min(2).max(20).describe("Array of media items"),
      text: z.string().max(500).optional().describe("Caption text"),
      ...commonOptions,
    },
    handler: async ({ items, text, ...options }, c) => {
      const childIds: string[] = [];
      for (const item of items) {
        const params: Record<string, unknown> = { media_type: item.type, is_carousel_item: true };
        if (item.type === "IMAGE") params.image_url = item.url;
        else params.video_url = item.url;
        if (item.alt_text) params.alt_text = item.alt_text;
        const childId = await createThreadsContainer(c, params);
        await waitForThreadsContainer(c, childId);
        childIds.push(childId);
      }
      const carouselParams: Record<string, unknown> = { media_type: "CAROUSEL", children: childIds.join(",") };
      if (text) carouselParams.text = text;
      const carouselId = await createThreadsContainer(c, applyCommon(carouselParams, options));
      await waitForThreadsContainer(c, carouselId);
      return publishThreadsContainer(c, carouselId);
    },
  });

  defineTool(server, client, {
    name: "threads_repost",
    description: "Repost a Threads post to the account's profile. Returns the repost ID.",
    platform: "threads",
    kind: "write",
    errorLabel: "Repost failed",
    schema: {
      post_id: z.string().describe("Threads post ID to repost"),
    },
    handler: async ({ post_id }, c) => c.threads("POST", `/${post_id}/repost`),
  });

  defineTool(server, client, {
    name: "threads_delete_post",
    description: "Delete a Threads post. This action is irreversible. Rate limited to 100 deletions per 24 hours.",
    platform: "threads",
    kind: "destructive",
    errorLabel: "Delete post failed",
    schema: {
      post_id: z.string().describe("Threads post ID to delete"),
    },
    handler: async ({ post_id }, c) => {
      const { data, rateLimit } = await c.threads("DELETE", `/${post_id}`);
      return { data: { success: true, ...(data as object) }, rateLimit };
    },
  });

  defineTool(server, client, {
    name: "threads_get_container_status",
    description: "Check the processing status of a Threads media container: IN_PROGRESS, FINISHED (ready), PUBLISHED, ERROR (with error_message) or EXPIRED.",
    platform: "threads",
    kind: "read",
    errorLabel: "Get container status failed",
    schema: {
      container_id: z.string().describe("Container ID to check"),
    },
    handler: async ({ container_id }, c) => c.threads("GET", `/${container_id}`, { fields: "id,status,error_message" }),
  });

  defineTool(server, client, {
    name: "threads_get_publishing_limit",
    description: "Check the account's remaining Threads quotas in the current 24-hour window (posts, replies, deletes, location searches).",
    platform: "threads",
    kind: "read",
    errorLabel: "Get publishing limit failed",
    schema: {},
    handler: async (_args, c) =>
      c.threads("GET", `/${await c.threadsUserId()}/threads_publishing_limit`, {
        fields: "quota_usage,config,reply_quota_usage,reply_config,delete_quota_usage,delete_config,location_search_quota_usage,location_search_config",
      }),
  });
}
