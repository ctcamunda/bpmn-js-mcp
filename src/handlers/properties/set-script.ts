/**
 * Handler for set_bpmn_script tool.
 *
 * Sets script content on a ScriptTask element. In Camunda 8 (Zeebe),
 * script tasks use FEEL expressions via zeebe:Script extension elements
 * with `expression` and `resultVariable` attributes.
 */
// @mutating

import { type ToolResult } from '../../types';
import { typeMismatchError } from '../../errors';
import {
  requireDiagram,
  requireElement,
  jsonResult,
  syncXml,
  validateArgs,
  getService,
  upsertExtensionElement,
} from '../helpers';
import { appendLintFeedback } from '../../linter';

export interface SetScriptArgs {
  diagramId: string;
  elementId: string;
  scriptFormat: string;
  script?: string;
  resultVariable?: string;
}

export async function handleSetScript(args: SetScriptArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementId', 'scriptFormat']);
  const { diagramId, elementId, scriptFormat, script, resultVariable } = args;

  const diagram = requireDiagram(diagramId);

  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const modeling = getService(diagram.modeler, 'modeling');
  const moddle = getService(diagram.modeler, 'moddle');

  const element = requireElement(elementRegistry, elementId);
  const bo = element.businessObject;

  if (!bo.$type.includes('ScriptTask')) {
    throw typeMismatchError(elementId, bo.$type, ['bpmn:ScriptTask']);
  }

  // Set scriptFormat on the BPMN element
  modeling.updateProperties(element, { scriptFormat });

  // Set the script body on the business object (standard BPMN property)
  if (script) {
    bo.script = script;
  }

  // Set zeebe:Script extension element for FEEL expression and resultVariable
  if (resultVariable || script) {
    const zeebeScriptAttrs: Record<string, any> = {};
    if (script) zeebeScriptAttrs.expression = script;
    if (resultVariable) zeebeScriptAttrs.resultVariable = resultVariable;
    const scriptEl = moddle.create('zeebe:Script', zeebeScriptAttrs);
    upsertExtensionElement(moddle, bo, modeling, element, 'zeebe:Script', scriptEl);
  }

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    elementId,
    scriptFormat,
    ...(script ? { scriptLength: script.length } : {}),
    resultVariable: resultVariable || undefined,
    message: `Set ${scriptFormat} script on ${elementId}${script ? ` (${script.length} chars)` : ''}`,
    nextSteps: [
      {
        tool: 'connect_bpmn_elements',
        description: 'Connect this script task to the next element in the process flow.',
      },
    ],
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'set_bpmn_script',
  description:
    'Set script content on a ScriptTask element. In Camunda 8 (Zeebe), script tasks use FEEL expressions via zeebe:Script. Set the expression and an optional resultVariable to capture the output.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      elementId: {
        type: 'string',
        description: 'The ID of the ScriptTask element',
      },
      scriptFormat: {
        type: 'string',
        description: "The scripting language (e.g. 'feel', 'groovy', 'javascript')",
      },
      script: {
        type: 'string',
        description: 'The script body / FEEL expression',
      },
      resultVariable: {
        type: 'string',
        description:
          'Variable name to store the script result in (creates zeebe:Script with resultVariable)',
      },
    },
    required: ['diagramId', 'elementId', 'scriptFormat'],
    examples: [
      {
        title: 'Set a FEEL expression with result variable',
        value: {
          diagramId: '<diagram-id>',
          elementId: 'ScriptTask_CalcTotal',
          scriptFormat: 'feel',
          script: 'sum(orderItems.price * orderItems.quantity)',
          resultVariable: 'orderTotal',
        },
      },
    ],
  },
} as const;
