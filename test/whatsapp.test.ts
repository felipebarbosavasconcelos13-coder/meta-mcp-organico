import test from "node:test";
import assert from "node:assert/strict";
import { captureTools, graphError, json, makeClient, text, FakeCall } from "./helpers.js";
import { registerWhatsappMessageTools } from "../src/tools/whatsapp/messages.js";
import { registerWhatsappTemplateTools } from "../src/tools/whatsapp/templates.js";
import { registerWhatsappMediaTools } from "../src/tools/whatsapp/media.js";
import { registerWhatsappAnalyticsTools } from "../src/tools/whatsapp/analytics.js";

const FILE = JSON.stringify({
  accounts: {
    bea: { whatsapp: { phone_number_id: "pn-bea", waba_id: "waba-bea", display_number: "+353 1 555 0000" } },
    nails: { whatsapp: { phone_number_id: "pn-nails", waba_id: "waba-nails", token_env: "WA_NAILS" } },
  },
});

function path(call: FakeCall) {
  return call.url.pathname.replace("/v26.0", "");
}

function setup(route: (call: FakeCall) => unknown = () => ({ messages: [{ id: "wamid.1" }] })) {
  const made = makeClient(
    { whatsappAccessToken: "WA_DEFAULT_TOKEN", accountsFile: "a.json", discoverInstagram: false, discoverWhatsapp: false },
    route,
    { env: { WA_NAILS: "WA_NAILS_TOKEN" }, files: { "a.json": FILE } }
  );
  const tools = captureTools(made.client, registerWhatsappMessageTools, registerWhatsappTemplateTools, registerWhatsappMediaTools, registerWhatsappAnalyticsTools);
  return { ...made, ...tools };
}

test("template send builds the Cloud API body for the chosen number with Bearer auth", async () => {
  const { run, calls } = setup();
  const result = json(await run("whatsapp_send_template", {
    account: "bea",
    to: "+55 (11) 99999-0000",
    template_name: "lembrete_consulta",
    language: "pt_BR",
    components: [{ type: "body", parameters: [{ type: "text", text: "Ana" }] }],
  }));
  assert.equal(result._account, "bea");
  const call = calls[0];
  assert.equal(path(call), "/pn-bea/messages");
  assert.equal(call.headers.Authorization, "Bearer WA_DEFAULT_TOKEN");
  assert.equal(call.body.access_token, undefined);
  assert.deepEqual(call.body, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: "5511999990000",
    type: "template",
    template: { name: "lembrete_consulta", language: { code: "pt_BR" }, components: [{ type: "body", parameters: [{ type: "text", text: "Ana" }] }] },
  });
});

test("per-account token_env is used and sends require account when several numbers exist", async () => {
  const { run, calls } = setup();
  await run("whatsapp_send_text", { account: "nails", to: "+5511999990000", text: "Oi" });
  assert.equal(calls[0].headers.Authorization, "Bearer WA_NAILS_TOKEN");
  const refused = await run("whatsapp_send_text", { to: "+5511999990000", text: "Oi" });
  assert.equal(refused.isError, true);
  assert.match(text(refused), /"account" is required/);
  assert.equal(calls.length, 1);
});

test("interactive validation and outside-window hint", async () => {
  const { run } = setup(() => graphError(400, 131047, "Re-engagement message"));
  const bad = await run("whatsapp_send_interactive", { account: "bea", to: "+5511999990000", kind: "list", body: "Escolha" });
  assert.match(text(bad), /list_button and sections are required/);
  const outside = await run("whatsapp_send_text", { account: "bea", to: "+5511999990000", text: "Oi" });
  assert.match(text(outside), /send an approved template instead/);
});

test("media send needs exactly one source; reaction and mark-as-read bodies", async () => {
  const { run, calls } = setup(() => ({ success: true }));
  const both = await run("whatsapp_send_media", { account: "bea", to: "+5511999990000", media_type: "image", link: "https://e.com/a.jpg", media_id: "1" });
  assert.equal(both.isError, true);
  await run("whatsapp_send_media", { account: "bea", to: "+5511999990000", media_type: "document", media_id: "m1", caption: "Laudo", filename: "laudo.pdf" });
  assert.deepEqual(calls[0].body.document, { id: "m1", caption: "Laudo", filename: "laudo.pdf" });
  await run("whatsapp_mark_as_read", { account: "bea", message_id: "wamid.9", typing_indicator: true });
  assert.deepEqual(calls[1].body, { messaging_product: "whatsapp", status: "read", message_id: "wamid.9", typing_indicator: { type: "text" } });
});

test("templates are listed and deleted on the account's WABA", async () => {
  const { run, calls } = setup((call) =>
    call.method === "GET"
      ? { data: [{ name: "lembrete_consulta", status: "APPROVED" }, { name: "promo", status: "REJECTED" }] }
      : { success: true }
  );
  const listed = json(await run("whatsapp_list_templates", { account: "bea", status: "approved" }));
  assert.deepEqual(listed.data.map((t: { name: string }) => t.name), ["lembrete_consulta"]);
  assert.equal(path(calls[0]), "/waba-bea/message_templates");
  await run("whatsapp_delete_template", { account: "bea", name: "promo", template_id: "123" });
  assert.equal(calls[1].method, "DELETE");
  assert.equal(calls[1].url.searchParams.get("name"), "promo");
  assert.equal(calls[1].url.searchParams.get("hsm_id"), "123");
});

test("pricing analytics uses the documented field expansion", async () => {
  const { run, calls } = setup(() => ({ pricing_analytics: { data: [] } }));
  await run("whatsapp_get_messaging_analytics", { account: "bea", kind: "pricing", start: "1767225600", end: "1769904000", dimensions: ["PRICING_CATEGORY", "COUNTRY"] });
  assert.equal(
    calls[0].url.searchParams.get("fields"),
    "pricing_analytics.start(1767225600).end(1769904000).granularity(DAILY).dimensions(PRICING_CATEGORY,COUNTRY)"
  );
});

test("media upload downloads the URL and posts multipart to the number", async () => {
  const { run, calls } = setup((call) => {
    if (call.url.hostname === "files.example.com") {
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
    }
    return { id: "media-77" };
  });
  const result = json(await run("whatsapp_upload_media", { account: "bea", url: "https://files.example.com/logo.png" }));
  assert.equal(result.id, "media-77");
  assert.equal(result.mime_type, "image/png");
  const upload = calls.find((c) => c.method === "POST")!;
  assert.equal(path(upload), "/pn-bea/media");
  assert.ok(upload.body instanceof FormData);
  assert.equal((upload.body as FormData).get("messaging_product"), "whatsapp");
});
