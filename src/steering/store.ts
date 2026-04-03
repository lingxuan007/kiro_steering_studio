/**
 * Steering store for managing and persisting steering file content.
 *
 * This module handles the in-memory state of steering files (product.md, tech.md, structure.md)
 * and provides methods for updating, persisting, and rendering them.
 */

import fs from 'node:fs';
import path from 'node:path';

import type {
  MergeMode,
  ProductSteering,
  TechSteering,
  StructureSteering,
  OpenQuestion,
  AddQuestionInput,
  SteeringSummary,
  PersistedState,
  FlushOptions,
} from './types';

// Re-export types for convenience
export type { MergeMode };

/**
 * Gets the current ISO timestamp.
 */
function now(): string {
  return new Date().toISOString();
}

/**
 * Ensures a directory exists, creating it if necessary.
 */
function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Writes content to a file atomically using a temp file and rename.
 * This prevents partial writes if the process is interrupted.
 */
function writeAtomic(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp-${Date.now()}`;
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, filePath);
}

/**
 * Appends unique values from patch array to base array.
 */
function uniqueAppend(base: string[] | undefined, patch: string[] | undefined): string[] {
  const result = base ?? [];
  const patchValues = patch ?? [];
  const existing = new Set(result);

  for (const value of patchValues) {
    if (value && !existing.has(value)) {
      result.push(value);
      existing.add(value);
    }
  }

  return result;
}

/**
 * Merges two objects, combining arrays with unique append.
 */
function mergeObj<T extends object>(base: T, patch: Partial<T>): T {
  const out = { ...base };

  for (const key of Object.keys(patch) as Array<keyof T>) {
    const value = patch[key];
    if (value === undefined) continue;

    if (Array.isArray(value)) {
      (out as Record<string, unknown>)[key as string] = uniqueAppend(
        (out as Record<string, unknown>)[key as string] as string[] | undefined,
        value as string[]
      );
    } else {
      out[key] = value as T[keyof T];
    }
  }

  return out;
}


/**
 * YAML front matter for steering files.
 */
const FRONT_MATTER = `---\ninclusion: always\n---\n`;

/**
 * Renders product steering data to Markdown.
 */
function renderProduct(product: ProductSteering, _questions: OpenQuestion[]): string {
  const glossary = product.glossary?.length
    ? product.glossary.map((g) => `- **${g.term}**: ${g.definition}`).join('\n')
    : '';

  return [
    FRONT_MATTER,
    '# Product Overview',
    '',
    '## One-liner',
    '',
    product.appOneLiner ? `> ${product.appOneLiner}` : '',
    '',
    '## Target Users',
    '',
    product.targetUsers ?? '',
    '',
    '## MVP User Journeys',
    '',
    product.userJourneys?.length
      ? product.userJourneys.map((x) => `- ${x}`).join('\n')
      : '',
    '',
    '## MVP Features',
    '',
    product.mvpFeatures?.length
      ? product.mvpFeatures.map((x) => `- ${x}`).join('\n')
      : '',
    '',
    '## Non-goals (Out of Scope)',
    '',
    product.nonGoals?.length ? product.nonGoals.map((x) => `- ${x}`).join('\n') : '',
    '',
    '## Success Metrics',
    '',
    product.successMetrics?.length
      ? product.successMetrics.map((x) => `- ${x}`).join('\n')
      : '',
    '',
    '## Glossary',
    '',
    glossary,
    '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * Renders tech steering data to Markdown.
 */
function renderTech(tech: TechSteering): string {
  const sections: string[] = [FRONT_MATTER, '# Technology Stack', ''];

  if (tech.frontend) {
    sections.push('## Frontend', '', tech.frontend, '');
  }

  if (tech.backend) {
    sections.push('## Backend', '', tech.backend, '');
  }

  if (tech.auth) {
    sections.push('## Authentication', '', tech.auth, '');
  }

  if (tech.data) {
    sections.push('## Data & Storage', '', tech.data, '');
  }

  if (tech.iac) {
    sections.push('## IaC / Provisioning', '', tech.iac, '');
  }

  if (tech.observability) {
    sections.push('## Observability', '', tech.observability, '');
  }

  if (tech.style) {
    sections.push('## Style', '', tech.style, '');
  }

  if (tech.constraints?.length) {
    sections.push(
      '## Constraints',
      '',
      tech.constraints.map((x) => `- ${x}`).join('\n'),
      ''
    );
  }

  return sections.join('\n');
}

/**
 * Renders structure steering data to Markdown.
 */
function renderStructure(structure: StructureSteering): string {
  const sections: string[] = [FRONT_MATTER, '# Project Structure', ''];

  if (structure.repoLayout?.length) {
    sections.push(
      '## Repo Layout',
      '',
      structure.repoLayout.map((x) => `- ${x}`).join('\n'),
      ''
    );
  }

  if (structure.namingConventions?.length) {
    sections.push(
      '## Naming Conventions',
      '',
      structure.namingConventions.map((x) => `- ${x}`).join('\n'),
      ''
    );
  }

  if (structure.importConventions?.length) {
    sections.push(
      '## Import Conventions',
      '',
      structure.importConventions.map((x) => `- ${x}`).join('\n'),
      ''
    );
  }

  if (structure.architecturePatterns?.length) {
    sections.push(
      '## Architecture Patterns',
      '',
      structure.architecturePatterns.map((x) => `- ${x}`).join('\n'),
      ''
    );
  }

  if (structure.testingApproach?.length) {
    sections.push(
      '## Testing Approach',
      '',
      structure.testingApproach.map((x) => `- ${x}`).join('\n'),
      ''
    );
  }

  return sections.join('\n');
}

/**
 * Manages steering file content and persistence.
 *
 * The store maintains in-memory state for product, tech, and structure steering,
 * along with open questions. It persists state to a JSON file for recovery
 * and renders Markdown files on checkpoint.
 */
export class SteeringStore {
  /** Product steering data */
  public product: ProductSteering = {};

  /** Tech steering data */
  public tech: TechSteering = {};

  /** Structure steering data */
  public structure: StructureSteering = {};

  /** List of open questions */
  public openQuestions: OpenQuestion[] = [];

  /** Absolute path to state directory */
  private readonly stateDirAbs: string;

  /** Absolute path to state JSON file */
  private readonly stateFileAbs: string;

  /**
   * Creates a new steering store.
   * @param steeringDirAbs - Absolute path to the steering output directory
   */
  constructor(public readonly steeringDirAbs: string) {
    ensureDir(steeringDirAbs);

    // Keep durable conversation state adjacent to the steering directory
    // Default: <repo>/.kiro/steering-studio/state.json
    this.stateDirAbs = path.join(path.dirname(steeringDirAbs), 'steering-studio');
    ensureDir(this.stateDirAbs);
    this.stateFileAbs = path.join(this.stateDirAbs, 'state.json');

    this.loadStateFromDisk();
  }

  /**
   * Updates product steering data.
   * @param patch - Partial product steering to apply
   * @param mode - "merge" to combine, "replace" to overwrite
   */
  setProduct(patch: ProductSteering, mode: MergeMode): void {
    this.product = mode === 'replace' ? { ...patch } : mergeObj(this.product, patch);
    this.saveStateToDisk();
    this.checkpoint();
  }

  /**
   * Updates tech steering data.
   * @param patch - Partial tech steering to apply
   * @param mode - "merge" to combine, "replace" to overwrite
   */
  setTech(patch: TechSteering, mode: MergeMode): void {
    this.tech = mode === 'replace' ? { ...patch } : mergeObj(this.tech, patch);
    this.saveStateToDisk();
    this.checkpoint();
  }

  /**
   * Updates structure steering data.
   * @param patch - Partial structure steering to apply
   * @param mode - "merge" to combine, "replace" to overwrite
   */
  setStructure(patch: StructureSteering, mode: MergeMode): void {
    this.structure = mode === 'replace' ? { ...patch } : mergeObj(this.structure, patch);
    this.saveStateToDisk();
    this.checkpoint();
  }

  /**
   * Adds a new open question.
   * @param input - Question data
   * @returns The created question
   */
  addOpenQuestion(input: AddQuestionInput): OpenQuestion {
    const question: OpenQuestion = {
      id: `Q${this.openQuestions.length + 1}`,
      question: input.question,
      whyItMatters: input.whyItMatters,
      status: 'open',
      createdAt: now(),
    };

    this.openQuestions.push(question);
    this.saveStateToDisk();
    return question;
  }

  /**
   * Resolves an open question.
   * @param id - Question ID to resolve
   * @param resolution - Resolution text
   * @returns The updated question
   * @throws Error if question not found
   */
  resolveOpenQuestion(id: string, resolution: string): OpenQuestion {
    const question = this.openQuestions.find((q) => q.id === id);
    if (!question) {
      throw new Error(`Open question not found: ${id}`);
    }

    question.status = 'resolved';
    question.resolution = resolution;
    question.resolvedAt = now();

    this.saveStateToDisk();
    return question;
  }

  /**
   * Gets a summary of steering state including missing fields and open questions.
   */
  summary(): SteeringSummary {
    const open = this.openQuestions.filter((q) => q.status === 'open');
    const missing: string[] = [];

    if (!this.product.appOneLiner) missing.push('product.appOneLiner');
    if (!this.product.targetUsers) missing.push('product.targetUsers');
    if (!this.tech.frontend) missing.push('tech.frontend');
    if (!this.tech.backend) missing.push('tech.backend');
    if (!this.structure.repoLayout?.length) missing.push('structure.repoLayout');

    return {
      missing,
      open: open.map((q) => ({ id: q.id, question: q.question })),
    };
  }

  /**
   * Writes all steering files to disk and returns list of written files.
   * @returns Array of file names that were written
   */
  checkpoint(): string[] {
    const files: string[] = [];

    this.writeFile('product.md', renderProduct(this.product, this.openQuestions));
    files.push('product.md');

    this.writeFile('tech.md', renderTech(this.tech));
    files.push('tech.md');

    this.writeFile('structure.md', renderStructure(this.structure));
    files.push('structure.md');

    this.saveStateToDisk();
    return files;
  }

  /**
   * Flushes durable state to disk and optionally refreshes steering files.
   * Intended to be called on lifecycle moments like stop/disconnect.
   * @param options - Flush options
   * @returns Array of written file names if writeSteering is true
   */
  flushState(options?: FlushOptions): string[] {
    const writeSteering = options?.writeSteering ?? true;

    if (writeSteering) {
      return this.checkpoint();
    }

    this.saveStateToDisk();
    return [];
  }

  /**
   * Gets the current state as a JSON string for recovery.
   * @param compact - If true, minimizes whitespace
   * @returns JSON string representation of the state
   */
  getStateJsonString(compact = false): string {
    const payload: PersistedState = {
      version: 1,
      updatedAt: now(),
      product: this.product,
      tech: this.tech,
      structure: this.structure,
      openQuestions: this.openQuestions,
    };

    return compact ? JSON.stringify(payload) : JSON.stringify(payload, null, 2);
  }

  /**
   * Loads state from the JSON file on disk.
   */
  private loadStateFromDisk(): void {
    try {
      if (!fs.existsSync(this.stateFileAbs)) return;

      const raw = fs.readFileSync(this.stateFileAbs, 'utf-8');
      if (!raw.trim()) return;

      const parsed = JSON.parse(raw) as Partial<PersistedState>;

      // Defensive parsing: only accept the fields we know about
      if (parsed && typeof parsed === 'object') {
        if (parsed.product && typeof parsed.product === 'object') {
          this.product = parsed.product;
        }
        if (parsed.tech && typeof parsed.tech === 'object') {
          this.tech = parsed.tech;
        }
        if (parsed.structure && typeof parsed.structure === 'object') {
          this.structure = parsed.structure;
        }
        if (Array.isArray(parsed.openQuestions)) {
          this.openQuestions = parsed.openQuestions;
        }
      }
    } catch (err) {
      // If state is corrupted, we intentionally do not crash the server
      console.warn('[steering] Failed to load state.json; starting fresh.', err);
    }
  }

  /**
   * Saves the current state to the JSON file on disk.
   */
  private saveStateToDisk(): void {
    try {
      const content = this.getStateJsonString() + '\n';
      writeAtomic(this.stateFileAbs, content);
    } catch (err) {
      console.warn('[steering] Failed to write state.json', err);
    }
  }

  /**
   * Writes a steering file to disk.
   */
  private writeFile(name: string, content: string): void {
    const abs = path.join(this.steeringDirAbs, name);
    writeAtomic(abs, content);
  }
}
