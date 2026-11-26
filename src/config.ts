export interface MetaConfig {
  appId: string;
  appSecret: string;
  /** User/system-user token for Instagram (Facebook Login). Also used for account discovery. */
  instagramAccessToken: string;
  /** Default Instagram account (kept for single-account setups). */
  instagramUserId: string;
  /** Page token for Instagram Messaging of the default account. */
  instagramMessagingAccessToken: string;
  instagramPageId: string;
  /** Default Threads account token and user ID. */
  threadsAccessToken: string;
  threadsUserId: string;
  /** WhatsApp Cloud API token (falls back to instagramAccessToken). */
  whatsappAccessToken: string;
  /** Default WhatsApp phone number ID and WhatsApp Business Account ID. */
  whatsappPhoneNumberId: string;
  whatsappBusinessAccountId: string;
  /** Business (portfolio) IDs whose WhatsApp accounts are discovered. Empty = /me/businesses. */
  whatsappBusinessIds: string[];
  /** Path to the accounts JSON file (aliases, Threads tokens by env var name, links). */
  accountsFile: string;
  /** Accounts that write tools may target. Empty = all. */
  allowedAccounts: string[];
  /** Discovery cache lifetime in seconds. */
  accountsTtlSeconds: number;
  /** Turn automatic discovery off for one or both platforms. */
  discoverInstagram: boolean;
  discoverWhatsapp: boolean;
  /** Return full tokens from exchange/refresh tools instead of masked ones. */
  exposeTokens: boolean;
}

function list(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return !["0", "false", "off", "no"].includes(value.trim().toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MetaConfig {
  const instagramAccessToken = env.INSTAGRAM_ACCESS_TOKEN || "";
  const whatsappAccessToken = env.WHATSAPP_ACCESS_TOKEN || "";
  const ttl = Number(env.META_ACCOUNTS_TTL);
  return {
    appId: env.META_APP_ID || "",
    appSecret: env.META_APP_SECRET || "",
    instagramAccessToken,
    instagramUserId: env.INSTAGRAM_USER_ID || "",
    instagramMessagingAccessToken: env.INSTAGRAM_MESSAGING_ACCESS_TOKEN || "",
    instagramPageId: env.INSTAGRAM_PAGE_ID || "",
    threadsAccessToken: env.THREADS_ACCESS_TOKEN || "",
    threadsUserId: env.THREADS_USER_ID || "",
    whatsappAccessToken,
    whatsappPhoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || "",
    whatsappBusinessAccountId: env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
    whatsappBusinessIds: list(env.WHATSAPP_BUSINESS_ID),
    accountsFile: env.META_ACCOUNTS_FILE || "",
    allowedAccounts: list(env.META_ALLOWED_ACCOUNTS),
    accountsTtlSeconds: Number.isFinite(ttl) && ttl > 0 ? ttl : 900,
    discoverInstagram: flag(env.META_DISCOVER_INSTAGRAM, true),
    // WhatsApp discovery walks businesses → WABAs → numbers; only on when WhatsApp is configured.
    discoverWhatsapp: flag(
      env.META_DISCOVER_WHATSAPP,
      Boolean(whatsappAccessToken || env.WHATSAPP_BUSINESS_ID)
    ),
    exposeTokens: flag(env.META_EXPOSE_TOKENS, false),
  };
}

export function emptyConfig(): MetaConfig {
  return loadConfig({});
}
