/**
 * Type definitions for the server module.
 */

import type { Socket } from 'socket.io';
import type { StreamSession } from '../sonic/client';

/**
 * State of a streaming session.
 */
export enum SessionState {
  /** Session is active and streaming */
  ACTIVE = 'active',
  /** Session is closed */
  CLOSED = 'closed',
}

/**
 * Socket session data tracked by the server.
 */
export interface SocketSessionData {
  /** The stream session instance */
  session: StreamSession;
  /** Current session state */
  state: SessionState;
  /** Whether audio content has been started */
  audioReady: boolean;
  /** Last system prompt sent (for recovery) */
  lastSystemPrompt: string;
  /** Keepalive timer handle (for pause state) */
  keepaliveTimer?: NodeJS.Timeout;
  /** Whether recovery is in progress */
  isRecovering: boolean;
  /** Whether cleanup is in progress */
  isCleaningUp: boolean;
}

/**
 * Pause state payload from client.
 */
export interface PauseStatePayload {
  /** Whether the client is paused */
  paused: boolean;
}

/**
 * Initialize connection callback result.
 */
export interface InitConnectionResult {
  /** Whether initialization succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Tool result event emitted to client.
 */
export interface ToolResultEvent {
  /** Tool use ID */
  toolUseId: string;
  /** Whether the tool succeeded */
  ok: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Steering update event emitted to client.
 */
export interface SteeringUpdateEvent {
  /** File that was updated */
  file: string;
  /** Diff information */
  diff: {
    added: number;
    removed: number;
  };
}

/**
 * Error event emitted to client.
 */
export interface ErrorEvent {
  /** Error message */
  message: string;
  /** Additional details */
  details?: string;
}

/**
 * Server-to-client events interface for Socket.IO.
 */
export interface ServerToClientEvents {
  serverConfig: (config: { steeringDir: string; modelId: string; region: string }) => void;
  contentStart: (data: unknown) => void;
  textOutput: (data: unknown) => void;
  audioOutput: (data: unknown) => void;
  contentEnd: (data: unknown) => void;
  usageEvent: (data: unknown) => void;
  toolUse: (data: unknown) => void;
  toolResult: (data: ToolResultEvent) => void;
  steeringUpdated: (data: SteeringUpdateEvent) => void;
  error: (data: ErrorEvent) => void;
  streamComplete: () => void;
}

/**
 * Client-to-server events interface for Socket.IO.
 */
export interface ClientToServerEvents {
  initializeConnection: (callback: (result: InitConnectionResult) => void) => void;
  promptStart: () => void;
  systemPrompt: (prompt: string) => void;
  audioStart: () => void;
  audioInput: (audioBase64: string) => void;
  stopAudio: () => void;
  pauseState: (payload: PauseStatePayload | boolean) => void;
}

/**
 * Inter-server events (not used but required by Socket.IO types).
 */
export interface InterServerEvents {
  // Empty for now
}

/**
 * Socket data stored per connection.
 */
export interface SocketData {
  // Empty for now, can be extended
}

/**
 * Typed socket with all event interfaces.
 */
export type TypedSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
