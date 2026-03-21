/**
 * Handler for get_element_properties tool.
 *
 * Returns standard BPMN attributes, Zeebe extension properties,
 * extension elements (I/O mapping, form definition), connections, and
 * event definitions for a given element.
 */
// @readonly

import { type ToolResult } from '../../types';
import { requireDiagram, requireElement, jsonResult, getService } from '../helpers';

export interface GetPropertiesArgs {
  diagramId: string;
  elementId: string;
}

// ── Sub-function: Zeebe extension attributes ───────────────────────────────

function serializeZeebeAttrs(bo: any): Record<string, any> | undefined {
  const zeebeAttrs: Record<string, any> = {};
  // From $attrs (explicit namespace prefixed attributes)
  if (bo.$attrs) {
    for (const [key, value] of Object.entries(bo.$attrs)) {
      if (key.startsWith('zeebe:')) {
        zeebeAttrs[key] = value;
      }
    }
  }
  return Object.keys(zeebeAttrs).length > 0 ? zeebeAttrs : undefined;
}

// ── Sub-function: zeebe:IoMapping serialisation ────────────────────────────

function serializeIoMapping(ext: any): Record<string, any> {
  const io: any = { type: 'zeebe:IoMapping' };
  if (ext.inputParameters) {
    io.inputParameters = ext.inputParameters.map((p: any) => ({
      source: p.source,
      target: p.target,
    }));
  }
  if (ext.outputParameters) {
    io.outputParameters = ext.outputParameters.map((p: any) => ({
      source: p.source,
      target: p.target,
    }));
  }
  return io;
}

// ── Sub-function: zeebe:TaskDefinition serialisation ───────────────────────

function serializeTaskDefinition(ext: any): Record<string, any> {
  const result: Record<string, any> = { type: 'zeebe:TaskDefinition' };
  if (ext.type) result.workerType = ext.type;
  if (ext.retries) result.retries = ext.retries;
  return result;
}

// ── Sub-function: zeebe:AssignmentDefinition serialisation ─────────────────

function serializeAssignmentDefinition(ext: any): Record<string, any> {
  const result: Record<string, any> = { type: 'zeebe:AssignmentDefinition' };
  if (ext.assignee) result.assignee = ext.assignee;
  if (ext.candidateGroups) result.candidateGroups = ext.candidateGroups;
  if (ext.candidateUsers) result.candidateUsers = ext.candidateUsers;
  return result;
}

// ── Sub-function: zeebe:FormDefinition serialisation ───────────────────────

function serializeFormDefinition(ext: any): Record<string, any> {
  const result: Record<string, any> = { type: 'zeebe:FormDefinition' };
  if (ext.formId) result.formId = ext.formId;
  if (ext.formKey) result.formKey = ext.formKey;
  return result;
}

// ── Sub-function: zeebe:CalledDecision serialisation ───────────────────────

function serializeCalledDecision(ext: any): Record<string, any> {
  const result: Record<string, any> = { type: 'zeebe:CalledDecision' };
  if (ext.decisionId) result.decisionId = ext.decisionId;
  if (ext.resultVariable) result.resultVariable = ext.resultVariable;
  return result;
}

// ── Sub-function: zeebe:CalledElement serialisation ────────────────────────

function serializeCalledElement(ext: any): Record<string, any> {
  const result: Record<string, any> = { type: 'zeebe:CalledElement' };
  if (ext.processId) result.processId = ext.processId;
  if (ext.propagateAllChildVariables != null) result.propagateAllChildVariables = ext.propagateAllChildVariables;
  return result;
}

// ── Sub-function: zeebe:Script serialisation ───────────────────────────────

function serializeZeebeScript(ext: any): Record<string, any> {
  const result: Record<string, any> = { type: 'zeebe:Script' };
  if (ext.expression) result.expression = ext.expression;
  if (ext.resultVariable) result.resultVariable = ext.resultVariable;
  return result;
}

// ── Sub-function: zeebe:Properties serialisation ───────────────────────────

function serializeZeebeProperties(ext: any): Record<string, any> {
  const result: Record<string, any> = { type: 'zeebe:Properties' };
  if (ext.properties?.length) {
    result.properties = ext.properties.reduce((acc: Record<string, string>, p: any) => {
      acc[p.name] = p.value;
      return acc;
    }, {});
  }
  return result;
}

// ── Sub-function: zeebe:UserTaskForm serialisation ─────────────────────────

function serializeUserTaskForm(ext: any): Record<string, any> {
  const result: Record<string, any> = { type: 'zeebe:UserTaskForm' };
  if (ext.body) result.body = ext.body;
  return result;
}

// ── Sub-function: zeebe:ExecutionListeners serialisation ───────────────────

function serializeExecutionListeners(ext: any): Record<string, any> {
  const result: Record<string, any> = { type: 'zeebe:ExecutionListeners' };
  if (ext.listeners?.length) {
    result.listeners = ext.listeners.map((l: any) => ({
      eventType: l.eventType,
      type: l.type,
      ...(l.retries ? { retries: l.retries } : {}),
    }));
  }
  return result;
}

// ── Sub-function: zeebe:TaskListeners serialisation ────────────────────────

function serializeTaskListeners(ext: any): Record<string, any> {
  const result: Record<string, any> = { type: 'zeebe:TaskListeners' };
  if (ext.listeners?.length) {
    result.listeners = ext.listeners.map((l: any) => ({
      eventType: l.eventType,
      type: l.type,
      ...(l.retries ? { retries: l.retries } : {}),
    }));
  }
  return result;
}

// ── Sub-function: zeebe:LoopCharacteristics serialisation ──────────────────

function serializeZeebeLoopCharacteristics(ext: any): Record<string, any> {
  const result: Record<string, any> = { type: 'zeebe:LoopCharacteristics' };
  if (ext.inputCollection) result.inputCollection = ext.inputCollection;
  if (ext.inputElement) result.inputElement = ext.inputElement;
  if (ext.outputCollection) result.outputCollection = ext.outputCollection;
  if (ext.outputElement) result.outputElement = ext.outputElement;
  return result;
}

// ── Sub-function: all extension elements ───────────────────────────────────

/** Type → serialiser mapping for known extension element types. */
const EXTENSION_SERIALIZERS: Record<string, (ext: any) => Record<string, any>> = {
  'zeebe:IoMapping': serializeIoMapping,
  'zeebe:TaskDefinition': serializeTaskDefinition,
  'zeebe:AssignmentDefinition': serializeAssignmentDefinition,
  'zeebe:FormDefinition': serializeFormDefinition,
  'zeebe:CalledDecision': serializeCalledDecision,
  'zeebe:CalledElement': serializeCalledElement,
  'zeebe:Script': serializeZeebeScript,
  'zeebe:Properties': serializeZeebeProperties,
  'zeebe:UserTaskForm': serializeUserTaskForm,
  'zeebe:ExecutionListeners': serializeExecutionListeners,
  'zeebe:TaskListeners': serializeTaskListeners,
  'zeebe:LoopCharacteristics': serializeZeebeLoopCharacteristics,
};

function serializeExtensionElements(bo: any): any[] | undefined {
  if (!bo.extensionElements?.values) return undefined;

  const extensions: any[] = [];
  for (const ext of bo.extensionElements.values) {
    const serializer = EXTENSION_SERIALIZERS[ext.$type];
    extensions.push(serializer ? serializer(ext) : { type: ext.$type });
  }
  return extensions.length > 0 ? extensions : undefined;
}

// ── Sub-function: connections ──────────────────────────────────────────────

function serializeConnections(element: any): { incoming?: any[]; outgoing?: any[] } {
  const result: { incoming?: any[]; outgoing?: any[] } = {};
  if (element.incoming?.length) {
    result.incoming = element.incoming.map((c: any) => ({
      id: c.id,
      type: c.type,
      sourceId: c.source?.id,
    }));
  }
  if (element.outgoing?.length) {
    result.outgoing = element.outgoing.map((c: any) => ({
      id: c.id,
      type: c.type,
      targetId: c.target?.id,
    }));
  }
  return result;
}

// ── Sub-function: event definitions ────────────────────────────────────────

function serializeEventDefinitions(bo: any): any[] | undefined {
  if (!bo.eventDefinitions?.length) return undefined;
  return bo.eventDefinitions.map((ed: any) => {
    const def: any = { type: ed.$type };
    if (ed.errorRef) {
      def.errorRef = {
        id: ed.errorRef.id,
        name: ed.errorRef.name,
        errorCode: ed.errorRef.errorCode,
      };
      if (ed.errorRef.errorMessage) def.errorRef.errorMessage = ed.errorRef.errorMessage;
    }
    if (ed.messageRef) {
      def.messageRef = { id: ed.messageRef.id, name: ed.messageRef.name };
    }
    if (ed.signalRef) {
      def.signalRef = { id: ed.signalRef.id, name: ed.signalRef.name };
    }
    if (ed.escalationRef) {
      def.escalationRef = {
        id: ed.escalationRef.id,
        name: ed.escalationRef.name,
        escalationCode: ed.escalationRef.escalationCode,
      };
    }
    // Timer properties
    if (ed.timeDuration) def.timeDuration = ed.timeDuration.body;
    if (ed.timeDate) def.timeDate = ed.timeDate.body;
    if (ed.timeCycle) def.timeCycle = ed.timeCycle.body;
    // Conditional properties
    if (ed.condition) def.condition = ed.condition.body;
    // Link properties
    if (ed.name) def.name = ed.name;
    return def;
  });
}

// ── Main handler ───────────────────────────────────────────────────────────

export async function handleGetProperties(args: GetPropertiesArgs): Promise<ToolResult> {
  const { diagramId, elementId } = args;
  const diagram = requireDiagram(diagramId);

  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const element = requireElement(elementRegistry, elementId);
  const bo = element.businessObject;

  const result: Record<string, any> = {
    id: bo.id,
    type: element.type,
    name: bo.name,
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
  };

  // For boundary events, include host element reference and cancelActivity
  if (element.type === 'bpmn:BoundaryEvent') {
    const attachedToRef = bo.attachedToRef as { id?: string } | undefined;
    const hostId = element.host?.id || attachedToRef?.id;
    if (hostId) {
      result.attachedToRef = hostId;
    }
    // cancelActivity: true = interrupting (default), false = non-interrupting
    result.cancelActivity = bo.cancelActivity !== false; // bpmn-js default is true
    if (bo.cancelActivity === false) {
      result.cancelActivity = false;
    }
  }

  const zeebe = serializeZeebeAttrs(bo);
  if (zeebe) result.zeebeProperties = zeebe;

  const extensions = serializeExtensionElements(bo);
  if (extensions) result.extensionElements = extensions;

  const connections = serializeConnections(element);
  if (connections.incoming) result.incoming = connections.incoming;
  if (connections.outgoing) result.outgoing = connections.outgoing;

  const eventDefs = serializeEventDefinitions(bo);
  if (eventDefs) result.eventDefinitions = eventDefs;

  return jsonResult(result);
}

export const TOOL_DEFINITION = {
  name: 'get_bpmn_element_properties',
  description:
    'Get all properties of an element, including standard BPMN attributes and Zeebe extension properties.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      elementId: {
        type: 'string',
        description: 'The ID of the element to inspect',
      },
    },
    required: ['diagramId', 'elementId'],
  },
} as const;
