/**
 * Environment configuration with fail-fast validation.
 * Call loadConfig() once at startup; it throws if anything required is missing.
 */

export interface Config {
  botToken: string;
  guildId: string;
  authTokens: string[];
  port: number;
  maxMessageLimit: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

/** Parse a comma-separated token list into a deduped, trimmed array. */
export function parseTokens(raw: string): string[] {
  const tokens = raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return [...new Set(tokens)];
}

export function loadConfig(): Config {
  const authTokens = parseTokens(required("MCP_AUTH_TOKENS"));
  if (authTokens.length === 0) {
    throw new Error("MCP_AUTH_TOKENS must contain at least one token.");
  }

  return {
    botToken: required("DISCORD_BOT_TOKEN"),
    guildId: required("DISCORD_GUILD_ID"),
    authTokens,
    port: parseInt(process.env.PORT ?? "3000", 10),
    maxMessageLimit: parseInt(process.env.MAX_MESSAGE_LIMIT ?? "500", 10),
  };
}
