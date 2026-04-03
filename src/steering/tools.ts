/**
 * Tool definitions and handlers for steering file manipulation.
 *
 * These tools are used by the Nova Sonic model to update steering files
 * during voice conversations.
 */

import { z } from 'zod';

import { SteeringStore } from './store';
import type { MergeMode } from './types';

/**
 * Zod schema for merge mode.
 */
const MergeModeSchema = z.enum(['merge', 'replace']).default('merge');

/**
 * Zod schema for setting product steering.
 */
const SetProductSteeringSchema = z.object({
  merge: MergeModeSchema.optional(),
  appOneLiner: z.string().optional(),
  targetUsers: z.string().optional(),
  userJourneys: z.array(z.string()).optional(),
  mvpFeatures: z.array(z.string()).optional(),
  nonGoals: z.array(z.string()).optional(),
  successMetrics: z.array(z.string()).optional(),
  glossary: z
    .array(
      z.object({
        term: z.string(),
        definition: z.string(),
      })
    )
    .optional(),
});

/**
 * Zod schema for setting tech steering.
 */
const SetTechSteeringSchema = z.object({
  merge: MergeModeSchema.optional(),
  frontend: z.string().optional(),
  backend: z.string().optional(),
  auth: z.string().optional(),
  data: z.string().optional(),
  iac: z.string().optional(),
  observability: z.string().optional(),
  style: z.string().optional(),
  constraints: z.array(z.string()).optional(),
});

/**
 * Zod schema for setting structure steering.
 */
const SetStructureSteeringSchema = z.object({
  merge: MergeModeSchema.optional(),
  repoLayout: z.array(z.string()).optional(),
  namingConventions: z.array(z.string()).optional(),
  importConventions: z.array(z.string()).optional(),
  architecturePatterns: z.array(z.string()).optional(),
  testingApproach: z.array(z.string()).optional(),
});

/**
 * Zod schema for adding an open question.
 */
const AddOpenQuestionSchema = z.object({
  question: z.string(),
  whyItMatters: z.string().optional(),
});

/**
 * Zod schema for resolving an open question.
 */
const ResolveOpenQuestionSchema = z.object({
  id: z.string(),
  resolution: z.string(),
});

/**
 * JSON schema for product steering (used by the model).
 */
const productJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    merge: { type: 'string', enum: ['merge', 'replace'] },
    appOneLiner: { type: 'string' },
    targetUsers: { type: 'string' },
    userJourneys: { type: 'array', items: { type: 'string' } },
    mvpFeatures: { type: 'array', items: { type: 'string' } },
    nonGoals: { type: 'array', items: { type: 'string' } },
    successMetrics: { type: 'array', items: { type: 'string' } },
    glossary: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          term: { type: 'string' },
          definition: { type: 'string' },
        },
        required: ['term', 'definition'],
      },
    },
  },
};

/**
 * JSON schema for tech steering (used by the model).
 */
const techJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    merge: { type: 'string', enum: ['merge', 'replace'] },
    frontend: { type: 'string' },
    backend: { type: 'string' },
    auth: { type: 'string' },
    data: { type: 'string' },
    iac: { type: 'string' },
    observability: { type: 'string' },
    style: { type: 'string' },
    constraints: { type: 'array', items: { type: 'string' } },
  },
};

/**
 * JSON schema for structure steering (used by the model).
 */
const structureJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    merge: { type: 'string', enum: ['merge', 'replace'] },
    repoLayout: { type: 'array', items: { type: 'string' } },
    namingConventions: { type: 'array', items: { type: 'string' } },
    importConventions: { type: 'array', items: { type: 'string' } },
    architecturePatterns: { type: 'array', items: { type: 'string' } },
    testingApproach: { type: 'array', items: { type: 'string' } },
  },
};

/**
 * JSON schema for adding an open question (used by the model).
 */
const addQuestionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['question'],
  properties: {
    question: { type: 'string' },
    whyItMatters: { type: 'string' },
  },
};

/**
 * JSON schema for resolving an open question (used by the model).
 */
const resolveQuestionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'resolution'],
  properties: {
    id: { type: 'string' },
    resolution: { type: 'string' },
  },
};

/**
 * Empty JSON schema for tools with no parameters.
 */
const emptyJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {},
};

/**
 * Tool specification interface.
 */
interface ToolSpec {
  name: string;
  description: string;
  inputSchema: { json: string };
}

/**
 * Tool configuration interface.
 */
interface ToolConfigResult {
  tools: Array<{ toolSpec: ToolSpec }>;
}

/**
 * Creates the tool configuration for the Nova Sonic model.
 * @returns Tool configuration with all available steering tools
 */
export function toolConfiguration(): ToolConfigResult {
  const stringify = (schema: object): string => JSON.stringify(schema);

  // Detailed tool descriptions that guide the model to produce agents.md-quality content
  const productDescription = `Update product steering (product.md). These files are consumed by AI coding agents (Kiro, Cline, Cursor) to build the application.

Write in terse bullet-point format optimized for AI comprehension:

- appOneLiner: One sentence - what it does and for whom
- targetUsers: Bullet list of user types with their goals
- userJourneys: Numbered steps with screen/action/outcome (e.g., "1. User lands on /login → enters credentials → redirected to /dashboard")
- mvpFeatures: Bullet list with acceptance criteria inline
- nonGoals: What we are NOT building and why (helps prevent scope creep)
- successMetrics: Specific KPIs with targets (e.g., "DAU > 1000 within 30 days")
- glossary: Term = definition format`;

  const techDescription = `Update tech steering (tech.md). These files are consumed by AI coding agents (Kiro, Cline, Cursor) to build the application.

Write in terse bullet-point format. For each field include:
- Exact versions (e.g., "Next.js 14.2" not "Next.js")
- Key conventions to follow
- What NOT to do (anti-patterns)
- Relevant CLI commands where applicable

Example format for backend:
"Node.js 20 LTS with Express 5.2, TypeScript, ESM modules.
- Use Express 5's native promise support for route handlers
- Organize: routes/, controllers/, services/, lib/, middleware/
- Entry point: src/app.ts
- Do NOT: fetch directly in controllers (use service layer), add dependencies without approval
- Commands: npm run tsc --noEmit path/to/file.tsx"

For style field: Include color palette values, spacing scale, component patterns, and accessibility requirements with specific values.

For constraints: Include what cannot be changed, performance requirements, security rules.`;

  const structureDescription = `Update structure steering (structure.md). These files are consumed by AI coding agents (Kiro, Cline, Cursor) to build the application.

Write in terse bullet-point format:

- repoLayout: Directory tree with key files and their purposes
  Example: "src/app/App.tsx - main routes", "src/lib/theme/tokens.ts - design tokens"
  
- namingConventions: Rules with actual examples
  Example: "Components: PascalCase (UserProfile.tsx), utils: camelCase (formatDate.ts), constants: SCREAMING_SNAKE_CASE"
  
- importConventions: Order, aliases, what to avoid
  Example: "1. React/Next imports, 2. External packages, 3. Internal @/ aliases, 4. Relative imports"
  
- architecturePatterns: Include good files to copy and legacy files to avoid
  Example: "For forms, copy app/components/Form.tsx. Avoid class components like Admin.tsx (legacy)"
  
- testingApproach: File locations, commands, patterns
  Example: "Tests: *.test.tsx colocated. Run: npm run vitest run path/to/file.test.tsx"`;

  return {
    tools: [
      {
        toolSpec: {
          name: 'set_product_steering',
          description: productDescription,
          inputSchema: { json: stringify(productJsonSchema) },
        },
      },
      {
        toolSpec: {
          name: 'set_tech_steering',
          description: techDescription,
          inputSchema: { json: stringify(techJsonSchema) },
        },
      },
      {
        toolSpec: {
          name: 'set_structure_steering',
          description: structureDescription,
          inputSchema: { json: stringify(structureJsonSchema) },
        },
      },
      {
        toolSpec: {
          name: 'add_open_question',
          description: 'Log an open question that needs resolution before implementation can proceed. Include context about why the decision matters and what options are being considered.',
          inputSchema: { json: stringify(addQuestionJsonSchema) },
        },
      },
      {
        toolSpec: {
          name: 'resolve_open_question',
          description: 'Resolve an open question by id with a detailed resolution that explains the decision, rationale, and any implications for the implementation.',
          inputSchema: { json: stringify(resolveQuestionJsonSchema) },
        },
      },
      {
        toolSpec: {
          name: 'get_steering_summary',
          description: 'Get a compact summary of what steering items are missing and what open questions remain unresolved.',
          inputSchema: { json: stringify(emptyJsonSchema) },
        },
      },
      {
        toolSpec: {
          name: 'checkpoint_steering_files',
          description: 'Write product.md, tech.md, structure.md to disk now. Use this to persist all steering content.',
          inputSchema: { json: stringify(emptyJsonSchema) },
        },
      },
    ],
  };
}

/**
 * Tool use content from the model.
 */
interface ToolUseContent {
  content?: string;
  [key: string]: unknown;
}

/**
 * Parses tool arguments from the model's tool use content.
 * @param content - Raw content from tool use event
 * @returns Parsed arguments object
 */
function parseArgs(content: ToolUseContent | unknown): Record<string, unknown> {
  if (content && typeof content === 'object') {
    const c = content as ToolUseContent;
    if (typeof c.content === 'string') {
      try {
        return JSON.parse(c.content) as Record<string, unknown>;
      } catch {
        // Ignore parse errors
      }
    }
    return c as Record<string, unknown>;
  }
  return {};
}

/**
 * Generic tool result with optional extra data.
 */
type ToolRunResult = {
  ok: boolean;
  error?: string;
} & Record<string, unknown>;

/**
 * Executes a steering tool.
 * @param store - The steering store instance
 * @param toolName - Name of the tool to execute
 * @param toolUseContent - Content from the tool use event
 * @returns Tool execution result
 * @throws Error if tool is not supported
 */
export function runTool(
  store: SteeringStore,
  toolName: string,
  toolUseContent: unknown
): ToolRunResult {
  const name = (toolName || '').trim();
  const args = parseArgs(toolUseContent);

  switch (name) {
    case 'set_product_steering': {
      const validated = SetProductSteeringSchema.parse(args);
      const mode: MergeMode = validated.merge ?? 'merge';
      const updatedFields = Object.keys(validated).filter(
        (k) => k !== 'merge' && validated[k as keyof typeof validated] !== undefined
      );
      store.setProduct(validated, mode);
      return { ok: true, updated: updatedFields };
    }

    case 'set_tech_steering': {
      const validated = SetTechSteeringSchema.parse(args);
      const mode: MergeMode = validated.merge ?? 'merge';
      const updatedFields = Object.keys(validated).filter(
        (k) => k !== 'merge' && validated[k as keyof typeof validated] !== undefined
      );
      store.setTech(validated, mode);
      return { ok: true, updated: updatedFields };
    }

    case 'set_structure_steering': {
      const validated = SetStructureSteeringSchema.parse(args);
      const mode: MergeMode = validated.merge ?? 'merge';
      const updatedFields = Object.keys(validated).filter(
        (k) => k !== 'merge' && validated[k as keyof typeof validated] !== undefined
      );
      store.setStructure(validated, mode);
      return { ok: true, updated: updatedFields };
    }

    case 'add_open_question': {
      const validated = AddOpenQuestionSchema.parse(args);
      const question = store.addOpenQuestion(validated);
      return { ok: true, question };
    }

    case 'resolve_open_question': {
      const validated = ResolveOpenQuestionSchema.parse(args);
      const question = store.resolveOpenQuestion(validated.id, validated.resolution);
      return { ok: true, question };
    }

    case 'get_steering_summary': {
      return { ok: true, summary: store.summary() };
    }

    case 'checkpoint_steering_files': {
      const updates = store.checkpoint();
      return { ok: true, updates };
    }

    default:
      throw new Error(`Unsupported tool: ${name}`);
  }
}
