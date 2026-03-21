/**
 * Handler for generate_bpmn_from_structure tool.
 *
 * Accepts a structured JSON description of a BPMN process and creates the
 * full diagram in a single tool call, orchestrating existing handlers internally.
 */
// @mutating

import { type ToolResult, type ToolContext } from '../../types';
import { missingRequiredError, semanticViolationError } from '../../errors';
import { validateArgs, jsonResult, requireDiagram, getService, syncXml } from '../helpers';
import { appendLintFeedback, setBatchMode } from '../../linter';
import { handleCreateDiagram } from './create-diagram';
import { handleAddElement, type AddElementArgs } from '../elements/add-element';
import { handleConnect } from '../elements/connect';
import { handleSetEventDefinition } from '../properties/set-event-definition';
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
function topologicalSort(elements: ProcessElement[]): ProcessElement[] {
  // Build adjacency: element depends on its `after` or `attachedTo` target
  const byId = new Map<string, ProcessElement>();
  for (const el of elements) {
    if (el.id) byId.set(el.id, el);
  }

  const sorted: ProcessElement[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>(); // cycle detection

  function visit(el: ProcessElement): void {
    const elId = el.id || '';
    if (visited.has(elId)) return;
    if (visiting.has(elId)) {
      // Cycle — just add it, don't loop forever
      sorted.push(el);
      visited.add(elId);
      return;
    }
    visiting.add(elId);

    // Visit dependency first
    const depId = el.attachedTo || el.after;
    if (depId && byId.has(depId)) {
      visit(byId.get(depId)!);
    }

    visiting.delete(elId);
    visited.add(elId);
    sorted.push(el);
  }

  for (const el of elements) {
    visit(el);
  }

  return sorted;
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
  let autoIdCounter = 0;
  for (const el of args.elements) {
    if (!el.id) {
      el.id = `_gen_${autoIdCounter++}`;
    }
  }

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
          wrapExisting: true,
          lanes: laneSpecs.length >= 2 ? laneSpecs : undefined,
        })
      );
      participantId = participantResult.participantId;

      // Map lane names to actual IDs
      if (participantResult.lanes) {
        for (const lane of participantResult.lanes) {
          // Find matching input lane by name
          const inputLane = args.lanes.find(l => l.name === lane.name);
          if (inputLane) {
            laneIdMap[inputLane.id || inputLane.name] = lane.laneId;
            lanesCreated++;
          }
        }
      }

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
        if (collabResult.participants) {
          for (const p of collabResult.participants) {
            const inputP = args.participants.find(ip => ip.name === p.name);
            if (inputP) {
              elementIdMap[inputP.id || inputP.name] = p.participantId;
              // Map lanes if any
              if (p.lanes && inputP.lanes) {
                for (const lane of p.lanes) {
                  const inputLane = inputP.lanes.find(l => l.name === lane.name);
                  if (inputLane) {
                    laneIdMap[inputLane.id || inputLane.name] = lane.laneId;
                    lanesCreated++;
                  }
                }
              }
            }
          }
          participantId = collabResult.participants[0]?.participantId;
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
            wrapExisting: true,
            lanes: laneSpecs,
          })
        );
        participantId = pResult.participantId;
        elementIdMap[p.id || p.name] = pResult.participantId;

        if (pResult.lanes && p.lanes) {
          for (const lane of pResult.lanes) {
            const inputLane = p.lanes.find(l => l.name === lane.name);
            if (inputLane) {
              laneIdMap[inputLane.id || inputLane.name] = lane.laneId;
              lanesCreated++;
            }
          }
        }
      }
    }

    // ── Step 3: Topological sort of elements ────────────────────────────
    const sortedElements = topologicalSort(args.elements);

    // ── Step 4: Create elements ─────────────────────────────────────────
    context?.sendProgress?.(2, undefined, 'Creating elements...');

    // Track which elements we've created to determine `afterElementId`
    const createdIds = new Set<string>();

    for (let i = 0; i < sortedElements.length; i++) {
      const el = sortedElements[i];
      const bpmnType = resolveBpmnType(el.type);

      try {
        const addArgs: AddElementArgs = {
          diagramId,
          elementType: bpmnType,
          name: el.name,
          ...(participantId && !el.attachedTo ? { participantId } : {}),
        };

        // Resolve lane assignment
        if (el.lane) {
          const resolvedLaneId = laneIdMap[el.lane] || el.lane;
          addArgs.laneId = resolvedLaneId;
        }

        // Boundary event attachment
        if (el.attachedTo) {
          const hostId = elementIdMap[el.attachedTo] || el.attachedTo;
          addArgs.hostElementId = hostId;
          if (el.cancelActivity === false) {
            addArgs.cancelActivity = false;
          }
        }

        // Event definition shorthand
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

        // Sub-process expansion & event sub-process flag
        if (bpmnType === 'bpmn:SubProcess') {
          addArgs.isExpanded = true;
          if (el.type === 'eventSubProcess') {
            // Mark as event sub-process via triggeredByEvent
            // We'll set this after creation via setProperties
          }
        }

        // Auto-connect to after element if it's already created
        if (el.after && !el.attachedTo) {
          const afterId = elementIdMap[el.after] || el.after;
          if (createdIds.has(el.after)) {
            addArgs.afterElementId = afterId;
          }
        }

        const addResult = parseResultText(await handleAddElement(addArgs));
        const createdId = addResult.elementId;
        elementIdMap[el.id!] = createdId;
        createdIds.add(el.id!);
        elementsCreated++;

        // Set documentation if provided
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

        // Set triggeredByEvent for eventSubProcess
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

        // Set event definition if not handled by shorthand and properties exist
        if (el.eventDefinition && el.eventDefinition.properties && !addArgs.eventDefinitionType) {
          try {
            await handleSetEventDefinition({
              diagramId,
              elementId: createdId,
              eventDefinitionType: resolveEventDefType(el.eventDefinition.type),
              properties: el.eventDefinition.properties,
              errorRef: el.eventDefinition.errorRef,
              messageRef: el.eventDefinition.messageRef,
              signalRef: el.eventDefinition.signalRef,
              escalationRef: el.eventDefinition.escalationRef,
            });
          } catch (e: any) {
            warnings.push(`Failed to set event definition on ${el.id}: ${e.message}`);
          }
        }

        // Handle children for sub-processes (recursive element creation)
        if (el.children && el.children.length > 0 && bpmnType === 'bpmn:SubProcess') {
          for (const child of el.children) {
            if (!child.id) child.id = `_gen_${autoIdCounter++}`;
            try {
              const childBpmnType = resolveBpmnType(child.type);
              const childAddArgs: AddElementArgs = {
                diagramId,
                elementType: childBpmnType,
                name: child.name,
                parentId: createdId,
              };
              const childResult = parseResultText(await handleAddElement(childAddArgs));
              elementIdMap[child.id] = childResult.elementId;
              createdIds.add(child.id);
              elementsCreated++;
            } catch (e: any) {
              errors.push(`Failed to create child element ${child.id} in sub-process ${el.id}: ${e.message}`);
            }
          }
        }
      } catch (e: any) {
        errors.push(`Failed to create element ${el.id} (${el.type}): ${e.message}`);
      }
    }

    // ── Step 5: Create connections ──────────────────────────────────────
    context?.sendProgress?.(3, undefined, 'Creating connections...');

    // Deduce sequential connections from element order
    const autoConnections = deduceSequentialConnections(args.elements);

    // Build a set of explicitly connected pairs to avoid duplicates
    const explicitPairs = new Set<string>();
    if (args.connections) {
      for (const conn of args.connections) {
        explicitPairs.add(`${conn.from}→${conn.to}`);
      }
    }

    // Also track all connected pairs to avoid creating afterElementId connections
    // that were already established during element creation
    const connectedPairs = new Set<string>();

    // Process deduced sequential connections (skip if explicit connection exists)
    for (const conn of autoConnections) {
      const pairKey = `${conn.from}→${conn.to}`;
      if (explicitPairs.has(pairKey)) continue;
      if (connectedPairs.has(pairKey)) continue;

      const sourceId = elementIdMap[conn.from];
      const targetId = elementIdMap[conn.to];
      if (!sourceId || !targetId) continue;

      // Check if this connection was already auto-created by afterElementId
      const diagram = requireDiagram(diagramId);
      const registry = getService(diagram.modeler, 'elementRegistry');
      const sourceEl = registry.get(sourceId);
      if (sourceEl) {
        const existingOutgoing = (sourceEl.outgoing || []) as any[];
        const alreadyConnected = existingOutgoing.some(
          (c: any) => c.target?.id === targetId
        );
        if (alreadyConnected) {
          connectedPairs.add(pairKey);
          continue;
        }
      }

      try {
        await handleConnect({
          diagramId,
          sourceElementId: sourceId,
          targetElementId: targetId,
          label: conn.label,
        });
        connectionsCreated++;
        connectedPairs.add(pairKey);
      } catch (e: any) {
        warnings.push(`Failed to auto-connect ${conn.from} → ${conn.to}: ${e.message}`);
      }
    }

    // Process explicit connections
    if (args.connections) {
      for (const conn of args.connections) {
        const pairKey = `${conn.from}→${conn.to}`;
        if (connectedPairs.has(pairKey)) {
          // Connection already exists — apply properties to it if needed
          if (conn.condition || conn.isDefault || conn.label) {
            const sourceId = elementIdMap[conn.from];
            const targetId = elementIdMap[conn.to];
            if (sourceId && targetId) {
              try {
                const diagram = requireDiagram(diagramId);
                const registry = getService(diagram.modeler, 'elementRegistry');
                const sourceEl = registry.get(sourceId);
                const existingConn = (sourceEl?.outgoing || []).find(
                  (c: any) => c.target?.id === targetId
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
                    // Set as default flow on the source gateway
                    await handleSetProperties({
                      diagramId,
                      elementId: sourceId,
                      properties: { default: existingConn.id },
                    });
                  }
                }
              } catch (e: any) {
                warnings.push(`Failed to update connection properties ${conn.from} → ${conn.to}: ${e.message}`);
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
          connectionsCreated++;
          connectedPairs.add(pairKey);

          // Set default flow after connection is created
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
                'boundaryEvent', 'subProcess', 'eventSubProcess',
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
