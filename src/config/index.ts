/**
 * Centralized configuration module for Kiro Steering Studio.
 *
 * All environment variables and application constants are managed here
 * with validation and sensible defaults.
 */

import path from 'node:path';

/**
 * Gets an environment variable value with an optional default.
 */
function env(name: string, defaultValue?: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? defaultValue : value;
}

/**
 * Server configuration.
 */
export const serverConfig = {
  /** HTTP server port */
  port: Number(env('PORT', '3000')),

  /** Socket.IO ping interval in milliseconds */
  socketPingInterval: 25000,

  /** Socket.IO ping timeout in milliseconds */
  socketPingTimeout: 60000,
} as const;

/**
 * AWS configuration for Bedrock access.
 */
export const awsConfig = {
  /** AWS region for Bedrock API calls */
  region: env('AWS_REGION', 'us-east-1')!,

  /** Optional AWS profile name for credential resolution */
  profile: env('AWS_PROFILE', ''),

  /** Bedrock model ID to use */
  modelId: env('MODEL_ID', 'amazon.nova-2-sonic-v1:0')!,
} as const;

/**
 * Steering file output configuration.
 */
export const steeringConfig = {
  /** Relative or absolute path to steering output directory */
  outputDir: env('STEERING_DIR', './.kiro/steering')!,

  /** Resolved absolute path to steering output directory */
  get outputDirAbsolute(): string {
    return path.resolve(process.cwd(), this.outputDir);
  },
} as const;

/**
 * Audio streaming constants.
 */
export const audioConfig = {
  /** Target sample rate for input audio (Hz) */
  inputSampleRate: 16000,

  /** Output sample rate from Nova Sonic (Hz) */
  outputSampleRate: 24000,

  /** Sample size in bits */
  sampleSizeBits: 16,

  /** Number of audio channels (mono) */
  channelCount: 1,

  /** Voice ID for Nova Sonic output */
  voiceId: 'tiffany',
} as const;

/**
 * Session keepalive configuration for pause/resume.
 */
export const keepaliveConfig = {
  /** Interval between keepalive frames when paused (ms) */
  intervalMs: 2000,

  /** Size of silent keepalive audio chunk (bytes) - 50ms of 16kHz mono s16le */
  chunkBytes: 1600,
} as const;

/**
 * Session management constants.
 */
export const sessionConfig = {
  /** Time after which inactive sessions are force-closed (ms) */
  inactiveTimeoutMs: 5 * 60 * 1000, // 5 minutes

  /** Interval for checking inactive sessions (ms) */
  cleanupIntervalMs: 60 * 1000, // 1 minute

  /** HTTP/2 request timeout (ms) */
  requestTimeoutMs: 24 * 60 * 60 * 1000, // 24 hours

  /** HTTP/2 session timeout (ms) */
  sessionTimeoutMs: 24 * 60 * 60 * 1000, // 24 hours

  /** Maximum concurrent streams per connection */
  maxConcurrentStreams: 20,
} as const;

/**
 * Model inference configuration defaults.
 */
export const inferenceConfig = {
  /** Maximum tokens to generate */
  maxTokens: 1024,

  /** Top-p sampling parameter */
  topP: 0.9,

  /** Temperature for randomness */
  temperature: 0.7,
} as const;

/**
 * Validates the configuration and logs the active settings.
 */
export function validateAndLogConfig(): void {
  console.log('Kiro Steering Studio configuration:');
  console.log(`  Port: ${serverConfig.port}`);
  console.log(`  AWS Region: ${awsConfig.region}`);
  console.log(`  AWS Profile: ${awsConfig.profile || '(default)'}`);
  console.log(`  Model ID: ${awsConfig.modelId}`);
  console.log(`  Steering output: ${steeringConfig.outputDirAbsolute}`);

  // Basic validation
  if (serverConfig.port < 1 || serverConfig.port > 65535) {
    throw new Error(`Invalid PORT: ${serverConfig.port}`);
  }

  if (!awsConfig.region) {
    throw new Error('AWS_REGION must be set');
  }

  if (!awsConfig.modelId) {
    throw new Error('MODEL_ID must be set');
  }
}

/**
 * Export all config as a single object for convenience.
 */
export const config = {
  server: serverConfig,
  aws: awsConfig,
  steering: steeringConfig,
  audio: audioConfig,
  keepalive: keepaliveConfig,
  session: sessionConfig,
  inference: inferenceConfig,
  validate: validateAndLogConfig,
} as const;

export default config;
