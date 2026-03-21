/**
 * Handler for set_input_output_mapping tool.
 *
 * Creates zeebe:IoMapping with zeebe:Input and zeebe:Output children
 * as extension elements. Input mappings map process variables into the
 * task scope; output mappings map task results back to process variables.
 * Both use FEEL expressions for the source.
 */
// @mutating

import { type ToolResult } from '../../types';
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

export interface IoParameterValue {
  source: string;
  target: string;
}

export interface SetInputOutputArgs {
  diagramId: string;
  elementId: string;
  inputParameters?: IoParameterValue[];
  outputParameters?: IoParameterValue[];
}

export async function handleSetInputOutput(args: SetInputOutputArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementId']);
  const { diagramId, elementId, inputParameters = [], outputParameters = [] } = args;
  const diagram = requireDiagram(diagramId);

  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const modeling = getService(diagram.modeler, 'modeling');
  const moddle = getService(diagram.modeler, 'moddle');

  const element = requireElement(elementRegistry, elementId);
  const bo = element.businessObject;

  // Build zeebe:Input elements
  const inputs = inputParameters.map((p) =>
    moddle.create('zeebe:Input', { source: p.source, target: p.target })
  );

  // Build zeebe:Output elements
  const outputs = outputParameters.map((p) =>
    moddle.create('zeebe:Output', { source: p.source, target: p.target })
  );

  // Build zeebe:IoMapping element
  const ioAttrs: Record<string, any> = {};
  if (inputs.length > 0) ioAttrs.inputParameters = inputs;
  if (outputs.length > 0) ioAttrs.outputParameters = outputs;
  const ioMapping = moddle.create('zeebe:IoMapping', ioAttrs);

  upsertExtensionElement(moddle, bo, modeling, element, 'zeebe:IoMapping', ioMapping);

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    elementId,
    inputParameterCount: inputs.length,
    outputParameterCount: outputs.length,
    message: `Set input/output mapping on ${elementId}`,
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'set_bpmn_input_output_mapping',
  description:
    'Set Zeebe input/output mappings on an element. Creates zeebe:IoMapping extension elements ' +
    'with zeebe:Input and zeebe:Output children. Each mapping has a source (FEEL expression) ' +
    'and a target (variable name). Input mappings map process variables into the local task scope; ' +
    'output mappings map task results back to process variables.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      elementId: {
        type: 'string',
        description: 'The ID of the element to update',
      },
      inputParameters: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            source: {
              type: 'string',
              description:
                'FEEL expression for the source value (e.g. "=orderId", "=customer.name", "=\"fixed-value\"")',
            },
            target: {
              type: 'string',
              description: 'Target variable name in the local task scope',
            },
          },
          required: ['source', 'target'],
        },
        description: 'Input mappings (process scope → task scope)',
      },
      outputParameters: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            source: {
              type: 'string',
              description:
                'FEEL expression for the source value (e.g. "=result", "=response.status")',
            },
            target: {
              type: 'string',
              description: 'Target variable name in the process scope',
            },
          },
          required: ['source', 'target'],
        },
        description: 'Output mappings (task scope → process scope)',
      },
    },
    required: ['diagramId', 'elementId'],
    examples: [
      {
        title: 'Map variables for a service task',
        value: {
          diagramId: '<diagram-id>',
          elementId: 'ServiceTask_FetchOrder',
          inputParameters: [
            { source: '=orderId', target: 'fetchOrderId' },
            { source: '="GET"', target: 'method' },
          ],
          outputParameters: [{ source: '=response', target: 'orderData' }],
        },
      },
    ],
  },
} as const;
