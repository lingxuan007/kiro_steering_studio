/**
 * Type definitions for steering file management.
 */

/**
 * Merge mode for steering updates.
 * - "merge": Combine new values with existing values (default)
 * - "replace": Completely replace the section with new values
 */
export type MergeMode = 'merge' | 'replace';

/**
 * Glossary entry for product steering.
 */
export interface GlossaryEntry {
  /** The term being defined */
  term: string;
  /** Definition of the term */
  definition: string;
}

/**
 * Product steering configuration (product.md).
 * Defines the product's purpose, users, scope, and success criteria.
 */
export interface ProductSteering {
  /** One-sentence description of the application */
  appOneLiner?: string;
  /** Description of target users */
  targetUsers?: string;
  /** MVP user journeys */
  userJourneys?: string[];
  /** MVP features to implement */
  mvpFeatures?: string[];
  /** Explicit non-goals (out of scope) */
  nonGoals?: string[];
  /** Success metrics for the product */
  successMetrics?: string[];
  /** Glossary of domain terms */
  glossary?: GlossaryEntry[];
}

/**
 * Technology steering configuration (tech.md).
 * Defines the technical stack and engineering guidance.
 */
export interface TechSteering {
  /** Frontend framework and tooling */
  frontend?: string;
  /** Backend framework and API approach */
  backend?: string;
  /** Authentication and authorization approach */
  auth?: string;
  /** Data storage and management */
  data?: string;
  /** Infrastructure as Code tooling */
  iac?: string;
  /** Observability (logging, metrics, tracing) */
  observability?: string;
  /** Style (layout structure, component hierarchy, navigation patterns) */
  style?: string;
  /** Technical constraints and limitations */
  constraints?: string[];
}

/**
 * Structure steering configuration (structure.md).
 * Defines project organization and conventions.
 */
export interface StructureSteering {
  /** Repository directory layout */
  repoLayout?: string[];
  /** Naming conventions for files/folders/code */
  namingConventions?: string[];
  /** Import/module conventions */
  importConventions?: string[];
  /** Architecture patterns to follow */
  architecturePatterns?: string[];
  /** Testing approach and conventions */
  testingApproach?: string[];
}

/**
 * Status of an open question.
 */
export type QuestionStatus = 'open' | 'resolved';

/**
 * An open question that needs resolution.
 * Used internally to track unresolved decisions.
 */
export interface OpenQuestion {
  /** Unique identifier for the question */
  id: string;
  /** The question text */
  question: string;
  /** Why this question matters for the project */
  whyItMatters?: string;
  /** Current status */
  status: QuestionStatus;
  /** Resolution when status is "resolved" */
  resolution?: string;
  /** ISO timestamp when created */
  createdAt: string;
  /** ISO timestamp when resolved */
  resolvedAt?: string;
}

/**
 * Input for adding a new open question.
 */
export interface AddQuestionInput {
  /** The question text */
  question: string;
  /** Why this question matters */
  whyItMatters?: string;
}

/**
 * Summary of steering state.
 */
export interface SteeringSummary {
  /** List of missing required fields */
  missing: string[];
  /** List of open questions */
  open: Array<{ id: string; question: string }>;
}

/**
 * Persisted state structure for recovery.
 */
export interface PersistedState {
  /** Schema version for forward compatibility */
  version: number;
  /** ISO timestamp of last update */
  updatedAt: string;
  /** Product steering data */
  product: ProductSteering;
  /** Tech steering data */
  tech: TechSteering;
  /** Structure steering data */
  structure: StructureSteering;
  /** Open questions list */
  openQuestions: OpenQuestion[];
}

/**
 * Tool result for successful operations.
 */
export interface ToolResultSuccess {
  ok: true;
  /** Optional additional data */
  [key: string]: unknown;
}

/**
 * Tool result for failed operations.
 */
export interface ToolResultError {
  ok: false;
  /** Error message */
  error: string;
}

/**
 * Union type for tool results.
 */
export type ToolResult = ToolResultSuccess | ToolResultError;

/**
 * Options for flushing state.
 */
export interface FlushOptions {
  /** Whether to also write steering markdown files (default: true) */
  writeSteering?: boolean;
}
