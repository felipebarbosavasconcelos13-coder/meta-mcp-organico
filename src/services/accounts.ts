import { readFileSync } from "node:fs";
import { z } from "zod";
import { MetaConfig } from "../config.js";
import { GRAPH_BASE } from "./api-contracts.js";

export type Platform = "instagram" | "threads" | "whatsapp";

export const PLATFORM_LABEL: Record<Platform, string> = {
  instagram: "Instagram",
  threads: "Threads",
  whatsapp: "WhatsApp",
};

type Source = "env" | "discovered" | "file";

export interface InstagramIdentity {
  userId: string;
  username?: string;
  name?: string;
  pageId?: string;
  pageName?: string;
  /** Env var holding a user token for this account (default: INSTAGRAM_ACCESS_TOKEN). */
  tokenEnv?: string;
  /** Env var holding the Page token used for messaging. */
  pageTokenEnv?: string;
  /** Page token found by discovery. Kept in memory only, never returned. */
  pageToken?: string;
  source: Source;
}

export interface ThreadsIdentity {
  userId?: string;
  username?: string;
  tokenEnv?: string;
  /** Resolved from the environment. Kept in memory only, never returned. */
  token?: string;
  source: Source;
}

export interface WhatsappIdentity {
  phoneNumberId: string;
  displayNumber?: string;
  verifiedName?: string;
  qualityRating?: string;
  wabaId?: string;
  wabaName?: string;
  tokenEnv?: string;
  source: Source;
}

export interface AccountRecord {
  key: string;
  label?: string;
  aliases: string[];
  isDefault: boolean;
  instagram?: InstagramIdentity;
  threads?: ThreadsIdentity;
  whatsapp?: WhatsappIdentity;
}

export interface RequestFn {
  (
    baseUrl: string,
    token: string,
    method: string,
    path: string,
    params?: Record<string, unknown>
  ): Promise<{ data: unknown }>;
}

// ─── accounts file ──────────────────────────────────────────────

const instagramEntry = z.union([
  z.string().min(1),
  z.object({
    user_id: z.string().optional(),
    username: z.string().optional(),
    page_id: z.string().optional(),
    token_env: z.string().optional(),
    page_token_env: z.string().optional(),
  }),
]);

const threadsEntry = z.object({
  token_env: z.string().min(1),
  user_id: z.string().optional(),
  username: z.string().optional(),
});

const whatsappEntry = z.union([
  z.string().min(1),
  z.object({
    phone_number_id: z.string().optional(),
    display_number: z.string().optional(),
    waba_id: z.string().optional(),
    token_env: z.string().optional(),
  }),
]);

const accountsFileSchema = z.object({
  default: z.string().optional(),
  accounts: z.record(
    z.string(),
    z.object({
      label: z.string().optional(),
      aliases: z.array(z.string()).optional(),
      instagram: instagramEntry.optional(),
      threads: threadsEntry.optional(),
      whatsapp: whatsappEntry.optional(),
    })
  ),
});

export type AccountsFile = z.infer<typeof accountsFileSchema>;

export function parseAccountsFile(raw: unknown): AccountsFile {
  const parsed = accountsFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid accounts file: ${issues}`);
  }
  return parsed.data;
}

// ─── helpers ────────────────────────────────────────────────────

export function normalizeRef(ref: string): string {
  return ref.trim().replace(/^@/, "").toLowerCase();
}

export function digitsOnly(value: string | undefined): string {
  return (value || "").replace(/\D/g, "");
}

function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function recordRefs(record: AccountRecord): string[] {
  return unique([
    record.key,
    ...record.aliases,
    record.label && slug(record.label),
    record.instagram?.username,
    record.instagram?.userId,
    record.instagram?.pageId,
    record.threads?.username,
    record.threads?.userId,
    record.whatsapp?.phoneNumberId,
  ]).map(normalizeRef);
}

function matchesRef(record: AccountRecord, ref: string): boolean {
  const normalized = normalizeRef(ref);
  if (recordRefs(record).includes(normalized)) return true;
  // Phone numbers: "+55 (11) 99999-0000" matches the display number by digits.
  const digits = digitsOnly(ref);
  return (
    digits.length >= 8 &&
    /^[+\d\s().-]+$/.test(ref.trim()) &&
    digitsOnly(record.whatsapp?.displayNumber) === digits
  );
}

function describe(record: AccountRecord): string {
  const parts: string[] = [];
  if (record.instagram) parts.push(`IG @${record.instagram.username || record.instagram.userId}`);
  if (record.threads) parts.push(`Threads ${record.threads.username ? `@${record.threads.username}` : record.threads.tokenEnv || "default"}`);
  if (record.whatsapp) parts.push(`WA ${record.whatsapp.displayNumber || record.whatsapp.phoneNumberId}`);
  return `${record.key}${record.isDefault ? " (default)" : ""} [${parts.join(", ")}]`;
}

function mergeInto(target: AccountRecord, source: AccountRecord): void {
  target.aliases = unique([...target.aliases, source.key, ...source.aliases]).filter(
    (alias) => alias !== target.key
  );
  target.label ??= source.label;
  target.isDefault ||= source.isDefault;
  if (source.instagram) {
    target.instagram = target.instagram
      ? { ...source.instagram, ...stripUndefined(target.instagram) }
      : source.instagram;
  }
  if (source.threads) {
    target.threads = target.threads
      ? { ...source.threads, ...stripUndefined(target.threads) }
      : source.threads;
  }
  if (source.whatsapp) {
    target.whatsapp = target.whatsapp
      ? { ...source.whatsapp, ...stripUndefined(target.whatsapp) }
      : source.whatsapp;
  }
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
  ) as Partial<T>;
}

// ─── registry ───────────────────────────────────────────────────

export interface RegistryOptions {
  env?: NodeJS.ProcessEnv;
  /** Override the file loader (tests). */
  readFile?: (path: string) => string;
  now?: () => number;
}

export interface ResolveOptions {
  write?: boolean;
}

export class AccountRegistry {
  private records: AccountRecord[] = [];
  private loadedAt = 0;
  private loading?: Promise<void>;
  private readonly env: NodeJS.ProcessEnv;
  private readonly readFile: (path: string) => string;
  private readonly now: () => number;
  readonly warnings: string[] = [];
  readonly errors: string[] = [];

  constructor(
    private readonly config: MetaConfig,
    private readonly request: RequestFn,
    options: RegistryOptions = {}
  ) {
    this.env = options.env ?? process.env;
    this.readFile = options.readFile ?? ((path) => readFileSync(path, "utf8"));
    this.now = options.now ?? Date.now;
  }

  /** Value of an env var named in the accounts file. */
  envValue(name: string | undefined): string | undefined {
    return name ? this.env[name] || undefined : undefined;
  }

  get allowedAccounts(): string[] {
    return this.config.allowedAccounts;
  }

  async all(options: { refresh?: boolean } = {}): Promise<AccountRecord[]> {
    await this.ensureLoaded(options.refresh);
    return this.records;
  }

  async resolve(
    ref: string | undefined,
    platform: Platform,
    options: ResolveOptions = {}
  ): Promise<AccountRecord> {
    await this.ensureLoaded();
    const label = PLATFORM_LABEL[platform];
    const candidates = this.records.filter((record) => record[platform]);
    let record: AccountRecord | undefined;

    if (ref && ref.trim()) {
      let matches = this.records.filter((item) => matchesRef(item, ref));
      if (matches.length === 0 && this.now() - this.loadedAt > 60_000) {
        // A client account may have been added since the last discovery.
        await this.ensureLoaded(true);
        matches = this.records.filter((item) => matchesRef(item, ref));
      }
      if (matches.length > 1) {
        throw new Error(
          `Account "${ref}" is ambiguous; it matches ${matches.map((item) => item.key).join(", ")}. Use the account key.`
        );
      }
      record = matches[0];
      if (!record) {
        throw new Error(
          `Unknown account "${ref}". ${label} accounts available: ${this.optionList(candidates)}. Run meta_list_accounts to see every account.`
        );
      }
      if (!record[platform]) {
        throw new Error(
          `Account "${record.key}" has no ${label} identity configured. ${label} accounts available: ${this.optionList(candidates)}.`
        );
      }
    } else {
      if (candidates.length === 0) {
        throw new Error(this.missingPlatformMessage(platform));
      }
      if (options.write && candidates.length > 1) {
        throw new Error(
          `This tool changes data and ${candidates.length} ${label} accounts are available, so "account" is required. Options: ${this.optionList(candidates)}.`
        );
      }
      record =
        candidates.find((item) => item.isDefault) ??
        (candidates.length === 1 ? candidates[0] : undefined);
      if (!record) {
        throw new Error(
          `No default ${label} account is set; pass "account". Options: ${this.optionList(candidates)}.`
        );
      }
    }

    if (options.write && !this.isWritable(record)) {
      throw new Error(
        `Account "${record.key}" is not in META_ALLOWED_ACCOUNTS, so write tools cannot target it.`
      );
    }
    return record;
  }

  isWritable(record: AccountRecord): boolean {
    const allowed = this.config.allowedAccounts.map(normalizeRef);
    if (allowed.length === 0) return true;
    return recordRefs(record).some((ref) => allowed.includes(ref));
  }

  private optionList(records: AccountRecord[]): string {
    if (records.length === 0) return "none";
    const shown = records.slice(0, 30).map(describe).join("; ");
    return records.length > 30 ? `${shown}; … (${records.length - 30} more)` : shown;
  }

  private missingPlatformMessage(platform: Platform): string {
    switch (platform) {
      case "instagram":
        return "No Instagram account is configured. Set INSTAGRAM_ACCESS_TOKEN (accounts are discovered from it) or INSTAGRAM_USER_ID.";
      case "threads":
        return "No Threads account is configured. Set THREADS_ACCESS_TOKEN, or add accounts with threads.token_env to META_ACCOUNTS_FILE.";
      case "whatsapp":
        return "No WhatsApp number is configured. Set WHATSAPP_ACCESS_TOKEN (numbers are discovered from it) or WHATSAPP_PHONE_NUMBER_ID.";
    }
  }

  private async ensureLoaded(force = false): Promise<void> {
    const fresh = this.loadedAt > 0 && this.now() - this.loadedAt < this.config.accountsTtlSeconds * 1000;
    if (!force && fresh) return;
    if (!this.loading) {
      this.loading = this.load().finally(() => {
        this.loading = undefined;
      });
    }
    await this.loading;
  }

  private async load(): Promise<void> {
    this.warnings.length = 0;
    this.errors.length = 0;
    const records: AccountRecord[] = [];

    const envRecord = this.envRecord();
    if (envRecord) records.push(envRecord);

    const discovered = [
      ...(await this.discoverInstagram()),
      ...(await this.discoverWhatsapp()),
    ];
    for (const record of discovered) {
      const owner = records.find(
        (item) =>
          (record.instagram && item.instagram?.userId === record.instagram.userId) ||
          (record.whatsapp && item.whatsapp?.phoneNumberId === record.whatsapp.phoneNumberId)
      );
      if (owner) mergeInto(owner, record);
      else records.push(record);
    }

    this.applyFile(records);

    const fileDefault = this.fileData?.default;
    if (fileDefault) {
      const target = records.find((item) => matchesRef(item, fileDefault));
      if (target) {
        for (const item of records) item.isDefault = item === target;
      } else {
        this.warnings.push(`Default account "${fileDefault}" from the accounts file was not found.`);
      }
    }
    if (!records.some((item) => item.isDefault) && records.length === 1) {
      records[0].isDefault = true;
    }

    for (const record of records) {
      if (record.threads && !record.threads.token) {
        this.warnings.push(
          `Threads for "${record.key}" has no token: env var ${record.threads.tokenEnv || "THREADS_ACCESS_TOKEN"} is not set.`
        );
      }
    }

    this.records = records;
    this.loadedAt = this.now();
  }

  private envRecord(): AccountRecord | undefined {
    const c = this.config;
    const record: AccountRecord = { key: "default", aliases: [], isDefault: true };
    if (c.instagramUserId) {
      record.instagram = {
        userId: c.instagramUserId,
        pageId: c.instagramPageId || undefined,
        pageTokenEnv: c.instagramMessagingAccessToken ? "INSTAGRAM_MESSAGING_ACCESS_TOKEN" : undefined,
        source: "env",
      };
    }
    if (c.threadsAccessToken) {
      record.threads = {
        userId: c.threadsUserId || undefined,
        token: c.threadsAccessToken,
        source: "env",
      };
    }
    if (c.whatsappPhoneNumberId) {
      record.whatsapp = {
        phoneNumberId: c.whatsappPhoneNumberId,
        wabaId: c.whatsappBusinessAccountId || undefined,
        source: "env",
      };
    }
    return record.instagram || record.threads || record.whatsapp ? record : undefined;
  }

  private async paged(
    token: string,
    path: string,
    params: Record<string, unknown>,
    maxPages = 20
  ): Promise<Array<Record<string, any>>> {
    const items: Array<Record<string, any>> = [];
    let after: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const { data } = await this.request(GRAPH_BASE, token, "GET", path, {
        limit: 100,
        ...params,
        ...(after ? { after } : {}),
      });
      const body = data as { data?: Array<Record<string, any>>; paging?: { next?: string; cursors?: { after?: string } } };
      items.push(...(body.data || []));
      after = body.paging?.next ? body.paging.cursors?.after : undefined;
      if (!after) break;
    }
    return items;
  }

  private async discoverInstagram(): Promise<AccountRecord[]> {
    const token = this.config.instagramAccessToken;
    if (!this.config.discoverInstagram || !token) return [];
    try {
      const pages = await this.paged(token, "/me/accounts", {
        fields: "id,name,access_token,instagram_business_account{id,username,name}",
      });
      return pages
        .filter((page) => page.instagram_business_account?.id)
        .map((page) => {
          const ig = page.instagram_business_account;
          const username: string | undefined = ig.username;
          return {
            key: normalizeRef(username || ig.id),
            label: ig.name || page.name,
            aliases: unique([page.name && slug(page.name)]),
            isDefault: false,
            instagram: {
              userId: String(ig.id),
              username,
              name: ig.name,
              pageId: String(page.id),
              pageName: page.name,
              pageToken: page.access_token,
              source: "discovered" as const,
            },
          };
        });
    } catch (error) {
      this.errors.push(`Instagram discovery failed: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  private async discoverWhatsapp(): Promise<AccountRecord[]> {
    const token = this.config.whatsappAccessToken || this.config.instagramAccessToken;
    if (!this.config.discoverWhatsapp || !token) return [];
    const wabas = new Map<string, string | undefined>();
    if (this.config.whatsappBusinessAccountId) wabas.set(this.config.whatsappBusinessAccountId, undefined);
    try {
      let businessIds = this.config.whatsappBusinessIds;
      if (businessIds.length === 0) {
        businessIds = (await this.paged(token, "/me/businesses", { fields: "id,name" })).map((biz) => String(biz.id));
      }
      for (const businessId of businessIds) {
        for (const edge of ["owned_whatsapp_business_accounts", "client_whatsapp_business_accounts"]) {
          try {
            for (const waba of await this.paged(token, `/${businessId}/${edge}`, { fields: "id,name" })) {
              wabas.set(String(waba.id), waba.name);
            }
          } catch (error) {
            this.warnings.push(`WhatsApp ${edge} of business ${businessId}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    } catch (error) {
      this.errors.push(`WhatsApp business discovery failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    const records: AccountRecord[] = [];
    for (const [wabaId, wabaName] of wabas) {
      try {
        const numbers = await this.paged(token, `/${wabaId}/phone_numbers`, {
          fields: "id,display_phone_number,verified_name,quality_rating",
        });
        for (const number of numbers) {
          const digits = digitsOnly(number.display_phone_number);
          records.push({
            key: `wa-${digits || number.id}`,
            label: number.verified_name,
            aliases: unique([digits, number.verified_name && slug(number.verified_name)]),
            isDefault: false,
            whatsapp: {
              phoneNumberId: String(number.id),
              displayNumber: number.display_phone_number,
              verifiedName: number.verified_name,
              qualityRating: number.quality_rating,
              wabaId,
              wabaName,
              source: "discovered",
            },
          });
        }
      } catch (error) {
        this.errors.push(`WhatsApp numbers of WABA ${wabaId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return records;
  }

  private fileData?: AccountsFile;

  private applyFile(records: AccountRecord[]): void {
    this.fileData = undefined;
    const path = this.config.accountsFile;
    if (!path) return;
    let file: AccountsFile;
    try {
      file = parseAccountsFile(JSON.parse(this.readFile(path)));
    } catch (error) {
      this.errors.push(`Accounts file ${path}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    this.fileData = file;

    for (const [rawKey, entry] of Object.entries(file.accounts)) {
      const key = normalizeRef(rawKey);
      const matched = new Set<AccountRecord>();
      const byKey = records.find((item) => item.key === key);
      if (byKey) matched.add(byKey);

      // Instagram: link to a discovered/env account or define one.
      let instagram: InstagramIdentity | undefined;
      if (entry.instagram) {
        const spec = typeof entry.instagram === "string"
          ? /^\d+$/.test(entry.instagram) ? { user_id: entry.instagram } : { username: entry.instagram }
          : entry.instagram;
        const ref = spec.user_id || spec.username;
        const owner = ref
          ? records.find((item) => item.instagram && (item.instagram.userId === spec.user_id || (spec.username && normalizeRef(item.instagram.username || "") === normalizeRef(spec.username))))
          : undefined;
        if (owner) matched.add(owner);
        const base = owner?.instagram;
        const userId = spec.user_id || base?.userId;
        if (userId) {
          instagram = {
            ...(base || { source: "file" as const }),
            userId,
            username: spec.username ? spec.username.replace(/^@/, "") : base?.username,
            pageId: spec.page_id || base?.pageId,
            tokenEnv: spec.token_env || base?.tokenEnv,
            pageTokenEnv: spec.page_token_env || base?.pageTokenEnv,
          };
        } else {
          this.warnings.push(`Accounts file "${rawKey}": Instagram ${ref} was not found by discovery and has no user_id.`);
        }
      }

      let whatsapp: WhatsappIdentity | undefined;
      if (entry.whatsapp) {
        const spec = typeof entry.whatsapp === "string"
          ? digitsOnly(entry.whatsapp).length >= 8 && /[+\s()-]/.test(entry.whatsapp)
            ? { display_number: entry.whatsapp }
            : { phone_number_id: entry.whatsapp }
          : entry.whatsapp;
        const owner = records.find(
          (item) =>
            item.whatsapp &&
            ((spec.phone_number_id && item.whatsapp.phoneNumberId === spec.phone_number_id) ||
              (spec.display_number && digitsOnly(item.whatsapp.displayNumber) === digitsOnly(spec.display_number)))
        );
        if (owner) matched.add(owner);
        const base = owner?.whatsapp;
        const phoneNumberId = spec.phone_number_id || base?.phoneNumberId;
        if (phoneNumberId) {
          whatsapp = {
            ...(base || { source: "file" as const }),
            phoneNumberId,
            displayNumber: spec.display_number || base?.displayNumber,
            wabaId: spec.waba_id || base?.wabaId,
            tokenEnv: spec.token_env || base?.tokenEnv,
          };
        } else {
          this.warnings.push(`Accounts file "${rawKey}": WhatsApp ${spec.display_number} was not found by discovery and has no phone_number_id.`);
        }
      }

      const threads: ThreadsIdentity | undefined = entry.threads
        ? {
            tokenEnv: entry.threads.token_env,
            token: this.envValue(entry.threads.token_env),
            userId: entry.threads.user_id,
            username: entry.threads.username?.replace(/^@/, ""),
            source: "file",
          }
        : undefined;

      const merged: AccountRecord = {
        key,
        label: entry.label,
        aliases: unique((entry.aliases || []).map(normalizeRef)),
        isDefault: false,
      };
      for (const item of matched) {
        mergeInto(merged, item);
        records.splice(records.indexOf(item), 1);
      }
      if (instagram) merged.instagram = instagram;
      if (whatsapp) merged.whatsapp = whatsapp;
      if (threads) merged.threads = threads;
      merged.aliases = merged.aliases.filter((alias) => alias !== key);
      records.push(merged);
    }
  }

  /** Cache a Threads user ID looked up with the account's token. */
  rememberThreadsIdentity(record: AccountRecord, userId: string, username?: string): void {
    if (!record.threads) return;
    record.threads.userId = userId;
    record.threads.username ??= username;
  }
}

/** Public, token-free view of an account. */
export function summarizeAccount(record: AccountRecord, registry: AccountRegistry) {
  return {
    key: record.key,
    label: record.label,
    default: record.isDefault,
    aliases: record.aliases,
    writable: registry.isWritable(record),
    instagram: record.instagram && {
      user_id: record.instagram.userId,
      username: record.instagram.username,
      page_id: record.instagram.pageId,
      page_name: record.instagram.pageName,
      messaging_ready: Boolean(
        record.instagram.pageId &&
          (registry.envValue(record.instagram.pageTokenEnv) || record.instagram.pageToken)
      ),
      source: record.instagram.source,
    },
    threads: record.threads && {
      user_id: record.threads.userId,
      username: record.threads.username,
      token_env: record.threads.tokenEnv,
      ready: Boolean(record.threads.token),
      source: record.threads.source,
    },
    whatsapp: record.whatsapp && {
      phone_number_id: record.whatsapp.phoneNumberId,
      display_number: record.whatsapp.displayNumber,
      verified_name: record.whatsapp.verifiedName,
      quality_rating: record.whatsapp.qualityRating,
      waba_id: record.whatsapp.wabaId,
      waba_name: record.whatsapp.wabaName,
      source: record.whatsapp.source,
    },
  };
}
