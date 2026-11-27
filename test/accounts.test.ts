import test from "node:test";
import assert from "node:assert/strict";
import { makeClient, FakeCall } from "./helpers.js";

const PAGES_P1 = {
  data: [
    { id: "p1", name: "Genial Soluções", access_token: "PAGE_TOKEN_GENIAL_123", instagram_business_account: { id: "ig1", username: "genialsolucoesdigitais" } },
    { id: "p2", name: "Dr Rander", access_token: "PAGE_TOKEN_RANDER_123", instagram_business_account: { id: "ig2", username: "drrander" } },
  ],
  paging: { cursors: { after: "cursor1" }, next: "https://graph.facebook.com/v26.0/me/accounts?access_token=SECRET&after=cursor1" },
};
const PAGES_P2 = {
  data: [
    { id: "p3", name: "Página sem IG", access_token: "x" },
    { id: "p4", name: "All Nails", access_token: "PAGE_TOKEN_NAILS_123", instagram_business_account: { id: "ig4", username: "allnails" } },
  ],
  paging: { cursors: { after: "cursor2" } },
};

function igRoute(call: FakeCall) {
  if (call.url.pathname === "/v26.0/me/accounts") {
    return call.url.searchParams.get("after") === "cursor1" ? PAGES_P2 : PAGES_P1;
  }
  return { ok: true };
}

test("discovery follows paging and keeps only pages with an Instagram account", async () => {
  const { client, calls } = makeClient({ instagramAccessToken: "USER_TOKEN_123456" }, igRoute);
  const records = await client.accounts.all();
  assert.deepEqual(records.map((r) => r.key).sort(), ["allnails", "drrander", "genialsolucoesdigitais"]);
  assert.equal(calls.filter((c) => c.url.pathname.endsWith("/me/accounts")).length, 2);
  // Second call uses the cursor, never the token-bearing next URL.
  assert.equal(calls[1].url.searchParams.get("after"), "cursor1");
});

test("resolution accepts key, @username, ID, page-name alias and is case-insensitive", async () => {
  const { client } = makeClient({ instagramAccessToken: "USER_TOKEN_123456" }, igRoute);
  for (const ref of ["drrander", "@DrRander", "ig2", "p2", "dr-rander"]) {
    assert.equal((await client.accounts.resolve(ref, "instagram")).key, "drrander", ref);
  }
  await assert.rejects(client.accounts.resolve("nobody", "instagram"), /Unknown account "nobody"/);
});

test("write without account is refused when several accounts exist; read needs a default", async () => {
  const { client } = makeClient({ instagramAccessToken: "USER_TOKEN_123456" }, igRoute);
  await assert.rejects(client.accounts.resolve(undefined, "instagram", { write: true }), /"account" is required/);
  await assert.rejects(client.accounts.resolve(undefined, "instagram"), /No default Instagram account/);
});

test("env account becomes the default and merges with its discovered twin", async () => {
  const { client } = makeClient(
    { instagramAccessToken: "USER_TOKEN_123456", instagramUserId: "ig1", instagramPageId: "p1" },
    igRoute
  );
  const records = await client.accounts.all();
  assert.equal(records.length, 3);
  const def = await client.accounts.resolve(undefined, "instagram");
  assert.equal(def.key, "default");
  assert.ok(def.aliases.includes("genialsolucoesdigitais"));
  assert.equal(def.instagram?.pageToken, "PAGE_TOKEN_GENIAL_123");
  // Writes still need an explicit account because three IG accounts exist.
  await assert.rejects(client.accounts.resolve(undefined, "instagram", { write: true }), /required/);
});

test("single account: writes go to it without account", async () => {
  const { client } = makeClient({ instagramAccessToken: "T", instagramUserId: "ig1", discoverInstagram: false }, () => ({}));
  assert.equal((await client.accounts.resolve(undefined, "instagram", { write: true })).key, "default");
});

test("accounts file adds aliases, default, Threads tokens by env name and links WhatsApp", async () => {
  const file = JSON.stringify({
    default: "genial",
    accounts: {
      genial: { aliases: ["gsd"], instagram: "@genialsolucoesdigitais", threads: { token_env: "TH_GENIAL", user_id: "th1" } },
      rander: { label: "Dr. Rander", instagram: "drrander", threads: { token_env: "TH_RANDER" }, whatsapp: { phone_number_id: "wa9", waba_id: "waba9" } },
    },
  });
  const { client } = makeClient(
    { instagramAccessToken: "USER_TOKEN_123456", accountsFile: "accounts.json" },
    igRoute,
    { env: { TH_GENIAL: "THREADS_TOKEN_GENIAL" }, files: { "accounts.json": file } }
  );
  const genial = await client.accounts.resolve("gsd", "threads");
  assert.equal(genial.key, "genial");
  assert.equal(genial.threads?.token, "THREADS_TOKEN_GENIAL");
  assert.equal((await client.accounts.resolve(undefined, "instagram")).key, "genial");
  const rander = await client.accounts.resolve("rander", "whatsapp");
  assert.equal(rander.instagram?.userId, "ig2");
  assert.equal(rander.whatsapp?.wabaId, "waba9");
  assert.ok(client.accounts.warnings.some((w) => w.includes("TH_RANDER")));
  // Discovered record was folded into the file entry, not duplicated.
  assert.equal((await client.accounts.all()).filter((r) => r.instagram?.userId === "ig2").length, 1);
});

test("accounts file with a UTF-8 BOM is accepted", async () => {
  const { client } = makeClient(
    { instagramAccessToken: "USER_TOKEN_123456", accountsFile: "bom.json" },
    igRoute,
    { files: { "bom.json": "﻿" + JSON.stringify({ default: "rander", accounts: { rander: { instagram: "@drrander" } } }) } }
  );
  assert.equal((await client.accounts.resolve(undefined, "instagram")).key, "rander");
  assert.deepEqual(client.accounts.errors, []);
});

test("invalid accounts file is reported, not fatal", async () => {
  const { client } = makeClient(
    { instagramAccessToken: "USER_TOKEN_123456", accountsFile: "bad.json" },
    igRoute,
    { files: { "bad.json": JSON.stringify({ accounts: { x: { threads: {} } } }) } }
  );
  assert.equal((await client.accounts.all()).length, 3);
  assert.ok(client.accounts.errors.some((e) => e.includes("Invalid accounts file")));
});

test("META_ALLOWED_ACCOUNTS blocks writes to other accounts but not reads", async () => {
  const { client } = makeClient({ instagramAccessToken: "USER_TOKEN_123456", allowedAccounts: ["@drrander"] }, igRoute);
  assert.equal((await client.accounts.resolve("drrander", "instagram", { write: true })).key, "drrander");
  await assert.rejects(client.accounts.resolve("allnails", "instagram", { write: true }), /META_ALLOWED_ACCOUNTS/);
  assert.equal((await client.accounts.resolve("allnails", "instagram")).key, "allnails");
});

test("WhatsApp discovery walks businesses, WABAs and numbers; numbers resolve by digits", async () => {
  const { client } = makeClient({ whatsappAccessToken: "WA_TOKEN_123456", discoverWhatsapp: true, discoverInstagram: false }, (call) => {
    const path = call.url.pathname.replace("/v26.0", "");
    if (path === "/me/businesses") return { data: [{ id: "biz1", name: "Agência" }] };
    if (path === "/biz1/owned_whatsapp_business_accounts") return { data: [{ id: "waba1", name: "Clínica" }] };
    if (path === "/biz1/client_whatsapp_business_accounts") return { data: [] };
    if (path === "/waba1/phone_numbers") {
      return { data: [{ id: "pn1", display_phone_number: "+55 11 99999-0000", verified_name: "Clínica Bea", quality_rating: "GREEN" }] };
    }
    return {};
  });
  const record = await client.accounts.resolve("+55 (11) 99999-0000", "whatsapp", { write: true });
  assert.equal(record.whatsapp?.phoneNumberId, "pn1");
  assert.equal(record.whatsapp?.wabaId, "waba1");
  assert.equal((await client.accounts.resolve("clinica-bea", "whatsapp")).key, record.key);
});

test("discovery failure is recorded and the env account still works", async () => {
  const { client } = makeClient(
    { instagramAccessToken: "USER_TOKEN_123456", instagramUserId: "ig1" },
    () => new Response(JSON.stringify({ error: { message: "Invalid OAuth access token", code: 190 } }), { status: 400, headers: { "content-type": "application/json" } })
  );
  assert.equal((await client.accounts.resolve(undefined, "instagram", { write: true })).key, "default");
  assert.ok(client.accounts.errors[0].includes("code 190"));
  assert.ok(!client.accounts.errors[0].includes("USER_TOKEN_123456"));
});
