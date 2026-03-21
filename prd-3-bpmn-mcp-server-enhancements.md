# PRD-3: BPMN MCP Server Enhancements — Camunda 8.9+ Migration

| Field | Value |
|-------|-------|
| **Technology** | TypeScript/Node.js (bpmn-js-mcp project at `~/bpmn-js-mcp/`) |
| **Target Platform** | **Camunda 8.9+** (Zeebe engine, FEEL expressions, job workers) |
| **Depends on** | PRD-2 (defines what the agentic BPMN generation process needs) |
| **Depended on by** | PRD-2 Phase 4 (BPMN generation) |

---

## 1. Overview

The BPMN MCP server (`bpmn-js-mcp`) provides tools for creating and manipulating BPMN diagrams via the Model Context Protocol. It currently supports ~30 tools for element creation, connection, layout, property configuration, and export.

**This PRD defines five enhancements** needed to support the agentic BPMN generation use case in the requirements gathering pipeline (PRD-2 Phase 4). The most significant change is **migrating the entire server from Camunda 7 to Camunda 8.9+** — replacing `camunda-bpmn-moddle` with `zeebe-bpmn-moddle`, rewriting all property handlers to use `zeebe:*` extensions, and updating lint rules, prompts, and documentation.

### Current Tool Inventory (Existing)

**Structural:** `create_bpmn_diagram`, `add_bpmn_element`, `add_bpmn_element_chain`, `connect_bpmn_elements`, `delete_bpmn_element`, `move_bpmn_element`, `list_bpmn_elements`, `get_bpmn_element_properties`, `import_bpmn_xml`, `export_bpmn`, `validate_bpmn_diagram`, `list_bpmn_diagrams`

**Properties:** `set_bpmn_element_properties`, `set_bpmn_input_output_mapping`, `set_bpmn_event_definition`, `set_bpmn_form_data`, `set_bpmn_camunda_listeners`, `set_bpmn_loop_characteristics`, `set_bpmn_call_activity_variables`

**Layout:** `layout_bpmn_diagram`

**Collaboration:** `create_bpmn_participant`, `create_bpmn_lanes`, `assign_bpmn_elements_to_lane`

### What's Missing / Needs to Change

| Gap | Impact | Enhancement |
|-----|--------|-------------|
| Server targets Camunda 7 (`camunda:*` extensions, `camunda-bpmn-moddle`) | Cannot produce deployable Camunda 8 BPMN | Enhancement 1: Camunda 8.9+ migration |
| No image export separate from XML export | Rails UI cannot display BPMN diagrams inline | Enhancement 2: Verify & document SVG export |
| Building a complete process requires 20-40 individual tool calls | AI Agent uses excessive tokens and may hit call limits | Enhancement 3: Structured process generation tool |
| Zeebe extensions require multiple `set_bpmn_element_properties` calls per element | Tedious, error-prone, token-heavy | Enhancement 4: Batch Zeebe extension configuration |
| MCP Client connector integration not documented | No guidance for deploying with Camunda runtime | Enhancement 5: Runtime integration (documentation only) |

---

## 2. Enhancement 1: Camunda 8.9+ Migration

### 2.1 Scope

Migrate the entire `bpmn-js-mcp` server from Camunda 7 (`camunda-bpmn-moddle`, `camunda:*` extensions) to **Camunda 8.9+** (`zeebe-bpmn-moddle`, `zeebe:*` extensions). This is a foundational change — all other enhancements build on it.

### 2.2 Camunda 7 vs 8: Key Differences

| Concept | Camunda 7 | Camunda 8 (Zeebe) |
|---------|-----------|-------------------|
| **Moddle extension** | `camunda-bpmn-moddle` | `zeebe-bpmn-moddle` |
| **Extension namespace** | `camunda:` | `zeebe:` |
| **Service task binding** | `camunda:class`, `camunda:delegateExpression`, `camunda:expression` | `zeebe:TaskDefinition` (type + retries) — job workers |
| **User task assignment** | `camunda:assignee`, `camunda:candidateGroups` | `zeebe:AssignmentDefinition` (assignee, candidateGroups, candidateUsers) |
| **Forms** | `camunda:formKey`, embedded `camunda:formData` | `zeebe:FormDefinition` (formId or formKey) + optional `zeebe:UserTaskForm` for embedded JSON |
| **I/O mappings** | `camunda:inputOutput` with `camunda:inputParameter`/`camunda:outputParameter` | `zeebe:IoMapping` with `zeebe:Input`/`zeebe:Output` (FEEL expressions) |
| **Listeners** | `camunda:executionListener`/`camunda:taskListener` with class/delegateExpression | `zeebe:ExecutionListeners`/`zeebe:TaskListeners` — job-worker-based (eventType, type, retries) |
| **Business rule tasks** | `camunda:decisionRef`, `camunda:resultVariable` | `zeebe:CalledDecision` (decisionId, resultVariable) |
| **Call activities** | `camunda:calledElement` with binding/version | `zeebe:CalledElement` (processId, propagateAllChildVariables, propagateAllParentVariables) |
| **Script tasks** | `camunda:scriptFormat` + inline script | FEEL-based script evaluation via `zeebe:Script` |
| **Expressions** | JUEL (`${...}`) or UEL | FEEL (`=...`) |
| **Conditions** | `conditionExpression` with JUEL | `conditionExpression` with FEEL |
| **Connectors** | `camunda:connectorId` | `zeebe:TaskDefinition` type (e.g. `io.camunda:http-json:1`) + `zeebe:Properties` |
| **Multi-instance** | `camunda:collection`, `camunda:elementVariable` | `zeebe:LoopCharacteristics` (inputCollection, inputElement, outputCollection, outputElement) |
| **Lint ruleset** | `plugin:camunda-compat/camunda-platform-7-24` | `plugin:camunda-compat/camunda-cloud-8-9` |

### 2.3 What Must Change

#### 2.3.1 Dependency Changes
- **Remove** `camunda-bpmn-moddle` from `package.json`
- **Add** `zeebe-bpmn-moddle` (^1.12.0)
- Update esbuild config if `zeebe-bpmn-moddle` needs different externalization treatment

#### 2.3.2 Moddle Registration
- `src/diagram-manager.ts`: Replace `camunda-bpmn-moddle` import with `zeebe-bpmn-moddle/resources/zeebe.json`
- All `BpmnModeler` instances use `{ zeebe: zeebeModdle }` instead of `{ camunda: camundaModdle }`

#### 2.3.3 Property Handlers (all `zeebe:*` extensions)
- **`set-properties.ts`**: Route `zeebe:*` properties to proper extension elements (`zeebe:TaskDefinition`, `zeebe:AssignmentDefinition`, etc.)
- **`set-input-output.ts`**: Create `zeebe:IoMapping` with `zeebe:Input`/`zeebe:Output` children using FEEL
- **`set-form-data.ts`**: Three modes — `formId` → `zeebe:FormDefinition`, `formKey` → `zeebe:FormDefinition`, `formJson` → `zeebe:UserTaskForm` + `zeebe:FormDefinition`
- **`set-camunda-listeners.ts`**: Job-worker-based listeners — `zeebe:ExecutionListeners`/`zeebe:TaskListeners` with eventType, type, retries
- **`set-call-activity-variables.ts`**: `zeebe:CalledElement` with processId, variable propagation flags
- **`set-script.ts`**: FEEL-based via `zeebe:Script`

#### 2.3.4 Lint Configuration
- `src/linter.ts`: Switch `DEFAULT_LINT_CONFIG` to extend `plugin:camunda-compat/camunda-cloud-8-9`
- Custom lint rules in `src/bpmnlint-plugin-bpmn-mcp/` updated for Zeebe patterns:
  - `service-task-missing-implementation` → check `zeebe:TaskDefinition`
  - `user-task-missing-assignee` → check `zeebe:AssignmentDefinition`
  - `call-activity-missing-called-element` → check `zeebe:CalledElement`
  - Remove `camunda-topic-without-external-type` (Camunda 7-only concept)

#### 2.3.5 Prompts & Documentation
- `src/prompts.ts`: All three prompts (executable, executable-pool, collaboration) rewritten for Camunda 8 — FEEL expressions, job workers, `zeebe:*` properties
- `src/resource-guides.ts`: "Executable BPMN" guide rewritten for Camunda 8 deployment model
- `src/handlers/helpers.ts`: `TYPE_HINTS` updated to reference Zeebe properties

#### 2.3.6 Tests
- All existing property tests updated to use `zeebe:*` patterns
- No Camunda 7 (`camunda:*`) assertions should remain

#### 2.3.7 Documentation (non-code)
- `AGENTS.md`: Update references to `camunda-bpmn-moddle` → `zeebe-bpmn-moddle`
- `docs/architecture.md`: Update moddle setup description

### 2.4 Implementation Progress

A previous implementation attempt made **substantial progress** on this enhancement. The following is the status as of the aborted attempt:

| Area | Status | Notes |
|------|--------|-------|
| `package.json` dependency swap | ✅ Done | `zeebe-bpmn-moddle@^1.12.0` added, `camunda-bpmn-moddle` removed |
| `diagram-manager.ts` moddle registration | ✅ Done | Uses `zeebe-bpmn-moddle/resources/zeebe.json` |
| `set-properties.ts` | ✅ Done | Routes `zeebe:*` properties to proper extension elements |
| `set-input-output.ts` | ✅ Done | Creates `zeebe:IoMapping` with FEEL |
| `set-form-data.ts` | ✅ Done | Three Zeebe form modes (formId, formKey, formJson) |
| `set-camunda-listeners.ts` | ✅ Done | Job-worker-based `zeebe:ExecutionListeners`/`zeebe:TaskListeners` |
| `set-call-activity-variables.ts` | ✅ Done | `zeebe:CalledElement` |
| `set-script.ts` | ✅ Done | FEEL-based `zeebe:Script` |
| `linter.ts` config | ✅ Done | Extends `camunda-cloud-8-9` |
| Custom lint rules | ✅ Done | All rules updated for Zeebe; `camunda-topic-without-external-type` deleted |
| `prompts.ts` | ✅ Done | All three prompts rewritten for Camunda 8 |
| `resource-guides.ts` | ✅ Done | Executable guide rewritten for Zeebe |
| `helpers.ts` TYPE_HINTS | ✅ Done | Updated for Zeebe properties |
| Existing property tests | ✅ Done | All 8 test files migrated to `zeebe:*` assertions |
| `AGENTS.md` updates | ❌ Not done | Still references `camunda-bpmn-moddle` |
| `docs/architecture.md` updates | ❌ Not done | Still references old moddle setup |
| Build verification | ❌ Not done | Build was not verified before abort |
| Full test suite pass | ❌ Not done | Tests were not run to completion |

### 2.5 Acceptance Criteria

- [ ] `camunda-bpmn-moddle` fully removed from dependencies and all source
- [ ] `zeebe-bpmn-moddle` registered as the sole moddle extension
- [ ] All property handlers produce `zeebe:*` extension elements
- [ ] `bpmnlint` config extends `camunda-cloud-8-9`
- [ ] All custom lint rules validate Zeebe patterns (no Camunda 7 rules)
- [ ] Prompts and resource guides describe Camunda 8 exclusively
- [ ] All existing tests pass with `zeebe:*` assertions
- [ ] No references to `camunda:*` extensions remain in source (except tool group alias naming, which is a convention unrelated to the engine)
- [ ] `npm run build` succeeds
- [ ] `npm test` passes
- [ ] `AGENTS.md` and `docs/architecture.md` updated

---

## 3. Enhancement 2: Verify & Document Image Export

### 3.1 Current State

The `export_bpmn` tool already supports `format: "svg"` and `format: "both"` (XML + SVG in one call). This appears to already meet the image export need.

### 3.2 Verification Needed

- [ ] Confirm that `export_bpmn` with `format: "svg"` returns a complete, self-contained SVG that can be embedded in an HTML `<img>` tag or rendered inline
- [ ] Confirm the SVG includes all element labels, connection labels, and boundary events
- [ ] Determine the SVG string size for a typical 20-30 element process (estimate for variable sizing in PRD-2)
- [ ] Confirm `format: "both"` returns both XML and SVG in a single response
- [ ] Test that the SVG renders correctly when stored as a text blob and served via Active Storage in Rails

### 3.3 If SVG Export is Insufficient

If the current SVG export misses elements, truncates labels, or produces excessively large output:

**Alternative: PNG export via headless rendering.** Add a `format: "png"` option to `export_bpmn` that uses a headless browser (Puppeteer or similar) to render the diagram as a rasterized PNG. This produces smaller files and more predictable rendering but adds a dependency.

### 3.4 Acceptance Criteria

- [ ] `export_bpmn` with `format: "svg"` returns a valid SVG string
- [ ] SVG is renderable in a browser `<img>` tag with no JavaScript required
- [ ] SVG includes all visual elements (labels, markers, pools, lanes)
- [ ] `export_bpmn` with `format: "both"` returns both XML and SVG

**Estimated effort:** Verification only — no code changes expected unless SVG rendering has issues.

---

## 4. Enhancement 3: Structured Process Generation

### 4.1 Problem

Building a BPMN process from scratch requires many sequential tool calls:

```
create_bpmn_diagram              →  1 call
add_bpmn_element (start event)   →  1 call
add_bpmn_element_chain (tasks)   →  1 call (but limited to linear chains)
add_bpmn_element (gateway)       →  per branch point
connect_bpmn_elements            →  per connection
set_bpmn_element_properties      →  per element with non-default props
layout_bpmn_diagram              →  1 call
```

A typical 20-element process with 3 decision points requires **25-40 tool calls**. With the AI Agent connector's `maxModelCalls` limit (set to 30 in PRD-2), this is tight and leaves no room for iteration or error recovery.

### 4.2 Solution: `generate_bpmn_from_structure` Tool

A new MCP tool that accepts a structured JSON description of a process and creates the full BPMN diagram — with Camunda 8.9+-compatible structure — in a single call.

### 4.3 Input Schema

```typescript
interface ProcessStructure {
  /** Process name */
  name: string;
  
  /** The ordered list of process elements */
  elements: ProcessElement[];
  
  /** Connections between elements (for non-sequential flows) */
  connections?: Connection[];
  
  /** Optional: participant pools for collaboration diagrams */
  participants?: Participant[];
  
  /** Optional: lanes within the main pool */
  lanes?: Lane[];
  
  /** Whether to auto-layout after creation. Default: true */
  autoLayout?: boolean;
}

interface ProcessElement {
  /** Unique ID for referencing in connections. Auto-generated if omitted. */
  id?: string;
  
  /** BPMN element type */
  type: 'startEvent' | 'endEvent' | 'userTask' | 'serviceTask' | 'scriptTask' 
      | 'businessRuleTask' | 'sendTask' | 'receiveTask' | 'callActivity'
      | 'exclusiveGateway' | 'parallelGateway' | 'inclusiveGateway'
      | 'intermediateCatchEvent' | 'intermediateThrowEvent'
      | 'boundaryEvent' | 'subProcess' | 'eventSubProcess';
  
  /** Element name/label */
  name?: string;
  
  /** Documentation text */
  documentation?: string;
  
  /** For sequential flow: ID of the element this connects FROM. 
      If omitted, connects from the previous element in the array. */
  after?: string;
  
  /** For boundary events: the host element ID */
  attachedTo?: string;
  
  /** For boundary events: interrupting (true) or non-interrupting (false) */
  cancelActivity?: boolean;
  
  /** Event definition (for events) */
  eventDefinition?: {
    type: 'error' | 'timer' | 'message' | 'signal' | 'conditional' | 'terminate';
    properties?: Record<string, string>;  // e.g., { timeDuration: "PT1H" }
    errorRef?: { id: string; name?: string; errorCode?: string };
    messageRef?: { id: string; name?: string };
  };
  
  /** Lane assignment */
  lane?: string;
  
  /** Sub-process children (for expanded sub-processes) */
  children?: ProcessElement[];
}

interface Connection {
  /** Source element ID */
  from: string;
  
  /** Target element ID */
  to: string;
  
  /** Optional label */
  label?: string;
  
  /** Condition expression (for gateway outgoing flows) */
  condition?: string;
  
  /** Is this the default flow from a gateway? */
  isDefault?: boolean;
}

interface Participant {
  name: string;
  id?: string;
  collapsed?: boolean;
  lanes?: Lane[];
}

interface Lane {
  name: string;
  id?: string;
}
```

### 4.4 Example Input

```json
{
  "name": "Invoice Approval Process",
  "lanes": [
    { "name": "AP Clerk", "id": "lane_clerk" },
    { "name": "Manager", "id": "lane_manager" },
    { "name": "System", "id": "lane_system" }
  ],
  "elements": [
    { "id": "start", "type": "startEvent", "name": "Invoice received", "lane": "lane_clerk" },
    { "id": "enter", "type": "userTask", "name": "Enter invoice details", "lane": "lane_clerk" },
    { "id": "validate", "type": "serviceTask", "name": "Validate invoice data", "lane": "lane_system" },
    { "id": "gw_valid", "type": "exclusiveGateway", "name": "Data valid?", "lane": "lane_system" },
    { "id": "fix", "type": "userTask", "name": "Fix validation errors", "lane": "lane_clerk", "after": "gw_valid" },
    { "id": "gw_amount", "type": "exclusiveGateway", "name": "Amount > $5000?", "after": "gw_valid", "lane": "lane_system" },
    { "id": "approve", "type": "userTask", "name": "Approve invoice", "lane": "lane_manager", "after": "gw_amount" },
    { "id": "auto_approve", "type": "serviceTask", "name": "Auto-approve invoice", "lane": "lane_system", "after": "gw_amount" },
    { "id": "gw_merge", "type": "exclusiveGateway", "lane": "lane_system" },
    { "id": "post", "type": "serviceTask", "name": "Post to ERP", "lane": "lane_system" },
    { "id": "end", "type": "endEvent", "name": "Invoice processed", "lane": "lane_system" },
    { "id": "timer_sla", "type": "boundaryEvent", "name": "2-day SLA", "attachedTo": "approve", "cancelActivity": false,
      "eventDefinition": { "type": "timer", "properties": { "timeDuration": "PT48H" } } },
    { "id": "notify_sla", "type": "serviceTask", "name": "Send SLA reminder", "lane": "lane_system", "after": "timer_sla" },
    { "id": "end_reminder", "type": "endEvent", "name": "Reminder sent", "after": "notify_sla", "lane": "lane_system" }
  ],
  "connections": [
    { "from": "gw_valid", "to": "fix", "label": "No", "condition": "=valid = false" },
    { "from": "fix", "to": "validate" },
    { "from": "gw_valid", "to": "gw_amount", "label": "Yes", "isDefault": true },
    { "from": "gw_amount", "to": "approve", "label": "Yes", "condition": "=amount > 5000" },
    { "from": "gw_amount", "to": "auto_approve", "label": "No", "isDefault": true },
    { "from": "approve", "to": "gw_merge" },
    { "from": "auto_approve", "to": "gw_merge" }
  ]
}
```

### 5.5 Output Schema

```typescript
interface GenerationResult {
  /** The diagram ID for further operations */
  diagramId: string;
  
  /** Map of input element IDs to actual BPMN element IDs */
  elementIdMap: Record<string, string>;
  
  /** Summary statistics */
  summary: {
    elementsCreated: number;
    connectionsCreated: number;
    lanesCreated: number;
    validationErrors: ValidationIssue[];
  };
  
  /** SVG preview (if includeImage is enabled on the diagram) */
  svg?: string;
}
```

### 5.6 Implementation Approach

The `generate_bpmn_from_structure` tool should be implemented as a high-level orchestrator that internally calls the existing low-level tools:

1. `create_bpmn_diagram` with the process name
2. `create_bpmn_participant` + `create_bpmn_lanes` if lanes/participants are specified
3. Topological sort of elements based on `after` dependencies
4. `add_bpmn_element_chain` for linear sequences
5. `add_bpmn_element` for branch elements (gateways, boundary events)
6. `connect_bpmn_elements` for non-sequential connections
7. `set_bpmn_event_definition` for events with definitions
8. `assign_bpmn_elements_to_lane` for lane assignments
9. `layout_bpmn_diagram` for final layout

**Key design decision:** Implement this as a single MCP tool call that orchestrates internal operations, NOT as multiple tool calls. The caller sees one tool → one result. Internally, the server reuses its own logic.

### 5.7 Acceptance Criteria

- [ ] `generate_bpmn_from_structure` tool is available in the MCP server
- [ ] Creates a complete diagram from the input JSON in a single tool call
- [ ] Supports: start/end events, user tasks, service tasks, exclusive/parallel gateways, boundary events, sub-processes
- [ ] Supports lanes and participants
- [ ] Auto-connects sequential elements (elements without explicit `after` connect to the previous element)
- [ ] Applies explicit connections with conditions and default flows
- [ ] Auto-layouts the result
- [ ] Returns element ID mapping so the caller can reference elements for further configuration
- [ ] Returns validation results
- [ ] The 20-element invoice approval example (§3.4) produces a valid, well-laid-out diagram
- [ ] On partial failure (some elements created, later step fails): returns the partial diagram with a clear error message explaining what succeeded and what failed
- [ ] Backward compatible: no changes to existing tools

**Estimated complexity:** Medium-high. This is a new tool that orchestrates existing internals. The topological sort and connection routing logic is the most complex part.

### 4.8 Implementation Progress

A previous implementation attempt created `src/handlers/core/generate-from-structure.ts`:

| Area | Status | Notes |
|------|--------|-------|
| Handler implementation | ✅ Done | 7-phase orchestrator: create → participants/lanes → topo sort → elements → connections → lane assignment → layout |
| Tool definition (schema) | ✅ Done | Full JSON schema with all element types, connections, participants, lanes |
| Element ID remapping | ✅ Done | Maps input IDs → actual BPMN IDs |
| Error/warning collection | ✅ Done | Per-step errors, partial failure reporting |
| Event definitions | ✅ Done | Timer, error, message, signal, escalation, conditional |
| Boundary events | ✅ Done | attachedTo + cancelActivity |
| Sub-process children | ⚠️ Partial | Children created but internal connections and nested layout not fully handled |
| Tests | ❌ Not done | No test file created |
| Build verification | ❌ Not done | Runtime not verified |

**Known issues from code review:**
1. Sub-process children: created but no internal connections established or recursive layout applied
2. Cycle detection in topological sort silently absorbs cycles without warning
3. Boundary event sequential connection deduction may be fragile in edge cases
4. Single-lane case warns but proceeds without lane assignment

---

## 5. Enhancement 4: Batch Zeebe Extension Configuration

### 5.1 Problem

After generating the BPMN structure, each service task needs Zeebe extensions configured (task definition, I/O mappings, headers). Currently, this requires:

- `set_bpmn_element_properties` to set the task type (via Zeebe-specific properties)
- `set_bpmn_input_output_mapping` for I/O mappings
- Multiple calls per element

For a process with 10 service tasks, this is 20-30 additional tool calls.

### 5.2 Solution: `configure_bpmn_zeebe_extensions` Tool

A batch tool that applies Zeebe-specific configuration to multiple elements in a single call.

### 5.3 Input Schema

```typescript
interface ZeebeBatchConfig {
  diagramId: string;
  
  /** Map of element IDs to their Zeebe configuration */
  elements: Record<string, ZeebeElementConfig>;
}

interface ZeebeElementConfig {
  /** Task definition type (e.g., "io.camunda:http-json:1") */
  taskDefinition?: {
    type: string;
    retries?: number;  // default: 3
  };
  
  /** I/O mappings */
  ioMapping?: {
    inputs?: Array<{
      source: string;   // FEEL expression or value
      target: string;   // Target variable name
    }>;
    outputs?: Array<{
      source: string;
      target: string;
    }>;
  };
  
  /** Task headers (for connectors: resultVariable, resultExpression, etc.) */
  taskHeaders?: Record<string, string>;
  
  /** Form definition (for user tasks) */
  formDefinition?: {
    formId: string;     // References a deployed .form file
  };
  
  /** User task marker (required for native Camunda user tasks) */
  userTask?: boolean;   // If true, adds <zeebe:userTask/>
  
  /** Called decision (for business rule tasks) */
  calledDecision?: {
    decisionId: string;
    resultVariable: string;
  };
  
  /** Assignee/candidate configuration (for user tasks) */
  assignment?: {
    assignee?: string;            // FEEL expression
    candidateGroups?: string;     // Comma-separated
    candidateUsers?: string;      // Comma-separated
  };
}
```

### 5.4 Example Input

```json
{
  "diagramId": "diagram_123",
  "elements": {
    "ServiceTask_ValidateInvoice": {
      "taskDefinition": { "type": "validate-invoice", "retries": 3 },
      "ioMapping": {
        "inputs": [
          { "source": "=invoice", "target": "invoiceData" }
        ],
        "outputs": [
          { "source": "=validationResult", "target": "isValid" }
        ]
      }
    },
    "ServiceTask_PostToERP": {
      "taskDefinition": { "type": "io.camunda:http-json:1", "retries": 1 },
      "ioMapping": {
        "inputs": [
          { "source": "noAuth", "target": "authentication.type" },
          { "source": "POST", "target": "method" },
          { "source": "=erpUrl + \"/api/invoices\"", "target": "url" },
          { "source": "=invoice", "target": "body" }
        ]
      },
      "taskHeaders": {
        "resultExpression": "={erpResponse: response.body}",
        "retryBackoff": "PT10S"
      }
    },
    "UserTask_ApproveInvoice": {
      "userTask": true,
      "formDefinition": { "formId": "invoice-approval-form" },
      "assignment": {
        "assignee": "=invoice.approverEmail"
      }
    }
  }
}
```

### 5.5 Output Schema

```typescript
interface ZeebeBatchResult {
  /** Number of elements configured */
  configured: number;
  
  /** Per-element results */
  results: Record<string, {
    success: boolean;
    error?: string;
    extensionsApplied: string[];  // e.g., ["taskDefinition", "ioMapping", "taskHeaders"]
  }>;
  
  /** Validation warnings (e.g., missing required inputs for a connector type) */
  warnings: string[];
}
```

### 5.6 Implementation Approach

Internally, for each element in the batch:

1. Set `zeebe:taskDefinition` via the existing property-setting mechanism
2. Set `zeebe:ioMapping` with `zeebe:input` and `zeebe:output` children
3. Set `zeebe:taskHeaders` with `zeebe:header` children
4. Set `zeebe:formDefinition` if specified
5. Set `zeebe:userTask` marker if specified
6. Set `zeebe:calledDecision` if specified
7. Set `zeebe:assignment` if specified

All operations happen within a single tool invocation. If one element fails, continue with the others and report the failure.

### 5.7 Acceptance Criteria

- [ ] `configure_bpmn_zeebe_extensions` tool is available in the MCP server
- [ ] Configures multiple elements in a single call
- [ ] Supports: task definitions, I/O mappings, task headers, form definitions, user task markers, called decisions, assignments
- [ ] Partial failure handling: one element's failure doesn't block others
- [ ] Configured elements produce valid Zeebe XML (deployable to Camunda 8.9+)
- [ ] Result includes per-element success/failure status
- [ ] Backward compatible: no changes to existing tools

**Estimated complexity:** Medium. This builds on existing property-setting internals but adds batch orchestration and Zeebe-specific XML structure generation.

### 5.8 Implementation Progress

A previous implementation attempt created `src/handlers/properties/configure-zeebe-extensions.ts`:

| Area | Status | Notes |
|------|--------|-------|
| Handler implementation | ✅ Done | Full handler with 8 specialized Zeebe element builders |
| Tool definition (schema) | ✅ Done | Comprehensive JSON schema in `TOOL_DEFINITION` |
| Per-element error handling | ✅ Done | Failures don't block other elements |
| Tool registration in index.ts | ✅ Done | Registered as `configure_bpmn_zeebe_extensions` in `TOOL_REGISTRY` |
| Tests | ❌ Not done | No test file created |
| Build verification | ❌ Not done | Runtime not verified |

**Known issue:** The handler calls `moddle.create('zeebe:*')` types. This works only if `zeebe-bpmn-moddle` is registered (covered by Enhancement 1). Verify at integration time.

---

## 6. Enhancement 5: Camunda Runtime Integration (Documentation Only)

### 6.1 Resolution

No transport changes to `bpmn-js-mcp` are required. Camunda's self-managed connector runtime natively supports stdio MCP servers via the **MCP Client connector** (currently early access / alpha). The connector runtime starts and manages the `bpmn-js-mcp` process as an OS subprocess.

### 6.2 Integration Architecture

The MCP Client connector acts as a **gateway tool definition** inside the AI Agent ad-hoc sub-process. Tool discovery is fully automatic — the AI Agent triggers `tools/list` on the MCP server via the MCP Client service task and receives all available tools dynamically. You do **not** need to declare individual BPMN MCP tools as separate BPMN activities.

Tool names as seen by the LLM are namespaced: `MCP_<activityId>___<toolName>` (e.g., `MCP_BpmnTools___create_bpmn_diagram`). Activity IDs must not contain `___`.

### 6.3 Connector Runtime Configuration

In the connector runtime's `application.yaml` (or an imported `mcp-clients.yml`), configure `bpmn-js-mcp` as a stdio client:

```yaml
camunda:
  connector:
    agenticai:
      mcp:
        client:
          enabled: true
          clients:
            bpmnTools:  # client ID — matches the MCP Client element template in BPMN
              type: stdio
              stdio:
                command: node
                args:
                  - "/path/to/bpmn-js-mcp/dist/index.js"
```

### 6.4 BPMN Modeling

In the AI Agent ad-hoc sub-process:
1. Add a single **service task** and apply the **MCP Client** element template (install from the Camunda marketplace for self-managed).
2. Set the **Client ID** to `bpmnTools` (matching the key in the YAML above).
3. The AI agent will auto-discover all tools exposed by `bpmn-js-mcp` at runtime.

### 6.5 Notes

- The MCP Client connector is in **early access (alpha)** as of Camunda 8.8, and may have stabilized by 8.9+. Pin your connector runtime version accordingly.
- No code changes to `bpmn-js-mcp` are needed. The existing stdio entry point (`node dist/index.js`) is used as-is.
- Tool filtering (include/exclude lists) can be configured on the MCP Client service task to restrict which tools the agent can call.

---

## 7. Implementation Order

```
Enhancement 1 (Camunda 8.9+ migration)  → Foundation; all other enhancements depend on this
Enhancement 2 (Verify SVG export)        → Quick check, no code expected
Enhancement 3 (Structured generation)    → Core value for reducing tool calls
Enhancement 4 (Zeebe batch config)       → Polishes the generation workflow
Enhancement 5 (Runtime integration)      → Documentation + connector runtime config, no code
```

**Critical path:** Enhancement 1 (migration) is the prerequisite — all Zeebe-dependent tools and tests require `zeebe-bpmn-moddle` to be wired. Enhancement 3 is required before PRD-2's Phase 4 can work efficiently. The Camunda runtime integration (Enhancement 5) needs connector runtime configuration but no code changes to this server.

**Priority for remaining work:** Enhancement 1 is ~90% code-complete (see §2.4) but needs build verification, full test pass, and doc updates. Enhancements 3 and 4 have handler code written but need tests and build verification. Enhancement 2 is verification-only. Enhancement 5 is documentation-only.

---

## 8. Testing Strategy

### 8.1 Enhancement 1: Camunda 8.9+ Migration

| Test | Description |
|------|-------------|
| Existing test suite | All ~8 modified property test files must pass with `zeebe:*` assertions |
| Service task Zeebe config | `set_bpmn_element_properties` with `zeebe:taskDefinition` → valid `zeebe:TaskDefinition` XML |
| User task Zeebe assignment | `set_bpmn_element_properties` with Zeebe assignment → valid `zeebe:AssignmentDefinition` XML |
| I/O mapping with FEEL | `set_bpmn_input_output_mapping` → valid `zeebe:IoMapping` with `zeebe:Input`/`zeebe:Output` |
| Form definition modes | `set_bpmn_form_data` with formId, formKey, formJson → correct `zeebe:FormDefinition` |
| Job-worker listeners | `set_bpmn_camunda_listeners` → `zeebe:ExecutionListeners`/`zeebe:TaskListeners` with type, retries |
| Lint validation | `validate_bpmn_diagram` runs `camunda-cloud-8-9` ruleset successfully |

### 8.2 Enhancement 3: `generate_bpmn_from_structure`

| Test | Description |
|------|-------------|
| Linear process | 5 sequential tasks → valid BPMN with 5 tasks and 4 sequence flows |
| Gateway branching | Exclusive gateway with 2 branches merging → correct connections and conditions |
| Parallel gateway | Parallel fork/join with 3 branches → all paths connect |
| Boundary events | Timer on user task → boundary event attached correctly |
| Sub-process | Expanded sub-process with inner tasks → children nested |
| Lanes | 3 lanes with elements distributed → lane assignments correct |
| Participants | 2-pool collaboration with message flows → cross-pool connections |
| Empty process | Only start + end → minimal valid BPMN |
| Invalid input | Missing required fields → clear error message |
| Large process | 50+ elements → completes within 5 seconds, correct layout |
| The invoice example | §4.4 input → valid, well-laid-out diagram matching the description |

### 8.3 Enhancement 4: `configure_bpmn_zeebe_extensions`

| Test | Description |
|------|-------------|
| Single service task | Task definition + I/O mapping + headers → valid Zeebe XML |
| User task with form | Form definition + user task marker + assignee → deploys to Camunda 8.9+ |
| Business rule task | Called decision → valid |
| Batch (10 elements) | Configure 10 elements in one call → all succeed |
| Partial failure | 1 invalid element ID in batch of 5 → 4 succeed, 1 reports error |
| REST connector | Full REST connector config (method, URL, body, auth, result) → matches expected XML |
| Overwrite existing | Configure same element twice → second call replaces first |

---

## 9. Risks & Open Questions

### Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| MCP Client connector is early access (alpha) | API surface may change between C8 minor releases | Pin connector runtime version; monitor Camunda release notes |
| `generate_bpmn_from_structure` with complex processes may produce poor layouts | Diagrams need manual cleanup | Leverage existing `layout_bpmn_diagram`; allow caller to disable auto-layout and layout manually |
| Partial failure in `generate_bpmn_from_structure` leaves diagram in incomplete state | Caller must interpret partial result | Return clear `partialResult` flag with per-step error details so caller can continue building or restart |
| `zeebe-bpmn-moddle` may not cover all Camunda 8.9+ extension elements | Missing properties at runtime | Pin `zeebe-bpmn-moddle@^1.12.0`; verify all required types exist in moddle schema |
| Previous implementation attempt has ~67 modified files — some changes may be incomplete or inconsistent | Build/test failures | Run full build + test suite before declaring Enhancement 1 complete; fix failures incrementally |

### Resolved Questions

1. **MCP transport for Camunda runtime:** ✅ **Resolved — no transport changes needed.** Camunda's self-managed connector runtime supports stdio MCP servers natively via the MCP Client connector. The existing `node dist/index.js` stdio entry point is used as-is. HTTP transport is not required.

2. **Diagram persistence in HTTP mode:** ✅ **N/A — HTTP mode is not being implemented.** The existing in-memory diagram store is sufficient for the stdio use case.

3. **How does the Camunda AI Agent connector discover MCP tools?** ✅ **Resolved via Camunda docs.** Tools are **auto-discovered dynamically** at runtime. A single **MCP Client service task** in the ad-hoc sub-process acts as a gateway tool definition (extension property `io.camunda.agenticai.gateway.type = mcpClient`). At runtime, the AI Agent triggers `tools/list` on the MCP server via this task and receives all tools. PRD-2 only needs one MCP Client activity per MCP server — not one activity per tool. Tool names are prefixed `MCP_<activityId>___<toolName>` to avoid LLM collisions.

4. **Version compatibility / dual transport:** ✅ **N/A — keeping stdio only.** No backward compatibility changes needed.

5. **Error propagation in `generate_bpmn_from_structure`:** ✅ **Resolved.** On partial failure, return the partial diagram and a clear error message describing what succeeded and what failed. Do not roll back.

6. **Camunda 7 vs 8 target:** ✅ **Resolved — targeting Camunda 8.9+ exclusively.** No backward compatibility with Camunda 7. The `zeebe-bpmn-moddle` package replaces `camunda-bpmn-moddle`. All extension properties use the `zeebe:` namespace. The lint config extends `camunda-cloud-8-9`.

### Open Questions

1. **Sub-process children in `generate_bpmn_from_structure`:** The current implementation creates children but doesn't establish internal connections or apply nested layout. Is sub-process support critical for the initial release, or can it be deferred?

2. **Camunda 8.9 vs 8.8 lint rules:** The `bpmnlint-plugin-camunda-compat` package has rulesets for specific Camunda versions. `camunda-cloud-8-9` should be verified as available in the installed version. If not, `camunda-cloud-8-8` may be the latest available.