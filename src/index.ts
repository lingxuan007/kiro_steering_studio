/**
 * Kiro Steering Studio - Entry Point
 *
 * Voice-powered steering file generator for Kiro using Amazon Nova Sonic.
 */

import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { Server } from 'socket.io';
import { fromIni } from '@aws-sdk/credential-providers';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { Buffer } from 'node:buffer';

import { config, validateAndLogConfig } from './config';
import { NovaSonicClient, StreamSession } from './sonic/client';
import { SteeringStore } from './steering/store';
import { runTool, toolConfiguration } from './steering/tools';
import { sessionManager } from './server/session-manager';
import { SessionState } from './server/types';
import type { ToolEndData } from './sonic/types';

// Validate configuration on startup
validateAndLogConfig();

// Express and Socket.IO setup
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: config.server.socketPingInterval,
  pingTimeout: config.server.socketPingTimeout,
});

// Static file serving
app.use(express.static(path.join(process.cwd(), 'public')));

// AWS credentials resolution
const credentials = config.aws.profile
  ? fromIni({ profile: config.aws.profile })
  : defaultProvider();

// Initialize steering store
const store = new SteeringStore(config.steering.outputDirAbsolute);

// Initialize Nova Sonic client
const sonic = new NovaSonicClient({
  modelId: config.aws.modelId,
  toolConfiguration: toolConfiguration(),
  clientConfig: {
    region: config.aws.region,
    credentials,
  },
});

/**
 * Periodically clean up inactive sessions.
 */
setInterval(() => {
  const now = Date.now();
  for (const sessionId of sonic.getActiveSessions()) {
    const last = sonic.getLastActivityTime(sessionId);
    if (now - last > config.session.inactiveTimeoutMs) {
      console.log('Force closing inactive session:', sessionId);
      try {
        sonic.forceCloseSession(sessionId);
      } catch (err) {
        console.error(`Error force closing session ${sessionId}:`, err);
      }
    }
  }
}, config.session.cleanupIntervalMs);

/**
 * Wires up event handlers for a stream session.
 */
function wireSessionEvents(
  socket: { id: string; emit: (event: string, data?: unknown) => void },
  session: StreamSession
): void {
  session.onEvent('contentStart', (d) => socket.emit('contentStart', d));
  session.onEvent('textOutput', (d) => socket.emit('textOutput', d));
  session.onEvent('audioOutput', (d) => socket.emit('audioOutput', d));
  session.onEvent('contentEnd', (d) => socket.emit('contentEnd', d));
  session.onEvent('usageEvent', (d) => socket.emit('usageEvent', d));
  session.onEvent('toolUse', (d) => socket.emit('toolUse', d));

  session.onEvent('toolEnd', async (d: unknown) => {
    const toolData = d as ToolEndData;
    try {
      const result = runTool(store, toolData.toolName, toolData.toolUseContent);

      // Emit steering updates if checkpoint was called
      if (toolData.toolName === 'checkpoint_steering_files' && result.updates) {
        for (const file of result.updates as string[]) {
          socket.emit('steeringUpdated', { file });
        }
      }

      // Emit specific field updates for set_* tools
      if (result.updated && Array.isArray(result.updated)) {
        socket.emit('steeringUpdated', { 
          tool: toolData.toolName,
          fields: result.updated 
        });
      }

      await sonic.sendToolResult(socket.id, toolData.toolUseId, result);
      socket.emit('toolResult', { toolUseId: toolData.toolUseId, ok: true });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await sonic.sendToolResult(socket.id, toolData.toolUseId, { ok: false, error: errorMessage });
      socket.emit('toolResult', { toolUseId: toolData.toolUseId, ok: false, error: errorMessage });
    }
  });

  session.onEvent('error', (e: unknown) => {
    sessionManager.deactivateSession(socket.id);
    const errorData = e as { message?: string };
    socket.emit('error', {
      message: 'Bedrock stream error',
      details: errorData?.message ?? String(e),
    });
  });

  session.onEvent('streamComplete', () => {
    sessionManager.deactivateSession(socket.id);
    socket.emit('streamComplete');
  });
}

/**
 * Attempts to recover a stream after an error or disconnect.
 */
async function recoverStream(
  socket: { id: string; emit: (event: string, data?: unknown) => void },
  reason: string
): Promise<boolean> {
  if (sessionManager.isRecovering(socket.id)) return false;
  sessionManager.setRecovering(socket.id, true);

  try {
    console.log(`[recover] Attempting stream recovery for ${socket.id} (${reason})`);

    // Clear keepalive timer
    sessionManager.clearKeepaliveTimer(socket.id);

    // Clean up previous session
    try {
      const existingSession = sessionManager.getSession(socket.id);
      if (existingSession) {
        try {
          await existingSession.close();
        } catch {
          // Ignore
        }
        sessionManager.removeSession(socket.id);
      }
      try {
        sonic.forceCloseSession(socket.id);
      } catch {
        // Ignore
      }
    } catch {
      // Ignore
    }

    // Create fresh session
    const session = sonic.createStreamSession(socket.id);
    wireSessionEvents(socket, session);
    sessionManager.activateSession(socket.id, session);

    // Start bidirectional streaming (don't await - it resolves when stream ends)
    sonic.initiateBidirectionalStreaming(socket.id).catch((err) => {
      console.error('Failed to start bidirectional stream (recover)', err);
      sessionManager.deactivateSession(socket.id);
      socket.emit('error', {
        message: 'Re-initializing bidirectional stream',
        details: err instanceof Error ? err.message : String(err),
      });
    });

    // Re-send setup events
    await session.setupSessionAndPromptStart();

    // Build recovery prompt with state
    const basePrompt = sessionManager.getSystemPrompt(socket.id);
    const stateJson = store.getStateJsonString(true);
    const recoveryPrompt = `${basePrompt}

# Recovery context
The previous voice stream ended unexpectedly. Use the JSON below as the authoritative state of the steering docs and unresolved questions.
Do NOT rewrite steering content unless asked; apply targeted, minimal updates that preserve existing decisions.

\`\`\`json
${stateJson}
\`\`\`
`;

    await session.setupSystemPrompt(recoveryPrompt);
    await session.setupStartAudio();
    sessionManager.setAudioReady(socket.id, true);

    console.log(`[recover] Recovery succeeded for ${socket.id}`);
    return true;
  } catch (err) {
    console.error(`[recover] Recovery failed for ${socket.id}:`, err);
    sessionManager.deactivateSession(socket.id);
    socket.emit('error', {
      message: 'Failed to recover stream',
      details: err instanceof Error ? err.message : String(err),
    });
    return false;
  } finally {
    sessionManager.setRecovering(socket.id, false);
  }
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  // Send server configuration to client
  socket.emit('serverConfig', {
    steeringDir: config.steering.outputDirAbsolute,
    modelId: config.aws.modelId,
    region: config.aws.region,
  });

  // Initialize session state
  sessionManager.initializeSocket(socket.id);

  // Initialize connection
  socket.on('initializeConnection', async (cb) => {
    try {
      sessionManager.setAudioReady(socket.id, false);

      // Reuse existing active session if available
      if (sessionManager.hasSession(socket.id) && sonic.isSessionActive(socket.id)) {
        cb?.({ success: true });
        sessionManager.setState(socket.id, SessionState.ACTIVE);
        return;
      }

      // Create new session
      const session = sonic.createStreamSession(socket.id);
      wireSessionEvents(socket, session);
      sessionManager.activateSession(socket.id, session);

      // Start streaming (don't await)
      sonic.initiateBidirectionalStreaming(socket.id).catch((err) => {
        sessionManager.deactivateSession(socket.id);
        sessionManager.removeSession(socket.id);
        try {
          sonic.forceCloseSession(socket.id);
        } catch {
          // Ignore
        }
        socket.emit('error', {
          message: 'Re-initializing bidirectional stream',
          details: err instanceof Error ? err.message : String(err),
        });
      });

      cb?.({ success: true });
    } catch (err) {
      cb?.({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Pause/resume handling
  socket.on('pauseState', async (payload) => {
    const paused = typeof payload === 'boolean' ? payload : !!payload?.paused;

    // Clear existing keepalive timer
    sessionManager.clearKeepaliveTimer(socket.id);

    if (!paused) {
      // On resume, recover if stream died during pause
      const hasSession = sessionManager.hasSession(socket.id) && sonic.isSessionActive(socket.id);
      if (!hasSession || !sessionManager.isActive(socket.id)) {
        try {
          store.flushState();
        } catch {
          // Ignore
        }
        await recoverStream(socket, 'resume');
      }
      return;
    }

    // Start keepalive only if audio is ready
    const session = sessionManager.getSession(socket.id);
    if (!session || !sessionManager.isActive(socket.id) || !sessionManager.isAudioReady(socket.id)) {
      return;
    }

    const timer = setInterval(async () => {
      try {
        const liveSession = sessionManager.getSession(socket.id);
        if (
          !liveSession ||
          !sessionManager.isActive(socket.id) ||
          !sessionManager.isAudioReady(socket.id)
        ) {
          sessionManager.clearKeepaliveTimer(socket.id);
          return;
        }

        await liveSession.streamAudio(Buffer.alloc(config.keepalive.chunkBytes));
      } catch (err) {
        sessionManager.clearKeepaliveTimer(socket.id);
        console.error('Pause keepalive error:', err);
      }
    }, config.keepalive.intervalMs);

    sessionManager.setKeepaliveTimer(socket.id, timer);
  });

  // Prompt setup
  socket.on('promptStart', async () => {
    const session = sessionManager.getSession(socket.id);
    if (session) {
      await session.setupSessionAndPromptStart();
    }
  });

  socket.on('systemPrompt', async (prompt: string) => {
    sessionManager.setSystemPrompt(socket.id, prompt);
    const session = sessionManager.getSession(socket.id);
    if (session) {
      await session.setupSystemPrompt(prompt);
    }
  });

  socket.on('audioStart', async () => {
    const session = sessionManager.getSession(socket.id);
    if (session) {
      await session.setupStartAudio();
      sessionManager.setAudioReady(socket.id, true);
    }
  });

  // Audio input handling
  socket.on('audioInput', async (audioBase64: string) => {
    if (sessionManager.isCleaningUp(socket.id)) return;

    const buf = Buffer.from(audioBase64, 'base64');
    const session = sessionManager.getSession(socket.id);

    try {
      if (
        !session ||
        !sessionManager.isActive(socket.id) ||
        !sessionManager.isAudioReady(socket.id) ||
        !sonic.isSessionActive(socket.id)
      ) {
        try {
          store.flushState();
        } catch {
          // Ignore
        }
        const ok = await recoverStream(socket, 'audioInput');
        if (!ok) return;
      }

      const liveSession = sessionManager.getSession(socket.id);
      if (liveSession) {
        await liveSession.streamAudio(buf);
      }
    } catch (err) {
      console.error('audioInput error:', err);
      try {
        store.flushState();
      } catch {
        // Ignore
      }
      const ok = await recoverStream(socket, 'audioInput-error');
      if (!ok) return;

      try {
        const liveSession = sessionManager.getSession(socket.id);
        if (liveSession) {
          await liveSession.streamAudio(buf);
        }
      } catch {
        // Ignore
      }
    }
  });

  // Stop audio
  socket.on('stopAudio', async () => {
    sessionManager.clearKeepaliveTimer(socket.id);
    sessionManager.deactivateSession(socket.id);

    try {
      store.flushState();
    } catch {
      // Ignore
    }

    const session = sessionManager.getSession(socket.id);
    if (!session || sessionManager.isCleaningUp(socket.id)) return;

    sessionManager.setCleaningUp(socket.id, true);
    try {
      await session.endAudioContent();
      await session.endPrompt();
      await session.close();
    } catch {
      try {
        sonic.forceCloseSession(socket.id);
      } catch {
        // Ignore
      }
    } finally {
      sessionManager.setCleaningUp(socket.id, false);
      sessionManager.removeSession(socket.id);
    }
  });

  // Disconnect handling
  socket.on('disconnect', async () => {
    sessionManager.clearKeepaliveTimer(socket.id);

    try {
      store.flushState();
    } catch {
      // Ignore
    }

    const session = sessionManager.getSession(socket.id);

    if (session && !sessionManager.isCleaningUp(socket.id) && sonic.isSessionActive(socket.id)) {
      sessionManager.setCleaningUp(socket.id, true);
      try {
        await session.endAudioContent();
        await session.endPrompt();
        await session.close();
      } catch {
        try {
          sonic.forceCloseSession(socket.id);
        } catch {
          // Ignore
        }
      } finally {
        sessionManager.setCleaningUp(socket.id, false);
      }
    }

    sessionManager.cleanupSocket(socket.id);
  });
});

// Start server
server.listen(config.server.port, () => {
  console.log('Steering Studio listening on http://localhost:%d', config.server.port);
});
