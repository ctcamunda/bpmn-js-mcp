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

// ── Legacy prompts (removed) ───────────────────────────────────────────────
// The 9 pattern-specific prompts below have been replaced by 3 style-toggle
// prompts in src/prompts.ts: 'executable', 'executable-pool', 'collaboration'.
/*
  // ── create-executable-process ────────────────────────────────────────────
  {
    name: 'create-executable-process',
    title: 'Create an executable Camunda 7 process from scratch',
    description:
      'Guided workflow to build a named, deployable Camunda 7 / Operaton process ' +
      'with properly configured tasks, gateways, and events.',
    arguments: [
      {
        name: 'processName',
        description: 'Name for the new process (e.g. "Order Processing")',
        required: false,
      },
    ],
    getMessages: (args) => {
      const processName = arg(args, 'processName', 'My Process');
      return [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Create an executable BPMN process named **"${processName}"** for ` +
              `Operaton / Camunda 7.\n\n` +
              `**Steps:**\n` +
              `1. \`create_bpmn_diagram\` — creates a blank diagram with an executable process.\n` +
              `2. Add a StartEvent, tasks, gateways, and an EndEvent using ` +
              `\`add_bpmn_element\` or \`add_bpmn_element_chain\`.\n` +
              `3. Connect elements with \`connect_bpmn_elements\`. ` +
              `Set \`conditionExpression\` on gateway branches and mark one as ` +
              `\`isDefault: true\`.\n` +
              `4. Configure each task type:\n` +
              `   - UserTask → \`camunda:assignee\` or \`camunda:candidateGroups\` + \`set_bpmn_form_data\`\n` +
              `   - ServiceTask → \`camunda:type: "external"\`, \`camunda:topic\`\n` +
              `   - BusinessRuleTask → \`camunda:decisionRef\`\n` +
              `5. \`layout_bpmn_diagram\` to tidy up.\n` +
              `6. \`validate_bpmn_diagram\` and fix any issues.\n` +
              `7. \`export_bpmn\` with \`format: "both"\` and a \`filePath\` to save.\n\n` +
              `Process name: **${processName}**`,
          },
        },
      ];
    },
  },

  // ── convert-to-collaboration ─────────────────────────────────────────────
  {
    name: 'convert-to-collaboration',
    title: 'Convert a flat process into a collaboration with partner pools',
    description:
      'Wraps an existing flat process in a participant pool and adds collapsed ' +
      'partner pools for external systems or organisations.',
    arguments: [
      { name: 'diagramId', description: 'ID of the diagram to convert', required: true },
      {
        name: 'partners',
        description:
          'Comma-separated list of external partner names (e.g. "Customer, Payment Gateway")',
        required: false,
      },
    ],
    getMessages: (args) => {
      const diagramId = arg(args, 'diagramId', DEFAULT_DIAGRAM_ID);
      const partners = arg(args, 'partners', 'Partner');
      return [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Convert diagram \`${diagramId}\` into a collaboration.\n\n` +
              `**Steps:**\n` +
              `1. Use \`create_bpmn_participant\` with \`wrapExisting: true\` to wrap the ` +
              `existing process in an expanded pool.\n` +
              `2. Add collapsed partner pools for each external party: **${partners}**.\n` +
              `   Pass them in the \`additionalParticipants\` array with \`collapsed: true\`.\n` +
              `3. Draw message flows between the main pool's tasks and the collapsed pools ` +
              `using \`connect_bpmn_elements\` (cross-pool connections auto-create message flows).\n` +
              `4. Optionally use \`manage_bpmn_root_elements\` to define named \`bpmn:Message\` ` +
              `elements referenced by the event definitions.\n` +
              `5. \`layout_bpmn_diagram\` → \`autosize_bpmn_pools_and_lanes\`.\n` +
              `6. \`export_bpmn\` with \`format: "both"\` and a \`filePath\`.\n\n` +
              `Diagram: \`${diagramId}\` | Partners: ${partners}`,
          },
        },
      ];
    },
  },

  // ── add-sla-timer-pattern ────────────────────────────────────────────────
  {
    name: 'add-sla-timer-pattern',
    title: 'Add an SLA boundary timer to a task',
    description:
      'Attaches a non-interrupting timer boundary event to a task to trigger ' +
      'an escalation path when the SLA duration elapses.',
    arguments: [
      ARG_DIAGRAM_ID,
      {
        name: 'targetElementId',
        description: 'ID of the task to attach the timer to',
        required: true,
      },
      {
        name: 'duration',
        description: 'ISO 8601 duration (e.g. "PT2H" for 2 hours, "P1D" for 1 day)',
        required: false,
      },
    ],
    getMessages: (args) => {
      const diagramId = arg(args, 'diagramId', DEFAULT_DIAGRAM_ID);
      const targetElementId = arg(args, 'targetElementId', DEFAULT_ELEMENT_ID);
      const duration = arg(args, 'duration', 'PT1H');
      return [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Add an SLA timer boundary event to task \`${targetElementId}\` in diagram \`${diagramId}\`.\n\n` +
              `**Steps:**\n` +
              `1. Add a \`bpmn:BoundaryEvent\` with \`hostElementId: "${targetElementId}"\` and ` +
              `\`eventDefinitionType: "bpmn:TimerEventDefinition"\`.\n` +
              `   Set \`cancelActivity: false\` for a **non-interrupting** timer (escalation path ` +
              `runs in parallel — the original task continues).\n` +
              `2. Set the timer duration using \`set_bpmn_event_definition\` with ` +
              `\`timeDuration: "${duration}"\` (ISO 8601 — ${duration}).\n` +
              `3. Add an escalation task after the boundary event (e.g. "Escalate to Manager") ` +
              `and connect with \`connect_bpmn_elements\`.\n` +
              `4. Connect the escalation task to an intermediate or end event.\n` +
              `5. \`layout_bpmn_diagram\` to tidy up.\n` +
              `6. \`export_bpmn\` with \`format: "both"\` and a \`filePath\`.\n\n` +
              `Target: \`${targetElementId}\` | Duration: **${duration}**`,
          },
        },
      ];
    },
  },

  // ── add-approval-pattern ─────────────────────────────────────────────────
  {
    name: 'add-approval-pattern',
    title: 'Insert an approval gateway after a task',
    description:
      'Adds an exclusive approval gateway with Approved/Rejected branches after ' +
      'a specified element, routing the reject branch back or to an end.',
    arguments: [
      ARG_DIAGRAM_ID,
      {
        name: 'afterElementId',
        description: 'ID of the element to insert the approval after',
        required: true,
      },
      {
        name: 'approverGroup',
        description: 'candidateGroups value for the approval UserTask (e.g. "managers")',
        required: false,
      },
    ],
    getMessages: (args) => {
      const diagramId = arg(args, 'diagramId', DEFAULT_DIAGRAM_ID);
      const afterElementId = arg(args, 'afterElementId', DEFAULT_ELEMENT_ID);
      const approverGroup = arg(args, 'approverGroup', 'approvers');
      return [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Add an approval gateway pattern after \`${afterElementId}\` in diagram \`${diagramId}\`.\n\n` +
              `**Steps:**\n` +
              `1. Add a \`bpmn:UserTask\` named "Review & Approve" after \`${afterElementId}\` ` +
              `using \`afterElementId\`.\n` +
              `   Set \`camunda:candidateGroups: "${approverGroup}"\` on it.\n` +
              `2. Add an \`bpmn:ExclusiveGateway\` named "Approved?" after the UserTask.\n` +
              `3. Add an "Approved" branch: connect the gateway to the next process step ` +
              `with \`conditionExpression: "\${approved == true}"\`.\n` +
              `4. Add a "Rejected" branch: connect the gateway to a "Handle Rejection" task ` +
              `with \`conditionExpression: "\${approved == false}"\`. ` +
              `Mark the approved path as \`isDefault: true\`.\n` +
              `5. Connect "Handle Rejection" to an EndEvent (or loop back if re-submission is allowed).\n` +
              `6. \`layout_bpmn_diagram\` to tidy up.\n` +
              `7. \`export_bpmn\` with \`format: "both"\` and a \`filePath\`.\n\n` +
              `Insert after: \`${afterElementId}\` | Approver group: **${approverGroup}**`,
          },
        },
      ];
    },
  },

  // ── add-error-handling-pattern ───────────────────────────────────────────
  {
    name: 'add-error-handling-pattern',
    title: 'Add error boundary event to a service task',
    description:
      'Attaches an interrupting error BoundaryEvent to a ServiceTask and routes ' +
      'the error path to a compensation or notification task.',
    arguments: [
      ARG_DIAGRAM_ID,
      {
        name: 'targetElementId',
        description: 'ID of the ServiceTask to attach error handling to',
        required: true,
      },
      {
        name: 'errorCode',
        description: 'Error code to catch (e.g. "PAYMENT_FAILED")',
        required: false,
      },
    ],
    getMessages: (args) => {
      const diagramId = arg(args, 'diagramId', DEFAULT_DIAGRAM_ID);
      const targetElementId = arg(args, 'targetElementId', DEFAULT_ELEMENT_ID);
      const errorCode = arg(args, 'errorCode', 'SERVICE_ERROR');
      return [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Add error handling to task \`${targetElementId}\` in diagram \`${diagramId}\`.\n\n` +
              `**Steps:**\n` +
              `1. Add a \`bpmn:BoundaryEvent\` with \`hostElementId: "${targetElementId}"\` ` +
              `and \`eventDefinitionType: "bpmn:ErrorEventDefinition"\`.\n` +
              `   Leave \`cancelActivity\` at its default (\`true\`) — an error BoundaryEvent ` +
              `is always interrupting.\n` +
              `2. Use \`set_bpmn_event_definition\` to configure the ErrorEventDefinition with ` +
              `\`errorRef: { id: "Error_${errorCode}", errorCode: "${errorCode}" }\`.\n` +
              `3. Add a compensation or notification task after the BoundaryEvent ` +
              `(e.g. "Handle ${errorCode} Error") and connect it.\n` +
              `4. End the error path with an EndEvent (optionally a terminating end event ` +
              `to stop the entire process on error).\n` +
              `5. \`layout_bpmn_diagram\` to tidy up.\n` +
              `6. \`export_bpmn\` with \`format: "both"\` and a \`filePath\`.\n\n` +
              `Target: \`${targetElementId}\` | ErrorEventDefinition code: **${errorCode}** | BoundaryEvent type: interrupting`,
          },
        },
      ];
    },
  },

  // ── add-parallel-tasks-pattern ───────────────────────────────────────────
  {
    name: 'add-parallel-tasks-pattern',
    title: 'Insert parallel branches after an element',
    description:
      'Adds a parallel split gateway, one task per branch, and a parallel join ' +
      'gateway that re-converges the flow.',
    arguments: [
      ARG_DIAGRAM_ID,
      {
        name: 'afterElementId',
        description: 'ID of the element to insert the parallel split after',
        required: true,
      },
      {
        name: 'branches',
        description:
          'Comma-separated task names for each parallel branch (e.g. "Check Stock, Process Payment, Send Email")',
        required: false,
      },
    ],
    getMessages: (args) => {
      const diagramId = arg(args, 'diagramId', DEFAULT_DIAGRAM_ID);
      const afterElementId = arg(args, 'afterElementId', DEFAULT_ELEMENT_ID);
      const branches = arg(args, 'branches', 'Task A, Task B');
      const branchList = branches
        .split(',')
        .map((b) => b.trim())
        .filter(Boolean);
      const branchBullets = branchList
        .map((b) => `   - Add \`bpmn:Task\` named "${b}" and connect from the split gateway.`)
        .join('\n');
      return [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Add parallel branches after \`${afterElementId}\` in diagram \`${diagramId}\`.\n\n` +
              `**Branches:** ${branches}\n\n` +
              `**Steps:**\n` +
              `1. Add a \`bpmn:ParallelGateway\` named "Split" after \`${afterElementId}\`.\n` +
              `2. Add one task per branch and connect each from the ParallelGateway (split):\n` +
              `${branchBullets}\n` +
              `3. Add another \`bpmn:ParallelGateway\` named "Join" (the synchronising join).\n` +
              `4. Connect each branch task to the join ParallelGateway.\n` +
              `5. Connect the join gateway to the next step in the process.\n` +
              `6. \`layout_bpmn_diagram\` to tidy up.\n` +
              `7. \`export_bpmn\` with \`format: "both"\` and a \`filePath\`.\n\n` +
              `Insert after: \`${afterElementId}\` | Branches: ${branches}`,
          },
        },
      ];
    },
  },

  // ── create-lane-based-process ────────────────────────────────────────────
  {
    name: 'create-lane-based-process',
    title: 'Create a process with swimlanes for role separation',
    description:
      'Builds a new executable process inside a single participant pool with ' +
      'swimlanes, one per role, and places tasks in the correct lane.',
    arguments: [
      { name: 'processName', description: 'Name for the process', required: false },
      {
        name: 'roles',
        description:
          'Comma-separated list of role/lane names (e.g. "Customer Service, Technical Support, Management")',
        required: false,
      },
    ],
    getMessages: (args) => {
      const processName = arg(args, 'processName', 'My Process');
      const roles = arg(args, 'roles', 'Role A, Role B');
      const roleList = roles
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean);
      const laneJson = JSON.stringify(roleList.map((name) => ({ name })));
      return [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Create a lane-based BPMN process named **"${processName}"** with these roles/lanes: **${roles}**.\n\n` +
              `**Steps:**\n` +
              `1. \`create_bpmn_diagram\` to create a blank diagram.\n` +
              `2. \`create_bpmn_participant\` with \`name: "${processName}"\` and ` +
              `\`lanes: ${laneJson}\` — this creates the pool and all lanes in one call.\n` +
              `3. For each lane, add the relevant tasks using \`add_bpmn_element\` with ` +
              `both \`participantId\` and \`laneId\` specified. ` +
              `This keeps tasks in their correct swimlane.\n` +
              `4. Connect tasks across lanes using \`connect_bpmn_elements\`. ` +
              `Use \`handoff_bpmn_to_lane\` for quick cross-lane handoffs.\n` +
              `5. Configure each task: UserTasks in human lanes should have ` +
              `\`camunda:candidateGroups\` matching the lane name.\n` +
              `6. \`layout_bpmn_diagram\` → \`autosize_bpmn_pools_and_lanes\` to size the pool.\n` +
              `7. \`validate_bpmn_diagram\` and fix issues.\n` +
              `8. \`export_bpmn\` with \`format: "both"\` and a \`filePath\`.\n\n` +
              `**Key parameters:** always specify \`laneId\` when calling \`add_bpmn_element\` inside a pool with lanes.`,
          },
        },
      ];
    },
  },

  // ── add-subprocess-pattern ───────────────────────────────────────────────
  {
    name: 'add-subprocess-pattern',
    title: 'Insert an expanded subprocess with internal steps',
    description:
      'Adds an expanded inline subprocess after a specified element, ' +
      'populates it with named steps, and reconnects the outer flow.',
    arguments: [
      ARG_DIAGRAM_ID,
      {
        name: 'afterElementId',
        description: 'ID of the element to insert the subprocess after',
        required: true,
      },
      {
        name: 'subprocessName',
        description: 'Name for the subprocess (e.g. "Process Payment")',
        required: false,
      },
      {
        name: 'steps',
        description:
          'Comma-separated internal step names (e.g. "Validate Card, Charge Amount, Send Receipt")',
        required: false,
      },
    ],
    getMessages: (args) => {
      const diagramId = arg(args, 'diagramId', DEFAULT_DIAGRAM_ID);
      const afterElementId = arg(args, 'afterElementId', DEFAULT_ELEMENT_ID);
      const subprocessName = arg(args, 'subprocessName', 'Sub-Process');
      const steps = arg(args, 'steps', 'Step A, Step B');
      const stepList = steps
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const stepBullets = stepList
        .map((s) => `   - \`add_bpmn_element\` bpmn:Task "${s}" with \`parentId\` = subprocess ID.`)
        .join('\n');
      return [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Add an expanded SubProcess named **"${subprocessName}"** after \`${afterElementId}\` ` +
              `in diagram \`${diagramId}\`.\n\n` +
              `**Internal steps:** ${steps}\n\n` +
              `**Steps:**\n` +
              `1. Add a \`bpmn:SubProcess\` with \`isExpanded: true\` after \`${afterElementId}\`.\n` +
              `   This creates an inline expanded subprocess on the same plane.\n` +
              `2. Note the returned subprocess element ID. Add internal elements using ` +
              `\`parentId\` = subprocess ID:\n` +
              `   - Add a StartEvent inside the SubProcess.\n` +
              `${stepBullets}\n` +
              `   - Add an EndEvent inside the SubProcess.\n` +
              `3. Connect the internal elements with \`connect_bpmn_elements\`.\n` +
              `4. The outer flow is auto-connected via \`afterElementId\`. ` +
              `If needed, reconnect the next outer element to the SubProcess.\n` +
              `5. \`layout_bpmn_diagram\` to tidy up.\n` +
              `6. \`export_bpmn\` with \`format: "both"\` and a \`filePath\`.\n\n` +
              `Subprocess: **${subprocessName}** | isExpanded: true | Insert after: \`${afterElementId}\``,
          },
        },
      ];
    },
  },

  // ── add-message-exchange-pattern ─────────────────────────────────────────
  {
    name: 'add-message-exchange-pattern',
    title: 'Create a message exchange collaboration between two systems',
    description:
      'Builds a collaboration with one executable process pool and one collapsed ' +
      'partner pool, connected via message flows.',
    arguments: [
      {
        name: 'processName',
        description: 'Name of the main (executable) process',
        required: false,
      },
      { name: 'partnerName', description: 'Name of the external partner system', required: false },
    ],
    getMessages: (args) => {
      const processName = arg(args, 'processName', 'Main Process');
      const partnerName = arg(args, 'partnerName', 'External System');
      return [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Create a message exchange collaboration between **"${processName}"** and ` +
              `**"${partnerName}"**.\n\n` +
              `**Steps:**\n` +
              `1. \`create_bpmn_diagram\` with \`workflowContext: "multi-system"\`.\n` +
              `2. \`create_bpmn_participant\` with a \`participants\` array:\n` +
              `   - \`{ name: "${processName}" }\` — expanded (executable) pool.\n` +
              `   - \`{ name: "${partnerName}", collapsed: true }\` — collapsed partner pool ` +
              `(external system, documentation only).\n` +
              `3. Build the internal flow of "${processName}" with tasks and events.\n` +
              `4. Add message send/receive events or Send/Receive tasks at the integration points.\n` +
              `5. Connect elements in "${processName}" to the collapsed "${partnerName}" pool ` +
              `using \`connect_bpmn_elements\` — this auto-creates **message flows** between pools.\n` +
              `6. Optionally define named bpmn:Message root elements with \`manage_bpmn_root_elements\` ` +
              `and reference them in the event definitions.\n` +
              `7. \`layout_bpmn_diagram\` → \`autosize_bpmn_pools_and_lanes\`.\n` +
              `8. \`export_bpmn\` with \`format: "both"\`, \`skipLint: true\`, and a \`filePath\`.\n\n` +
              `Process: **${processName}** | Partner: **${partnerName}** (collapsed) | ` +
              `Connection type: message flows`,
          },
        },
      ];
    },
  },
*/
