/**
 * Handler for set_bpmn_camunda_listeners tool (Zeebe execution/task listeners).
 *
 * In Camunda 8 (Zeebe), listeners are job-worker-based:
 * - zeebe:ExecutionListeners with zeebe:ExecutionListener children
 *   (eventType: start/end, type: job worker type, retries)
 * - zeebe:TaskListeners with zeebe:TaskListener children
 *   (eventType: complete/assignment/..., type: job worker type, retries)
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

export interface SetCamundaListenersArgs {
  diagramId: string;
  elementId: string;
  executionListeners?: Array<{
    eventType: string;
    type: string;
    retries?: string;
  }>;
  taskListeners?: Array<{
    eventType: string;
    type: string;
    retries?: string;
  }>;
}

export async function handleSetCamundaListeners(
  args: SetCamundaListenersArgs
): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementId']);
  const {
    diagramId,
    elementId,
    executionListeners = [],
    taskListeners = [],
  } = args;

  if (executionListeners.length === 0 && taskListeners.length === 0) {
    throw missingRequiredError(['executionListeners', 'taskListeners']);
  }

  const diagram = requireDiagram(diagramId);
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const modeling = getService(diagram.modeler, 'modeling');
  const moddle = getService(diagram.modeler, 'moddle');

  const element = requireElement(elementRegistry, elementId);
  const bo = element.businessObject;
  const elType = element.type || bo.$type || '';

  if (taskListeners.length > 0 && !elType.includes('UserTask')) {
    throw typeMismatchError(elementId, elType, ['bpmn:UserTask']);
  }

  // Build zeebe:ExecutionListeners
  if (executionListeners.length > 0) {
    const listeners = executionListeners.map((l) => {
      const attrs: Record<string, any> = {
        eventType: l.eventType,
        type: l.type,
      };
      if (l.retries) attrs.retries = l.retries;
      return moddle.create('zeebe:ExecutionListener', attrs);
    });
    const container = moddle.create('zeebe:ExecutionListeners', { listeners });
    upsertExtensionElement(moddle, bo, modeling, element, 'zeebe:ExecutionListeners', container);
  }

  // Build zeebe:TaskListeners
  if (taskListeners.length > 0) {
    const listeners = taskListeners.map((l) => {
      const attrs: Record<string, any> = {
        eventType: l.eventType,
        type: l.type,
      };
      if (l.retries) attrs.retries = l.retries;
      return moddle.create('zeebe:TaskListener', attrs);
    });
    const container = moddle.create('zeebe:TaskListeners', { listeners });
    upsertExtensionElement(moddle, bo, modeling, element, 'zeebe:TaskListeners', container);
  }

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    elementId,
    executionListenerCount: executionListeners.length,
    taskListenerCount: taskListeners.length,
    message: `Set ${executionListeners.length} execution listener(s) and ${taskListeners.length} task listener(s) on ${elementId}`,
  });
  return appendLintFeedback(result, diagram);
}

export { TOOL_DEFINITION } from './set-camunda-listeners-schema';
