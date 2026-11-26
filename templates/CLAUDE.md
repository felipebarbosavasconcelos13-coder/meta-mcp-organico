# Meta MCP (multi-account) — Instructions for Claude

This project uses the **meta-mcp-organico** MCP server for Instagram, Threads, WhatsApp Cloud API and Meta platform management. Tools are prefixed with `mcp__meta__` in Claude Code.

## Multi-account rules (read first)

- Run `meta_list_accounts` to see every account (Instagram, Threads, WhatsApp) with its key, aliases and which is the default.
- Pass `account` (key, alias, @username, ID or phone number) to every tool. Reads without it use the default account.
- Write tools (publish, reply, comment, DM, WhatsApp send, delete) **fail without `account` when the platform has more than one account** — confirm the client with the user, never guess.
- Every result carries `_account`: check it matches the client you meant.
- If a publish call errors, check `ig_get_container_status` / `threads_get_container_status` before retrying; the tools already report `status: PUBLISHED` when the post went out despite the error.
- WhatsApp free-form messages only reach people who messaged in the last 24 h; otherwise use `whatsapp_send_template`. Incoming WhatsApp messages are not readable here (webhooks only).
- Number onboarding, payments and business verification for WhatsApp belong to Meta's official MCP (`https://mcp.facebook.com/whatsapp_business_tools`).

## Tools

### Meta platform (8)
- `meta_list_accounts` — List every account this server can act on — Instagram accounts discovered from the token, Threads profiles and WhatsApp numbers — with the key/aliases to pass as `account`, which one is the default, and which ones write tools may target.
- `meta_whoami` — Show which account a given `account` value resolves to for a platform (and whether write tools may use it) without calling the platform.
- `meta_exchange_token` — Exchange a short-lived token for a long-lived token (valid ~60 days).
- `meta_refresh_token` — Extend an Instagram/Facebook user token through the token-exchange flow, or refresh a Threads long-lived token through the Threads refresh endpoint.
- `meta_debug_token` — Debug/inspect an access token to check validity, expiration, scopes and associated user.
- `meta_get_app_info` — Get Meta App basic information (name, category, namespace, etc.).
- `meta_subscribe_webhook` — Subscribe to webhook notifications for an object (e.g., 'instagram', 'page', 'whatsapp_business_account').
- `meta_get_webhook_subscriptions` — List current webhook subscriptions for the Meta App.

### Instagram (43)
- `ig_publish_photo` — Publish a photo to an Instagram account.
- `ig_publish_video` — Publish a standalone video as a Reel and share it to the feed.
- `ig_publish_carousel` — Publish a carousel (album) post with 2-10 images/videos.
- `ig_publish_reel` — Publish a Reel (short video).
- `ig_publish_story` — Publish a Story (image or video).
- `ig_get_container_status` — Check the processing status of a media container: IN_PROGRESS, FINISHED (ready), PUBLISHED, ERROR or EXPIRED.
- `ig_get_publishing_limit` — Check how many posts the Instagram account has published in the current 24-hour window and its quota (content_publishing_limit).
- `ig_get_media_list` — Get the media published on an Instagram account (feed posts and reels; stories are listed by ig_get_stories).
- `ig_get_stories` — Get the account's currently live Stories (last 24h).
- `ig_get_media` — Get details of a specific Instagram media post.
- `ig_delete_media` — Delete an Instagram media post (posts, carousels, reels, stories).
- `ig_get_media_insights` — Get insights for a media post.
- `ig_toggle_comments` — Enable or disable comments on an Instagram media post.
- `ig_get_collaborative_media` — Get media where the account is a collaborator (collab posts).
- `ig_get_comments` — Get comments on a specific Instagram media post.
- `ig_get_comment` — Get details of a specific comment.
- `ig_post_comment` — Post a top-level comment on a media post as the account.
- `ig_get_replies` — Get replies to a specific comment.
- `ig_reply_to_comment` — Reply publicly to a specific comment.
- `ig_hide_comment` — Hide or unhide a comment on your post.
- `ig_delete_comment` — Delete a comment from your media post.
- `ig_like` — Like a media post or comment as the account (Instagram engagement API, April 2026).
- `ig_unlike` — Remove the account's like from a media post or comment.
- `ig_get_profile` — Get Instagram Business/Creator account profile information.
- `ig_get_account_insights` — Get Instagram account insights.
- `ig_business_discovery` — Look up another Instagram Business/Creator account's public info by username (read through one of your accounts).
- `ig_get_collaboration_invites` — Get pending collaboration invites for the Instagram account.
- `ig_respond_collaboration_invite` — Accept or decline a collaboration invite.
- `ig_search_hashtag` — Search for a hashtag ID by name.
- `ig_get_hashtag` — Get hashtag information by ID.
- `ig_get_hashtag_recent` — Get recent media (last 24h) tagged with a specific hashtag.
- `ig_get_hashtag_top` — Get top (most popular) media tagged with a specific hashtag.
- `ig_get_mentioned_comments` — Get a comment where the account was @mentioned (comment ID from a mention webhook).
- `ig_get_mentioned_media` — Get a media post whose caption @mentions the account (media ID from a mention webhook).
- `ig_reply_to_mention` — Comment on a post (or reply to a comment) where the account was @mentioned.
- `ig_get_tagged_media` — Get media where the account is tagged (photo tags, not @mentions).
- `ig_get_conversations` — Get Instagram DM conversations of the account.
- `ig_get_messages` — Get messages in a specific DM conversation.
- `ig_get_message` — Get details of a specific DM message.
- `ig_send_message` — Send an Instagram DM: text (optionally with quick replies or as a reply to a message) or one attachment (image, video, audio or file, by public URL or attachment_id).
- `ig_private_reply` — Reply privately (in the DM inbox) to someone who commented on the account's post or reel.
- `ig_send_reaction` — React to (or remove the reaction from) a message in an Instagram DM conversation.
- `ig_sender_action` — Show a typing indicator or mark the conversation as seen in an Instagram DM.

### Threads (28)
- `threads_publish_text` — Publish a text-only post on Threads.
- `threads_publish_image` — Publish an image post on Threads.
- `threads_publish_video` — Publish a video post on Threads.
- `threads_publish_carousel` — Publish a carousel post on Threads with 2-20 images/videos.
- `threads_repost` — Repost a Threads post to the account's profile.
- `threads_delete_post` — Delete a Threads post.
- `threads_get_container_status` — Check the processing status of a Threads media container: IN_PROGRESS, FINISHED (ready), PUBLISHED, ERROR (with error_message) or EXPIRED.
- `threads_get_publishing_limit` — Check the account's remaining Threads quotas in the current 24-hour window (posts, replies, deletes, location searches).
- `threads_get_posts` — Get a list of the account's published Threads posts.
- `threads_get_post` — Get details of a specific Threads post.
- `threads_get_profile_posts` — Get a public profile's posts by username (Profile Discovery).
- `threads_search_posts` — Search for public Threads posts by keyword or topic tag via the /keyword_search endpoint.
- `threads_get_replies` — Get top-level replies to a specific Threads post.
- `threads_get_conversation` — Get a flattened list of all replies (top-level and nested) to a Threads post, in chronological or reverse-chronological order.
- `threads_reply` — Reply to a Threads post or another reply as the account.
- `threads_hide_reply` — Hide a reply on your Threads post.
- `threads_unhide_reply` — Unhide a previously hidden reply on your Threads post.
- `threads_get_pending_replies` — Get pending/ignored replies awaiting approval on a post that has reply approvals enabled (enable_reply_approvals).
- `threads_manage_pending_reply` — Approve or ignore a pending reply on a post with reply approvals enabled.
- `threads_get_profile` — Get the account's Threads profile information including verification status.
- `threads_lookup_profile` — Look up a public Threads user's profile by username (Profile Discovery).
- `threads_get_user_threads` — Get all threads published by the account (lighter field set than threads_get_posts).
- `threads_get_post_insights` — Get insights for a specific Threads post (views, likes, replies, reposts, quotes, shares).
- `threads_get_user_insights` — Get account-level Threads insights: views, likes, replies, reposts, quotes, clicks (link clicks, returned as link_total_values), followers_count, follower_demographics (needs breakdown and 100+ followers).
- `threads_get_mentions` — Get public Threads posts where the account has been @mentioned by another profile.
- `threads_search_locations` — Search for locations to tag in a Threads post, by query text or by coordinates.
- `threads_get_location` — Get a Threads location object by ID (from threads_search_locations or a post's location_id field).
- `threads_get_oembed` — Get the embed HTML and metadata for a public Threads post, for rendering a rich preview on an external site.

### WhatsApp (20)
- `whatsapp_send_text` — Send a WhatsApp text message from the account's number.
- `whatsapp_send_template` — Send an approved WhatsApp message template (works outside the 24-hour window; billed per message by category).
- `whatsapp_send_media` — Send an image, video, audio, document or sticker by public link or by media_id (from whatsapp_upload_media).
- `whatsapp_send_interactive` — Send an interactive message: reply buttons (up to 3, titles ≤20 chars), a list (up to 10 rows in total, row titles ≤24 chars), or a call-to-action URL button.
- `whatsapp_send_location` — Send a location pin.
- `whatsapp_send_reaction` — React to a customer's message with an emoji (empty emoji removes the reaction).
- `whatsapp_mark_as_read` — Mark a received message (and the earlier ones in the chat) as read; optionally show a typing indicator for up to 25 seconds.
- `whatsapp_upload_media` — Download a file from a public URL and upload it to WhatsApp for the account's number.
- `whatsapp_get_media` — Get a media object's metadata and a download URL (valid for 5 minutes, needs the WhatsApp token to download).
- `whatsapp_delete_media` — Delete an uploaded media object.
- `whatsapp_list_templates` — List the message templates of the account's WhatsApp Business Account with status (APPROVED, PENDING, REJECTED, PAUSED…), category, language and quality.
- `whatsapp_get_template` — Get one message template by its ID.
- `whatsapp_create_template` — Submit a new message template for Meta review (status starts as PENDING).
- `whatsapp_delete_template` — Delete a message template.
- `whatsapp_list_phone_numbers` — List the phone numbers of the account's WhatsApp Business Account with verified name, quality rating (GREEN/YELLOW/RED), name status and connection status.
- `whatsapp_get_business_profile` — Get the WhatsApp business profile (about, address, description, email, websites, vertical, photo) of the account's number.
- `whatsapp_update_business_profile` — Update the WhatsApp business profile of the account's number.
- `whatsapp_get_messaging_analytics` — Messaging analytics for the account's WhatsApp Business Account.
- `whatsapp_get_template_analytics` — Daily performance of up to 10 templates: sent, delivered, read, clicked (marketing/utility) and cost.
- `whatsapp_enable_template_insights` — Turn on template analytics for the account's WhatsApp Business Account.

## Notes

- Instagram requires a **Business or Creator account** linked to a Facebook Page.
- Threads works with any account; each Threads profile needs its own token.
- Media URLs must be public HTTPS links.
- Deprecated metrics: `impressions`, `plays`, `video_views` — use `views`.
