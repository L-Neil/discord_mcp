/**
 * Thin read-only wrapper over the Discord REST API.
 *
 * We deliberately use @discordjs/rest (REST only) instead of the full
 * discord.js Client: history is fetched on demand, so there is no need for a
 * persistent Gateway WebSocket. Message *content* is returned by REST as long
 * as the bot has the MESSAGE CONTENT privileged intent enabled in the Developer
 * Portal — a live Gateway session is not required for that.
 */
import { REST } from "@discordjs/rest";
import {
  Routes,
  type APIChannel,
  type APIMessage,
  type APIAttachment,
  ChannelType,
} from "discord-api-types/v10";
import type { Config } from "./config.js";

const DISCORD_API_VERSION = "10";

/** Human-readable channel type label for the small subset we care about. */
const CHANNEL_TYPE_NAMES: Partial<Record<ChannelType, string>> = {
  [ChannelType.GuildText]: "text",
  [ChannelType.GuildVoice]: "voice",
  [ChannelType.GuildCategory]: "category",
  [ChannelType.GuildAnnouncement]: "announcement",
  [ChannelType.AnnouncementThread]: "announcement_thread",
  [ChannelType.PublicThread]: "public_thread",
  [ChannelType.PrivateThread]: "private_thread",
  [ChannelType.GuildStageVoice]: "stage",
  [ChannelType.GuildForum]: "forum",
  [ChannelType.GuildMedia]: "media",
};

export interface ChannelSummary {
  id: string;
  name: string;
  type: string;
  parent_id: string | null;
  topic: string | null;
}

export interface AttachmentSummary {
  id: string;
  filename: string;
  content_type: string | null;
  size: number;
  url: string;
  width: number | null;
  height: number | null;
  is_image: boolean;
}

export interface MessageSummary {
  id: string;
  author: {
    id: string;
    username: string;
    display_name: string;
    bot: boolean;
  };
  timestamp: string;
  content: string;
  attachments: AttachmentSummary[];
  reply_to_id: string | null;
  edited_timestamp: string | null;
}

export interface AttachmentBytes {
  filename: string;
  content_type: string;
  size: number;
  base64: string;
}

function isImageAttachment(a: APIAttachment): boolean {
  return typeof a.content_type === "string" && a.content_type.startsWith("image/");
}

export class DiscordClient {
  private readonly rest: REST;
  private readonly guildId: string;
  private readonly maxMessageLimit: number;

  constructor(config: Config) {
    this.rest = new REST({ version: DISCORD_API_VERSION }).setToken(config.botToken);
    this.guildId = config.guildId;
    this.maxMessageLimit = config.maxMessageLimit;
  }

  /** List channels the bot can see in the guild. Categories/voice included with a type label. */
  async listChannels(guildId?: string): Promise<ChannelSummary[]> {
    const gid = guildId ?? this.guildId;
    const channels = (await this.rest.get(Routes.guildChannels(gid))) as APIChannel[];

    return channels.map((c) => {
      const anyC = c as APIChannel & {
        name?: string;
        parent_id?: string | null;
        topic?: string | null;
      };
      return {
        id: c.id,
        name: anyC.name ?? "(unnamed)",
        type: CHANNEL_TYPE_NAMES[c.type] ?? `type_${c.type}`,
        parent_id: anyC.parent_id ?? null,
        topic: anyC.topic ?? null,
      };
    });
  }

  /**
   * Read the most recent messages from a channel, auto-paginating the Discord
   * REST API (100 per page) up to `limit` (capped by MAX_MESSAGE_LIMIT).
   *
   * Default behaviour walks backwards from newest. An optional `before` message
   * id sets the starting cursor for older history. (`after` is honoured for a
   * single page only; the auto-pagination path is the "latest N" case.)
   */
  async readMessages(
    channelId: string,
    limit: number,
    before?: string,
    after?: string,
  ): Promise<MessageSummary[]> {
    const target = Math.min(Math.max(limit, 1), this.maxMessageLimit);
    const collected: APIMessage[] = [];
    let cursor = before;

    while (collected.length < target) {
      const pageSize = Math.min(100, target - collected.length);
      const params = new URLSearchParams({ limit: String(pageSize) });
      if (cursor) {
        params.set("before", cursor);
      } else if (after) {
        params.set("after", after);
      }

      const page = (await this.rest.get(Routes.channelMessages(channelId), {
        query: params,
      })) as APIMessage[];

      if (page.length === 0) break;
      collected.push(...page);

      // `after` returns ascending order and is not safe to keep paginating with
      // the same cursor logic, so we stop after the first page in that mode.
      if (after && !before) break;

      cursor = page[page.length - 1].id; // oldest id in this (newest-first) page
      if (page.length < pageSize) break;
    }

    return collected.slice(0, target).map((m) => this.toSummary(m));
  }

  /**
   * Re-fetch a message by id to obtain a *fresh* signed attachment URL, then
   * download the attachment bytes server-side and return them base64-encoded.
   * This avoids relying on possibly-expired URLs the agent already holds.
   */
  async getAttachmentImage(
    channelId: string,
    messageId: string,
    attachmentId: string,
  ): Promise<AttachmentBytes> {
    const message = (await this.rest.get(
      Routes.channelMessage(channelId, messageId),
    )) as APIMessage;

    const attachment = message.attachments.find((a) => a.id === attachmentId);
    if (!attachment) {
      throw new Error(
        `Attachment ${attachmentId} not found on message ${messageId} in channel ${channelId}.`,
      );
    }

    const response = await fetch(attachment.url);
    if (!response.ok) {
      throw new Error(
        `Failed to download attachment ${attachmentId}: HTTP ${response.status}`,
      );
    }
    const buffer = Buffer.from(await response.arrayBuffer());

    return {
      filename: attachment.filename,
      content_type:
        attachment.content_type ?? response.headers.get("content-type") ?? "application/octet-stream",
      size: buffer.byteLength,
      base64: buffer.toString("base64"),
    };
  }

  private toSummary(m: APIMessage): MessageSummary {
    return {
      id: m.id,
      author: {
        id: m.author.id,
        username: m.author.username,
        display_name: m.author.global_name ?? m.author.username,
        bot: m.author.bot ?? false,
      },
      timestamp: m.timestamp,
      content: m.content,
      attachments: m.attachments.map((a) => ({
        id: a.id,
        filename: a.filename,
        content_type: a.content_type ?? null,
        size: a.size,
        url: a.url,
        width: a.width ?? null,
        height: a.height ?? null,
        is_image: isImageAttachment(a),
      })),
      reply_to_id: m.message_reference?.message_id ?? null,
      edited_timestamp: m.edited_timestamp ?? null,
    };
  }
}
