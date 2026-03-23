/**
 * Handler for generate_bpmn_from_structure tool.
 *
 * Accepts a structured JSON description of a BPMN process and creates the
 * full diagram in a single tool call, orchestrating existing handlers internally.
 */
// @mutating

import { type ToolResult, type ToolContext } from '../../types';
import { missingRequiredError, semanticViolationError } from '../../errors';
import { validateArgs, jsonResult, requireDiagram, getService } from '../helpers';
import { appendLintFeedback, setBatchMode } from '../../linter';
import { handleCreateDiagram } from './create-diagram';
import { handleAddElement, type AddElementArgs } from '../elements/add-element';
import { handleConnect } from '../elements/connect';
import { handleSetProperties } from '../properties/set-properties';
import { handleCreateParticipant } from '../collaboration/create-participant';
import { handleAssignElementsToLane } from '../collaboration/assign-elements-to-lane';
import { handleLayoutDiagram } from '../layout/layout-diagram';

// ── Short type → bpmn: type mapping ───────────────────────────────────────

const TYPE_MAP: Record<string, string> = {
  startEvent: 'bpmn:StartEvent',
  endEvent: 'bpmn:EndEvent',
  task: 'bpmn:Task',
  userTask: 'bpmn:UserTask',
  serviceTask: 'bpmn:ServiceTask',
  scriptTask: 'bpmn:ScriptTask',
  manualTask: 'bpmn:ManualTask',
  businessRuleTask: 'bpmn:BusinessRuleTask',
  sendTask: 'bpmn:SendTask',
  receiveTask: 'bpmn:ReceiveTask',
  callActivity: 'bpmn:CallActivity',
  exclusiveGateway: 'bpmn:ExclusiveGateway',
  parallelGateway: 'bpmn:ParallelGateway',
  inclusiveGateway: 'bpmn:InclusiveGateway',
  eventBasedGateway: 'bpmn:EventBasedGateway',
  intermediateCatchEvent: 'bpmn:IntermediateCatchEvent',
  intermediateThrowEvent: 'bpmn:IntermediateThrowEvent',
  boundaryEvent: 'bpmn:BoundaryEvent',
  subProcess: 'bpmn:SubProcess',
  adHocSubProcess: 'bpmn:AdHocSubProcess',
  eventSubProcess: 'bpmn:SubProcess',
};

/** Resolve a short type name or pass through bpmn:-prefixed types. */
function resolveBpmnType(type: string): string {
  if (type.startsWith('bpmn:')) return type;
  const mapped = TYPE_MAP[type];
  if (!mapped) {
    throw semanticViolationError(
      `Unknown element type "${type}". Use one of: ${Object.keys(TYPE_MAP).join(', ')}`
    );
  }
  return mapped;
}

/** Event definition type short name → qualified type. */
const EVENT_DEF_TYPE_MAP: Record<string, string> = {
  error: 'bpmn:ErrorEventDefinition',
  timer: 'bpmn:TimerEventDefinition',
  message: 'bpmn:MessageEventDefinition',
  signal: 'bpmn:SignalEventDefinition',
  conditional: 'bpmn:ConditionalEventDefinition',
  terminate: 'bpmn:TerminateEventDefinition',
  escalation: 'bpmn:EscalationEventDefinition',
  link: 'bpmn:LinkEventDefinition',
};

function resolveEventDefType(type: string): string {
  if (type.startsWith('bpmn:')) return type;
  return EVENT_DEF_TYPE_MAP[type] || `bpmn:${type.charAt(0).toUpperCase() + type.slice(1)}EventDefinition`;
}

interface AutoIdState {
  value: number;
}

// ── Input types ────────────────────────────────────────────────────────────

export interface ProcessElement {
  id?: string;
  type: string;
  name?: string;
  documentation?: string;
  after?: string;
  attachedTo?: string;
  cancelActivity?: boolean;
  eventDefinition?: {
    type: string;
    properties?: Record<string, string>;
    errorRef?: { id: string; name?: string; errorCode?: string };
    messageRef?: { id: string; name?: string };
    signalRef?: { id: string; name?: string };
    escalationRef?: { id: string; name?: string; escalationCode?: string };
  };
  lane?: string;
  children?: ProcessElement[];
  connections?: ProcessConnection[];
}

export interface ProcessConnection {
  from: string;
  to: string;
  label?: string;
  condition?: string;
  isDefault?: boolean;
}

export interface ProcessLane {
  name: string;
  id?: string;
}

export interface ProcessParticipant {
  name: string;
  id?: string;
  collapsed?: boolean;
  lanes?: ProcessLane[];
}

export interface GenerateFromStructureArgs {
  name: string;
  elements: ProcessElement[];
  connections?: ProcessConnection[];
  participants?: ProcessParticipant[];
  lanes?: ProcessLane[];
  autoLayout?: boolean;
}

// ── Topological sort ───────────────────────────────────────────────────────

/**
 * Topological sort of elements based on `after` dependencies.
 * Elements without `after` come first (in original order), then dependents.
 * Boundary events (attachedTo) are sorted after their host.
 */
function topologicalSort(elements: ProcessElement[]): {
  sorted: ProcessElement[];
  cycleIds: string[];
} {
  // Build adjacency: element depends on its `after` or `attachedTo` target
  const byId = new Map<string, ProcessElement>();
  for (const el of elements) {
    if (el.id) byId.set(el.id, el);
  }

  const sorted: ProcessElement[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>(); // cycle detection
  const cycleIds = new Set<string>();

  function visit(el: ProcessElement): void {
    const elId = el.id || '';
    if (visited.has(elId)) return;
    if (visiting.has(elId)) {
      cycleIds.add(elId);
      return;
    }
    visiting.add(elId);

    // Visit dependency first
    const depId = el.attachedTo || el.after;
    if (depId && byId.has(depId)) {
      if (visiting.has(depId)) {
        cycleIds.add(elId);
        cycleIds.add(depId);
      }
      visit(byId.get(depId)!);
    }

    visiting.delete(elId);
    if (!visited.has(elId)) {
      visited.add(elId);
      sorted.push(el);
    }
  }

  for (const el of elements) {
    visit(el);
  }

  return { sorted, cycleIds: [...cycleIds] };
}

function assignGeneratedIds(elements: ProcessElement[], autoIdState: AutoIdState): void {
  for (const el of elements) {
    if (!el.id) {
      el.id = `_gen_${autoIdState.value++}`;
    }
    if (el.children && el.children.length > 0) {
      assignGeneratedIds(el.children, autoIdState);
    }
  }
}

function mapLaneIdsByOrder(
  lanes: ProcessLane[] | undefined,
  laneIds: string[] | undefined,
  laneIdMap: Record<string, string>
): number {
  if (!lanes || !laneIds) return 0;

  let mapped = 0;
  for (let i = 0; i < Math.min(lanes.length, laneIds.length); i++) {
    const lane = lanes[i];
    laneIdMap[lane.id || lane.name] = laneIds[i];
    mapped++;
  }
  return mapped;
}

async function connectionAlreadyExists(
  diagramId: string,
  sourceId: string,
  targetId: string
): Promise<boolean> {
  const diagram = requireDiagram(diagramId);
  const registry = getService(diagram.modeler, 'elementRegistry');
  const sourceEl = registry.get(sourceId);
  if (!sourceEl) return false;

  const existingOutgoing = (sourceEl.outgoing || []) as any[];
  return existingOutgoing.some((conn: any) => conn.target?.id === targetId);
}

async function createImplicitConnections(
  diagramId: string,
  elements: ProcessElement[],
  elementIdMap: Record<string, string>,
  warnings: string[],
  incrementConnectionCount: () => void
): Promise<void> {
  const autoConnections = deduceSequentialConnections(elements);
  const connectedPairs = new Set<string>();

  for (const conn of autoConnections) {
    const pairKey = `${conn.from}→${conn.to}`;
    if (connectedPairs.has(pairKey)) continue;

    const sourceId = elementIdMap[conn.from];
    const targetId = elementIdMap[conn.to];
    if (!sourceId || !targetId) continue;

    if (await connectionAlreadyExists(diagramId, sourceId, targetId)) {
      connectedPairs.add(pairKey);
      continue;
    }

    try {
      await handleConnect({
        diagramId,
        sourceElementId: sourceId,
        targetElementId: targetId,
        label: conn.label,
      });
      incrementConnectionCount();
      connectedPairs.add(pairKey);
    } catch (e: any) {
      warnings.push(`Failed to auto-connect ${conn.from} → ${conn.to}: ${e.message}`);
    }
  }
}

async function createScopedConnections(
  diagramId: string,
  elements: ProcessElement[],
  explicitConnections: ProcessConnection[] | undefined,
  elementIdMap: Record<string, string>,
  warnings: string[],
  errors: string[],
  incrementConnectionCount: () => void
): Promise<void> {
  const autoConnections = deduceSequentialConnections(elements);
  const explicitPairs = new Set<string>();
  if (explicitConnections) {
    for (const conn of explicitConnections) {
      explicitPairs.add(`${conn.from}→${conn.to}`);
    }
  }

  const connectedPairs = new Set<string>();

  for (const conn of autoConnections) {
    const pairKey = `${conn.from}→${conn.to}`;
    if (explicitPairs.has(pairKey) || connectedPairs.has(pairKey)) continue;

    const sourceId = elementIdMap[conn.from];
    const targetId = elementIdMap[conn.to];
    if (!sourceId || !targetId) continue;

    if (await connectionAlreadyExists(diagramId, sourceId, targetId)) {
      connectedPairs.add(pairKey);
      continue;
    }

    try {
      await handleConnect({
        diagramId,
        sourceElementId: sourceId,
        targetElementId: targetId,
        label: conn.label,
      });
      incrementConnectionCount();
      connectedPairs.add(pairKey);
    } catch (e: any) {
      warnings.push(`Failed to auto-connect ${conn.from} → ${conn.to}: ${e.message}`);
    }
  }

  if (!explicitConnections) {
    return;
  }

  for (const conn of explicitConnections) {
    const pairKey = `${conn.from}→${conn.to}`;
    if (connectedPairs.has(pairKey)) {
      if (conn.condition || conn.isDefault || conn.label) {
        const sourceId = elementIdMap[conn.from];
        const targetId = elementIdMap[conn.to];
        if (sourceId && targetId) {
          try {
            const diagram = requireDiagram(diagramId);
            const registry = getService(diagram.modeler, 'elementRegistry');
            const sourceEl = registry.get(sourceId);
            const existingConn = (sourceEl?.outgoing || []).find(
              (connection: any) => connection.target?.id === targetId
            );
            if (existingConn) {
              const props: Record<string, any> = {};
              if (conn.label) props.name = conn.label;
              if (conn.condition) props.conditionExpression = conn.condition;
              await handleSetProperties({
                diagramId,
                elementId: existingConn.id,
                properties: props,
              });
              if (conn.isDefault) {
                await handleSetProperties({
                  diagramId,
                  elementId: sourceId,
                  properties: { default: existingConn.id },
                });
              }
            }
          } catch (e: any) {
            warnings.push(
              `Failed to update connection properties ${conn.from} → ${conn.to}: ${e.message}`
            );
          }
        }
      }
      continue;
    }

    const sourceId = elementIdMap[conn.from];
    const targetId = elementIdMap[conn.to];
    if (!sourceId || !targetId) {
      errors.push(
        `Connection ${conn.from} → ${conn.to}: ` +
          `${!sourceId ? `source "${conn.from}" not found` : ''}` +
          `${!sourceId && !targetId ? ', ' : ''}` +
          `${!targetId ? `target "${conn.to}" not found` : ''}`
      );
      continue;
    }

    try {
      const connectResult = parseResultText(
        await handleConnect({
          diagramId,
          sourceElementId: sourceId,
          targetElementId: targetId,
          label: conn.label,
          conditionExpression: conn.condition,
        })
      );
      incrementConnectionCount();
      connectedPairs.add(pairKey);

      if (conn.isDefault && connectResult.connectionId) {
        try {
          await handleSetProperties({
            diagramId,
            elementId: sourceId,
            properties: { default: connectResult.connectionId },
          });
        } catch (e: any) {
          warnings.push(`Failed to set default flow on ${conn.from}: ${e.message}`);
        }
      }
    } catch (e: any) {
      errors.push(`Failed to connect ${conn.from} → ${conn.to}: ${e.message}`);
    }
  }
}

// ── Connection deduction ───────────────────────────────────────────────────

/**
 * Deduce implicit sequential connections from element ordering.
 * Elements with explicit `after` connect from their `after` target.
 * Elements without `after` connect from the previous element in the array
 * (unless they are boundary events or the first element).
 *
 * Returns only auto-deduced connections; explicit connections are separate.
 */
function deduceSequentialConnections(elements: ProcessElement[]): ProcessConnection[] {
  const connections: ProcessConnection[] = [];
  const explicitlyConnected = new Set<string>(); // elements that have explicit `after`

  for (const el of elements) {
    if (el.attachedTo) continue; // boundary events connect differently
    if (el.after) {
      explicitlyConnected.add(el.id || '');
    }
  }

  // Walk elements in order, connect sequentially (unless explicit `after` or boundary)
  for (let i = 1; i < elements.length; i++) {
    const el = elements[i];
    const prev = elements[i - 1];

    // Skip boundary events — they don't get sequential connections
    if (el.attachedTo) continue;

    // If element has explicit `after`, connect from that instead of previous
    if (el.after) {
      connections.push({ from: el.after, to: el.id! });
      continue;
    }

    // Skip if previous is a boundary event — use the non-boundary element before it
    let source = prev;
    let sourceIdx = i - 1;
    while (source.attachedTo && sourceIdx > 0) {
      sourceIdx--;
      source = elements[sourceIdx];
    }
    if (source.attachedTo) continue; // all preceding elements are boundaries

    if (source.id && el.id) {
      connections.push({ from: source.id, to: el.id });
    }
  }

  return connections;
}

// ── Main handler ───────────────────────────────────────────────────────────

function parseResultText(result: ToolResult): any {
  return JSON.parse(result.content[0].text!);
}

// eslint-disable-next-line complexity, max-lines-per-function
export async function handleGenerateFromStructure(
  args: GenerateFromStructureArgs,
  context?: ToolContext
): Promise<ToolResult> {
  validateArgs(args, ['name', 'elements']);

  if (!Array.isArray(args.elements) || args.elements.length === 0) {
    throw missingRequiredError(['elements']);
  }

  // Assign IDs to elements that don't have them
  const autoIdState: AutoIdState = { value: 0 };
  assignGeneratedIds(args.elements, autoIdState);

  // Flatten children into main elements list (for sub-process support later)
  // For now, children are handled by creating elements inside the sub-process

  const errors: string[] = [];
  const warnings: string[] = [];
  const elementIdMap: Record<string, string> = {};
  let diagramId: string;
  let elementsCreated = 0;
  let connectionsCreated = 0;
  let lanesCreated = 0;

  // Suppress lint feedback during multi-step construction
  setBatchMode(true);

  try {
    // ── Step 1: Create the diagram ──────────────────────────────────────
    context?.sendProgress?.(0, undefined, 'Creating diagram...');
    const createResult = parseResultText(
      await handleCreateDiagram({ name: args.name })
    );
    diagramId = createResult.diagramId;

    // ── Step 2: Create participant + lanes if specified ──────────────────
    let participantId: string | undefined;
    const laneIdMap: Record<string, string> = {};

    const hasLanes = (args.lanes && args.lanes.length > 0) ||
      (args.participants && args.participants.length > 0);

    if (args.lanes && args.lanes.length > 0) {
      context?.sendProgress?.(1, undefined, 'Creating participant and lanes...');

      const laneSpecs = args.lanes.map(l => ({ name: l.name }));
      const participantResult = parseResultText(
        await handleCreateParticipant({
          diagramId,
          name: args.name,
          lanes: laneSpecs.length >= 2 ? laneSpecs : undefined,
        })
      );
      participantId = participantResult.participantId;
      lanesCreated += mapLaneIdsByOrder(args.lanes, participantResult.laneIds, laneIdMap);

      // If fewer than 2 lanes were given to createParticipant, handle separately
      if (laneSpecs.length === 1) {
        // Single lane — can't create via createParticipant, need a different approach
        // Just track the participant, elements will be placed there
        warnings.push('Only one lane specified — minimum 2 lanes required for lane creation. Elements will be placed directly in the pool.');
      }
    } else if (args.participants && args.participants.length > 0) {
      context?.sendProgress?.(1, undefined, 'Creating participants...');

      if (args.participants.length >= 2) {
        // Multi-pool collaboration
        const participantSpecs = args.participants.map(p => ({
          name: p.name,
          participantId: p.id,
          collapsed: p.collapsed,
          lanes: p.lanes && p.lanes.length >= 2
            ? p.lanes.map(l => ({ name: l.name }))
            : undefined,
        }));
        const collabResult = parseResultText(
          await handleCreateParticipant({
            diagramId,
            participants: participantSpecs,
          })
        );
        if (collabResult.participantIds) {
          for (let index = 0; index < args.participants.length; index++) {
            const inputParticipant = args.participants[index];
            const createdParticipantId = collabResult.participantIds[index];
            if (!createdParticipantId) continue;

            elementIdMap[inputParticipant.id || inputParticipant.name] = createdParticipantId;
            lanesCreated += mapLaneIdsByOrder(
              inputParticipant.lanes,
              collabResult.lanesCreated?.[createdParticipantId],
              laneIdMap
            );
          }
          const firstExpandedIndex = args.participants.findIndex(p => p.collapsed !== true);
          const selectedIndex = firstExpandedIndex >= 0 ? firstExpandedIndex : 0;
          participantId = collabResult.participantIds[selectedIndex];
        }
      } else {
        // Single participant
        const p = args.participants[0];
        const laneSpecs = p.lanes && p.lanes.length >= 2
          ? p.lanes.map(l => ({ name: l.name }))
          : undefined;
        const pResult = parseResultText(
          await handleCreateParticipant({
            diagramId,
            name: p.name,
            participantId: p.id,
            collapsed: p.collapsed,
            lanes: laneSpecs,
          })
        );
        participantId = pResult.participantId;
        elementIdMap[p.id || p.name] = pResult.participantId;
        lanesCreated += mapLaneIdsByOrder(p.lanes, pResult.laneIds, laneIdMap);
      }
    }

    // ── Step 3: Topological sort of elements ────────────────────────────
    const { sorted: sortedElements, cycleIds } = topologicalSort(args.elements);
    if (cycleIds.length > 0) {
      errors.push(
        `Cyclic element dependencies detected in after/attachedTo references: ${cycleIds.join(', ')}`
      );
    }

    // ── Step 4: Create elements ─────────────────────────────────────────
    context?.sendProgress?.(2, undefined, 'Creating elements...');

    const createElementsRecursively = async (
      elements: ProcessElement[],
      options: { participantId?: string; parentId?: string; scopeLabel?: string }
    ): Promise<void> => {
      const { sorted, cycleIds: nestedCycleIds } = topologicalSort(elements);
      if (nestedCycleIds.length > 0) {
        errors.push(
          `Cyclic element dependencies detected${options.scopeLabel ? ` in ${options.scopeLabel}` : ''}: ${nestedCycleIds.join(', ')}`
        );
      }

      for (const el of sorted) {
        const bpmnType = resolveBpmnType(el.type);

        try {
          const addArgs: AddElementArgs = {
            diagramId,
            elementType: bpmnType,
            name: el.name,
          };

          if (options.parentId) {
            addArgs.parentId = options.parentId;
          } else if (options.participantId && !el.attachedTo) {
            addArgs.participantId = options.participantId;
          }

          if (el.lane) {
            addArgs.laneId = laneIdMap[el.lane] || el.lane;
          }

          if (el.attachedTo) {
            addArgs.hostElementId = elementIdMap[el.attachedTo] || el.attachedTo;
            if (el.cancelActivity === false) {
              addArgs.cancelActivity = false;
            }
          }

          if (el.eventDefinition) {
            addArgs.eventDefinitionType = resolveEventDefType(el.eventDefinition.type);
            if (el.eventDefinition.errorRef) addArgs.errorRef = el.eventDefinition.errorRef;
            if (el.eventDefinition.messageRef) addArgs.messageRef = el.eventDefinition.messageRef;
            if (el.eventDefinition.signalRef) addArgs.signalRef = el.eventDefinition.signalRef;
            if (el.eventDefinition.escalationRef) addArgs.escalationRef = el.eventDefinition.escalationRef;
            if (el.eventDefinition.properties) {
              addArgs.eventDefinitionProperties = el.eventDefinition.properties;
            }
          }

          if (bpmnType.includes('SubProcess')) {
            addArgs.isExpanded = true;
          }

          if (el.after && !el.attachedTo && elementIdMap[el.after]) {
            addArgs.afterElementId = elementIdMap[el.after];
          }

          const addResult = parseResultText(await handleAddElement(addArgs));
          const createdId = addResult.elementId;
          elementIdMap[el.id!] = createdId;
          elementsCreated++;

          if (el.documentation) {
            try {
              await handleSetProperties({
                diagramId,
                elementId: createdId,
                properties: { documentation: el.documentation },
              });
            } catch (e: any) {
              warnings.push(`Failed to set documentation on ${el.id}: ${e.message}`);
            }
          }

          if (el.type === 'eventSubProcess') {
            try {
              await handleSetProperties({
                diagramId,
                elementId: createdId,
                properties: { triggeredByEvent: true },
              });
            } catch (e: any) {
              warnings.push(`Failed to set triggeredByEvent on ${el.id}: ${e.message}`);
            }
          }

          if (el.children && el.children.length > 0 && bpmnType.includes('SubProcess')) {
            await createElementsRecursively(el.children, {
              parentId: createdId,
              scopeLabel: `sub-process ${el.id}`,
            });
            await createScopedConnections(
              diagramId,
              el.children,
              el.connections,
              elementIdMap,
              warnings,
              errors,
              () => {
                connectionsCreated++;
              }
            );
          }
        } catch (e: any) {
          errors.push(`Failed to create element ${el.id} (${el.type}): ${e.message}`);
        }
      }
    };

    await createElementsRecursively(sortedElements, { participantId });

    // ── Step 5: Create connections ──────────────────────────────────────
    context?.sendProgress?.(3, undefined, 'Creating connections...');

    await createScopedConnections(
      diagramId,
      args.elements,
      args.connections,
      elementIdMap,
      warnings,
      errors,
      () => {
        connectionsCreated++;
      }
    );

    // ── Step 6: Assign elements to lanes ────────────────────────────────
    if (hasLanes) {
      context?.sendProgress?.(4, undefined, 'Assigning elements to lanes...');

      // Group elements by lane
      const laneAssignments = new Map<string, string[]>();
      for (const el of args.elements) {
        if (!el.lane) continue;
        const resolvedLaneId = laneIdMap[el.lane] || el.lane;
        const resolvedElementId = elementIdMap[el.id!];
        if (!resolvedElementId) continue;
        if (!laneAssignments.has(resolvedLaneId)) {
          laneAssignments.set(resolvedLaneId, []);
        }
        laneAssignments.get(resolvedLaneId)!.push(resolvedElementId);
      }

      for (const [laneId, elementIds] of laneAssignments) {
        try {
          await handleAssignElementsToLane({
            diagramId,
            laneId,
            elementIds,
          });
        } catch (e: any) {
          warnings.push(`Failed to assign elements to lane ${laneId}: ${e.message}`);
        }
      }
    }

    // ── Step 7: Auto-layout ─────────────────────────────────────────────
    if (args.autoLayout !== false) {
      context?.sendProgress?.(5, undefined, 'Laying out diagram...');
      try {
        await handleLayoutDiagram({ diagramId });
      } catch (e: any) {
        warnings.push(`Layout failed: ${e.message}`);
      }
    }
  } finally {
    setBatchMode(false);
  }

  // ── Build result ────────────────────────────────────────────────────
  const diagram = requireDiagram(diagramId!);

  const resultData: Record<string, any> = {
    success: errors.length === 0,
    diagramId: diagramId!,
    elementIdMap,
    summary: {
      elementsCreated,
      connectionsCreated,
      lanesCreated,
      errors,
    },
    message:
      errors.length === 0
        ? `Created "${args.name}" with ${elementsCreated} elements and ${connectionsCreated} connections`
        : `Partially created "${args.name}": ${elementsCreated} elements, ${connectionsCreated} connections, ${errors.length} error(s)`,
  };

  if (warnings.length > 0) {
    resultData.warnings = warnings;
  }

  const result = jsonResult(resultData);
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'generate_bpmn_from_structure',
  description:
    'Create a complete BPMN diagram from a structured JSON description in a single call. ' +
    'Accepts elements, connections, lanes, and participants — internally orchestrates ' +
    'element creation, connection routing, lane assignment, and layout. ' +
    'Elements connect sequentially by default (each to the previous); use "after" to override or "connections" for non-sequential flows. ' +
    'Returns the diagram ID and a mapping of input element IDs to actual BPMN element IDs.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Process name',
      },
      elements: {
        type: 'array',
        description: 'Ordered list of process elements to create',
        items: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description:
                'Unique ID for referencing in connections. Auto-generated if omitted.',
            },
            type: {
              type: 'string',
              description:
                'BPMN element type. Short form (startEvent, userTask, serviceTask, exclusiveGateway, etc.) ' +
                'or qualified (bpmn:StartEvent, bpmn:UserTask, etc.).',
              enum: [
                'startEvent', 'endEvent', 'userTask', 'serviceTask', 'scriptTask',
                'businessRuleTask', 'sendTask', 'receiveTask', 'callActivity',
                'exclusiveGateway', 'parallelGateway', 'inclusiveGateway',
                'intermediateCatchEvent', 'intermediateThrowEvent',
                'boundaryEvent', 'subProcess', 'adHocSubProcess', 'eventSubProcess',
              ],
            },
            name: { type: 'string', description: 'Element name/label' },
            documentation: { type: 'string', description: 'Documentation text' },
            after: {
              type: 'string',
              description:
                'ID of the element this connects FROM. If omitted, connects from the previous element in the array.',
            },
            attachedTo: {
              type: 'string',
              description: 'For boundary events: the host element ID',
            },
            cancelActivity: {
              type: 'boolean',
              description: 'For boundary events: interrupting (true) or non-interrupting (false)',
            },
            eventDefinition: {
              type: 'object',
              description: 'Event definition (for events)',
              properties: {
                type: {
                  type: 'string',
                  description: 'Event type: error, timer, message, signal, conditional, terminate, escalation',
                },
                properties: {
                  type: 'object',
                  description: 'Event-specific properties (e.g. { timeDuration: "PT1H" })',
                  additionalProperties: { type: 'string' },
                },
                errorRef: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    errorCode: { type: 'string' },
                  },
                  required: ['id'],
                },
                messageRef: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                  },
                  required: ['id'],
                },
              },
              required: ['type'],
            },
            lane: { type: 'string', description: 'Lane ID or name to place element in' },
            children: {
              type: 'array',
              description: 'Child elements for expanded sub-processes',
              items: { type: 'object' },
            },
            connections: {
              type: 'array',
              description:
                'For subProcess or eventSubProcess: explicit internal connections between child elements. ' +
                'Uses the same shape as top-level connections and is applied after all children are created.',
              items: {
                type: 'object',
                properties: {
                  from: { type: 'string', description: 'Source child element ID' },
                  to: { type: 'string', description: 'Target child element ID' },
                  label: { type: 'string', description: 'Connection label' },
                  condition: {
                    type: 'string',
                    description: 'Condition expression for gateway outgoing flows',
                  },
                  isDefault: {
                    type: 'boolean',
                    description: 'Is this the default flow from a gateway?',
                  },
                },
                required: ['from', 'to'],
              },
            },
          },
          required: ['type'],
        },
      },
      connections: {
        type: 'array',
        description:
          'Explicit connections between elements (for non-sequential flows, conditions, default flows). ' +
          'Sequential connections are auto-deduced from element order.',
        items: {
          type: 'object',
          properties: {
            from: { type: 'string', description: 'Source element ID' },
            to: { type: 'string', description: 'Target element ID' },
            label: { type: 'string', description: 'Connection label' },
            condition: {
              type: 'string',
              description: 'Condition expression for gateway outgoing flows',
            },
            isDefault: {
              type: 'boolean',
              description: 'Is this the default flow from a gateway?',
            },
          },
          required: ['from', 'to'],
        },
      },
      participants: {
        type: 'array',
        description: 'Participant pools for collaboration diagrams',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            id: { type: 'string' },
            collapsed: { type: 'boolean' },
            lanes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  id: { type: 'string' },
                },
                required: ['name'],
              },
            },
          },
          required: ['name'],
        },
      },
      lanes: {
        type: 'array',
        description: 'Lanes within the main pool (shorthand for single-pool with lanes)',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Lane name' },
            id: { type: 'string', description: 'Lane ID for referencing in elements' },
          },
          required: ['name'],
        },
      },
      autoLayout: {
        type: 'boolean',
        description: 'Whether to auto-layout after creation. Default: true',
      },
    },
    required: ['name', 'elements'],
  },
} as const;
