/**
 * MCP server definition: registers the three read-only tools and wires them to
 * the Discord REST wrapper. A fresh McpServer is created per request by the
 * caller (stateless transport), but tool definitions are pure, so this factory
 * is cheap to call repeatedly.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DiscordClient } from "./discord.js";
import type { Config } from "./config.js";

export function createMcpServer(discord: DiscordClient, config: Config): McpServer {
  const server = new McpServer({
    name: "discord-mcp",
    version: "1.0.0",
  });

  // --- list_channels -------------------------------------------------------
  server.registerTool(
    "list_channels",
    {
      title: "List channels",
      description:
        "List the channels the bot can see in the Discord server (id, name, type). " +
        "Use this to discover channel ids for read_messages.",
      inputSchema: {
        guild_id: z
          .string()
          .optional()
          .describe("Guild (server) id. Defaults to the server configured on the bot."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ guild_id }) => {
      const channels = await discord.listChannels(guild_id);
      return {
        content: [{ type: "text", text: JSON.stringify(channels, null, 2) }],
        structuredContent: { channels },
      };
    },
  );

  // --- read_messages -------------------------------------------------------
  server.registerTool(
    "read_messages",
    {
      title: "Read messages",
      description:
        "Read the most recent messages from a channel (newest first). Returns author, " +
        "timestamp, content and attachment metadata for each message. Auto-paginates up to " +
        `${config.maxMessageLimit} messages. Image attachments include a signed URL; the URL ` +
        "expires, so use get_attachment_image to load image bytes reliably.",
      inputSchema: {
        channel_id: z.string().describe("The channel id to read from."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(config.maxMessageLimit)
          .default(50)
          .describe(`How many recent messages to fetch (1-${config.maxMessageLimit}).`),
        before: z
          .string()
          .optional()
          .describe("Only return messages before this message id (for paging into older history)."),
        after: z
          .string()
          .optional()
          .describe("Only return messages after this message id (single page; mutually exclusive with before)."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ channel_id, limit, before, after }) => {
      const messages = await discord.readMessages(channel_id, limit ?? 50, before, after);
      return {
        content: [{ type: "text", text: JSON.stringify(messages, null, 2) }],
        structuredContent: { count: messages.length, messages },
      };
    },
  );

  // --- get_attachment_image ------------------------------------------------
  server.registerTool(
    "get_attachment_image",
    {
      title: "Get attachment image (base64)",
      description:
        "Download an image attachment by ids and return it as base64 image content. " +
        "Re-fetches the message to obtain a fresh signed URL, so it works even after the " +
        "URL returned by read_messages has expired. Use the channel_id / message_id / " +
        "attachment_id from a read_messages result.",
      inputSchema: {
        channel_id: z.string().describe("Channel id the message belongs to."),
        message_id: z.string().describe("Message id that carries the attachment."),
        attachment_id: z.string().describe("Attachment id (from the message's attachments[])."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ channel_id, message_id, attachment_id }) => {
      const img = await discord.getAttachmentImage(channel_id, message_id, attachment_id);
      const isImage = img.content_type.startsWith("image/");

      if (!isImage) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Attachment ${attachment_id} is not an image (content_type: ${img.content_type}).`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "image",
            data: img.base64,
            mimeType: img.content_type,
          },
          {
            type: "text",
            text: `Loaded ${img.filename} (${img.content_type}, ${img.size} bytes).`,
          },
        ],
      };
    },
  );

  return server;
}
