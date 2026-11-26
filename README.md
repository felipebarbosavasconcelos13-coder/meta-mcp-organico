**English** | [Português (multi-contas)](docs/MULTI-CONTAS.md) | [한국어 (v2)](README.ko.md)

# meta-mcp-organico

Fork of [mikusnuz/meta-mcp](https://github.com/mikusnuz/meta-mcp): an MCP server for **Instagram Graph API** (v26.0), **Threads API**, **WhatsApp Cloud API** and **Meta platform** management, built to operate **many client accounts from one server**.

## When to Use

Tell your AI assistant things like:

- **"List the accounts you can manage"** — `meta_list_accounts`
- **"Post this photo on @drrander"** — every tool takes an `account`
- **"Publish a text post on Threads for Genial"** — polls, GIFs, link attachments, topic tags
- **"How did Bea's Instagram do this month?"** — account and post insights, stories, collab posts
- **"Reply privately to this comment"** — `ig_private_reply`, DMs with attachments and quick replies
- **"Send the appointment reminder template on WhatsApp"** — templates, media, interactive messages
- **"How much did we spend on WhatsApp per category?"** — pricing and template analytics

> **AI Agent Integration**: See [`llms.txt`](llms.txt) for a machine-readable summary, or copy [`templates/CLAUDE.md`](templates/CLAUDE.md) / [`templates/AGENTS.md`](templates/AGENTS.md) into your project for automatic MCP discovery.

## Features

- **99 tools**: Instagram (43), Threads (28), WhatsApp (20), Meta platform (8)
- **Multi-account**: Instagram accounts discovered from the token, WhatsApp numbers discovered from your businesses, Threads profiles and aliases from an accounts file. Every tool takes an optional `account`.
- **Safe writes**: with more than one account, write tools refuse to run without `account`; `META_ALLOWED_ACCOUNTS` limits which accounts may be changed. MCP tool annotations mark read-only and destructive tools.
- **No duplicate posts**: containers are polled with backoff (5 min cap, per Meta), Threads waits for every container (text included), and a failed publish call checks the container before reporting an error.
- **Token hygiene**: tokens are stripped from paging links and error messages; exchanged/refreshed tokens are masked unless `META_EXPOSE_TOKENS=true`.
- **Resilient reads**: transient errors (codes 1/2, 5xx, network) are retried; rate limits are reported with `x-app-usage` / `x-business-use-case-usage` instead of hammering the API.
- **4 resources**: `instagram://profile`, `instagram://profile/{account}`, `threads://profile`, `threads://profile/{account}`
- **2 prompts**: cross-platform publishing, analytics report

## Multi-account

### How accounts are found

1. **Environment (default account)** — `INSTAGRAM_USER_ID`, `THREADS_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` keep working as before and become the default account (`default`).
2. **Instagram discovery** — `GET /me/accounts` with `INSTAGRAM_ACCESS_TOKEN` lists every Facebook Page the token manages and its linked Instagram professional account. Each one becomes an account keyed by its username. The Page token found here is kept in memory (never returned) and used for DMs. Cached for `META_ACCOUNTS_TTL` seconds (default 900); unknown accounts trigger a refresh.
3. **WhatsApp discovery** — when `WHATSAPP_ACCESS_TOKEN` (or `WHATSAPP_BUSINESS_ID`) is set: businesses → owned and client WhatsApp Business Accounts → phone numbers. Each number becomes an account `wa-<digits>`, also reachable by its digits or verified name.
4. **Accounts file** — `META_ACCOUNTS_FILE=/path/accounts.json` adds aliases, the default account, Threads profiles (each needs its own token) and links an Instagram account, a Threads profile and a WhatsApp number into one client. The file holds **env var names**, never tokens. See [`accounts.example.json`](accounts.example.json).

```json
{
  "default": "genial",
  "accounts": {
    "genial": {
      "label": "Genial Soluções Digitais",
      "aliases": ["gsd"],
      "instagram": "@genialsolucoesdigitais",
      "threads": { "token_env": "THREADS_TOKEN_GENIAL" },
      "whatsapp": "+55 11 99999-0000"
    },
    "rander": {
      "instagram": { "username": "drrander", "page_token_env": "PAGE_TOKEN_RANDER" },
      "whatsapp": { "phone_number_id": "123456789012345", "waba_id": "987654321098765", "token_env": "WA_TOKEN_RANDER" }
    }
  }
}
```

### Choosing an account

`account` accepts the key, an alias, `@username`, the Instagram/Page/Threads ID, the WhatsApp phone number ID, or the phone number in any format. Reads without `account` use the default account; **write tools without `account` fail when the platform has more than one account** and list the options. `meta_whoami` shows what a value resolves to.

Every result includes `_account` so the agent can confirm where it acted.

### Tokens per platform

- **Instagram**: one user or system-user token publishes for every account whose Page it manages (CREATE_CONTENT/MANAGE task). Override per account with `token_env`.
- **Instagram DMs**: need the Page token (MESSAGE task) — discovered automatically, or `page_token_env` / `INSTAGRAM_MESSAGING_ACCESS_TOKEN`.
- **Threads**: each profile has its own token (`threads.token_env`). The user ID is looked up with `/me` when not given.
- **WhatsApp**: a system-user token with `whatsapp_business_messaging` and `whatsapp_business_management` (falls back to `INSTAGRAM_ACCESS_TOKEN`). Override per number with `token_env`.

## WhatsApp

This server covers day-to-day **sending and management**: text, templates, media, interactive messages (buttons, lists, CTA URL), location, reactions, mark as read, media upload, templates (list/create/delete), business profile, phone numbers, pricing/message analytics and template analytics.

Not covered here, by design:

- **Receiving messages** — the Cloud API has no inbox endpoint; incoming messages arrive by webhook. Keep them in your CRM/webhook receiver.
- **Number onboarding** (add/verify/register numbers), payment setup and business verification — use Meta's official hosted MCP alongside this one:

```bash
claude mcp add --transport http whatsapp-business https://mcp.facebook.com/whatsapp_business_tools
```

Free-form messages are delivered only within 24 hours of the customer's last message; outside that window use `whatsapp_send_template` (error 131047 says so).

## What's New in v3.0.0

- **Multi-account** across Instagram, Threads and WhatsApp (see above). **Breaking:** write tools now require `account` when several accounts are available.
- **WhatsApp Cloud API**: 20 `whatsapp_*` tools.
- **New Instagram tools**: `ig_get_publishing_limit`, `ig_get_stories`, `ig_get_collaborative_media`, `ig_private_reply`, `ig_send_reaction`, `ig_sender_action`, `ig_reply_to_mention`, `ig_get_mentioned_media`, `ig_like`, `ig_unlike`. Publishing gains `collaborators`, `user_tags` on reels/carousel items/stories and `audio_name`; `ig_send_message` gains attachments, quick replies, `reply_to` and the `HUMAN_AGENT` tag.
- **New Threads tool**: `threads_repost`; `threads_get_publishing_limit` returns every quota.
- **New Meta tools**: `meta_list_accounts`, `meta_whoami`.
- Reliability: backoff polling, Threads text/image/reply containers wait until ready, publish idempotency check.
- Security: token redaction in paging links and errors, masked exchange/refresh results.

## What's New in v2.2.1

- Photos, image Stories, and every carousel child and parent now wait for container processing before publication. Processing errors stop the publish request.
- Mentioned comments use the Instagram user field expansion with documented default fields.

## What's New in v2.2.0

- Fixed Instagram business discovery and collaboration invite requests. Use `media_id` and `accept` for invites; `invite_id` and `action` remain supported aliases.
- Account insights support `metric_type`, `breakdown`, and demographic `timeframe`. Metrics such as `views` select `total_value` automatically.
- Standalone videos now publish as Reels shared to the feed. Photo, Reel, and carousel publishing support AI info and paid-partnership labels; Reels also support `trial_params`.
- Public Threads oEmbed works without a token. Includes the token refresh, Instagram Messaging, publishing, and reply handling fixes since v2.1.1.

## What's New in v2.1.0

- **Graph API v26.0**: Upgraded from v25.0 (no deprecated fields/endpoints from the v26.0 changelog were in use)
- **Tenor removed**: GIPHY is now the only GIF provider (Tenor was sunset March 31, 2026); `gif_provider` param dropped
- **Threads Ghost Posts**: `is_ghost_post` on `threads_publish_text` (auto-archived after 24h)
- **Threads Reply Approvals**: `enable_reply_approvals` on publish tools, plus `threads_get_pending_replies` and `threads_manage_pending_reply`
- **Threads → Instagram Stories cross-share**: `crossreshare_to_ig` / `crossreshare_to_ig_dark_mode` on all publish tools
- **Threads Location Tagging**: `location_id` on publish tools, plus `threads_search_locations` and `threads_get_location`
- **Threads Profile Discovery**: `threads_lookup_profile` and `threads_get_profile_posts` for public profiles
- **Threads Mentions**: `threads_get_mentions`
- **Threads oEmbed**: `threads_get_oembed` for embedding public posts
- **Threads Conversations**: `threads_get_conversation` for flattened (nested) reply threads
- **Fixed `threads_search_posts`**: now calls the correct `/keyword_search` endpoint with the correct `search_mode`/`search_type` parameters (previous version targeted a non-existent endpoint)
- Post/reply fields expanded with `is_verified`, `profile_picture_url`, `location_id`, `root_post`, `replied_to`, `reply_audience`

## What's New in v2.0.0

- **Graph API v25.0**: Upgraded from v21.0 (expired Sep 2025) to v25.0 (current)
- **Fixed deprecated metrics**: `impressions`, `video_views`, `engagement` replaced with `views`, `reach`, `saved`, `shares`
- **Threads polls**: Create posts with interactive poll attachments
- **Threads GIFs**: Attach GIFs from GIPHY or Tenor
- **Threads topic tags**: Categorize posts with topic tags
- **Threads link attachments**: Attach URL preview cards to text posts
- **Threads post search**: Search public posts by keyword or topic tag
- **Threads post deletion**: Delete posts (rate limited to 100/day)
- **Threads publishing limit**: Check remaining quota
- **Threads quote posts**: Quote other posts by ID
- **Threads spoiler flag**: Mark content as spoiler
- **Threads alt text**: Add accessibility descriptions to all media types
- **Threads new reply controls**: `parent_post_author_only` and `followers_only` options
- **Instagram alt text**: Support for photo, reel, and carousel items
- **Instagram collaboration invites**: Query and respond to collab invites
- **Updated insights metrics**: New `clicks`, `reposts`, `reels_skip_rate` metrics

## Account Requirements

| Platform | Account Type | Notes |
|----------|-------------|-------|
| **Instagram** | Business or Creator account | Personal accounts cannot use the Graph API. Free to switch in Instagram settings |
| **Threads** | Any account | All Threads accounts can use the API (Instagram account link no longer required since Sep 2025) |
| **WhatsApp** | WhatsApp Business Platform (Cloud API) number | System-user token with `whatsapp_business_messaging` and `whatsapp_business_management` |
| **Meta** (token/webhook tools) | Meta Developer App | Create at [developers.facebook.com](https://developers.facebook.com) |

## Installation

Requires Node.js 20 or later.

### From GitHub (no npm publish needed)

```json
{
  "mcpServers": {
    "meta": {
      "command": "npx",
      "args": ["-y", "github:felipebarbosavasconcelos13-coder/meta-mcp-organico"],
      "env": {
        "INSTAGRAM_ACCESS_TOKEN": "your_user_or_system_user_token",
        "WHATSAPP_ACCESS_TOKEN": "your_whatsapp_system_user_token",
        "META_ACCOUNTS_FILE": "/path/to/accounts.json",
        "THREADS_TOKEN_GENIAL": "threads_token_for_genial"
      }
    }
  }
}
```

The package builds itself on install (`prepare`).

### Manual

```bash
git clone https://github.com/felipebarbosavasconcelos13-coder/meta-mcp-organico.git
cd meta-mcp-organico
npm install   # also builds dist/
```

```json
{
  "mcpServers": {
    "meta": {
      "command": "node",
      "args": ["/path/to/meta-mcp-organico/dist/index.js"],
      "env": {
        "INSTAGRAM_ACCESS_TOKEN": "your_user_or_system_user_token",
        "META_ACCOUNTS_FILE": "/path/to/accounts.json"
      }
    }
  }
}
```

Single-account setups from v2 (`INSTAGRAM_USER_ID`, `THREADS_USER_ID`, …) keep working unchanged.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `INSTAGRAM_ACCESS_TOKEN` | User or system-user token (Facebook Login). Publishes for every account whose Page it manages and drives Instagram discovery |
| `INSTAGRAM_USER_ID` | Optional default Instagram account |
| `INSTAGRAM_MESSAGING_ACCESS_TOKEN` | Page token for DMs of the default account (other accounts use the discovered Page token) |
| `INSTAGRAM_PAGE_ID` | Facebook Page linked to the default Instagram account |
| `THREADS_ACCESS_TOKEN` / `THREADS_USER_ID` | Default Threads account (other profiles: `threads.token_env` in the accounts file) |
| `WHATSAPP_ACCESS_TOKEN` | System-user token with `whatsapp_business_messaging` + `whatsapp_business_management`; turns on WhatsApp discovery |
| `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_BUSINESS_ACCOUNT_ID` | Optional default WhatsApp number and its WABA |
| `WHATSAPP_BUSINESS_ID` | Comma-separated business (portfolio) IDs to discover WABAs from (default: `/me/businesses`) |
| `META_ACCOUNTS_FILE` | Path to the accounts JSON file (aliases, default, Threads tokens by env var name, links) |
| `META_ALLOWED_ACCOUNTS` | Comma-separated accounts write tools may target (default: all) |
| `META_ACCOUNTS_TTL` | Discovery cache in seconds (default 900) |
| `META_DISCOVER_INSTAGRAM` / `META_DISCOVER_WHATSAPP` | `false` turns a discovery off |
| `META_EXPOSE_TOKENS` | `true` returns full tokens from exchange/refresh tools (default masked) |
| `META_APP_ID` / `META_APP_SECRET` | For token and webhook tools |

## Tools

Every tool except the Meta platform ones accepts an optional `account`. *write* and *destructive* tools need it when the platform has more than one account.

### Meta platform (8)

| Tool | Kind | Description |
|------|------|-------------|
| `meta_list_accounts` | read | List every account this server can act on — Instagram accounts discovered from the token, Threads profiles and WhatsApp numbers — with the key/aliases to pass as `account`, which one is the default, and which ones write tools may target. |
| `meta_whoami` | read | Show which account a given `account` value resolves to for a platform (and whether write tools may use it) without calling the platform. |
| `meta_exchange_token` | write | Exchange a short-lived token for a long-lived token (valid ~60 days). |
| `meta_refresh_token` | write | Extend an Instagram/Facebook user token through the token-exchange flow, or refresh a Threads long-lived token through the Threads refresh endpoint. |
| `meta_debug_token` | read | Debug/inspect an access token to check validity, expiration, scopes and associated user. |
| `meta_get_app_info` | read | Get Meta App basic information (name, category, namespace, etc.). |
| `meta_subscribe_webhook` | write | Subscribe to webhook notifications for an object (e.g., 'instagram', 'page', 'whatsapp_business_account'). |
| `meta_get_webhook_subscriptions` | read | List current webhook subscriptions for the Meta App. |

### Instagram (43)

| Tool | Kind | Description |
|------|------|-------------|
| `ig_publish_photo` | write | Publish a photo to an Instagram account. |
| `ig_publish_video` | write | Publish a standalone video as a Reel and share it to the feed. |
| `ig_publish_carousel` | write | Publish a carousel (album) post with 2-10 images/videos. |
| `ig_publish_reel` | write | Publish a Reel (short video). |
| `ig_publish_story` | write | Publish a Story (image or video). |
| `ig_get_container_status` | read | Check the processing status of a media container: IN_PROGRESS, FINISHED (ready), PUBLISHED, ERROR or EXPIRED. |
| `ig_get_publishing_limit` | read | Check how many posts the Instagram account has published in the current 24-hour window and its quota (content_publishing_limit). |
| `ig_get_media_list` | read | Get the media published on an Instagram account (feed posts and reels; stories are listed by ig_get_stories). |
| `ig_get_stories` | read | Get the account's currently live Stories (last 24h). |
| `ig_get_media` | read | Get details of a specific Instagram media post. |
| `ig_delete_media` | destructive | Delete an Instagram media post (posts, carousels, reels, stories). |
| `ig_get_media_insights` | read | Get insights for a media post. |
| `ig_toggle_comments` | write | Enable or disable comments on an Instagram media post. |
| `ig_get_collaborative_media` | read | Get media where the account is a collaborator (collab posts). |
| `ig_get_comments` | read | Get comments on a specific Instagram media post. |
| `ig_get_comment` | read | Get details of a specific comment. |
| `ig_post_comment` | write | Post a top-level comment on a media post as the account. |
| `ig_get_replies` | read | Get replies to a specific comment. |
| `ig_reply_to_comment` | write | Reply publicly to a specific comment. |
| `ig_hide_comment` | destructive | Hide or unhide a comment on your post. |
| `ig_delete_comment` | destructive | Delete a comment from your media post. |
| `ig_like` | write | Like a media post or comment as the account (Instagram engagement API, April 2026). |
| `ig_unlike` | destructive | Remove the account's like from a media post or comment. |
| `ig_get_profile` | read | Get Instagram Business/Creator account profile information. |
| `ig_get_account_insights` | read | Get Instagram account insights. |
| `ig_business_discovery` | read | Look up another Instagram Business/Creator account's public info by username (read through one of your accounts). |
| `ig_get_collaboration_invites` | read | Get pending collaboration invites for the Instagram account. |
| `ig_respond_collaboration_invite` | write | Accept or decline a collaboration invite. |
| `ig_search_hashtag` | read | Search for a hashtag ID by name. |
| `ig_get_hashtag` | read | Get hashtag information by ID. |
| `ig_get_hashtag_recent` | read | Get recent media (last 24h) tagged with a specific hashtag. |
| `ig_get_hashtag_top` | read | Get top (most popular) media tagged with a specific hashtag. |
| `ig_get_mentioned_comments` | read | Get a comment where the account was @mentioned (comment ID from a mention webhook). |
| `ig_get_mentioned_media` | read | Get a media post whose caption @mentions the account (media ID from a mention webhook). |
| `ig_reply_to_mention` | write | Comment on a post (or reply to a comment) where the account was @mentioned. |
| `ig_get_tagged_media` | read | Get media where the account is tagged (photo tags, not @mentions). |
| `ig_get_conversations` | read | Get Instagram DM conversations of the account. |
| `ig_get_messages` | read | Get messages in a specific DM conversation. |
| `ig_get_message` | read | Get details of a specific DM message. |
| `ig_send_message` | write | Send an Instagram DM: text (optionally with quick replies or as a reply to a message) or one attachment (image, video, audio or file, by public URL or attachment_id). |
| `ig_private_reply` | write | Reply privately (in the DM inbox) to someone who commented on the account's post or reel. |
| `ig_send_reaction` | write | React to (or remove the reaction from) a message in an Instagram DM conversation. |
| `ig_sender_action` | write | Show a typing indicator or mark the conversation as seen in an Instagram DM. |

### Threads (28)

| Tool | Kind | Description |
|------|------|-------------|
| `threads_publish_text` | write | Publish a text-only post on Threads. |
| `threads_publish_image` | write | Publish an image post on Threads. |
| `threads_publish_video` | write | Publish a video post on Threads. |
| `threads_publish_carousel` | write | Publish a carousel post on Threads with 2-20 images/videos. |
| `threads_repost` | write | Repost a Threads post to the account's profile. |
| `threads_delete_post` | destructive | Delete a Threads post. |
| `threads_get_container_status` | read | Check the processing status of a Threads media container: IN_PROGRESS, FINISHED (ready), PUBLISHED, ERROR (with error_message) or EXPIRED. |
| `threads_get_publishing_limit` | read | Check the account's remaining Threads quotas in the current 24-hour window (posts, replies, deletes, location searches). |
| `threads_get_posts` | read | Get a list of the account's published Threads posts. |
| `threads_get_post` | read | Get details of a specific Threads post. |
| `threads_get_profile_posts` | read | Get a public profile's posts by username (Profile Discovery). |
| `threads_search_posts` | read | Search for public Threads posts by keyword or topic tag via the /keyword_search endpoint. |
| `threads_get_replies` | read | Get top-level replies to a specific Threads post. |
| `threads_get_conversation` | read | Get a flattened list of all replies (top-level and nested) to a Threads post, in chronological or reverse-chronological order. |
| `threads_reply` | write | Reply to a Threads post or another reply as the account. |
| `threads_hide_reply` | destructive | Hide a reply on your Threads post. |
| `threads_unhide_reply` | destructive | Unhide a previously hidden reply on your Threads post. |
| `threads_get_pending_replies` | read | Get pending/ignored replies awaiting approval on a post that has reply approvals enabled (enable_reply_approvals). |
| `threads_manage_pending_reply` | write | Approve or ignore a pending reply on a post with reply approvals enabled. |
| `threads_get_profile` | read | Get the account's Threads profile information including verification status. |
| `threads_lookup_profile` | read | Look up a public Threads user's profile by username (Profile Discovery). |
| `threads_get_user_threads` | read | Get all threads published by the account (lighter field set than threads_get_posts). |
| `threads_get_post_insights` | read | Get insights for a specific Threads post (views, likes, replies, reposts, quotes, shares). |
| `threads_get_user_insights` | read | Get account-level Threads insights: views, likes, replies, reposts, quotes, clicks (link clicks, returned as link_total_values), followers_count, follower_demographics (needs breakdown and 100+ followers). |
| `threads_get_mentions` | read | Get public Threads posts where the account has been @mentioned by another profile. |
| `threads_search_locations` | read | Search for locations to tag in a Threads post, by query text or by coordinates. |
| `threads_get_location` | read | Get a Threads location object by ID (from threads_search_locations or a post's location_id field). |
| `threads_get_oembed` | read | Get the embed HTML and metadata for a public Threads post, for rendering a rich preview on an external site. |

### WhatsApp (20)

| Tool | Kind | Description |
|------|------|-------------|
| `whatsapp_send_text` | write | Send a WhatsApp text message from the account's number. |
| `whatsapp_send_template` | write | Send an approved WhatsApp message template (works outside the 24-hour window; billed per message by category). |
| `whatsapp_send_media` | write | Send an image, video, audio, document or sticker by public link or by media_id (from whatsapp_upload_media). |
| `whatsapp_send_interactive` | write | Send an interactive message: reply buttons (up to 3, titles ≤20 chars), a list (up to 10 rows in total, row titles ≤24 chars), or a call-to-action URL button. |
| `whatsapp_send_location` | write | Send a location pin. |
| `whatsapp_send_reaction` | write | React to a customer's message with an emoji (empty emoji removes the reaction). |
| `whatsapp_mark_as_read` | write | Mark a received message (and the earlier ones in the chat) as read; optionally show a typing indicator for up to 25 seconds. |
| `whatsapp_upload_media` | write | Download a file from a public URL and upload it to WhatsApp for the account's number. |
| `whatsapp_get_media` | read | Get a media object's metadata and a download URL (valid for 5 minutes, needs the WhatsApp token to download). |
| `whatsapp_delete_media` | destructive | Delete an uploaded media object. |
| `whatsapp_list_templates` | read | List the message templates of the account's WhatsApp Business Account with status (APPROVED, PENDING, REJECTED, PAUSED…), category, language and quality. |
| `whatsapp_get_template` | read | Get one message template by its ID. |
| `whatsapp_create_template` | write | Submit a new message template for Meta review (status starts as PENDING). |
| `whatsapp_delete_template` | destructive | Delete a message template. |
| `whatsapp_list_phone_numbers` | read | List the phone numbers of the account's WhatsApp Business Account with verified name, quality rating (GREEN/YELLOW/RED), name status and connection status. |
| `whatsapp_get_business_profile` | read | Get the WhatsApp business profile (about, address, description, email, websites, vertical, photo) of the account's number. |
| `whatsapp_update_business_profile` | write | Update the WhatsApp business profile of the account's number. |
| `whatsapp_get_messaging_analytics` | read | Messaging analytics for the account's WhatsApp Business Account. |
| `whatsapp_get_template_analytics` | read | Daily performance of up to 10 templates: sent, delivered, read, clicked (marketing/utility) and cost. |
| `whatsapp_enable_template_insights` | write | Turn on template analytics for the account's WhatsApp Business Account. |

## Resources

| URI | Description |
|-----|-------------|
| `instagram://profile` | Default Instagram account profile |
| `instagram://profile/{account}` | Profile of any Instagram account |
| `threads://profile` | Default Threads account profile |
| `threads://profile/{account}` | Profile of any Threads account |

## Prompts

| Prompt | Description |
|--------|-------------|
| `content_publish` | Cross-post content to Instagram and Threads |
| `analytics_report` | Generate combined analytics report |

## Setup Guide

### Step 1: Create a Meta Developer App

All platforms (Instagram, Threads) require a Meta Developer App.

1. Go to [developers.facebook.com](https://developers.facebook.com) and log in
2. Click **"My Apps"** → **"Create App"**
3. Select **"Other"** → **"Business"** (or "None" for personal use)
4. Enter an app name and create

Your **`META_APP_ID`** and **`META_APP_SECRET`** are in **App Settings → Basic**.

### Step 2: Instagram Setup

> Requires an **Instagram Business or Creator account**. Switch for free in Instagram app → Settings → Account type.

1. In your Meta App, go to **"Add Products"** → add **"Instagram Graph API"**
2. Go to **"Instagram Graph API" → "Settings"** and connect your Instagram Business account via a Facebook Page
3. Open the [Graph API Explorer](https://developers.facebook.com/tools/explorer/)
   - Select your app
   - Add permissions: `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_insights`, `instagram_manage_contents`, `instagram_manage_messages`, `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`
   - Click **"Generate Access Token"** and authorize
4. The generated token is short-lived (~1 hour). Exchange it for a long-lived token (~60 days):
   ```
   GET https://graph.facebook.com/v26.0/oauth/access_token
     ?grant_type=fb_exchange_token
     &client_id=YOUR_APP_ID
     &client_secret=YOUR_APP_SECRET
     &fb_exchange_token=SHORT_LIVED_TOKEN
   ```
   Or use the `meta_exchange_token` tool after setup.
5. **Get your Instagram User ID** — call this with your token:
   ```
   GET https://graph.facebook.com/v26.0/me/accounts?fields=id,name,access_token&access_token=YOUR_TOKEN
   ```
   This returns your Facebook Pages. For each page, get the linked Instagram account:
   ```
   GET https://graph.facebook.com/v26.0/{page-id}?fields=instagram_business_account&access_token=YOUR_TOKEN
   ```
   The `instagram_business_account.id` is your **`INSTAGRAM_USER_ID`** (a numeric ID like `17841400123456789`).
   For the DM tools, the matching Page's `id` is `INSTAGRAM_PAGE_ID` and its
   `access_token` is `INSTAGRAM_MESSAGING_ACCESS_TOKEN`. Do not use the IG User
   ID or the user token in their place.

### Step 3: Threads Setup

> Works with **any Threads account** (personal or business). Instagram account link is no longer required since September 2025.

1. In your Meta App, go to **"Add Products"** → add **"Threads API"**
2. Go to **"Threads API" → "Settings"**:
   - Add your Threads account as a **Threads Tester** under "Roles"
   - Accept the invitation in the Threads app: **Settings → Account → Website permissions → Invites**
3. Generate an authorization URL:
   ```
   https://threads.net/oauth/authorize
     ?client_id=YOUR_APP_ID
     &redirect_uri=YOUR_REDIRECT_URI
     &scope=threads_basic,threads_content_publish,threads_manage_insights,threads_manage_replies,threads_read_replies,threads_keyword_search,threads_manage_mentions,threads_delete,threads_location_tagging,threads_profile_discovery
     &response_type=code
   ```
   - For local testing, use `https://localhost/` as redirect URI (configure in App Settings → Threads API → Redirect URIs)
4. After authorization, exchange the code for an access token:
   ```
   POST https://graph.threads.net/oauth/access_token
   Content-Type: application/x-www-form-urlencoded

   client_id=YOUR_APP_ID
   &client_secret=YOUR_APP_SECRET
   &grant_type=authorization_code
   &redirect_uri=YOUR_REDIRECT_URI
   &code=AUTHORIZATION_CODE
   ```
5. Exchange for a long-lived token (~60 days):
   ```
   GET https://graph.threads.net/access_token
     ?grant_type=th_exchange_token
     &client_secret=YOUR_APP_SECRET
     &access_token=SHORT_LIVED_TOKEN
   ```
6. **Get your Threads User ID** — call this with your token:
   ```
   GET https://graph.threads.net/v1.0/me?fields=id,username&access_token=YOUR_TOKEN
   ```
   The `id` field is your **`THREADS_USER_ID`** (a numeric ID like `1234567890`).

### Step 4: Configure Environment Variables

Set only the variables for the platforms you use:

```bash
# Instagram (requires Business/Creator account)
INSTAGRAM_ACCESS_TOKEN=EAAxxxxxxx...     # Long-lived token from Step 2
INSTAGRAM_USER_ID=17841400123456789      # Numeric ID from Step 2.5
INSTAGRAM_MESSAGING_ACCESS_TOKEN=EAA...  # Page token from Step 2.5 (DM tools only)
INSTAGRAM_PAGE_ID=123456789012345        # Linked Facebook Page ID (DM tools only)

# Threads (any account)
THREADS_ACCESS_TOKEN=THQWxxxxxxx...      # Long-lived token from Step 3
THREADS_USER_ID=1234567890               # Numeric ID from Step 3.6

# Meta App (for token management & webhooks)
META_APP_ID=123456789012345              # From App Settings → Basic
META_APP_SECRET=abcdef0123456789abcdef   # From App Settings → Basic
```

### Token Renewal

Access tokens expire after ~60 days. Refresh before expiration:

- **Instagram**: Use `meta_refresh_token` with `platform=instagram` (requires `META_APP_ID` and `META_APP_SECRET`)
- **Threads**: Use `meta_refresh_token` with `platform=threads` or call:
  ```
  GET https://graph.threads.net/refresh_access_token
    ?grant_type=th_refresh_token
    &access_token=CURRENT_LONG_LIVED_TOKEN
  ```

You can check token status anytime with `meta_debug_token`.

## Deprecated Metrics (v22.0+)

The following Instagram metrics were deprecated in Graph API v22.0 (January 2025) and removed for all versions on April 21, 2025:

| Deprecated Metric | Replacement |
|-------------------|-------------|
| `impressions` | `views` |
| `video_views` | `views` |
| `plays` | `views` |
| `clips_replays_count` | `views` |
| `engagement` | `saves` + `shares` + `likes` + `comments` |
| `email_contacts` | Removed (no replacement) |
| `phone_call_clicks` | Removed (no replacement) |
| `text_message_clicks` | Removed (no replacement) |
| `get_directions_clicks` | Removed (no replacement) |
| `website_clicks` | Removed (no replacement) |
| `profile_views` | Removed (no replacement) |

## License

MIT
