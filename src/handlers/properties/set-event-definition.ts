/**
 * Handler for set_event_definition tool.
 */
// @mutating

import { type ToolResult } from '../../types';
import { illegalCombinationError, missingRequiredError, typeMismatchError } from '../../errors';
import {
  requireDiagram,
  requireElement,
  jsonResult,
  syncXml,
  resolveOrCreateError,
  resolveOrCreateMessage,
  resolveOrCreateSignal,
  resolveOrCreateEscalation,
  validateArgs,
  getService,
} from '../helpers';
import { appendLintFeedback } from '../../linter';

export interface SetEventDefinitionArgs {
  diagramId: string;
  elementId: string;
  eventDefinitionType: string;
  properties?: Record<string, any>;
  errorRef?: { id: string; name?: string; errorCode?: string; errorMessage?: string };
  messageRef?: { id: string; name?: string };
  signalRef?: { id: string; name?: string };
  escalationRef?: { id: string; name?: string; escalationCode?: string };

}

// ── Type-specific attribute builders ───────────────────────────────────────

/** Build timer attributes (exactly one of timeDuration/timeDate/timeCycle). */
function buildTimerAttrs(moddle: any, defProps: Record<string, any>): Record<string, any> {
  const timerKeys = ['timeDuration', 'timeDate', 'timeCycle'].filter((k) => defProps[k]);
  if (timerKeys.length > 1) {
    throw illegalCombinationError(
      `Timer events accept only one of timeDuration, timeDate, or timeCycle — got: ${timerKeys.join(', ')}`,
      timerKeys
    );
  }
  if (timerKeys.length === 0) {
    throw missingRequiredError(['timeDuration']);
  }
  const attrs: Record<string, any> = {};
  for (const key of timerKeys) {
    attrs[key] = moddle.create('bpmn:FormalExpression', { body: defProps[key] });
  }
  return attrs;
}

/** Resolve root-level definitions element from the diagram. */
function getDefinitions(diagram: ReturnType<typeof requireDiagram>): any {
  const canvas = getService(diagram.modeler, 'canvas');
  return canvas.getRootElement().businessObject.$parent;
}

/** Ref-type → resolver function + arg key mapping. */
const REF_RESOLVERS: Record<
  string,
  { argKey: string; attrKey: string; resolver: (...a: any[]) => any }
> = {
  'bpmn:ErrorEventDefinition': {
    argKey: 'errorRef',
    attrKey: 'errorRef',
    resolver: resolveOrCreateError,
  },
  'bpmn:MessageEventDefinition': {
    argKey: 'messageRef',
    attrKey: 'messageRef',
    resolver: resolveOrCreateMessage,
  },
  'bpmn:SignalEventDefinition': {
    argKey: 'signalRef',
    attrKey: 'signalRef',
    resolver: resolveOrCreateSignal,
  },
  'bpmn:EscalationEventDefinition': {
    argKey: 'escalationRef',
    attrKey: 'escalationRef',
    resolver: resolveOrCreateEscalation,
  },
};



// ── Ref-type validation ────────────────────────────────────────────────────

/** Map each event definition type to its allowed ref key; all others are rejected. */
const ALLOWED_REFS: Record<string, string | undefined> = {
  'bpmn:ErrorEventDefinition': 'errorRef',
  'bpmn:MessageEventDefinition': 'messageRef',
  'bpmn:SignalEventDefinition': 'signalRef',
  'bpmn:EscalationEventDefinition': 'escalationRef',
};

const REF_KEYS = ['errorRef', 'messageRef', 'signalRef', 'escalationRef'] as const;

/** Throw if the caller supplies a ref arg that doesn't match the eventDefinitionType. */
function validateRefArgs(eventDefinitionType: string, args: Record<string, any>): void {
  const allowedRef = ALLOWED_REFS[eventDefinitionType];
  for (const key of REF_KEYS) {
    if (args[key] && key !== allowedRef) {
      const expected = allowedRef
        ? `Only ${allowedRef} is valid for ${eventDefinitionType}.`
        : `${eventDefinitionType} does not accept any ref arguments.`;
      throw illegalCombinationError(
        `Invalid argument "${key}" for ${eventDefinitionType}. ${expected}`,
        [key]
      );
    }
  }
}

/** Build event definition attributes from type-specific properties. */
function buildEventDefAttrs(
  moddle: any,
  eventDefinitionType: string,
  defProps: Record<string, any>
): Record<string, any> {
  if (eventDefinitionType === 'bpmn:TimerEventDefinition') {
    return buildTimerAttrs(moddle, defProps);
  }
  if (eventDefinitionType === 'bpmn:ConditionalEventDefinition' && defProps.condition) {
    return { condition: moddle.create('bpmn:FormalExpression', { body: defProps.condition }) };
  }
  if (eventDefinitionType === 'bpmn:LinkEventDefinition' && defProps.name) {
    return { name: defProps.name };
  }
  return {};
}

// ── Main handler ───────────────────────────────────────────────────────────

export async function handleSetEventDefinition(args: SetEventDefinitionArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementId', 'eventDefinitionType']);
  const {
    diagramId,
    elementId,
    eventDefinitionType,
    properties: defProps = {},
    errorRef,
    messageRef,
    signalRef,
    escalationRef,
  } = args;

  // Validate that ref args match the event definition type
  validateRefArgs(eventDefinitionType, { errorRef, messageRef, signalRef, escalationRef });

  const diagram = requireDiagram(diagramId);

  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const modeling = getService(diagram.modeler, 'modeling');
  const moddle = getService(diagram.modeler, 'moddle');

  const element = requireElement(elementRegistry, elementId);
  const bo = element.businessObject;

  // Verify element is an event type
  if (!bo.$type.includes('Event')) {
    throw typeMismatchError(elementId, bo.$type, [
      'bpmn:StartEvent',
      'bpmn:EndEvent',
      'bpmn:IntermediateCatchEvent',
      'bpmn:IntermediateThrowEvent',
      'bpmn:BoundaryEvent',
    ]);
  }

  // Build event definition attributes based on type
  const eventDefAttrs = buildEventDefAttrs(moddle, eventDefinitionType, defProps);

  // Resolve root-level references (error, message, signal, escalation)
  const refArgs: Record<string, any> = { errorRef, messageRef, signalRef, escalationRef };
  const refEntry = REF_RESOLVERS[eventDefinitionType];
  if (refEntry && refArgs[refEntry.argKey]) {
    const definitions = getDefinitions(diagram);
    eventDefAttrs[refEntry.attrKey] = refEntry.resolver(
      moddle,
      definitions,
      refArgs[refEntry.argKey]
    );
  }

  const eventDef = moddle.create(eventDefinitionType, eventDefAttrs);

  // Replace existing event definitions
  bo.eventDefinitions = [eventDef];
  eventDef.$parent = bo;

  // Use modeling to trigger proper updates
  modeling.updateProperties(element, {
    eventDefinitions: bo.eventDefinitions,
  });

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    elementId,
    eventDefinitionType,
    message: `Set ${eventDefinitionType} on ${elementId}`,
    nextSteps: [
      {
        tool: 'connect_bpmn_elements',
        description: 'Connect this event to the next element in the process flow.',
      },
      {
        tool: 'export_bpmn',
        description: 'Export the diagram once the process is complete.',
      },
    ],
  });
  return appendLintFeedback(result, diagram);
}

// Schema extracted to set-event-definition-schema.ts for readability.
export { TOOL_DEFINITION } from './set-event-definition-schema';
