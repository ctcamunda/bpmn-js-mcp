# bpmn-js-mcp

MCP server that lets AI assistants create and manipulate BPMN 2.0 workflow diagrams. Uses [bpmn-js](https://bpmn.io/toolkit/bpmn-js/) headlessly via jsdom to produce valid BPMN XML and SVG output targeting [Camunda 8](https://docs.camunda.io/) executable BPMN with Zeebe extensions.

![BPMN Diagram Example](./docs/images/bpmn.png)

> [!WARNING]
> This fork is primarily developed with the assistance of AI coding agents.

## Setup

### `./vscode/mcp.json`

```json
{
  "servers": {
    "bpmn": {
      "type": "stdio",
      "command": "npx",
      "args": ["git+https://github.com/datakurre/bpmn-js-mcp"]
    }
  }
}
```

### Persistence

By default, all diagrams are held **in-memory only** and are lost when the MCP server process restarts. To survive restarts, pass `--persist-dir` with a directory path:

```json
{
  "servers": {
    "bpmn": {
      "type": "stdio",
      "command": "npx",
      "args": ["git+https://github.com/datakurre/bpmn-js-mcp", "--persist-dir", "./diagrams"]
    }
  }
}
```

With persistence enabled:

- Each diagram is saved as `<diagramId>.bpmn` (plus a `<diagramId>.meta.json` sidecar) in the specified directory whenever it is mutated.
- The directory is created automatically if it does not exist.
- All `.bpmn` files found in the directory are reloaded into memory on startup, restoring diagrams across restarts.
- Up to `BPMN_MCP_MAX_DIAGRAMS` diagrams (default: 100) are held in memory at once; when the limit is reached, the oldest diagram is evicted (FIFO). Set the environment variable to override.

You can also combine `--persist-dir` with `--hint-level` to reduce response verbosity:

```json
"args": ["git+https://github.com/datakurre/bpmn-js-mcp", "--persist-dir", "./diagrams", "--hint-level", "minimal"]
```

`--hint-level` values: `full` (default — includes lint errors, layout hints, connectivity warnings), `minimal` (lint errors only), `none` (no implicit feedback).

## AI Agent Instructions

> **When working with `.bpmn` files, always use the BPMN MCP tools instead of editing BPMN XML directly.** The MCP tools ensure valid BPMN 2.0 structure, proper diagram layout coordinates, and semantic correctness that hand-editing XML cannot guarantee.

**To modify an existing `.bpmn` file**, use `import_bpmn_xml` to load it, make changes with the MCP tools, then `export_bpmn` and write the result back to the file.

**To create a new diagram**, use `create_bpmn_diagram`, build it with `add_bpmn_element` / `connect_bpmn_elements`, then `export_bpmn` to get the XML.

### When To Use `generate_bpmn_from_structure`

Use `generate_bpmn_from_structure` as the preferred first-pass authoring path when the user provides a reasonably complete process description, such as:

- the main steps in order
- the key decisions or branches
- lanes or participant structure
- obvious subprocess boundaries

This lets the agent create the initial BPMN skeleton in one call, then switch to the specialized property tools to make it executable.

Prefer low-level tool chains (`add_bpmn_element`, `connect_bpmn_elements`, `layout_bpmn_diagram`, and related tools) when the task is primarily:

- an incremental edit to an existing diagram
- a geometry-sensitive refinement or routing fix
- an advanced BPMN construct that still benefits from explicit manual modeling

For executable Camunda 8 models, the recommended workflow is:

1. Use `generate_bpmn_from_structure` for first-pass construction when the process description is already fairly complete.
2. Use the specialized executable-authoring tools to add Zeebe task definitions, assignments, forms, I/O mappings, event definitions, and loop behavior.
3. Use the low-level element and layout tools for cleanup, exceptions, and structure refinements.

### BPMN Modeling Best Practices

Follow these conventions when creating BPMN diagrams:

- **Model left-to-right** — avoid flows that go backwards (right-to-left).
- **Name every element** — use human-readable business language, not technical identifiers.
- **Naming conventions**:
  - Tasks: verb + object (`"Process Order"`, `"Send Invoice"`).
  - Events: object + state (`"Order Received"`, `"Payment Completed"`).
  - Exclusive/Inclusive gateways: yes/no question ending with `?` (`"Order valid?"`, `"Payment successful?"`). Label outgoing flows as answers.
  - Don't name parallel gateways, joining gateways, or event-based gateways unless it adds meaning.
- **Prefer explicit gateways** — don't use conditional flows directly out of tasks.
- **Show start and end events explicitly** — required for executable processes.
- **Avoid lanes by default** — use collaboration diagrams (separate pools + message flows) for role separation.
- **Avoid retry loops in BPMN** — use engine-level retry mechanisms instead (job retries, external task backoff).
- **Use receive tasks + boundary events for waiting** — for executable Camunda 8 models, prefer a receive task with boundary timers/messages over event-based gateway patterns when you need a stable wait state.
- **Model the happy path first**, then add exceptions incrementally with boundary events and event subprocesses.

See [docs/modeling-best-practices.md](docs/modeling-best-practices.md) for full guidance.

### Layout Workflow

For best results, follow this recommended workflow after structural changes:

1. **Build structure** — `add_bpmn_element` / `connect_bpmn_elements` to create the flow.
2. **Auto-layout** — `layout_bpmn_diagram` to arrange elements (use `scopeElementId` to scope to a pool/subprocess).
3. **Fine-tune** — `layout_bpmn_diagram` with `mode: "align"` or `mode: "distribute"` for alignment/distribution refinements.
4. **Fix labels** — `layout_bpmn_diagram` with `labelsOnly: true` to resolve label overlaps.

No separate "repair layout" tool is needed — chain these existing tools for fine-grained control.

## Available Tools

### Core BPMN Tools

| Tool                          | Description                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| `create_bpmn_diagram`         | Create a new diagram (use `cloneFrom` to duplicate an existing one)                      |
| `add_bpmn_element`            | Add elements (use `flowId` to insert, `fromElementId`+`toLaneId` for cross-lane handoff) |
| `add_bpmn_element_chain`      | Add a chain of elements connected in sequence                                            |
| `connect_bpmn_elements`       | Connect elements (use `connectionId`+`waypoints` for custom routing)                     |
| `delete_bpmn_element`         | Remove an element or connection                                                          |
| `move_bpmn_element`           | Move, resize, or reassign an element to a lane                                           |
| `export_bpmn`                 | Export as BPMN 2.0 XML or SVG (with implicit lint gate)                                  |
| `import_bpmn_xml`             | Import existing BPMN XML (auto-layout if no DI)                                          |
| `manage_bpmn_root_elements`   | Create or update shared Message and Signal definitions                                   |
| `generate_bpmn_from_structure`| Generate a complete BPMN diagram from a structured JSON description                      |
| `inspect_bpmn`                | Unified read-only inspection for diagrams, elements, validation, variables, and diffs    |

### Layout & Alignment Tools

| Tool                  | Description                                                  |
| --------------------- | ------------------------------------------------------------ |
| `layout_bpmn_diagram` | Auto-layout using rebuild engine (labelsOnly mode available) |
| `layout_bpmn_diagram` | Auto-layout, align, distribute, autosize, or labels-only cleanup                          |

### Camunda 8 / Zeebe Tools

The specialized tools are the primary executable-authoring surface. Use them when correctness and type-specific semantics matter. Treat `configure_bpmn_zeebe_extensions` as an optional batch shortcut for repeated Zeebe setup across multiple already-placed elements, not as a replacement for the specialized tools.

| Tool                               | Description                                         |
| ---------------------------------- | --------------------------------------------------- |
| `set_bpmn_element_properties`      | Set standard and Zeebe extension properties                                      |
| `set_bpmn_input_output_mapping`    | Configure Zeebe input/output mappings using FEEL                               |
| `set_bpmn_event_definition`        | Add error, timer, message, signal, escalation, and related event definitions   |
| `set_bpmn_form_data`               | Configure Camunda 8 user task forms (formId, formKey, or embedded JSON)        |
| `set_bpmn_camunda_listeners`       | Configure Zeebe execution/task listeners and service-task error definitions     |
| `set_bpmn_loop_characteristics`    | Configure loop and multi-instance markers                                       |
| `set_bpmn_call_activity_variables` | Set variable propagation and called-process settings on CallActivity elements   |
| `configure_bpmn_zeebe_extensions`  | Optional batch shortcut for repeated Zeebe task definitions, assignments, forms, headers, and I/O   |

### Collaboration Tools

| Tool                           | Description                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| `create_bpmn_participant`      | Create pools (use `wrapExisting` to wrap an existing process)                             |
| `create_bpmn_lanes`            | Create swimlanes (use `mergeFrom` to convert multi-pool to lanes)                         |
| `manage_bpmn_lanes`            | Assign, suggest, validate, compare pools vs lanes, or redistribute lane assignments       |

### Utility Tools

| Tool                          | Description                                                             |
| ----------------------------- | ----------------------------------------------------------------------- |
| `bpmn_history`                | Undo or redo changes (supports multiple steps)                          |
| `batch_bpmn_operations`       | Execute multiple operations in a single call                            |

### Automatic Lint Feedback

All mutating tools automatically append bpmnlint error-level issues to their response. This gives AI callers immediate feedback when an operation introduces a rule violation. Use `inspect_bpmn` with `mode: "validation"` for a full multi-severity validation report.

The default config extends `bpmnlint:recommended`, `plugin:camunda-compat/camunda-cloud-8-9`, and `plugin:bpmn-mcp/recommended`. Key tuning for AI-generated diagrams:

- `label-required` and `no-disconnected` → `warn` (diagrams are built incrementally)
- `no-overlapping-elements` → `off` (false positives in headless layout mode)
- `fake-join` → `info` (boundary-event retry patterns produce valid fake-joins)

The custom `plugin:bpmn-mcp/recommended` adds project-specific rules covering gateway logic, Zeebe task configuration, lane organization, collaboration patterns, subprocess validation, and layout quality. Override any rule with a `.bpmnlintrc` file in the project root.

### MCP Resources

Stable, addressable read-context endpoints for AI callers to re-ground context mid-conversation:

| URI                                 | Description                                                       |
| ----------------------------------- | ----------------------------------------------------------------- |
| `bpmn://diagrams`                   | List all in-memory diagrams                                       |
| `bpmn://diagram/{id}/summary`       | Lightweight diagram summary (element counts, names, connectivity) |
| `bpmn://diagram/{id}/lint`          | Validation issues with fix suggestions                            |
| `bpmn://diagram/{id}/variables`     | Process variable references with read/write access patterns       |
| `bpmn://diagram/{id}/xml`           | Current BPMN 2.0 XML for re-grounding                             |
| `bpmn://diagram/{id}/elements`      | Current element inventory with positions, connections, and properties |
| `bpmn://guides/executable-camunda8` | Constraints and best practices for executable Camunda 8 / Zeebe   |
| `bpmn://guides/modeling-elements`   | BPMN element selection, boundary-event, and subprocess guidance   |
| `bpmn://guides/element-properties`  | Supported BPMN and Zeebe property catalog                         |

### MCP Prompts

Three style-toggle prompts that set the modeling context for the agent session. Each instructs the agent on which BPMN structure to use and reminds it to `export_bpmn` the final result.

| Prompt            | Description                                                                  |
| ----------------- | ---------------------------------------------------------------------------- |
| `executable`      | Flat executable Camunda 8 / Zeebe process without a pool                     |
| `executable-pool` | Executable process wrapped in a participant pool, optionally with swim lanes |
| `collaboration`   | Non-executable multi-pool documentation diagram with message flows           |

## Output Compatibility

Generated BPMN 2.0 XML works with [Camunda Modeler](https://camunda.com/download/modeler/), [bpmn.io](https://bpmn.io/), and any BPMN 2.0 compliant tool.

## Development

```bash
npm run dev        # auto-reload server on code changes (runs watch + nodemon)
npm run watch      # rebuild on change
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run format     # format with Prettier
npm test           # vitest
```

### Auto-reload Setup

For development with VS Code's MCP integration, the server will automatically reload when you make code changes:

1. The `watch` script (esbuild --watch) rebuilds `dist/index.js` when source files change
2. The `dev` script (nodemon) watches `dist/index.js` and restarts the server on rebuild
3. `.vscode/mcp.json` is configured to use `npm run dev`
4. Nodemon is configured with `--quiet` and stdio passthrough to ensure MCP protocol compatibility

To develop with auto-reload:

- Start the `watch` script in one terminal: `npm run watch`
- The MCP server (configured in VS Code) will automatically restart via nodemon when the build completes
- Nodemon runs in quiet mode and passes stdin/stdout directly to the server process, maintaining MCP stdio compatibility

Or equivalently via `make`:

```bash
make format check test   # format, typecheck + lint, run tests
```

See [AGENTS.md](AGENTS.md) for architecture details and decision records.

## Contributing

### Getting Started

```bash
git clone https://github.com/datakurre/bpmn-js-mcp
cd bpmn-js-mcp
npm install
npm run build   # compile TypeScript → dist/ via esbuild
npm test        # run Vitest test suite (~1 300 tests)
npm run lint    # ESLint (sonarjs + unicorn + typescript-eslint)
npm run typecheck  # tsc --noEmit (type check only, no emit)
```

Node.js **≥ 18** is required.

### Project Layout

```
src/handlers/      tool handlers, one file per tool domain
src/rebuild/       topology-driven layout engine
src/bpmnlint-plugin-bpmn-mcp/  custom lint rules
src/eval/          layout quality scoring harness
test/              Vitest tests mirroring src/ structure
docs/              architecture, best practices, ADRs
agents/adrs/       Architecture Decision Records
```

### Adding a New MCP Tool

1. Create `src/handlers/<domain>/<name>.ts` — export both the handler function and a `TOOL_DEFINITION` constant.
2. Add one entry to `TOOL_REGISTRY` in `src/handlers/index.ts`.
3. Add a test in `test/handlers/<domain>/<name>.test.ts`.

The dispatch map and `TOOL_DEFINITIONS` array are auto-derived from `TOOL_REGISTRY`.

### Key Constraints

- **Never edit `.bpmn` files directly** — always use the MCP tools (`import_bpmn_xml` → edit → `export_bpmn`).
- **Never write BPMN XML via terminal heredocs** — line-wrapping can corrupt element names. Use `create_file` or MCP export.
- `src/rebuild/` and `src/bpmnlint-plugin-bpmn-mcp/` must not import from `src/handlers/` (enforced by ESLint).
- Mutating handlers must call `appendLintFeedback()` from `src/linter.ts` to surface error-level issues.

See [AGENTS.md](AGENTS.md) for full architecture details and decision records.

## License

MIT
