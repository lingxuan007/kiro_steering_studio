/**
 * Nova Sonic bidirectional streaming client for Amazon Bedrock.
 *
 * This module provides a high-level API for real-time audio streaming
 * with the Nova Sonic model, including session management, event handling,
 * and tool calling support.
 */

import {
  BedrockRuntimeClient,
  InvokeModelWithBidirectionalStreamCommand,
  InvokeModelWithBidirectionalStreamInput,
} from '@aws-sdk/client-bedrock-runtime';
import { NodeHttp2Handler } from '@smithy/node-http-handler';
import { Subject, firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';
import { randomUUID } from 'node:crypto';

import { sessionConfig, audioConfig, inferenceConfig as defaultInferenceConfig } from '../config';
import type {
  InferenceConfig,
  TextConfiguration,
  AudioConfiguration,
  NovaSonicClientConfig,
  SessionData,
  ResponseHandler,
  ToolUseEvent,
} from './types';

// Re-export types for convenience
export type { InferenceConfig, TextConfiguration, AudioConfiguration, NovaSonicClientConfig };

/**
 * Default inference configuration.
 */
export const DefaultInferenceConfiguration: InferenceConfig = {
  maxTokens: defaultInferenceConfig.maxTokens,
  topP: defaultInferenceConfig.topP,
  temperature: defaultInferenceConfig.temperature,
};

/**
 * Default text configuration.
 */
export const DefaultTextConfiguration: TextConfiguration = {
  mediaType: 'text/plain',
};

/**
 * Default audio input configuration.
 */
export const DefaultAudioInputConfiguration: AudioConfiguration = {
  audioType: 'SPEECH',
  encoding: 'base64',
  mediaType: 'audio/lpcm',
  sampleRateHertz: audioConfig.inputSampleRate as 16000,
  sampleSizeBits: audioConfig.sampleSizeBits as 16,
  channelCount: audioConfig.channelCount as 1,
};

/**
 * Default audio output configuration.
 */
export const DefaultAudioOutputConfiguration: AudioConfiguration = {
  ...DefaultAudioInputConfiguration,
  sampleRateHertz: audioConfig.outputSampleRate as 24000,
  voiceId: audioConfig.voiceId,
};

/**
 * Manages a single streaming session with buffered audio handling.
 */
export class StreamSession {
  private audioBufferQueue: Buffer[] = [];
  private readonly maxQueueSize = 220;
  private isProcessingAudio = false;
  private isActive = true;

  /**
   * Creates a new stream session.
   * @param sessionId - Unique identifier for this session
   * @param client - Parent NovaSonicClient instance
   */
  constructor(
    private readonly sessionId: string,
    private readonly client: NovaSonicClient
  ) {}

  /**
   * Registers an event handler for a specific event type.
   * @param eventType - Type of event to listen for
   * @param handler - Handler function to call when event occurs
   * @returns This session for chaining
   */
  onEvent(eventType: string, handler: ResponseHandler): this {
    this.client.registerEventHandler(this.sessionId, eventType, handler);
    return this;
  }

  /**
   * Sets up the session start and prompt start events.
   */
  async setupSessionAndPromptStart(): Promise<void> {
    this.client.setupSessionStartEvent(this.sessionId);
    this.client.setupPromptStartEvent(this.sessionId);
  }

  /**
   * Sets up the system prompt for the conversation.
   * @param systemPromptContent - The system prompt text
   * @param textConfig - Optional text configuration
   */
  async setupSystemPrompt(
    systemPromptContent: string,
    textConfig: TextConfiguration = DefaultTextConfiguration
  ): Promise<void> {
    this.client.setupSystemPromptEvent(this.sessionId, textConfig, systemPromptContent);
  }

  /**
   * Sets up audio streaming.
   * @param audioConfig - Optional audio configuration
   */
  async setupStartAudio(
    audioConfig: AudioConfiguration = DefaultAudioInputConfiguration
  ): Promise<void> {
    this.client.setupStartAudioEvent(this.sessionId, audioConfig);
  }

  /**
   * Streams an audio chunk to the model.
   * Audio is buffered and processed in batches to prevent overwhelming the stream.
   * @param audioData - PCM audio data as a Buffer
   */
  async streamAudio(audioData: Buffer): Promise<void> {
    if (this.audioBufferQueue.length >= this.maxQueueSize) {
      this.audioBufferQueue.shift();
    }
    this.audioBufferQueue.push(audioData);
    this.processAudioQueue();
  }

  /**
   * Processes the audio buffer queue in batches.
   */
  private async processAudioQueue(): Promise<void> {
    if (this.isProcessingAudio || this.audioBufferQueue.length === 0 || !this.isActive) {
      return;
    }

    this.isProcessingAudio = true;
    try {
      let processed = 0;
      const maxBatch = 5;

      while (this.audioBufferQueue.length > 0 && processed < maxBatch && this.isActive) {
        const chunk = this.audioBufferQueue.shift();
        if (chunk) {
          await this.client.streamAudioChunk(this.sessionId, chunk);
          processed++;
        }
      }
    } finally {
      this.isProcessingAudio = false;

      // Continue processing if there's more in the queue
      if (this.audioBufferQueue.length > 0 && this.isActive) {
        setTimeout(() => this.processAudioQueue(), 0);
      }
    }
  }

  /**
   * Ends the current audio content stream.
   */
  async endAudioContent(): Promise<void> {
    if (this.isActive) {
      await this.client.sendContentEnd(this.sessionId);
    }
  }

  /**
   * Ends the current prompt.
   */
  async endPrompt(): Promise<void> {
    if (this.isActive) {
      await this.client.sendPromptEnd(this.sessionId);
    }
  }

  /**
   * Closes the session.
   */
  async close(): Promise<void> {
    if (this.isActive) {
      this.isActive = false;
      await this.client.sendSessionEnd(this.sessionId);
    }
  }

  /**
   * Gets the session ID.
   */
  getSessionId(): string {
    return this.sessionId;
  }
}

/**
 * Client for bidirectional streaming with Nova Sonic on Amazon Bedrock.
 *
 * Manages multiple concurrent streaming sessions, handles event dispatch,
 * and provides tools for session lifecycle management.
 */
export class NovaSonicClient {
  private readonly bedrockRuntimeClient: BedrockRuntimeClient;
  private readonly inferenceConfig: InferenceConfig;
  private readonly activeSessions = new Map<string, SessionData>();
  private readonly sessionLastActivity = new Map<string, number>();

  /**
   * Creates a new Nova Sonic client.
   * @param config - Client configuration
   */
  constructor(private readonly config: NovaSonicClientConfig) {
    const nodeHttp2Handler = new NodeHttp2Handler({
      requestTimeout: sessionConfig.requestTimeoutMs,
      sessionTimeout: sessionConfig.sessionTimeoutMs,
      disableConcurrentStreams: false,
      maxConcurrentStreams: sessionConfig.maxConcurrentStreams,
      ...(config.requestHandlerConfig as Record<string, unknown>),
    });

    this.bedrockRuntimeClient = new BedrockRuntimeClient({
      ...config.clientConfig,
      region: (config.clientConfig.region as string) || 'us-east-1',
      requestHandler: nodeHttp2Handler,
    });

    this.inferenceConfig = config.inferenceConfig ?? DefaultInferenceConfiguration;
  }

  /**
   * Gets the last activity timestamp for a session.
   * @param sessionId - Session identifier
   * @returns Timestamp in milliseconds, or 0 if not found
   */
  getLastActivityTime(sessionId: string): number {
    return this.sessionLastActivity.get(sessionId) || 0;
  }

  /**
   * Gets all active session IDs.
   */
  getActiveSessions(): string[] {
    return Array.from(this.activeSessions.keys());
  }

  /**
   * Checks if a session is active.
   * @param sessionId - Session identifier
   */
  isSessionActive(sessionId: string): boolean {
    const session = this.activeSessions.get(sessionId);
    return !!session && session.isActive;
  }

  /**
   * Forces a session to close immediately.
   * @param sessionId - Session identifier
   */
  forceCloseSession(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    session.isActive = false;
    session.closeSignal.next();
    session.closeSignal.complete();
    this.activeSessions.delete(sessionId);
    this.sessionLastActivity.delete(sessionId);
  }

  /**
   * Creates a new stream session.
   * @param sessionId - Unique identifier for the session
   * @returns The new StreamSession instance
   * @throws Error if session already exists
   */
  createStreamSession(sessionId: string): StreamSession {
    if (this.activeSessions.has(sessionId)) {
      throw new Error(`Session already exists: ${sessionId}`);
    }

    const sessionData: SessionData = {
      queue: [],
      queueSignal: new Subject<void>(),
      closeSignal: new Subject<void>(),
      responseHandlers: new Map(),
      promptName: randomUUID(),
      inferenceConfig: this.inferenceConfig,
      isActive: true,
      isPromptStartSent: false,
      isAudioContentStartSent: false,
      audioContentId: randomUUID(),
      toolUseContent: null,
      toolUseId: '',
      toolName: '',
    };

    this.activeSessions.set(sessionId, sessionData);
    this.sessionLastActivity.set(sessionId, Date.now());

    return new StreamSession(sessionId, this);
  }

  /**
   * Initiates bidirectional streaming for a session.
   * @param sessionId - Session identifier
   * @throws Error if session not found
   */
  async initiateBidirectionalStreaming(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const asyncIterable = this.createSessionAsyncIterable(sessionId);

    const response = await this.bedrockRuntimeClient.send(
      new InvokeModelWithBidirectionalStreamCommand({
        modelId: this.config.modelId,
        body: asyncIterable,
      })
    );

    if (!response.body) {
      throw new Error('No response body from Bedrock stream');
    }

    await this.processResponseStream(sessionId, response.body);
  }

  /**
   * Registers an event handler for a session.
   * @param sessionId - Session identifier
   * @param eventType - Type of event
   * @param handler - Handler function
   * @throws Error if session not found
   */
  registerEventHandler(sessionId: string, eventType: string, handler: ResponseHandler): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    session.responseHandlers.set(eventType, handler);
  }

  /**
   * Dispatches an event to registered handlers.
   */
  private dispatch(sessionId: string, eventType: string, data: unknown): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    this.sessionLastActivity.set(sessionId, Date.now());
    const handler = session.responseHandlers.get(eventType);
    if (handler) {
      handler(data);
    }
  }

  /**
   * Adds an event to the session's outgoing queue.
   */
  private addEvent(sessionId: string, event: Record<string, unknown>): void {
    const session = this.activeSessions.get(sessionId);
    if (!session || !session.isActive) return;

    this.sessionLastActivity.set(sessionId, Date.now());
    session.queue.push({ event });
    session.queueSignal.next();
  }

  /**
   * Creates an async iterable for streaming events to Bedrock.
   */
  private createSessionAsyncIterable(
    sessionId: string
  ): AsyncIterable<InvokeModelWithBidirectionalStreamInput> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    return {
      [Symbol.asyncIterator]: () => ({
        next: async (): Promise<IteratorResult<InvokeModelWithBidirectionalStreamInput>> => {
          if (!session.isActive) {
            return { value: undefined, done: true };
          }

          // Wait for either a queue item or close signal
          if (session.queue.length === 0) {
            try {
              await Promise.race([
                firstValueFrom(session.queueSignal.pipe(take(1))),
                firstValueFrom(session.closeSignal.pipe(take(1))).then(() => {
                  throw new Error('Session closed');
                }),
              ]);
            } catch {
              return { value: undefined, done: true };
            }
          }

          if (session.queue.length === 0 || !session.isActive) {
            return { value: undefined, done: true };
          }

          const nextEvent = session.queue.shift();
          return {
            value: {
              chunk: {
                bytes: new TextEncoder().encode(JSON.stringify(nextEvent)),
              },
            },
            done: false,
          };
        },
      }),
    };
  }

  /**
   * Processes the response stream from Bedrock.
   */
  private async processResponseStream(
    sessionId: string,
    responseBody: AsyncIterable<{ chunk?: { bytes?: Uint8Array }; modelStreamErrorException?: unknown }>
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    for await (const event of responseBody) {
      if (!session.isActive) break;

      if (event.chunk?.bytes) {
        const text = new TextDecoder().decode(event.chunk.bytes);
        try {
          const json = JSON.parse(text) as { event?: Record<string, unknown> };
          const ev = json.event || {};

          this.handleStreamEvent(sessionId, session, ev);
        } catch {
          // Ignore JSON parse errors
        }
      } else if (event.modelStreamErrorException) {
        this.dispatch(sessionId, 'error', event.modelStreamErrorException);
      }
    }

    this.dispatch(sessionId, 'streamComplete', { at: new Date().toISOString() });
  }

  /**
   * Handles individual stream events.
   */
  private handleStreamEvent(
    sessionId: string,
    session: SessionData,
    ev: Record<string, unknown>
  ): void {
    if (ev.contentStart) {
      this.dispatch(sessionId, 'contentStart', ev.contentStart);
    } else if (ev.textOutput) {
      this.dispatch(sessionId, 'textOutput', ev.textOutput);
    } else if (ev.audioOutput) {
      this.dispatch(sessionId, 'audioOutput', ev.audioOutput);
    } else if (ev.usageEvent) {
      this.dispatch(sessionId, 'usageEvent', ev.usageEvent);
    } else if (ev.toolUse) {
      this.dispatch(sessionId, 'toolUse', ev.toolUse);
      const toolUse = ev.toolUse as ToolUseEvent;
      session.toolUseContent = toolUse;
      session.toolUseId = toolUse.toolUseId;
      session.toolName = toolUse.toolName;
    } else if (ev.contentEnd) {
      const contentEnd = ev.contentEnd as { type?: string };
      if (contentEnd.type === 'TOOL') {
        this.dispatch(sessionId, 'toolEnd', {
          toolUseContent: session.toolUseContent,
          toolUseId: session.toolUseId,
          toolName: session.toolName,
        });
      } else {
        this.dispatch(sessionId, 'contentEnd', ev.contentEnd);
      }
    } else {
      this.dispatch(sessionId, 'unknown', { event: ev });
    }
  }

  /**
   * Sets up the session start event.
   * @internal
   */
  setupSessionStartEvent(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    this.addEvent(sessionId, {
      sessionStart: {
        inferenceConfiguration: session.inferenceConfig,
      },
    });
  }

  /**
   * Sets up the prompt start event.
   * @internal
   */
  setupPromptStartEvent(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    this.addEvent(sessionId, {
      promptStart: {
        promptName: session.promptName,
        textOutputConfiguration: { mediaType: 'text/plain' },
        audioOutputConfiguration: DefaultAudioOutputConfiguration,
        toolUseOutputConfiguration: { mediaType: 'application/json' },
        toolConfiguration: this.config.toolConfiguration,
      },
    });
    session.isPromptStartSent = true;
  }

  /**
   * Sets up the system prompt event.
   * @internal
   */
  setupSystemPromptEvent(
    sessionId: string,
    textConfig: TextConfiguration,
    systemPromptContent: string
  ): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    const contentName = randomUUID();

    this.addEvent(sessionId, {
      contentStart: {
        promptName: session.promptName,
        contentName,
        type: 'TEXT',
        interactive: false,
        role: 'SYSTEM',
        textInputConfiguration: textConfig,
      },
    });

    this.addEvent(sessionId, {
      textInput: {
        promptName: session.promptName,
        contentName,
        content: systemPromptContent,
      },
    });

    this.addEvent(sessionId, {
      contentEnd: {
        promptName: session.promptName,
        contentName,
      },
    });
  }

  /**
   * Sets up the audio start event.
   * @internal
   */
  setupStartAudioEvent(sessionId: string, audioConfig: AudioConfiguration): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    this.addEvent(sessionId, {
      contentStart: {
        promptName: session.promptName,
        contentName: session.audioContentId,
        type: 'AUDIO',
        interactive: true,
        role: 'USER',
        audioInputConfiguration: audioConfig,
      },
    });
    session.isAudioContentStartSent = true;
  }

  /**
   * Streams an audio chunk.
   * @internal
   */
  async streamAudioChunk(sessionId: string, audioData: Buffer): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session || !session.isActive) {
      throw new Error('Invalid or inactive session');
    }

    const base64 = audioData.toString('base64');
    this.addEvent(sessionId, {
      audioInput: {
        promptName: session.promptName,
        contentName: session.audioContentId,
        content: base64,
      },
    });
  }

  /**
   * Sends a tool result back to the model.
   * @param sessionId - Session identifier
   * @param toolUseId - Tool use ID from the tool call
   * @param result - Tool execution result
   */
  async sendToolResult(sessionId: string, toolUseId: string, result: unknown): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session || !session.isActive) return;

    const contentName = randomUUID();
    const content = typeof result === 'string' ? result : JSON.stringify(result);

    this.addEvent(sessionId, {
      contentStart: {
        promptName: session.promptName,
        contentName,
        interactive: false,
        type: 'TOOL',
        role: 'TOOL',
        toolResultInputConfiguration: {
          toolUseId,
          type: 'TEXT',
          textInputConfiguration: { mediaType: 'text/plain' },
        },
      },
    });

    this.addEvent(sessionId, {
      toolResult: {
        promptName: session.promptName,
        contentName,
        content,
      },
    });

    this.addEvent(sessionId, {
      contentEnd: {
        promptName: session.promptName,
        contentName,
      },
    });
  }

  /**
   * Sends content end event.
   * @internal
   */
  async sendContentEnd(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session || !session.isAudioContentStartSent) return;

    this.addEvent(sessionId, {
      contentEnd: {
        promptName: session.promptName,
        contentName: session.audioContentId,
      },
    });

    // Small delay to ensure event is sent
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  /**
   * Sends prompt end event.
   * @internal
   */
  async sendPromptEnd(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session || !session.isPromptStartSent) return;

    this.addEvent(sessionId, {
      promptEnd: {
        promptName: session.promptName,
      },
    });

    // Small delay to ensure event is sent
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  /**
   * Sends session end event.
   * @internal
   */
  async sendSessionEnd(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    this.addEvent(sessionId, {
      sessionEnd: {},
    });

    // Small delay to ensure event is sent
    await new Promise((resolve) => setTimeout(resolve, 250));

    session.isActive = false;
    session.closeSignal.next();
    session.closeSignal.complete();
    this.activeSessions.delete(sessionId);
    this.sessionLastActivity.delete(sessionId);
  }
}
