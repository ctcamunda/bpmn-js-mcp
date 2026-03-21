/**
 * Handler for set_bpmn_form_data tool.
 *
 * In Camunda 8 (Zeebe), forms are linked via:
 * - `zeebe:FormDefinition` with `formId` (linked form deployed separately)
 *   or `formKey` (custom form implementation)
 * - `zeebe:UserTaskForm` for embedding Camunda Form JSON directly in the BPMN XML
 *
 * This handler supports both approaches. Use `formId` to link a deployed form
 * or `formJson`/`formBody` to embed the form definition inline.
 */
// @mutating

import { type ToolResult } from '../../types';
import { typeMismatchError } from '../../errors';
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

export interface SetFormDataArgs {
  diagramId: string;
  elementId: string;
  /** Deployed form ID — creates zeebe:FormDefinition with formId. */
  formId?: string;
  /** Custom form key for external form implementations. */
  formKey?: string;
  /** Embedded Camunda Form JSON string — creates zeebe:UserTaskForm. */
  formJson?: string;
}

export async function handleSetFormData(args: SetFormDataArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementId']);
  const { diagramId, elementId, formId, formKey, formJson } = args;
  const diagram = requireDiagram(diagramId);

  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const modeling = getService(diagram.modeler, 'modeling');
  const moddle = getService(diagram.modeler, 'moddle');

  const element = requireElement(elementRegistry, elementId);
  const bo = element.businessObject;

  // Verify element is a UserTask or StartEvent
  if (bo.$type !== 'bpmn:UserTask' && bo.$type !== 'bpmn:StartEvent') {
    throw typeMismatchError(elementId, bo.$type, ['bpmn:UserTask', 'bpmn:StartEvent']);
  }

  let message: string;

  if (formJson) {
    // Embed the form JSON as a zeebe:UserTaskForm
    const userTaskForm = moddle.create('zeebe:UserTaskForm', { body: formJson });
    upsertExtensionElement(moddle, bo, modeling, element, 'zeebe:UserTaskForm', userTaskForm);

    // Also set a zeebe:FormDefinition pointing to the embedded form
    const formDef = moddle.create('zeebe:FormDefinition', {
      formKey: `camunda-forms:bpmn:userTaskForm_${elementId}`,
    });
    upsertExtensionElement(moddle, bo, modeling, element, 'zeebe:FormDefinition', formDef);
    message = `Set embedded Camunda Form on ${elementId}`;
  } else if (formId) {
    // Link to a deployed Camunda Form by ID
    const formDef = moddle.create('zeebe:FormDefinition', { formId });
    upsertExtensionElement(moddle, bo, modeling, element, 'zeebe:FormDefinition', formDef);
    message = `Linked form "${formId}" on ${elementId}`;
  } else if (formKey) {
    // Custom form key for external form implementations
    const formDef = moddle.create('zeebe:FormDefinition', { formKey });
    upsertExtensionElement(moddle, bo, modeling, element, 'zeebe:FormDefinition', formDef);
    message = `Set form key "${formKey}" on ${elementId}`;
  } else {
    message = `No form configuration provided for ${elementId}`;
  }

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    elementId,
    message,
    nextSteps: [
      {
        tool: 'connect_bpmn_elements',
        description: 'Connect this task to the next element in the process flow.',
      },
      {
        tool: 'export_bpmn',
        description: 'Export the diagram once the process is complete.',
      },
    ],
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'set_bpmn_form_data',
  description:
    'Link a Camunda Form to a User Task or Start Event. Supports three modes: ' +
    '(1) formId — link a deployed Camunda Form by its ID; ' +
    '(2) formKey — custom form key for external form implementations; ' +
    '(3) formJson — embed a Camunda Form JSON definition directly in the BPMN XML. ' +
    'Use the Camunda Modeler or form-js to design forms, then link them here. ' +
    'For simple variable collection, consider using zeebe:IoMapping instead.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      elementId: {
        type: 'string',
        description: 'The ID of the element to update (must be bpmn:UserTask or bpmn:StartEvent)',
      },
      formId: {
        type: 'string',
        description: 'ID of a deployed Camunda Form to link (creates zeebe:FormDefinition with formId)',
      },
      formKey: {
        type: 'string',
        description: 'Custom form key for external form implementations (creates zeebe:FormDefinition with formKey)',
      },
      formJson: {
        type: 'string',
        description: 'Camunda Form JSON string to embed directly in the BPMN XML (creates zeebe:UserTaskForm)',
      },
    },
    required: ['diagramId', 'elementId'],
    examples: [
      {
        title: 'Link a deployed Camunda Form',
        value: {
          diagramId: '<diagram-id>',
          elementId: 'UserTask_ReviewOrder',
          formId: 'review-order-form',
        },
      },
      {
        title: 'Set a custom external form key',
        value: {
          diagramId: '<diagram-id>',
          elementId: 'UserTask_ApproveRequest',
          formKey: 'myapp:approve-request',
        },
      },
    ],
  },
} as const;
