import { MetaConfig } from "../config.js";
import { RateLimit } from "../types.js";
import {
  buildTokenRefreshRequest,
  GRAPH_BASE,
  MetaTokenPlatform,
  THREADS_GRAPH_BASE,
} from "./api-contracts.js";
import { AccountRecord, AccountRegistry, Platform, RegistryOptions } from "./accounts.js";
import { redactSecrets, sanitizeValue } from "./sanitize.js";

export interface ClientResponse {
  data: unknown;
  rateLimit?: RateLimit;
}

export type AuthMode = "query" | "bearer";

export interface RequestOptions {
  /** WhatsApp Cloud API documents Bearer auth; Graph/Threads use the access_token parameter. */
  auth?: AuthMode;
}

export interface ClientOptions extends RegistryOptions {
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  /** Extra attempts for GET requests that fail transiently. */
  maxRetries?: number;
  timeoutMs?: number;
}

/** Error codes Meta documents as transient (safe to retry the same call shortly). */
const TRANSIENT_CODES = new Set([1, 2]);
/** Throttling codes: retrying within seconds only extends the block, so report instead. */
const THROTTLE_CODES = new Set([4, 17, 32, 341, 613]);

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
    readonly subcode?: number,
    readonly transient = false,
    readonly throttled = false
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

interface GraphErrorBody {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  is_transient?: boolean;
  fbtrace_id?: string;
  error_user_msg?: string;
  error_data?: { details?: string } | string;
}

function errorHint(code?: number, subcode?: number): string {
  if (code === undefined) return "";
  if (code === 190 || code === 102) return " Hint: the access token is invalid or expired; generate or refresh it.";
  if (code === 10 || (code >= 200 && code <= 299)) return " Hint: the token lacks a permission or task for this object.";
  if (code === 506) return " Hint: duplicate post; change the content before trying again.";
  if (code === 131047) return " Hint: more than 24 hours since the customer's last message; send an approved template instead.";
  if (code === 131026) return " Hint: the recipient cannot receive this message (not on WhatsApp, old app, or not accepted terms).";
  if (code === 132001) return " Hint: the template name or language does not exist or is not approved.";
  if (code === 9007 || subcode === 2207027) return " Hint: the media container is not ready yet; check its status before publishing.";
  if (THROTTLE_CODES.has(code) || (code >= 80000 && code < 81000)) return " Hint: rate limited; wait before calling again (more calls extend the block).";
  return "";
}

export class MetaClient {
  readonly config: MetaConfig;
  readonly accounts: AccountRegistry;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;

  constructor(config: MetaConfig, options: ClientOptions = {}) {
    this.config = config;
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args));
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.maxRetries = options.maxRetries ?? 2;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.accounts = new AccountRegistry(
      config,
      (baseUrl, token, method, path, params) => this.request(baseUrl, token, method, path, params),
      options
    );
  }

  private secrets(token?: string): string[] {
    return [token, this.config.appSecret].filter((value): value is string => Boolean(value));
  }

  private parseRateLimit(headers: Headers): RateLimit | undefined {
    const parse = (name: string) => {
      const value = headers.get(name);
      if (!value) return undefined;
      try {
        return JSON.parse(value);
      } catch {
        return undefined;
      }
    };
    const app = parse("x-app-usage");
    const business = parse("x-business-use-case-usage") as
      | Record<string, Array<Record<string, number | string>>>
      | undefined;
    if (!app && !business) return undefined;
    const rateLimit: RateLimit = {};
    if (app) {
      rateLimit.callCount = app.call_count;
      rateLimit.totalCpuTime = app.total_cputime;
      rateLimit.totalTime = app.total_time;
    }
    if (business) {
      rateLimit.business = Object.entries(business).flatMap(([businessId, entries]) =>
        (entries || []).map((entry) => ({ business_id: businessId, ...entry }))
      );
    }
    return rateLimit;
  }

  private buildError(status: number, method: string, path: string, body: unknown, token: string): MetaApiError {
    const error = (body as { error?: GraphErrorBody } | undefined)?.error;
    if (!error) {
      const text = typeof body === "string" ? body : JSON.stringify(body ?? "");
      return new MetaApiError(
        redactSecrets(`Meta API ${method} ${path} (${status}): ${text.slice(0, 500)}`, this.secrets(token)),
        status,
        undefined,
        undefined,
        status >= 500
      );
    }
    const details = typeof error.error_data === "string" ? error.error_data : error.error_data?.details;
    const parts = [
      `Meta API error on ${method} ${path} (${status}): ${error.message || "unknown error"}`,
      `(code ${error.code ?? "?"}${error.error_subcode ? `, subcode ${error.error_subcode}` : ""})`,
      error.error_user_msg ? `— ${error.error_user_msg}` : "",
      details ? `— ${details}` : "",
      error.fbtrace_id ? `[fbtrace_id ${error.fbtrace_id}]` : "",
    ].filter(Boolean);
    const code = error.code;
    const throttled = code !== undefined && (THROTTLE_CODES.has(code) || (code >= 80000 && code < 81000));
    return new MetaApiError(
      redactSecrets(parts.join(" ") + errorHint(code, error.error_subcode), this.secrets(token)),
      status,
      code,
      error.error_subcode,
      Boolean(error.is_transient) || (code !== undefined && TRANSIENT_CODES.has(code)) || (status >= 500 && !throttled),
      throttled
    );
  }

  /** Low-level request with retries for transient GET failures and token redaction. */
  async request(
    baseUrl: string,
    token: string,
    method: string,
    path: string,
    params?: Record<string, unknown>,
    options: RequestOptions = {}
  ): Promise<ClientResponse> {
    let url = `${baseUrl}${path}`;
    const headers: Record<string, string> = {};
    let body: string | undefined;
    const auth = options.auth ?? "query";
    if (token && auth === "bearer") headers.Authorization = `Bearer ${token}`;

    if (method === "GET" || method === "DELETE") {
      const qs = new URLSearchParams();
      if (token && auth === "query") qs.set("access_token", token);
      for (const [key, value] of Object.entries(params || {})) {
        if (value === undefined || value === null || value === "") continue;
        qs.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
      }
      const query = qs.toString();
      if (query) url += `?${query}`;
    } else {
      const payload: Record<string, unknown> = { ...params };
      if (token && auth === "query") payload.access_token = token;
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(payload);
    }

    const retries = method === "GET" ? this.maxRetries : 0;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method,
          headers,
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        const message = redactSecrets(
          `Meta API ${method} ${path} failed: ${error instanceof Error ? error.message : String(error)}`,
          this.secrets(token)
        );
        if (attempt < retries) {
          await this.sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new MetaApiError(message, 0, undefined, undefined, true);
      }

      const rateLimit = this.parseRateLimit(res.headers);
      const contentType = res.headers.get("content-type") || "";
      const raw = await res.text().catch(() => "");
      let parsed: unknown = raw;
      if (contentType.includes("json") || /^\s*[{[]/.test(raw)) {
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch {
          parsed = raw;
        }
      }

      const failed = !res.ok || Boolean((parsed as { error?: unknown } | null)?.error);
      if (failed) {
        const error = this.buildError(res.status, method, path, parsed, token);
        if (error.transient && attempt < retries) {
          await this.sleep(1000 * 2 ** attempt);
          continue;
        }
        throw error;
      }

      const data = typeof parsed === "string" ? parsed || { success: true } : parsed;
      return { data: sanitizeValue(data), rateLimit };
    }
  }

  /** Multipart upload (WhatsApp media). Never retried. */
  async upload(
    baseUrl: string,
    token: string,
    path: string,
    form: FormData
  ): Promise<ClientResponse> {
    const res = await this.fetchImpl(`${baseUrl}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(Math.max(this.timeoutMs, 120_000)),
    });
    const raw = await res.text().catch(() => "");
    let parsed: unknown = raw;
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      /* keep text */
    }
    if (!res.ok || (parsed as { error?: unknown } | null)?.error) {
      throw this.buildError(res.status, "POST", path, parsed, token);
    }
    return { data: sanitizeValue(parsed), rateLimit: this.parseRateLimit(res.headers) };
  }

  /** Fetch a public file (for WhatsApp uploads from a URL). */
  async download(url: string): Promise<{ blob: Blob; contentType: string; filename: string }> {
    const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`Download of ${url} failed (${res.status}).`);
    const contentType = res.headers.get("content-type")?.split(";")[0].trim() || "application/octet-stream";
    const filename = new URL(url).pathname.split("/").pop() || "file";
    return { blob: await res.blob(), contentType, filename };
  }

  // ─── default-account shortcuts (kept for compatibility) ───────

  async ig(method: string, path: string, params?: Record<string, unknown>): Promise<ClientResponse> {
    if (!this.config.instagramAccessToken) throw new Error("INSTAGRAM_ACCESS_TOKEN is not configured.");
    return this.request(GRAPH_BASE, this.config.instagramAccessToken, method, path, params);
  }

  async threads(method: string, path: string, params?: Record<string, unknown>): Promise<ClientResponse> {
    if (!this.config.threadsAccessToken) throw new Error("THREADS_ACCESS_TOKEN is not configured.");
    return this.request(THREADS_GRAPH_BASE, this.config.threadsAccessToken, method, path, params);
  }

  async threadsOembed(params: Record<string, unknown>): Promise<ClientResponse> {
    return this.request(THREADS_GRAPH_BASE, "", "GET", "/oembed", params);
  }

  async meta(method: string, path: string, params?: Record<string, unknown>): Promise<ClientResponse> {
    if (!this.config.appId || !this.config.appSecret) {
      throw new Error("META_APP_ID and META_APP_SECRET are required.");
    }
    const appToken = `${this.config.appId}|${this.config.appSecret}`;
    return this.request(GRAPH_BASE, appToken, method, path, params);
  }

  /** Exchange short-lived token for long-lived token */
  async exchangeToken(shortToken: string): Promise<ClientResponse> {
    if (!this.config.appId || !this.config.appSecret) {
      throw new Error("META_APP_ID and META_APP_SECRET are required for token exchange.");
    }
    return this.request(GRAPH_BASE, shortToken, "GET", "/oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: this.config.appId,
      client_secret: this.config.appSecret,
      fb_exchange_token: shortToken,
    });
  }

  /** Extend an Instagram/Facebook token or refresh a Threads long-lived token. */
  async refreshToken(longToken: string, platform: MetaTokenPlatform): Promise<ClientResponse> {
    const spec = buildTokenRefreshRequest(platform, longToken, this.config.appId, this.config.appSecret);
    return this.request(spec.baseUrl, spec.token, "GET", spec.path, spec.params);
  }

  /** Debug a token */
  async debugToken(inputToken: string): Promise<ClientResponse> {
    if (!this.config.appId || !this.config.appSecret) {
      throw new Error("META_APP_ID and META_APP_SECRET are required for token debug.");
    }
    const appToken = `${this.config.appId}|${this.config.appSecret}`;
    return this.request(GRAPH_BASE, appToken, "GET", "/debug_token", { input_token: inputToken });
  }

  // ─── account scoping ─────────────────────────────────────────

  /**
   * Resolve `account` for a platform and return a client bound to that account's IDs and tokens.
   * Write tools pass `write: true`: with several accounts and no `account`, resolution fails.
   */
  async scope(account: string | undefined, platform: Platform, options: { write?: boolean } = {}): Promise<ScopedClient> {
    const record = await this.accounts.resolve(account, platform, options);
    return new ScopedClient(this, record, platform);
  }
}

export class ScopedClient {
  constructor(
    private readonly client: MetaClient,
    readonly record: AccountRecord,
    readonly platform: Platform
  ) {}

  get account(): { key: string; label?: string } {
    return { key: this.record.key, label: this.record.label };
  }

  private get config() {
    return this.client.config;
  }

  private envValue(name?: string) {
    return this.client.accounts.envValue(name);
  }

  // ─── Instagram ───

  private get igToken(): string {
    const ig = this.record.instagram;
    const token = ig?.tokenEnv ? this.envValue(ig.tokenEnv) : this.config.instagramAccessToken;
    if (!token) {
      throw new Error(
        ig?.tokenEnv
          ? `Env var ${ig.tokenEnv} (Instagram token for "${this.record.key}") is not set.`
          : "INSTAGRAM_ACCESS_TOKEN is not configured."
      );
    }
    return token;
  }

  get igUserId(): string {
    const id = this.record.instagram?.userId;
    if (!id) throw new Error(`Account "${this.record.key}" has no Instagram user ID.`);
    return id;
  }

  get instagramPageId(): string {
    const id = this.record.instagram?.pageId;
    if (!id) {
      throw new Error(
        `Account "${this.record.key}" has no linked Facebook Page ID. Instagram Messaging needs it (INSTAGRAM_PAGE_ID or discovery via /me/accounts).`
      );
    }
    return id;
  }

  async ig(method: string, path: string, params?: Record<string, unknown>): Promise<ClientResponse> {
    return this.client.request(GRAPH_BASE, this.igToken, method, path, params);
  }

  async igMessaging(method: string, path: string, params?: Record<string, unknown>): Promise<ClientResponse> {
    const ig = this.record.instagram;
    const token = this.envValue(ig?.pageTokenEnv) || ig?.pageToken;
    if (!token) {
      throw new Error(
        `No Page access token for "${this.record.key}". Instagram Messaging needs a Page token with the MESSAGE task: discovered from /me/accounts, INSTAGRAM_MESSAGING_ACCESS_TOKEN, or page_token_env in the accounts file.`
      );
    }
    return this.client.request(GRAPH_BASE, token, method, path, params);
  }

  // ─── Threads ───

  private get threadsToken(): string {
    const token = this.record.threads?.token;
    if (!token) {
      throw new Error(
        `Threads token for "${this.record.key}" is not set (env var ${this.record.threads?.tokenEnv || "THREADS_ACCESS_TOKEN"}).`
      );
    }
    return token;
  }

  async threads(method: string, path: string, params?: Record<string, unknown>): Promise<ClientResponse> {
    return this.client.request(THREADS_GRAPH_BASE, this.threadsToken, method, path, params);
  }

  /** Threads user ID; looked up with the account token when the config does not name it. */
  async threadsUserId(): Promise<string> {
    const threads = this.record.threads;
    if (threads?.userId) return threads.userId;
    const { data } = await this.threads("GET", "/me", { fields: "id,username" });
    const me = data as { id?: string; username?: string };
    if (!me.id) throw new Error(`Could not resolve the Threads user ID for "${this.record.key}".`);
    this.client.accounts.rememberThreadsIdentity(this.record, me.id, me.username);
    return me.id;
  }

  // ─── WhatsApp ───

  private get waToken(): string {
    const wa = this.record.whatsapp;
    const token = wa?.tokenEnv
      ? this.envValue(wa.tokenEnv)
      : this.config.whatsappAccessToken || this.config.instagramAccessToken;
    if (!token) {
      throw new Error(
        wa?.tokenEnv
          ? `Env var ${wa.tokenEnv} (WhatsApp token for "${this.record.key}") is not set.`
          : "WHATSAPP_ACCESS_TOKEN is not configured."
      );
    }
    return token;
  }

  get waPhoneNumberId(): string {
    const id = this.record.whatsapp?.phoneNumberId;
    if (!id) throw new Error(`Account "${this.record.key}" has no WhatsApp phone number ID.`);
    return id;
  }

  get wabaId(): string {
    const id = this.record.whatsapp?.wabaId;
    if (!id) {
      throw new Error(
        `Account "${this.record.key}" has no WhatsApp Business Account ID (waba_id in the accounts file, WHATSAPP_BUSINESS_ACCOUNT_ID, or discovery).`
      );
    }
    return id;
  }

  async wa(method: string, path: string, params?: Record<string, unknown>): Promise<ClientResponse> {
    return this.client.request(GRAPH_BASE, this.waToken, method, path, params, { auth: "bearer" });
  }

  async waUpload(path: string, form: FormData): Promise<ClientResponse> {
    return this.client.upload(GRAPH_BASE, this.waToken, path, form);
  }

  async download(url: string) {
    return this.client.download(url);
  }
}
