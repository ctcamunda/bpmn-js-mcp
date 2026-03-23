/**
 * Static guide content for MCP resource templates.
 *
 * Extracted from resources.ts to keep file sizes under the max-lines lint limit.
 * Each export is a markdown string served via bpmn://guides/{name}.
 */

/**
 * Executable Camunda 8 (Zeebe) guide.
 *
 * Provides AI callers with constraints and conventions for building
 * processes that can be deployed and executed on Camunda 8 (Zeebe).
 */
export const EXECUTABLE_CAMUNDA8_GUIDE = `# Executable BPMN for Camunda 8 (Zeebe)

## Preferred authoring path

### Start with the generator when the process description is already concrete

- Prefer \`generate_bpmn_from_structure\` for **first-pass construction** when the user already provides most of the workflow shape: the main steps, major branches, lanes or participants, and obvious subprocess boundaries.
- This is the fastest way to produce an initial BPMN skeleton that can then be refined into a deployable Camunda 8 model.
- After generation, switch to the specialized executable-authoring tools to add Zeebe semantics and fix any structure details the generator did not capture.

### Use specialized tools as the executable-authoring surface

- Treat the specialized BPMN property tools as the **primary authoring surface** for executable behavior.
- In practice, that means using:
  - \`set_bpmn_element_properties\` for task definitions, assignment, called-process or decision IDs, and core Zeebe attributes
  - \`set_bpmn_input_output_mapping\` for FEEL I/O mappings
  - \`set_bpmn_form_data\` for user-task forms
  - \`set_bpmn_event_definition\`, \`set_bpmn_loop_characteristics\`, and related specialized tools for their specific BPMN concerns
- Use \`configure_bpmn_zeebe_extensions\` only as an **optional batch shortcut** when the structure is already stable and you want to apply repeated Zeebe setup across multiple elements in one call.
- Do not assume \`configure_bpmn_zeebe_extensions\` is a full replacement for the specialized tools; it is intentionally narrower.

### Reserve low-level element tools for refinement

- Prefer the low-level element and layout tools when the task is primarily an **incremental edit** to an existing diagram.
- They are also the better fit for **geometry-sensitive refinements**, label cleanup, custom routing, and manual corrections after generation.
- For advanced BPMN constructs that are still easier to model explicitly, use \`add_bpmn_element\`, \`connect_bpmn_elements\`, and related tools directly.

## Deployment constraints

- **One executable pool per deployment.** In a collaboration diagram, only one
  participant may have \`isExecutable: true\`. Partner pools must be **collapsed**
  (thin bars) and serve only as message-flow endpoints.
- **Process ID = deployment key.** The \`id\` attribute on \`<bpmn:Process>\` is the
  process definition key used in API calls. Use a stable, meaningful kebab-case
  or camelCase identifier (e.g. \`order-processing\`).

## Task types

| BPMN type | Camunda 8 usage | Key properties |
|-----------|-----------------|----------------|
| **User Task** | Human work in Tasklist | \`zeebe:AssignmentDefinition\` (assignee, candidateGroups, candidateUsers), \`zeebe:FormDefinition\` (formId/formKey) |
| **Service Task** | Job worker integration | \`zeebe:TaskDefinition\` (type, retries) |
| **Script Task** | FEEL expression evaluation | \`scriptFormat\`, inline FEEL script |
| **Business Rule Task** | DMN decision | \`zeebe:CalledDecision\` (decisionId, resultVariable) |
| **Send Task** | Message dispatch via worker | \`zeebe:TaskDefinition\` (type, retries) |
| **Receive Task** | Wait for correlated message | Message reference + correlation key |
| **Call Activity** | Invoke another BPMN process | \`zeebe:CalledElement\` (processId, propagateAllChildVariables) |

## User Task forms

- **Camunda Forms** (\`formId\` via \`set_bpmn_form_data\`): form designed in
  Camunda Modeler and deployed alongside the process. Referenced by form ID.
- **Custom forms** (\`formKey\` via \`set_bpmn_form_data\`): external form implementation
  referenced by key (e.g. \`camunda-forms:bpmn:myFormId\`).
- **Embedded JSON forms** (\`formJson\` via \`set_bpmn_form_data\`): form definition
  embedded directly in the BPMN XML as a \`zeebe:UserTaskForm\` element.

## Business Rule Task and DMN

Business Rule Tasks integrate with DMN decision tables:
1. Deploy the DMN table separately (or use a companion \`dmn-js-mcp\` server).
2. Set \`zeebe:decisionId\` to the decision table ID and \`zeebe:resultVariable\`
   to the output variable name via \`set_bpmn_element_properties\`.
3. Use \`set_bpmn_input_output_mapping\` to map process variables to/from
   the decision input/output columns using FEEL expressions.

## Job Worker pattern

1. Set \`zeebe:type\` (job type) and optional \`zeebe:retries\` (default "3") on the
   Service Task via \`set_bpmn_element_properties\`.
2. Deploy a job worker that subscribes to jobs of this type and completes or fails them.
3. For error handling, use boundary error events attached to the service task.
4. Retry behavior is configured via \`zeebe:retries\` on the task definition.
   Workers can also configure retry backoff.

## Gateways and conditions

- **Exclusive gateway** (XOR): exactly one outgoing flow is taken. Every
  outgoing flow (except the default) must have a \`conditionExpression\`.
  Always mark one flow as \`isDefault: true\`.
- **Parallel gateway** (AND): all outgoing flows are taken. Do **not** set
  conditions. The merging gateway must also be parallel.
- **Inclusive gateway** (OR): one or more flows are taken based on conditions.
  Always set a default flow.
- **Event-based gateway**: waits for the first event to occur among
  intermediate catch events (message, timer, signal).
- Condition expressions use FEEL: \`= amount > 1000\`, \`= approved = true\`.

## Event handling patterns

- **Boundary events** (on tasks/subprocesses): handle exceptions at a
  specific activity. Interrupting stops the activity; non-interrupting
  lets it continue.
- **Event subprocesses**: handle exceptions anywhere within the parent
  scope. Interrupting cancels the scope; non-interrupting runs in parallel.
- **Timer events**: use ISO 8601 durations (\`PT15M\`, \`P2D\`), dates, or
  cycles (\`R3/PT10M\`).
- **Error events**: use error codes to match specific errors.
  \`bpmn:Error\` root elements define reusable error references.
- **Message events**: use message names for correlation.
  \`bpmn:Message\` root elements define reusable message references.

## Process decomposition strategies

### Call Activities (hierarchical)
- Break large processes into reusable subprocesses.
- Configure via \`zeebe:CalledElement\` with \`processId\` and \`propagateAllChildVariables\`.
- Or use explicit I/O mappings for fine-grained control.

### Message-based integration (distributed)
- Separate processes communicate via message events.
- Each process is independently deployable.
- Requires message correlation (correlation keys).
- Model partner processes as collapsed pools in collaboration diagrams.

### Link events (within a single process)
- Use **Link throw/catch event pairs** to split a long flow into sections
  within the same process, improving readability without creating separate
  deployment units.
- Link events must have matching names (set via \`set_bpmn_event_definition\`
  with \`bpmn:LinkEventDefinition\` and \`properties: { name: "LinkName" }\`).
- Multiple throw events can target one catch event (many-to-one pattern).

## Common pitfalls

1. **Missing default flow on gateways** — always set \`isDefault: true\` on
   one outgoing flow of exclusive/inclusive gateways.
2. **Expanded partner pools** — only one pool is executable per deployment.
   Use collapsed pools for partners.
3. **Implicit splits** — avoid conditional flows directly on tasks; use
   explicit gateways.
4. **Missing \`zeebe:TaskDefinition\`** — service tasks need a job type
   for workers to subscribe to.
5. **Parallel gateway merging exclusive paths** — use exclusive gateway
   to merge XOR branches.
6. **Duplicate element names** — each flow node should have a unique name
   within its scope for clarity.
7. **Retry / loop-back flows creating implicit merges** — when a flow loops
   back to a task that already has an incoming flow (e.g. a retry path
   rejoining a task), you MUST insert an explicit merge gateway first.
   Use \`add_bpmn_element\` with \`flowId\` set to the existing incoming
   flow to insert the gateway in-line, then connect the retry flow to
   that gateway. Never connect two flows directly into a task — this
   creates an implicit merge that causes runtime errors.
`;

/**
 * Element modeling best practices guide.
 *
 * Moved from the add_bpmn_element tool description to keep tool descriptions
 * focused on parameters. Referenced via bpmn://guides/modeling-elements.
 */
export const MODELING_ELEMENTS_GUIDE = `# BPMN Element Modeling Guide

## Naming conventions

- **Tasks:** verb-object ("Process Order", "Send Invoice", "Review Application")
- **Events:** object-participle or noun-state ("Order Received", "Payment Completed")
- **Gateways:** yes/no question ending with "?" ("Order valid?", "Payment successful?")

## Element type selection

### Tasks
| Type | When to use |
|------|-------------|
| **UserTask** | Human work in Tasklist |
| **ServiceTask** | System integration via Zeebe job workers |
| **ScriptTask** | Inline FEEL expression evaluation |
| **BusinessRuleTask** | DMN decision table evaluation |
| **SendTask** | Fire-and-forget message dispatch |
| **ReceiveTask** | Wait for a correlated message |
| **ManualTask** | Off-system human work (no tasklist entry) |
| **CallActivity** | Invoke another deployed BPMN process |

### Service integration patterns
- For simple integrations (fire-and-forget or request-response), prefer
  **bpmn:ServiceTask** with \`zeebe:TaskDefinition\` (type for job workers).
- Use **message throw/catch events** only when modeling explicit message
  exchanges with collapsed partner pools in a collaboration diagram.
- Only one pool is executable per deployment; others are collapsed
  documentation of message endpoints.

## Boundary events

- Use \`elementType=bpmn:BoundaryEvent\` with \`hostElementId\` to attach
  to a task or subprocess.
- Do **NOT** use \`bpmn:IntermediateCatchEvent\` for boundary events —
  that creates a standalone event not attached to any host.
- After adding, use \`set_bpmn_event_definition\` to set the type
  (error, timer, message, signal).
- Or use the \`eventDefinitionType\` shorthand parameter on \`add_bpmn_element\`.

## Subprocesses

- By default, \`bpmn:SubProcess\` is created **expanded** (350×200 shape
  with inline children).
- Set \`isExpanded=false\` for a **collapsed** subprocess (small shape
  with a separate drilldown plane).

## Event subprocesses

- Create a \`bpmn:SubProcess\` and set \`triggeredByEvent: true\` via
  \`set_bpmn_element_properties\`.
- The event subprocess needs its own start event with an event definition
  (timer, message, error, signal).
- **Interrupting** cancels the parent scope; **non-interrupting** runs
  in parallel.
- Prefer event subprocesses over boundary events when exception handling
  spans multiple activities or applies to the whole process scope.
`;

/**
 * Element properties reference guide.
 *
 * Moved from the set_bpmn_element_properties tool description to keep tool
 * descriptions focused on the interface. Referenced via bpmn://guides/element-properties.
 */
export const ELEMENT_PROPERTIES_GUIDE = `# Camunda 8 Element Properties Reference

This is the complete catalog of properties supported by \`set_bpmn_element_properties\`.
Zeebe extension elements are configured as \`zeebe:\` prefixed properties.

## Standard BPMN properties

- \`name\` — element label/name
- \`isExecutable\` — process executability flag
- \`documentation\` — element documentation text
- \`default\` — default sequence flow ID on exclusive/inclusive gateways
- \`conditionExpression\` — FEEL condition on sequence flows (e.g. \`= approved = true\`)
- \`isExpanded\` — SubProcess expanded/collapsed toggle

## Zeebe properties by element type

### UserTask
- \`zeebe:assignee\` — user assignment (FEEL expression) → zeebe:AssignmentDefinition
- \`zeebe:candidateUsers\` — comma-separated user list (FEEL) → zeebe:AssignmentDefinition
- \`zeebe:candidateGroups\` — comma-separated group list (FEEL) → zeebe:AssignmentDefinition
- Form: use \`set_bpmn_form_data\` with formId, formKey, or embedded JSON

### ServiceTask / SendTask
- \`zeebe:type\` — job type for Zeebe workers → zeebe:TaskDefinition
- \`zeebe:retries\` — retry count (default "3") → zeebe:TaskDefinition

### ScriptTask
- \`scriptFormat\` — script language (\`feel\`)
- \`script\` — inline FEEL expression body

### BusinessRuleTask
- \`zeebe:decisionId\` — DMN decision table ID → zeebe:CalledDecision
- \`zeebe:resultVariable\` — output variable name → zeebe:CalledDecision

### CallActivity
- \`zeebe:processId\` — called process ID → zeebe:CalledElement
- \`zeebe:propagateAllChildVariables\` — propagate all variables (boolean) → zeebe:CalledElement

### Any element
- \`zeebe:properties\` — generic key-value pairs → zeebe:Properties

## Related tools

- \`set_bpmn_form_data\` — Zeebe form definition (formId, formKey, or embedded JSON)
- \`set_bpmn_input_output_mapping\` — FEEL-based input/output mappings (zeebe:IoMapping)
- \`set_bpmn_event_definition\` — event definitions (timer, error, message, etc.)
- \`set_bpmn_loop_characteristics\` — multi-instance configuration
- \`set_bpmn_camunda_listeners\` — execution/task listeners (job-worker-based)
- \`set_bpmn_call_activity_variables\` — call activity variable propagation
- \`configure_bpmn_zeebe_extensions\` — optional batch shortcut for repeated Zeebe setup across multiple elements; use after the specialized tools are understood, not instead of them
`;
