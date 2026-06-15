/**
 * Streamable HTTP entrypoint for the Discord MCP server.
 *
 *   POST /mcp     -> MCP JSON-RPC (bearer-authenticated, stateless transport)
 *   GET  /healthz -> liveness/readiness probe (unauthenticated)
 *
 * Stateless pattern (per the MCP TS SDK guidance): a new McpServer +
 * StreamableHTTPServerTransport is created for each request with
 * sessionIdGenerator=undefined and enableJsonResponse=true. This avoids
 * cross-request state leakage and request-id collisions, and lets 14 users
 * connect independently without server-side session bookkeeping.
 */
import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig } from "./config.js";
import { createAuthMiddleware } from "./auth.js";
import { DiscordClient } from "./discord.js";
import { createMcpServer } from "./mcp.js";

const config = loadConfig();
const discord = new DiscordClient(config);
const requireAuth = createAuthMiddleware(config.authTokens);

const app = express();
app.use(express.json({ limit: "1mb" }));

// Health check — no auth, returns fast.
app.get("/healthz", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

// MCP endpoint — bearer auth, then per-request stateless transport.
app.post("/mcp", requireAuth, async (req: Request, res: Response) => {
  const server = createMcpServer(discord, config);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("Error handling /mcp request:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// Stateless transport only uses POST. Be explicit for stray GET/DELETE probes.
app.all("/mcp", (_req: Request, res: Response) => {
  res.status(405).set("Allow", "POST").json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed. Use POST." },
    id: null,
  });
});

app.listen(config.port, () => {
  console.error(
    `discord-mcp listening on :${config.port}  (POST /mcp, GET /healthz) — ` +
      `${config.authTokens.length} auth token(s) loaded, guild ${config.guildId}`,
  );
});
