/**
 * Session manager for tracking Socket.IO session state.
 *
 * Encapsulates all session-related state management including:
 * - Stream sessions
 * - Session states
 * - Audio readiness
 * - System prompts
 * - Keepalive timers
 * - Recovery tracking
 */

import type { StreamSession } from '../sonic/client';
import { SessionState } from './types';

/**
 * Default system prompt used when client hasn't sent one yet.
 */
const DEFAULT_SYSTEM_PROMPT =
  'You are Nova 2 Sonic, a real-time voice agent. Keep responses short, helpful, and conversational.';

/**
 * Manages session state for all connected sockets.
 */
export class SessionManager {
  /** Map of socket ID to stream session */
  private sessions = new Map<string, StreamSession>();

  /** Map of socket ID to session state */
  private states = new Map<string, SessionState>();

  /** Map of socket ID to audio ready flag */
  private audioReady = new Map<string, boolean>();

  /** Map of socket ID to last system prompt */
  private systemPrompts = new Map<string, string>();

  /** Map of socket ID to keepalive timer */
  private keepaliveTimers = new Map<string, NodeJS.Timeout>();

  /** Set of socket IDs currently in recovery */
  private recovering = new Set<string>();

  /** Map of socket ID to cleanup-in-progress flag */
  private cleaningUp = new Map<string, boolean>();

  /**
   * Gets the stream session for a socket.
   */
  getSession(socketId: string): StreamSession | undefined {
    return this.sessions.get(socketId);
  }

  /**
   * Sets the stream session for a socket.
   */
  setSession(socketId: string, session: StreamSession): void {
    this.sessions.set(socketId, session);
  }

  /**
   * Checks if a session exists for the socket.
   */
  hasSession(socketId: string): boolean {
    return this.sessions.has(socketId);
  }

  /**
   * Removes the session for a socket.
   */
  removeSession(socketId: string): void {
    this.sessions.delete(socketId);
  }

  /**
   * Gets the session state for a socket.
   */
  getState(socketId: string): SessionState {
    return this.states.get(socketId) ?? SessionState.CLOSED;
  }

  /**
   * Sets the session state for a socket.
   */
  setState(socketId: string, state: SessionState): void {
    this.states.set(socketId, state);
  }

  /**
   * Checks if the session is active.
   */
  isActive(socketId: string): boolean {
    return this.getState(socketId) === SessionState.ACTIVE;
  }

  /**
   * Gets whether audio is ready for a socket.
   */
  isAudioReady(socketId: string): boolean {
    return this.audioReady.get(socketId) ?? false;
  }

  /**
   * Sets the audio ready state for a socket.
   */
  setAudioReady(socketId: string, ready: boolean): void {
    this.audioReady.set(socketId, ready);
  }

  /**
   * Gets the last system prompt for a socket.
   */
  getSystemPrompt(socketId: string): string {
    return this.systemPrompts.get(socketId) ?? DEFAULT_SYSTEM_PROMPT;
  }

  /**
   * Sets the last system prompt for a socket.
   */
  setSystemPrompt(socketId: string, prompt: string): void {
    this.systemPrompts.set(socketId, prompt);
  }

  /**
   * Gets the keepalive timer for a socket.
   */
  getKeepaliveTimer(socketId: string): NodeJS.Timeout | undefined {
    return this.keepaliveTimers.get(socketId);
  }

  /**
   * Sets a keepalive timer for a socket.
   */
  setKeepaliveTimer(socketId: string, timer: NodeJS.Timeout): void {
    this.keepaliveTimers.set(socketId, timer);
  }

  /**
   * Clears and removes the keepalive timer for a socket.
   */
  clearKeepaliveTimer(socketId: string): void {
    const timer = this.keepaliveTimers.get(socketId);
    if (timer) {
      clearInterval(timer);
      this.keepaliveTimers.delete(socketId);
    }
  }

  /**
   * Checks if recovery is in progress for a socket.
   */
  isRecovering(socketId: string): boolean {
    return this.recovering.has(socketId);
  }

  /**
   * Marks a socket as recovering.
   */
  setRecovering(socketId: string, recovering: boolean): void {
    if (recovering) {
      this.recovering.add(socketId);
    } else {
      this.recovering.delete(socketId);
    }
  }

  /**
   * Checks if cleanup is in progress for a socket.
   */
  isCleaningUp(socketId: string): boolean {
    return this.cleaningUp.get(socketId) ?? false;
  }

  /**
   * Sets the cleanup-in-progress flag for a socket.
   */
  setCleaningUp(socketId: string, cleaningUp: boolean): void {
    this.cleaningUp.set(socketId, cleaningUp);
  }

  /**
   * Initializes default state for a new socket connection.
   */
  initializeSocket(socketId: string): void {
    this.states.set(socketId, SessionState.CLOSED);
    this.audioReady.set(socketId, false);
    if (!this.systemPrompts.has(socketId)) {
      this.systemPrompts.set(socketId, DEFAULT_SYSTEM_PROMPT);
    }
  }

  /**
   * Cleans up all state for a disconnected socket.
   */
  cleanupSocket(socketId: string): void {
    this.clearKeepaliveTimer(socketId);
    this.sessions.delete(socketId);
    this.states.delete(socketId);
    this.audioReady.delete(socketId);
    this.systemPrompts.delete(socketId);
    this.recovering.delete(socketId);
    this.cleaningUp.delete(socketId);
  }

  /**
   * Marks a session as active after successful initialization.
   */
  activateSession(socketId: string, session: StreamSession): void {
    this.sessions.set(socketId, session);
    this.states.set(socketId, SessionState.ACTIVE);
    this.audioReady.set(socketId, false);
  }

  /**
   * Marks a session as closed.
   */
  deactivateSession(socketId: string): void {
    this.states.set(socketId, SessionState.CLOSED);
    this.audioReady.delete(socketId);
  }

  /**
   * Gets statistics about current sessions.
   */
  getStats(): { total: number; active: number; recovering: number } {
    let active = 0;
    for (const state of this.states.values()) {
      if (state === SessionState.ACTIVE) active++;
    }
    return {
      total: this.sessions.size,
      active,
      recovering: this.recovering.size,
    };
  }
}

/**
 * Singleton instance of the session manager.
 */
export const sessionManager = new SessionManager();
