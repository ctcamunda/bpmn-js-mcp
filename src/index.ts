/**
 * bpmn-js-mcp server entry point.
 *
 * Thin shell that wires MCP SDK transport ↔ tool modules ↔ handlers.
 *
 * Tool modules are pluggable: each editor back-end (BPMN, DMN, Forms, …)
 * implements the ToolModule interface and registers its tools here.
 * Currently only the BPMN module is active.
 *
 * CLI usage:
 *   bpmn-js-mcp [options]
 *
 * Options:
 *   --persist-dir <dir>   Enable file-backed persistence in <dir>
 *   --help                Show usage information
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import { type ToolModule } from './module';
import { bpmnModule } from './bpmn-module';
import { enablePersistence, persistAllDiagrams } from './persistence';
import { setServerHintLevel } from './linter';
import type { HintLevel, ToolContext } from './types';
import { RESOURCE_TEMPLATES, listResources, readResource } from './resources';
import { listPrompts, getPrompt } from './prompts';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { version: PKG_VERSION } = require('../package.json') as { version: string };

// ── CLI argument parsing ───────────────────────────────────────────────────

/**
 * Named tool groups for use with --enable-tools / --disable-tools.
 * Group names expand to the listed tool names.
 */
const TOOL_GROUPS: Record<string, string[]> = {
  batch: ['batch_bpmn_operations'],
  history: ['bpmn_history'],
  layout: ['layout_bpmn_diagram'],
  collaboration: [
    'create_bpmn_participant',
    'create_bpmn_lanes',
    'manage_bpmn_lanes',
    'manage_bpmn_root_elements',
  ],
  /** All Zeebe/Camunda property setters. */
  camunda: [
    'set_bpmn_input_output_mapping',
    'set_bpmn_event_definition',
    'set_bpmn_form_data',
    'set_bpmn_loop_characteristics',
    'set_bpmn_camunda_listeners',
    'set_bpmn_call_activity_variables',
  ],
  /** Higher-level analysis / read-only tools (safe to hide for simple use-cases). */
  analysis: ['inspect_bpmn', 'manage_bpmn_lanes'],
};

/** Expand a comma-separated list of tool names / group names to individual tool names. */
function expandToolList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((token) => TOOL_GROUPS[token] ?? [token]);
}

interface CliOptions {
  persistDir?: string;
  hintLevel?: HintLevel;
  /** Whitelist: only expose these tools (comma-separated names or group aliases). */
  enableTools?: string[];
  /** Blacklist: hide these tools (comma-separated names or group aliases). */
  disableTools?: string[];
}

function printUsage(): void {
  const groupList = Object.entries(TOOL_GROUPS)
    .map(([name, tools]) => `    ${name.padEnd(15)} ${tools.join(', ')}`)
    .join('\n');
  console.error(`Usage: bpmn-js-mcp [options]

Options:
  --persist-dir <dir>         Enable file-backed diagram persistence in <dir>.
                              Diagrams are saved as .bpmn files and restored on startup.
  --hint-level <level>        Set server-wide feedback verbosity. Values: full (default),
                              minimal (lint errors only), none (no implicit feedback).
  --enable-tools <list>       Whitelist: expose ONLY these tools (comma-separated).
                              Mutually exclusive with --disable-tools.
  --disable-tools <list>      Blacklist: hide these tools (comma-separated).
                              Mutually exclusive with --enable-tools.
  --help                      Show this help message and exit.

Tool group aliases (usable in --enable-tools / --disable-tools):
${groupList}

Examples:
  bpmn-js-mcp
  bpmn-js-mcp --persist-dir ./diagrams
  bpmn-js-mcp --hint-level minimal
  bpmn-js-mcp --disable-tools batch,history
  bpmn-js-mcp --enable-tools create_bpmn_diagram,add_bpmn_element,connect_bpmn_elements,export_bpmn

MCP configuration (.vscode/mcp.json):
  {
    "servers": {
      "bpmn": {
        "command": "npx",
        "args": ["bpmn-js-mcp", "--disable-tools", "batch,history", "--hint-level", "minimal"]
      }
    }
  }
`);
}

function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2); // skip node + script
  const options: CliOptions = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--persist-dir': {
        const dir = args[++i];
        if (!dir) {
          console.error('Error: --persist-dir requires a directory path');
          process.exit(1);
        }
        options.persistDir = dir;
        break;
      }
      case '--hint-level': {
        const level = args[++i];
        if (!level || !['none', 'minimal', 'full'].includes(level)) {
          console.error("Error: --hint-level requires a value: 'none', 'minimal', or 'full'");
          process.exit(1);
        }
        options.hintLevel = level as HintLevel;
        break;
      }
      case '--enable-tools': {
        const list = args[++i];
        if (!list) {
          console.error('Error: --enable-tools requires a comma-separated list of tool names');
          process.exit(1);
        }
        options.enableTools = expandToolList(list);
        break;
      }
      case '--disable-tools': {
        const list = args[++i];
        if (!list) {
          console.error('Error: --disable-tools requires a comma-separated list of tool names');
          process.exit(1);
        }
        options.disableTools = expandToolList(list);
        break;
      }
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      default:
        console.error(`Unknown option: ${args[i]}`);
        printUsage();
        process.exit(1);
    }
  }

  if (options.enableTools && options.disableTools) {
    console.error('Error: --enable-tools and --disable-tools are mutually exclusive');
    process.exit(1);
  }

  return options;
}

// ── Registered tool modules ────────────────────────────────────────────────
// Add new editor modules here (e.g. dmnModule, formModule) when available.
const modules: ToolModule[] = [bpmnModule];

/**
 * Active tool filter — set by main() from CLI options before the server
 * starts accepting connections.  null means all tools are allowed.
 */
let allowedTools: Set<string> | null = null;

const server = new Server(
  { name: 'bpmn-js-mcp', version: PKG_VERSION },
  { capabilities: { tools: {}, resources: {}, prompts: {} } }
);

// ── Tool handlers ──────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: modules
    .flatMap((m) => m.toolDefinitions)
    .filter((td) => allowedTools === null || allowedTools.has(td.name as string)),
}));

server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const { name, arguments: args } = request.params;

  if (allowedTools !== null && !allowedTools.has(name)) {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }

  // Build a ToolContext with progress notification capability when the
  // client supplied a progressToken in the request's _meta.
  const progressToken = request.params._meta?.progressToken;
  const context: ToolContext = {};
  if (progressToken !== undefined && extra?.sendNotification) {
    context.sendProgress = async (
      progress: number,
      total?: number,
      message?: string
    ): Promise<void> => {
      await extra.sendNotification({
        method: 'notifications/progress' as const,
        params: { progressToken, progress, total, message },
      });
    };
  }

  for (const mod of modules) {
    const result = mod.dispatch(name, args, context);
    if (result) return result;
  }

  throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
});

// ── Resource handlers ──────────────────────────────────────────────────────

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: listResources(),
}));

server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
  resourceTemplates: RESOURCE_TEMPLATES,
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  return readResource(uri);
});

// ── Prompt handlers ────────────────────────────────────────────────────────

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: listPrompts(),
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return getPrompt(name, args || {});
});

async function main() {
  const options = parseArgs(process.argv);

  // Set server-wide hint level if specified
  if (options.hintLevel) {
    setServerHintLevel(options.hintLevel);
    console.error(`Hint level set to: ${options.hintLevel}`);
  }

  // Compute tool allowlist from --enable-tools / --disable-tools
  if (options.enableTools) {
    allowedTools = new Set(options.enableTools);
    console.error(`Tool filter (whitelist): ${[...allowedTools].join(', ')}`);
  } else if (options.disableTools) {
    const allTools = modules.flatMap((m) => m.toolDefinitions).map((td) => td.name as string);
    const disabled = new Set(options.disableTools);
    allowedTools = new Set(allTools.filter((name) => !disabled.has(name)));
    console.error(`Tool filter (disabled): ${[...disabled].join(', ')}`);
  }

  // Enable file-backed persistence if requested
  if (options.persistDir) {
    const count = await enablePersistence(options.persistDir);
    console.error(`Persistence enabled in ${options.persistDir} (${count} diagram(s) loaded)`);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('bpmn-js-mcp server running on stdio');

  // ── Graceful shutdown ────────────────────────────────────────────────────
  // Flush pending persistence writes before the process exits so diagrams
  // are not lost when nodemon restarts (SIGTERM) or the user hits Ctrl-C.
  const shutdown = async (signal: string): Promise<void> => {
    console.error(`Received ${signal}, flushing diagrams…`);
    try {
      const saved = await persistAllDiagrams();
      if (saved > 0) console.error(`Persisted ${saved} diagram(s).`);
    } catch (err) {
      console.error('Error during shutdown flush:', err);
    }
    process.exit(0);
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
