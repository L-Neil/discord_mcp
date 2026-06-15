/**
 * Bearer-token auth middleware.
 *
 * Tokens are compared by their SHA-256 digests via a Set lookup, so the
 * comparison work does not short-circuit on the first differing byte of the
 * raw token. Unknown / missing tokens get a 401.
 */
import { createHash } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createAuthMiddleware(validTokens: string[]) {
  const validHashes = new Set(validTokens.map(sha256));

  return function authMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const header = req.headers["authorization"];
    if (typeof header !== "string" || !header.startsWith("Bearer ")) {
      unauthorized(res, "Missing or malformed Authorization header");
      return;
    }

    const token = header.slice("Bearer ".length).trim();
    if (token.length === 0 || !validHashes.has(sha256(token))) {
      unauthorized(res, "Invalid bearer token");
      return;
    }

    next();
  };
}

function unauthorized(res: Response, message: string): void {
  res
    .status(401)
    .set("WWW-Authenticate", 'Bearer realm="discord-mcp"')
    .json({
      jsonrpc: "2.0",
      error: { code: -32001, message: `Unauthorized: ${message}` },
      id: null,
    });
}
