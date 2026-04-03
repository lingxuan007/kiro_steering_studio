/**
 * Type definitions for the Nova Sonic streaming client.
 */

import type { BedrockRuntimeClientConfig } from '@aws-sdk/client-bedrock-runtime';
import type { NodeHttp2HandlerOptions } from '@smithy/node-http-handler';
import type { Provider } from '@smithy/types';
import type { Subject } from 'rxjs';

/**
 * Inference configuration for the model.
 */
export interface InferenceConfig {
  /** Maximum number of tokens to generate */
  maxTokens: number;
  /** Top-p (nucleus) sampling parameter */
  topP: number;
  /** Temperature for response randomness */
  temperature: number;
}

/**
 * Text content configuration.
 */
export interface TextConfiguration {
  /** MIME type for text content */
  mediaType: 'text/plain';
}

/**
 * Audio content configuration.
 */
export interface AudioConfiguration {
  /** Type of audio (always SPEECH for this use case) */
  audioType: 'SPEECH';
  /** Encoding format for audio data */
  encoding: 'base64';
  /** MIME type for audio */
  mediaType: 'audio/lpcm';
  /** Sample rate in Hz */
  sampleRateHertz: 16000 | 24000;
  /** Bits per sample */
  sampleSizeBits: 16;
  /** Number of audio channels */
  channelCount: 1;
  /** Optional voice ID for text-to-speech */
  voiceId?: string;
}

/**
 * Configuration for the Nova Sonic client.
 */
export interface NovaSonicClientConfig {
  /** Optional HTTP/2 handler configuration */
  requestHandlerConfig?: NodeHttp2HandlerOptions | Provider<NodeHttp2HandlerOptions | void>;
  /** Bedrock client configuration */
  clientConfig: Partial<BedrockRuntimeClientConfig>;
  /** Optional inference configuration override */
  inferenceConfig?: InferenceConfig;
  /** Bedrock model ID */
  modelId: string;
  /** Tool configuration for function calling */
  toolConfiguration: ToolConfiguration;
}

/**
 * Internal session data structure.
 */
export interface SessionData {
  /** Event queue for outgoing messages */
  queue: StreamEvent[];
  /** Signal for queue updates */
  queueSignal: Subject<void>;
  /** Signal for session close */
  closeSignal: Subject<void>;
  /** Map of event type to handler function */
  responseHandlers: Map<string, ResponseHandler>;
  /** Unique prompt name for this session */
  promptName: string;
  /** Inference configuration for this session */
  inferenceConfig: InferenceConfig;
  /** Whether the session is active */
  isActive: boolean;
  /** Whether prompt start event has been sent */
  isPromptStartSent: boolean;
  /** Whether audio content start event has been sent */
  isAudioContentStartSent: boolean;
  /** Unique ID for the audio content stream */
  audioContentId: string;
  /** Current tool use content (for tracking active tool calls) */
  toolUseContent: ToolUseEvent | null;
  /** Current tool use ID */
  toolUseId: string;
  /** Current tool name */
  toolName: string;
}

/**
 * Handler function for response events.
 */
export type ResponseHandler = (data: unknown) => void;

/**
 * Generic stream event wrapper.
 */
export interface StreamEvent {
  event: Record<string, unknown>;
}

/**
 * Tool specification for function calling.
 */
export interface ToolSpec {
  /** Unique name for the tool */
  name: string;
  /** Description of what the tool does */
  description: string;
  /** JSON schema for the tool's input parameters */
  inputSchema: {
    json: string;
  };
}

/**
 * Tool configuration containing available tools.
 */
export interface ToolConfiguration {
  tools: Array<{ toolSpec: ToolSpec }>;
}

/**
 * Event emitted when a tool is being used.
 */
export interface ToolUseEvent {
  /** Unique ID for this tool invocation */
  toolUseId: string;
  /** Name of the tool being called */
  toolName: string;
  /** Tool input content (may be JSON string) */
  content?: string;
}

/**
 * Event data for tool end.
 */
export interface ToolEndData {
  /** The tool use event that completed */
  toolUseContent: ToolUseEvent | null;
  /** Tool use ID */
  toolUseId: string;
  /** Tool name */
  toolName: string;
}

/**
 * Content start event data.
 */
export interface ContentStartEvent {
  /** Type of content (TEXT, AUDIO, TOOL) */
  type: string;
  /** Role (USER, ASSISTANT, SYSTEM, TOOL) */
  role?: string;
  /** Content name identifier */
  contentName?: string;
  /** Additional model-specific fields */
  additionalModelFields?: string;
}

/**
 * Text output event data.
 */
export interface TextOutputEvent {
  /** Text content */
  content: string;
}

/**
 * Audio output event data.
 */
export interface AudioOutputEvent {
  /** Base64-encoded audio data */
  content: string;
}

/**
 * Content end event data.
 */
export interface ContentEndEvent {
  /** Type of content that ended */
  type: string;
  /** Content name identifier */
  contentName?: string;
}

/**
 * Usage metrics event data.
 */
export interface UsageEvent {
  /** Usage details with token counts */
  details?: {
    delta?: {
      input?: {
        speechTokens?: number;
        textTokens?: number;
      };
      output?: {
        speechTokens?: number;
        textTokens?: number;
      };
    };
  };
}

/**
 * Stream completion event.
 */
export interface StreamCompleteEvent {
  /** Timestamp when stream completed */
  at: string;
}

/**
 * Supported event types for the streaming session.
 */
export type EventType =
  | 'contentStart'
  | 'textOutput'
  | 'audioOutput'
  | 'contentEnd'
  | 'usageEvent'
  | 'toolUse'
  | 'toolEnd'
  | 'error'
  | 'streamComplete'
  | 'unknown';

/**
 * Server configuration sent to clients.
 */
export interface ServerConfig {
  /** Absolute path to steering output directory */
  steeringDir: string;
  /** Model ID being used */
  modelId: string;
  /** AWS region */
  region: string;
}
