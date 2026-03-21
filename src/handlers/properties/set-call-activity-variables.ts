/**
 * Handler for set_bpmn_call_activity_variables tool.
 *
 * In Camunda 8 (Zeebe), CallActivities use:
 * - zeebe:CalledElement with processId and propagateAllChildVariables
 * - zeebe:IoMapping for explicit variable input/output mappings
 *
 * This handler manages the zeebe:CalledElement extension and optional
 * I/O mappings for call activity variable passing.
 */
// @mutating

import { type ToolResult } from '../../types';
import { missingRequiredError, typeMismatchError } from '../../errors';
import {
  requireDiagram,
  requireElement,
  jsonResult,
  syncXml,
  upsertExtensionElement,
  validateArgs,
  getService,
} from '../helpers';
import { appendLintFeedback } from '../../linter';

export interface SetCallActivityVariablesArgs {
  diagramId: string;
  elementId: string;
  /** Process ID to call */
  processId?: string;
  /** Whether to propagate all child variables (default: true) */
  propagateAllChildVariables?: boolean;
  /** Input mappings (parent → called process) */
  inputMappings?: Array<{
    source: string;
    target: string;
  }>;
  /** Output mappings (called process → parent) */
  outputMappings?: Array<{
    source: string;
    target: string;
  }>;
}

export async function handleSetCallActivityVariables(
  args: SetCallActivityVariablesArgs
): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementId']);
  const { diagramId, elementId, processId, propagateAllChildVariables, inputMappings = [], outputMappings = [] } = args;

  if (!processId && inputMappings.length === 0 && outputMappings.length === 0 && propagateAllChildVariables === undefined) {
    throw missingRequiredError(['processId', 'inputMappings', 'outputMappings']);
  }

  const diagram = requireDiagram(diagramId);
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const modeling = getService(diagram.modeler, 'modeling');
  const moddle = getService(diagram.modeler, 'moddle');

  const element = requireElement(elementRegistry, elementId);
  const bo = element.businessObject;
  const elType = element.type || bo.$type || '';

  if (elType !== 'bpmn:CallActivity') {
    throw typeMismatchError(elementId, elType, ['bpmn:CallActivity']);
  }

  // Set zeebe:CalledElement
  if (processId !== undefined || propagateAllChildVariables !== undefined) {
    const attrs: Record<string, any> = {};
    if (processId) attrs.processId = processId;
    if (propagateAllChildVariables !== undefined) attrs.propagateAllChildVariables = propagateAllChildVariables;
    const calledElement = moddle.create('zeebe:CalledElement', attrs);
    upsertExtensionElement(moddle, bo, modeling, element, 'zeebe:CalledElement', calledElement);
  }

  // Set zeebe:IoMapping if explicit mappings provided
  if (inputMappings.length > 0 || outputMappings.length > 0) {
    const ioAttrs: Record<string, any> = {};
    if (inputMappings.length > 0) {
      ioAttrs.inputParameters = inputMappings.map((m) =>
        moddle.create('zeebe:Input', { source: m.source, target: m.target })
      );
    }
    if (outputMappings.length > 0) {
      ioAttrs.outputParameters = outputMappings.map((m) =>
        moddle.create('zeebe:Output', { source: m.source, target: m.target })
      );
    }
    const ioMapping = moddle.create('zeebe:IoMapping', ioAttrs);
    upsertExtensionElement(moddle, bo, modeling, element, 'zeebe:IoMapping', ioMapping);
  }

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    elementId,
    processId: processId || undefined,
    propagateAllChildVariables: propagateAllChildVariables ?? true,
    inputMappingCount: inputMappings.length,
    outputMappingCount: outputMappings.length,
    message: `Configured call activity variables on ${elementId}`,
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'set_bpmn_call_activity_variables',
  description:
    'Configure a CallActivity element with the called process ID and variable mappings. ' +
    'Sets zeebe:CalledElement (processId, propagateAllChildVariables) and optionally zeebe:IoMapping ' +
    'for explicit input/output variable mappings between parent and called process.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      elementId: {
        type: 'string',
        description: 'The ID of the CallActivity element',
      },
      processId: {
        type: 'string',
        description: 'The BPMN process ID of the process to call',
      },
      propagateAllChildVariables: {
        type: 'boolean',
        description: 'Whether to propagate all child variables back to the parent (default: true). Set to false when using explicit output mappings.',
      },
      inputMappings: {
        type: 'array',
        description: 'Input variable mappings from parent process into the called process',
        items: {
          type: 'object',
          properties: {
            source: {
              type: 'string',
              description: 'FEEL expression for the source value (e.g. "=orderId")',
            },
            target: {
              type: 'string',
              description: 'Target variable name in the called process',
            },
          },
          required: ['source', 'target'],
        },
      },
      outputMappings: {
        type: 'array',
        description: 'Output variable mappings from the called process back to the parent',
        items: {
          type: 'object',
          properties: {
            source: {
              type: 'string',
              description: 'FEEL expression for the source value (e.g. "=result")',
            },
            target: {
              type: 'string',
              description: 'Target variable name in the parent process',
            },
          },
          required: ['source', 'target'],
        },
      },
    },
    required: ['diagramId', 'elementId'],
    examples: [
      {
        title: 'Call a subprocess with explicit variable mapping',
        value: {
          diagramId: '<diagram-id>',
          elementId: 'CallActivity_ProcessPayment',
          processId: 'payment-process',
          propagateAllChildVariables: false,
          inputMappings: [
            { source: '=orderId', target: 'orderId' },
            { source: '=amount', target: 'paymentAmount' },
          ],
          outputMappings: [
            { source: '=paymentStatus', target: 'paymentResult' },
          ],
        },
      },
    ],
  },
} as const;
