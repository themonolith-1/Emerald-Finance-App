import { z } from "zod";

const emptyToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => {
    if (typeof v === "string" && v.trim().length === 0) return undefined;
    return v;
  }, schema);

const ServerEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  // Required only if you use Plaid / bank connections (used to encrypt access tokens at rest)
  BANK_TOKEN_ENCRYPTION_KEY: emptyToUndefined(z.string().min(1).optional()),

  // Plaid
  PLAID_CLIENT_ID: emptyToUndefined(z.string().min(1).optional()),
  PLAID_SECRET: emptyToUndefined(z.string().min(1).optional()),
  PLAID_ENV: emptyToUndefined(z.enum(["sandbox", "development", "production"]).optional().default("sandbox")),

  // Optional (recommended for Plaid Link)
  PLAID_REDIRECT_URI: emptyToUndefined(z.string().optional()),
  PLAID_WEBHOOK_URL: emptyToUndefined(z.string().optional()),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

export function getServerEnv(): ServerEnv {
  // Ensure this file is only used server-side.
  if (typeof window !== "undefined") {
    throw new Error("getServerEnv() must not be called in the browser");
  }

  const parsed = ServerEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid server environment variables: ${message}`);
  }
  return parsed.data;
}

export function isPlaidConfigured(env: ServerEnv = getServerEnv()): boolean {
  return Boolean(env.PLAID_CLIENT_ID && env.PLAID_SECRET && env.BANK_TOKEN_ENCRYPTION_KEY);
}

export function requirePlaidEnv(): Required<
  Pick<ServerEnv, "PLAID_CLIENT_ID" | "PLAID_SECRET" | "PLAID_ENV" | "BANK_TOKEN_ENCRYPTION_KEY">
> &
  Pick<ServerEnv, "PLAID_REDIRECT_URI" | "PLAID_WEBHOOK_URL"> {
  const env = getServerEnv();
  if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET) {
    throw new Error(
      "Plaid is not configured. Set PLAID_CLIENT_ID and PLAID_SECRET (and BANK_TOKEN_ENCRYPTION_KEY) in .env.local to enable bank linking."
    );
  }
  if (!env.BANK_TOKEN_ENCRYPTION_KEY) {
    throw new Error(
      "Plaid is not configured. Set BANK_TOKEN_ENCRYPTION_KEY (base64 32-byte key) in .env.local to enable bank linking."
    );
  }
  return {
    PLAID_CLIENT_ID: env.PLAID_CLIENT_ID,
    PLAID_SECRET: env.PLAID_SECRET,
    PLAID_ENV: env.PLAID_ENV,
    BANK_TOKEN_ENCRYPTION_KEY: env.BANK_TOKEN_ENCRYPTION_KEY,
    PLAID_REDIRECT_URI: env.PLAID_REDIRECT_URI,
    PLAID_WEBHOOK_URL: env.PLAID_WEBHOOK_URL,
  };
}

export function requireBankTokenEncryptionKey(): string {
  const env = getServerEnv();
  if (!env.BANK_TOKEN_ENCRYPTION_KEY) {
    throw new Error(
      "BANK_TOKEN_ENCRYPTION_KEY is required for bank connections. Set it in .env.local (base64 32-byte key)."
    );
  }
  return env.BANK_TOKEN_ENCRYPTION_KEY;
}
