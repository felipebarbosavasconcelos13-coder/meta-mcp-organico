import test from "node:test";
import assert from "node:assert/strict";
import { captureTools, graphError, json, makeClient, text, FakeCall } from "./helpers.js";
import { registerIgPublishingTools } from "../src/tools/instagram/publishing.js";
import { registerIgProfileTools } from "../src/tools/instagram/profile.js";
import { registerIgMessagingTools } from "../src/tools/instagram/messaging.js";
import { registerIgMediaTools } from "../src/tools/instagram/media.js";
import { registerThreadsPublishingTools } from "../src/tools/threads/publishing.js";
import { registerThreadsReplyTools } from "../src/tools/threads/replies.js";
import { registerMetaAuthTools } from "../src/tools/meta/auth.js";

const PAGES = {
  data: [
    { id: "p1", name: "Genial", access_token: "PAGE_TOKEN_GENIAL_123", instagram_business_account: { id: "ig1", username: "genial" } },
    { id: "p2", name: "Rander", access_token: "PAGE_TOKEN_RANDER_123", instagram_business_account: { id: "ig2", username: "drrander" } },
  ],
};

function path(call: FakeCall) {
  return call.url.pathname.replace(/^\/(v26\.0|v1\.0)/, "");
}

function token(call: FakeCall) {
  return call.url.searchParams.get("access_token") ?? call.body?.access_token;
}

test("reads and publishes on the requested account; page token used for DMs", async () => {
  const { client, calls } = makeClient({ instagramAccessToken: "USER_TOKEN_123456" }, (call) => {
    const p = path(call);
    if (p === "/me/accounts") return PAGES;
    if (p === "/ig2" ) return { id: "ig2", username: "drrander" };
    if (p === "/ig2/media") return { id: "container-1" };
    if (p === "/container-1") return { status_code: "FINISHED" };
    if (p === "/ig2/media_publish") return { id: "media-9" };
    if (p === "/p2/messages") return { message_id: "m1" };
    return {};
  });
  const { run } = captureTools(client, registerIgProfileTools, registerIgPublishingTools, registerIgMessagingTools);

  const profile = json(await run("ig_get_profile", { account: "@drrander" }));
  assert.equal(profile._account, "drrander");

  const published = json(await run("ig_publish_photo", { account: "drrander", image_url: "https://example.com/a.jpg" }));
  assert.equal(published.id, "media-9");
  assert.equal(published.container_id, "container-1");
  assert.ok(calls.some((c) => path(c) === "/ig2/media_publish" && token(c) === "USER_TOKEN_123456"));

  await run("ig_send_message", { account: "drrander", recipient_id: "u1", message: "Oi" });
  const dm = calls.find((c) => path(c) === "/p2/messages")!;
  assert.equal(token(dm), "PAGE_TOKEN_RANDER_123");
  assert.deepEqual(dm.body.recipient, { id: "u1" });
});

test("write tools without account fail with the options and make no publish call", async () => {
  const { client, calls } = makeClient({ instagramAccessToken: "USER_TOKEN_123456" }, (call) => (path(call) === "/me/accounts" ? PAGES : {}));
  const { run } = captureTools(client, registerIgPublishingTools);
  const result = await run("ig_publish_photo", { image_url: "https://example.com/a.jpg" });
  assert.equal(result.isError, true);
  assert.match(text(result), /"account" is required.*genial.*drrander/s);
  assert.equal(calls.filter((c) => c.method === "POST").length, 0);
});

test("publish error with a PUBLISHED container is reported as success, not retried", async () => {
  const { client, calls } = makeClient({ instagramAccessToken: "T_123456789", instagramUserId: "ig1", discoverInstagram: false }, (call) => {
    const p = path(call);
    if (p === "/ig1/media" && call.method === "POST") return { id: "c1" };
    if (p === "/c1") return { status_code: calls.some((c) => path(c) === "/ig1/media_publish") ? "PUBLISHED" : "FINISHED" };
    if (p === "/ig1/media_publish") return graphError(500, 2, "Service temporarily unavailable");
    if (p === "/ig1/media") return { data: [{ id: "media-1", permalink: "https://instagram.com/p/x" }] };
    return {};
  });
  const { run } = captureTools(client, registerIgPublishingTools);
  const result = json(await run("ig_publish_photo", { image_url: "https://example.com/a.jpg" }));
  assert.equal(result.status, "PUBLISHED");
  assert.equal(result.id, "media-1");
  assert.equal(calls.filter((c) => path(c) === "/ig1/media_publish").length, 1, "POST is never retried");
});

test("publish error with an unpublished container keeps the container id in the error", async () => {
  const { client } = makeClient({ instagramAccessToken: "T_123456789", instagramUserId: "ig1", discoverInstagram: false }, (call) => {
    const p = path(call);
    if (p === "/ig1/media") return { id: "c1" };
    if (p === "/c1") return { status_code: "FINISHED" };
    if (p === "/ig1/media_publish") return graphError(400, 9007, "Media ID is not available");
    return {};
  });
  const { run } = captureTools(client, registerIgPublishingTools);
  const result = await run("ig_publish_photo", { image_url: "https://example.com/a.jpg" });
  assert.equal(result.isError, true);
  assert.match(text(result), /container_id c1/);
  assert.match(text(result), /not ready yet/);
});

test("Threads text posts and replies wait for the container before publishing, per account token", async () => {
  const file = JSON.stringify({ accounts: { genial: { threads: { token_env: "TH_GENIAL" } }, rander: { threads: { token_env: "TH_RANDER", user_id: "th2" } } } });
  let statusPolls = 0;
  const { client, calls } = makeClient({ accountsFile: "a.json", discoverInstagram: false }, (call) => {
    const p = path(call);
    if (p === "/me") return { id: "th1", username: "genial" };
    if (p.endsWith("/threads") && call.method === "POST") return { id: "tc1" };
    if (p === "/tc1") return { status: ++statusPolls < 2 ? "IN_PROGRESS" : "FINISHED" };
    if (p.endsWith("/threads_publish")) return { id: "post-1" };
    return {};
  }, { env: { TH_GENIAL: "THREADS_GENIAL_TOKEN", TH_RANDER: "THREADS_RANDER_TOKEN" }, files: { "a.json": file } });
  const { run } = captureTools(client, registerThreadsPublishingTools, registerThreadsReplyTools);

  const posted = json(await run("threads_publish_text", { account: "genial", text: "Olá" }));
  assert.equal(posted.id, "post-1");
  const sequence = calls.map((c) => `${c.method} ${path(c)}`);
  assert.deepEqual(sequence, ["GET /me", "POST /th1/threads", "GET /tc1", "GET /tc1", "POST /th1/threads_publish"]);
  assert.ok(calls.every((c) => token(c) === "THREADS_GENIAL_TOKEN"));

  calls.length = 0;
  statusPolls = 5;
  await run("threads_reply", { account: "rander", reply_to_id: "x", text: "Valeu" });
  assert.deepEqual(calls.map((c) => `${c.method} ${path(c)}`), ["POST /th2/threads", "GET /tc1", "POST /th2/threads_publish"]);
  assert.ok(calls.every((c) => token(c) === "THREADS_RANDER_TOKEN"));
});

test("paging links and errors never carry access tokens", async () => {
  const { client } = makeClient({ instagramAccessToken: "USER_TOKEN_SECRET_123", instagramUserId: "ig1", discoverInstagram: false }, (call) => {
    if (path(call) === "/ig1/media") {
      return {
        data: [{ id: "m1" }],
        paging: { next: "https://graph.facebook.com/v26.0/ig1/media?access_token=USER_TOKEN_SECRET_123&after=abc" },
      };
    }
    return graphError(400, 100, "Bad request for token USER_TOKEN_SECRET_123");
  });
  const { run } = captureTools(client, registerIgMediaTools);
  const list = text(await run("ig_get_media_list", {}));
  assert.ok(!list.includes("USER_TOKEN_SECRET_123"));
  assert.match(list, /access_token=REDACTED&after=abc/);
  const failed = text(await run("ig_get_media", { media_id: "m1" }));
  assert.ok(!failed.includes("USER_TOKEN_SECRET_123"));
});

test("transient GET errors are retried; throttling is reported without retrying", async () => {
  let attempts = 0;
  const { client } = makeClient({ instagramAccessToken: "T_123456789", instagramUserId: "ig1", discoverInstagram: false }, () => {
    attempts++;
    return attempts === 1 ? graphError(500, 2, "temporary") : { id: "ig1", username: "genial" };
  });
  const { run } = captureTools(client, registerIgProfileTools);
  assert.equal(json(await run("ig_get_profile")).username, "genial");
  assert.equal(attempts, 2);

  let throttled = 0;
  const second = makeClient({ instagramAccessToken: "T_123456789", instagramUserId: "ig1", discoverInstagram: false }, () => {
    throttled++;
    return graphError(400, 4, "Application request limit reached");
  });
  const result = await captureTools(second.client, registerIgProfileTools).run("ig_get_profile");
  assert.equal(result.isError, true);
  assert.match(text(result), /rate limited/);
  assert.equal(throttled, 1);
});

test("meta_list_accounts lists accounts without tokens; exchange masks the token", async () => {
  const { client } = makeClient({ instagramAccessToken: "USER_TOKEN_123456", appId: "app", appSecret: "APP_SECRET_123" }, (call) => {
    if (path(call) === "/me/accounts") return PAGES;
    if (path(call) === "/oauth/access_token") return { access_token: "EAALONGLIVEDTOKEN1234567890", token_type: "bearer" };
    return {};
  });
  const { run, tools } = captureTools(client, registerMetaAuthTools);
  const listed = text(await run("meta_list_accounts", {}));
  assert.ok(!listed.includes("PAGE_TOKEN"));
  assert.equal(JSON.parse(listed).count, 2);
  assert.equal(JSON.parse(listed).accounts[0].instagram.messaging_ready, true);
  const exchanged = json(await run("meta_exchange_token", { short_lived_token: "SHORT_TOKEN_1234" }));
  assert.ok(!exchanged.access_token.includes("LONGLIVEDTOKEN1234567890"));
  assert.equal(tools.get("meta_list_accounts")?.annotations?.readOnlyHint, true);
});

test("tool annotations mark reads, writes and destructive tools", async () => {
  const { client } = makeClient({}, () => ({}));
  const { tools } = captureTools(client, registerIgMediaTools, registerIgPublishingTools);
  assert.equal(tools.get("ig_get_media_list")?.annotations?.readOnlyHint, true);
  assert.equal(tools.get("ig_publish_photo")?.annotations?.readOnlyHint, false);
  assert.equal(tools.get("ig_delete_media")?.annotations?.destructiveHint, true);
  assert.ok("account" in tools.get("ig_publish_photo")!.schema);
});
