/**
 * JSON Schema for the set_bpmn_camunda_listeners tool (Zeebe listeners).
 *
 * Extracted from set-camunda-listeners.ts to keep the handler logic
 * readable and within the max-lines limit.
 */

export const TOOL_DEFINITION = {
  name: 'set_bpmn_camunda_listeners',
  description:
    'Set Zeebe execution listeners and/or task listeners on a BPMN element. ' +
    'In Camunda 8, listeners are job-worker-based — each listener specifies a worker type and optional retries. ' +
    'Execution listeners can be attached to any flow node or process (eventType: start/end). ' +
    'Task listeners are specific to UserTasks (eventType: complete, assignment, update, cancel).',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      elementId: {
        type: 'string',
        description: 'The ID of the element to configure',
      },
      executionListeners: {
        type: 'array',
        description: 'Execution listeners to set (replaces existing)',
        items: {
          type: 'object',
          properties: {
            eventType: {
              type: 'string',
              enum: ['start', 'end'],
              description: "When the listener fires: 'start' or 'end'",
            },
            type: {
              type: 'string',
              description: 'Job worker type that handles this listener (e.g. "audit-logger")',
            },
            retries: {
              type: 'string',
              description: 'Number of retries (default: "3")',
            },
          },
          required: ['eventType', 'type'],
        },
      },
      taskListeners: {
        type: 'array',
        description: 'Task listeners to set (UserTask only, replaces existing)',
        items: {
          type: 'object',
          properties: {
            eventType: {
              type: 'string',
              enum: ['complete', 'assignment', 'update', 'cancel'],
              description: "When the listener fires: 'complete', 'assignment', 'update', or 'cancel'",
            },
            type: {
              type: 'string',
              description: 'Job worker type that handles this listener (e.g. "task-assignment-handler")',
            },
            retries: {
              type: 'string',
              description: 'Number of retries (default: "3")',
            },
          },
          required: ['eventType', 'type'],
        },
      },
    },
    required: ['diagramId', 'elementId'],
    examples: [
      {
        title: 'Add an execution listener that logs on task start',
        value: {
          diagramId: '<diagram-id>',
          elementId: 'ServiceTask_ProcessOrder',
          executionListeners: [
            {
              eventType: 'start',
              type: 'audit-logger',
              retries: '3',
            },
          ],
        },
      },
      {
        title: 'Add a task listener for assignment handling',
        value: {
          diagramId: '<diagram-id>',
          elementId: 'UserTask_ReviewOrder',
          taskListeners: [
            {
              eventType: 'assignment',
              type: 'task-assignment-handler',
            },
          ],
        },
      },
    ],
  },
} as const;
