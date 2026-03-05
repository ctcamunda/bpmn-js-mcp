/**
 * Prompt definitions for MCP prompts.
 *
 * Three modeling-style prompts that toggle how the agent builds diagrams.
 * Each prompt instructs the agent on proper MCP tool usage and reminds
 * it to export the final diagram using export_bpmn with a filePath.
 */

/** Reusable interface for prompt definitions. */
export interface PromptDefinition {
  name: string;
  title: string;
  description: string;
  arguments?: Array<{
    name: string;
    description: string;
    required?: boolean;
  }>;
  getMessages: (
    args: Record<string, string>
  ) => Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } }>;
}

// ── Additional prompts ─────────────────────────────────────────────────────

/** Additional prompts defined in this module. */
export const ADDITIONAL_PROMPTS: PromptDefinition[] = [];
