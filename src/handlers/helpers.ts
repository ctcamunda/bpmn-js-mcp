/**
 * Shared helpers used by individual tool handler modules.
 *
 * Re-exports from focused sub-modules and directly contains hint utilities.
 * Sub-modules:
 *   - `./validation`      — validateArgs, validateElementType, ALLOWED/INSERTABLE_ELEMENT_TYPES
 *   - `./id-generation`   — generateDescriptiveId, generateFlowId
 *   - `./diagram-access`  — requireDiagram, requireElement, jsonResult, syncXml, …
 *   - `./moddle-utils`    — upsertExtensionElement, resolveOrCreate*, fixConnectionId, …
 *   - `./lane-helpers`    — removeFromAllLanes, addToLane, getLaneElements, getSiblingLanes
 */

// Re-export getService for convenient typed access from handlers
export { getService } from '../bpmn-types';

// ── Error codes ────────────────────────────────────────────────────────────
export {
  ERR_MISSING_REQUIRED,
  ERR_INVALID_ENUM,
  ERR_ILLEGAL_COMBINATION,
  ERR_NOT_FOUND,
  ERR_DIAGRAM_NOT_FOUND,
  ERR_ELEMENT_NOT_FOUND,
  ERR_TYPE_MISMATCH,
  ERR_DUPLICATE,
  ERR_EXPORT_FAILED,
  ERR_LINT_BLOCKED,
  ERR_SEMANTIC_VIOLATION,
  ERR_INTERNAL,
  createMcpError,
  missingRequiredError,
  diagramNotFoundError,
  elementNotFoundError,
  invalidEnumError,
  illegalCombinationError,
  typeMismatchError,
  duplicateError,
  semanticViolationError,
  exportFailedError,
} from '../errors';

// ── Validation ─────────────────────────────────────────────────────────────
export {
  validateArgs,
  validateElementType,
  ALLOWED_ELEMENT_TYPES,
  INSERTABLE_ELEMENT_TYPES,
} from './validation';

// ── ID generation ──────────────────────────────────────────────────────────
export { generateDescriptiveId, generateFlowId } from './id-generation';

// ── Diagram access, element filtering, counts, connectivity ────────────────
export {
  requireDiagram,
  requireElement,
  jsonResult,
  syncXml,
  getVisibleElements,
  isConnectionElement,
  isInfrastructureElement,
  buildElementCounts,
  buildConnectivityWarnings,
  buildConnectivityNextSteps,
  getParticipants,
  getLanes,
  getProcesses,
  getSequenceFlows,
  getMessageFlows,
  getElementsByType,
  isCollaboration,
} from './diagram-access';

// ── Moddle / extension-element utilities ───────────────────────────────────
export {
  upsertExtensionElement,
  createBusinessObject,
  fixConnectionId,
  resolveOrCreateError,
  resolveOrCreateMessage,
  resolveOrCreateSignal,
  resolveOrCreateEscalation,
} from './moddle-utils';

// ── Lane helpers ───────────────────────────────────────────────────────────
export { removeFromAllLanes, addToLane, getLaneElements, getSiblingLanes } from './lane-helpers';

// ── AI-caller hints ─────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------
// Shared hint interface
// ---------------------------------------------------------------------------

/** Hint record with a short description and the tool name to call. */
export interface Hint {
  tool: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Type-specific hints (returned by add / replace / insert element)
// ---------------------------------------------------------------------------

/** Map from element type patterns to suggested next-step hints. */
const TYPE_HINTS: Array<{ match: (type: string) => boolean; hints: Hint[] }> = [
  {
    match: (t) => t === 'bpmn:UserTask',
    hints: [
      {
        tool: 'set_bpmn_form_data',
        description:
          'Define a Zeebe form (formId referencing a deployed Camunda Form, formKey for custom forms, or embedded JSON form body)',
      },
      {
        tool: 'set_bpmn_element_properties',
        description:
          'Set zeebe:AssignmentDefinition properties: zeebe:assignee, zeebe:candidateGroups, zeebe:candidateUsers (FEEL expressions). ' +
          'For forms: use set_bpmn_form_data with formId (deployed form reference) or formKey (custom form).',
      },
    ],
  },
  {
    match: (t) => t === 'bpmn:ServiceTask',
    hints: [
      {
        tool: 'set_bpmn_element_properties',
        description:
          'Set zeebe:TaskDefinition with zeebe:type (job type for workers) and optional zeebe:retries (default "3")',
      },
      {
        tool: 'set_bpmn_input_output_mapping',
        description: 'Map process variables to/from the service task using FEEL expressions',
      },
    ],
  },
  {
    match: (t) => t === 'bpmn:ScriptTask',
    hints: [
      {
        tool: 'set_bpmn_element_properties',
        description: 'Set scriptFormat and script (inline FEEL expression body)',
      },
    ],
  },
  {
    match: (t) => t === 'bpmn:BusinessRuleTask',
    hints: [
      {
        tool: 'set_bpmn_element_properties',
        description:
          'Set zeebe:CalledDecision with zeebe:decisionId (DMN decision table ID) and zeebe:resultVariable (output variable name). ' +
          'Alternatively use zeebe:TaskDefinition for custom business rule worker.',
      },
      {
        tool: 'set_bpmn_input_output_mapping',
        description:
          'Map process variables to DMN input columns and DMN output to process variables. ' +
          'Use a companion dmn-js-mcp server (if available) to design the DMN decision table itself.',
      },
    ],
  },
  {
    match: (t) => t === 'bpmn:CallActivity',
    hints: [
      {
        tool: 'set_bpmn_call_activity_variables',
        description: 'Set zeebe:CalledElement processId and configure variable propagation (propagateAllChildVariables or explicit I/O mappings)',
      },
      {
        tool: 'set_bpmn_element_properties',
        description:
          'Set calledElement (process ID) via zeebe:CalledElement',
      },
    ],
  },
  {
    match: (t) => t === 'bpmn:BoundaryEvent',
    hints: [
      {
        tool: 'set_bpmn_event_definition',
        description:
          'Set event type (error, timer, message, signal) if not already set via eventDefinitionType shorthand',
      },
    ],
  },
  {
    match: (t) => t === 'bpmn:SendTask',
    hints: [
      {
        tool: 'set_bpmn_element_properties',
        description:
          'Set zeebe:TaskDefinition with zeebe:type (job type for the message-sending worker)',
      },
    ],
  },
  {
    match: (t) => t === 'bpmn:ReceiveTask',
    hints: [
      {
        tool: 'set_bpmn_element_properties',
        description: 'Configure message reference for correlation',
      },
    ],
  },
  {
    match: (t) => t === 'bpmn:ExclusiveGateway' || t === 'bpmn:InclusiveGateway',
    hints: [
      {
        tool: 'set_bpmn_element_properties',
        description:
          'Name the gateway as a yes/no question (e.g. "Order valid?", "Payment successful?"). Set `default` to a sequence flow ID for the default branch.',
      },
      {
        tool: 'connect_bpmn_elements',
        description:
          'Create conditional outgoing flows with conditionExpression and optional isDefault flag',
      },
    ],
  },
  {
    match: (t) => t === 'bpmn:ParallelGateway',
    hints: [
      {
        tool: 'connect_bpmn_elements',
        description:
          'Create outgoing flows for parallel branches. Parallel gateways typically don\u2019t need a name unless it adds clarity.',
      },
    ],
  },
  {
    match: (t) => t.includes('SubProcess'),
    hints: [
      {
        tool: 'set_bpmn_element_properties',
        description:
          'Set triggeredByEvent: true for event subprocesses, or isExpanded to toggle inline/collapsed view',
      },
      {
        tool: 'add_bpmn_element',
        description: 'Add start/end events and tasks inside the subprocess',
      },
    ],
  },
  {
    match: (t) => t === 'bpmn:DataObjectReference' || t === 'bpmn:DataStoreReference',
    hints: [
      {
        tool: 'connect_bpmn_elements',
        description:
          'Create a data association to connect this data element to a task (auto-detects DataInputAssociation or DataOutputAssociation based on direction)',
      },
    ],
  },
  {
    match: (t) => t === 'bpmn:Lane',
    hints: [
      {
        tool: 'create_bpmn_participant',
        description:
          'Consider using pools (participants) with message flows instead of lanes for cross-organizational processes. Lanes are for role-based swimlanes within a single pool.',
      },
    ],
  },
  {
    match: (t) => t === 'bpmn:IntermediateThrowEvent' || t === 'bpmn:IntermediateCatchEvent',
    hints: [
      {
        tool: 'set_bpmn_event_definition',
        description:
          'Set the event type (message, timer, signal, link, conditional, compensation). Use LinkEventDefinition for cross-page flow references in large diagrams.',
      },
    ],
  },
];

/**
 * Get type-specific next-step hints for an element type.
 * Returns `{ nextSteps: Hint[] }` if hints exist, or an empty object.
 */
export function getTypeSpecificHints(elementType: string): { nextSteps?: Hint[] } {
  for (const entry of TYPE_HINTS) {
    if (entry.match(elementType)) {
      return { nextSteps: entry.hints };
    }
  }
  return {};
}

/** Naming convention categories for BPMN elements. */
const NAMING_CATEGORIES: Array<{ match: (t: string) => boolean; convention: string }> = [
  {
    match: (t) => t.includes('Task') || t === 'bpmn:CallActivity',
    convention:
      'Use verb-object pattern (e.g. "Process Order", "Send Invoice", "Review Application")',
  },
  {
    match: (t) => t.includes('Event') && !t.includes('Gateway'),
    convention:
      'Use object-participle or noun-state pattern (e.g. "Order Received", "Payment Completed", "Timeout Reached")',
  },
  {
    match: (t) => t === 'bpmn:ExclusiveGateway' || t === 'bpmn:InclusiveGateway',
    convention:
      'Use a yes/no question ending with "?" (e.g. "Order valid?", "Payment successful?")',
  },
];

/**
 * Get a naming convention reminder when an element is created without a name.
 * Returns `{ namingHint: string }` if applicable, or an empty object.
 */
export function getNamingHint(elementType: string, name?: string): { namingHint?: string } {
  if (name) return {};
  // Parallel gateways typically don't need naming
  if (elementType === 'bpmn:ParallelGateway') return {};
  for (const entry of NAMING_CATEGORIES) {
    if (entry.match(elementType)) {
      return { namingHint: entry.convention };
    }
  }
  return {};
}

// ---------------------------------------------------------------------------
// Property-specific hints (returned by set-properties)
// ---------------------------------------------------------------------------

/** Hint for event subprocess triggered-by-event setup. */
function hintTriggeredByEvent(props: Record<string, any>, hints: Hint[]): void {
  if (props['triggeredByEvent'] === true) {
    hints.push({
      tool: 'add_bpmn_element',
      description:
        'Add a start event with an event definition (timer, message, error, signal) inside the event subprocess',
    });
  }
}

/** Hint for zeebe:CalledDecision on BusinessRuleTask. */
function hintCalledDecision(zeebeProps: Record<string, any>, elType: string, hints: Hint[]): void {
  if (
    zeebeProps['zeebe:decisionId'] &&
    elType === 'bpmn:BusinessRuleTask' &&
    !zeebeProps['zeebe:resultVariable']
  ) {
    hints.push({
      tool: 'set_bpmn_element_properties',
      description:
        'Set zeebe:resultVariable to specify the process variable that receives the DMN decision result',
    });
  }
}

/** Hint for zeebe:CalledElement on CallActivity. */
function hintCalledElement(
  zeebeProps: Record<string, any>,
  elType: string,
  hints: Hint[]
): void {
  if (
    zeebeProps['zeebe:processId'] &&
    elType === 'bpmn:CallActivity'
  ) {
    hints.push({
      tool: 'set_bpmn_call_activity_variables',
      description:
        'Configure variable propagation for the call activity — set propagateAllChildVariables or define explicit I/O mappings',
    });
  }
}

/**
 * Build contextual next-step hints based on properties that were set.
 */
export function buildPropertyHints(
  props: Record<string, any>,
  zeebeProps: Record<string, any>,
  element: any
): Hint[] {
  const hints: Hint[] = [];
  const elType = element.type || element.businessObject?.$type || '';

  hintTriggeredByEvent(props, hints);
  hintCalledDecision(zeebeProps, elType, hints);
  hintCalledElement(zeebeProps, elType, hints);

  return hints;
}

// ---------------------------------------------------------------------------
// Coordinate normalisation helpers
// ---------------------------------------------------------------------------

/** Minimum Y margin (px) from the viewport top after normalisation. */
const POSITIVE_Y_MARGIN = 30;

/**
 * Shift all participant pools so the topmost element is at least
 * POSITIVE_Y_MARGIN pixels from the top of the viewport.
 *
 * Moving only bpmn:Participant elements is correct because bpmn-js
 * automatically moves a pool's children when the pool is moved.
 * Attempting to move non-participant top-level objects (e.g. the canvas
 * root or Collaboration element) causes BpmnOrderingProvider to crash.
 */
export function shiftToPositiveCoordinates(elementRegistry: any, modeling: any): void {
  const allElements: any[] = elementRegistry.getAll();
  const minY = allElements
    .filter(
      (el) =>
        el.y !== undefined &&
        !el.type?.includes('Flow') &&
        !el.type?.includes('Association') &&
        el.type !== 'label'
    )
    .reduce((m: number, el: any) => Math.min(m, el.y), Infinity);
  if (!isFinite(minY) || minY >= POSITIVE_Y_MARGIN) return;
  const participants = allElements.filter((el: any) => el.type === 'bpmn:Participant');
  if (participants.length > 0) {
    modeling.moveElements(participants, { x: 0, y: POSITIVE_Y_MARGIN - minY });
  }
}

/**
 * Optionally run `layout_bpmn_diagram` on a diagram.
 * Returns true if layout was applied, false if skipped or failed.
 */
export async function runOptionalLayout(
  diagramId: string,
  shouldLayout: boolean
): Promise<boolean> {
  if (!shouldLayout) return false;
  try {
    const { handleLayoutDiagram } = await import('./layout/layout-diagram');
    await handleLayoutDiagram({ diagramId });
    return true;
  } catch {
    return false;
  }
}
