import { randomBytes } from 'node:crypto';
import {
  AccessToken,
  DataPacket_Kind,
  RoomServiceClient,
  TrackSource,
  WebhookReceiver,
} from 'livekit-server-sdk';
import { HTTP_STATUS } from '../config/constants.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/response.js';

export interface LiveKitSettings {
  url: string;
  apiKey: string;
  apiSecret: string;
  ttlSeconds: number;
}

export interface IssuedMediaToken {
  identity: string;
  room: string;
  token: string;
}

export interface VerifiedMediaWebhook {
  id: string;
  event: string;
  roomName: string;
  identity: string;
  occurredAt: Date;
}

export interface LiveKitGateway {
  url: string;
  createRoom(name: string, maxParticipants: number): Promise<void>;
  deleteRoom(name: string): Promise<void>;
  issueToken(input: {
    identity: string;
    name: string;
    room: string;
    ttlSeconds: number;
  }): Promise<string>;
  verifyWebhook(
    body: string,
    authorization: string | undefined,
  ): Promise<VerifiedMediaWebhook | null>;
  sendData(room: string, data: Uint8Array): Promise<void>;
}

/** Grants for a joined participant. Screen share and recording are off. */
export function participantVideoGrant(room: string) {
  return {
    roomJoin: true,
    room,
    roomCreate: false,
    roomList: false,
    roomRecord: false,
    roomAdmin: false,
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
    canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE],
    canUpdateOwnMetadata: false,
    recorder: false,
  };
}

export function liveKitSettings(): LiveKitSettings | null {
  const url = env.LIVEKIT_URL.trim();
  const apiKey = env.LIVEKIT_API_KEY.trim();
  const apiSecret = env.LIVEKIT_API_SECRET.trim();
  if (!url || !apiKey || !apiSecret) return null;
  return {
    url,
    apiKey,
    apiSecret,
    ttlSeconds: env.LIVEKIT_TOKEN_TTL_SECONDS,
  };
}

export function liveKitNotConfigured(): AppError {
  return new AppError('LiveKit is not configured', HTTP_STATUS.SERVICE_UNAVAILABLE);
}

export function generateLiveKitRoomName(): string {
  return `pz_${randomBytes(18).toString('base64url')}`;
}

function httpHost(url: string): string {
  return url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
}

export class SdkLiveKitGateway implements LiveKitGateway {
  readonly url: string;

  constructor(private readonly settings: LiveKitSettings) {
    this.url = settings.url;
  }

  async createRoom(name: string, maxParticipants: number): Promise<void> {
    const client = new RoomServiceClient(
      httpHost(this.settings.url),
      this.settings.apiKey,
      this.settings.apiSecret,
    );
    await client.createRoom({ name, maxParticipants });
  }

  async deleteRoom(name: string): Promise<void> {
    const client = new RoomServiceClient(
      httpHost(this.settings.url),
      this.settings.apiKey,
      this.settings.apiSecret,
    );
    try {
      await client.deleteRoom(name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/not found|does not exist/i.test(message)) return;
      throw error;
    }
  }

  async issueToken(input: {
    identity: string;
    name: string;
    room: string;
    ttlSeconds: number;
  }): Promise<string> {
    const token = new AccessToken(this.settings.apiKey, this.settings.apiSecret, {
      identity: input.identity,
      name: input.name,
      ttl: input.ttlSeconds,
    });
    token.addGrant(participantVideoGrant(input.room));
    return token.toJwt();
  }

  async verifyWebhook(
    body: string,
    authorization: string | undefined,
  ): Promise<VerifiedMediaWebhook | null> {
    const receiver = new WebhookReceiver(this.settings.apiKey, this.settings.apiSecret);
    const event = await receiver.receive(body, authorization);
    if (
      event.event !== 'participant_joined' &&
      event.event !== 'participant_left' &&
      event.event !== 'participant_connection_aborted'
    ) {
      return null;
    }
    const roomName = event.room?.name ?? '';
    const identity = event.participant?.identity ?? '';
    if (!roomName || !identity) return null;
    const seconds = Number(event.createdAt);
    const occurredAt =
      Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date();
    return {
      id: event.id || `${event.event}:${identity}:${seconds}`,
      event: event.event,
      roomName,
      identity,
      occurredAt,
    };
  }

  async sendData(room: string, data: Uint8Array): Promise<void> {
    const client = new RoomServiceClient(
      httpHost(this.settings.url),
      this.settings.apiKey,
      this.settings.apiSecret,
    );
    await client.sendData(room, data, DataPacket_Kind.RELIABLE, {});
  }
}

let override: LiveKitGateway | null | undefined;

export function mediaAccessConfigured(): boolean {
  return Boolean(override) || liveKitSettings() !== null;
}

/** Pass undefined to use the SDK when configuration is present. */
export function setLiveKitGateway(next: LiveKitGateway | null | undefined): void {
  override = next;
}

export function activeLiveKitGateway(): LiveKitGateway {
  if (override) return override;
  const settings = liveKitSettings();
  if (!settings) throw liveKitNotConfigured();
  return new SdkLiveKitGateway(settings);
}
