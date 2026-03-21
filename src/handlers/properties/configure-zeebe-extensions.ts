/**
 * Handler for configure_zeebe_extensions tool.
 *
 * Batch-applies Zeebe-specific (Camunda 8) extension configurations
 * to multiple elements in a single call. Uses moddle.create() with
 * the zeebe-bpmn-moddle package for proper typed Zeebe extension elements.
 */
// @mutating

import { type ToolResult } from '../../types';
import { validateArgs, requireDiagram, requireElement, jsonResult, syncXml, getService } from '../helpers';
import { appendLintFeedback } from '../../linter';

// ── Zeebe extension element builders ───────────────────────────────────────

/** Get or create extensionElements container on a business object. */
function ensureExtensionElements(moddle: any, bo: any): any {
  if (!bo.extensionElements) {
    bo.extensionElements = moddle.create('bpmn:ExtensionElements', { values: [] });
    bo.extensionElements.$parent = bo;
  }
  if (!bo.extensionElements.values) {
    bo.extensionElements.values = [];
  }
  return bo.extensionElements;
}

/** Remove existing Zeebe extension elements of a given type. */
function removeZeebeElement(extensionElements: any, zeebeType: string): void {
  extensionElements.values = (extensionElements.values || []).filter(
    (v: any) => v.$type !== zeebeType
  );
}

export interface ZeebeElementConfig {
  taskDefinition?: {
    type: string;
    retries?: number;
  };
  ioMapping?: {
    inputs?: Array<{ source: string; target: string }>;
    outputs?: Array<{ source: string; target: string }>;
  };
  taskHeaders?: Record<string, string>;
  formDefinition?: {
    formId: string;
  };
  userTask?: boolean;
  calledDecision?: {
    decisionId: string;
    resultVariable: string;
  };
  assignment?: {
    assignee?: string;
    candidateGroups?: string;
    candidateUsers?: string;
  };
}

export interface ConfigureZeebeExtensionsArgs {
  diagramId: string;
  elements: Record<string, ZeebeElementConfig>;
}

// ── Zeebe element builders ─────────────────────────────────────────────────

/** Build zeebe:TaskDefinition element. */
function buildTaskDefinition(moddle: any, config: NonNullable<ZeebeElementConfig['taskDefinition']>): any {
  const attrs: Record<string, any> = { type: config.type };
  if (config.retries !== undefined) attrs.retries = String(config.retries);
  return moddle.create('zeebe:TaskDefinition', attrs);
}

/** Build zeebe:IoMapping element with input/output children. */
function buildIoMapping(moddle: any, config: NonNullable<ZeebeElementConfig['ioMapping']>): any {
  const inputParameters = (config.inputs || []).map(
    (input) => moddle.create('zeebe:Input', { source: input.source, target: input.target })
  );
  const outputParameters = (config.outputs || []).map(
    (output) => moddle.create('zeebe:Output', { source: output.source, target: output.target })
  );
  const mapping = moddle.create('zeebe:IoMapping', { inputParameters, outputParameters });
  for (const child of [...inputParameters, ...outputParameters]) child.$parent = mapping;
  return mapping;
}

/** Build zeebe:TaskHeaders element with header children. */
function buildTaskHeaders(moddle: any, headers: Record<string, string>): any {
  const values = Object.entries(headers).map(
    ([key, value]) => moddle.create('zeebe:Header', { key, value })
  );
  const taskHeaders = moddle.create('zeebe:TaskHeaders', { values });
  for (const h of values) h.$parent = taskHeaders;
  return taskHeaders;
}

/** Build zeebe:FormDefinition element. */
function buildFormDefinition(moddle: any, config: NonNullable<ZeebeElementConfig['formDefinition']>): any {
  return moddle.create('zeebe:FormDefinition', { formId: config.formId });
}

/** Build zeebe:UserTask element (marker). */
function buildUserTask(moddle: any): any {
  return moddle.create('zeebe:UserTask');
}

/** Build zeebe:CalledDecision element. */
function buildCalledDecision(moddle: any, config: NonNullable<ZeebeElementConfig['calledDecision']>): any {
  return moddle.create('zeebe:CalledDecision', {
    decisionId: config.decisionId,
    resultVariable: config.resultVariable,
  });
}

/** Build zeebe:AssignmentDefinition element. */
function buildAssignment(moddle: any, config: NonNullable<ZeebeElementConfig['assignment']>): any {
  const attrs: Record<string, any> = {};
  if (config.assignee) attrs.assignee = config.assignee;
  if (config.candidateGroups) attrs.candidateGroups = config.candidateGroups;
  if (config.candidateUsers) attrs.candidateUsers = config.candidateUsers;
  return moddle.create('zeebe:AssignmentDefinition', attrs);
}

// ── Main handler ───────────────────────────────────────────────────────────

export async function handleConfigureZeebeExtensions(
  args: ConfigureZeebeExtensionsArgs
): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elements']);
  const { diagramId, elements } = args;

  if (!elements || typeof elements !== 'object' || Object.keys(elements).length === 0) {
    throw new Error('elements must be a non-empty object mapping element IDs to configurations');
  }

  const diagram = requireDiagram(diagramId);
  const moddle = getService(diagram.modeler, 'moddle');
  const modeling = getService(diagram.modeler, 'modeling');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');

  const results: Record<string, {
    success: boolean;
    error?: string;
    extensionsApplied: string[];
  }> = {};
  const warnings: string[] = [];
  let configuredCount = 0;

  for (const [elementId, config] of Object.entries(elements)) {
    const extensionsApplied: string[] = [];

    try {
      const element = requireElement(elementRegistry, elementId);
      const bo = element.businessObject;
      const ext = ensureExtensionElements(moddle, bo);

      // Apply each configured extension
      if (config.taskDefinition) {
        removeZeebeElement(ext, 'zeebe:TaskDefinition');
        const el = buildTaskDefinition(moddle, config.taskDefinition);
        el.$parent = ext;
        ext.values.push(el);
        extensionsApplied.push('taskDefinition');
      }

      if (config.ioMapping) {
        removeZeebeElement(ext, 'zeebe:IoMapping');
        const el = buildIoMapping(moddle, config.ioMapping);
        el.$parent = ext;
        ext.values.push(el);
        extensionsApplied.push('ioMapping');
      }

      if (config.taskHeaders) {
        removeZeebeElement(ext, 'zeebe:TaskHeaders');
        const el = buildTaskHeaders(moddle, config.taskHeaders);
        el.$parent = ext;
        ext.values.push(el);
        extensionsApplied.push('taskHeaders');
      }

      if (config.formDefinition) {
        removeZeebeElement(ext, 'zeebe:FormDefinition');
        const el = buildFormDefinition(moddle, config.formDefinition);
        el.$parent = ext;
        ext.values.push(el);
        extensionsApplied.push('formDefinition');
      }

      if (config.userTask) {
        removeZeebeElement(ext, 'zeebe:UserTask');
        const el = buildUserTask(moddle);
        el.$parent = ext;
        ext.values.push(el);
        extensionsApplied.push('userTask');
      }

      if (config.calledDecision) {
        removeZeebeElement(ext, 'zeebe:CalledDecision');
        const el = buildCalledDecision(moddle, config.calledDecision);
        el.$parent = ext;
        ext.values.push(el);
        extensionsApplied.push('calledDecision');
      }

      if (config.assignment) {
        removeZeebeElement(ext, 'zeebe:AssignmentDefinition');
        const el = buildAssignment(moddle, config.assignment);
        el.$parent = ext;
        ext.values.push(el);
        extensionsApplied.push('assignment');
      }

      // Trigger modeling update to persist the extension elements
      modeling.updateProperties(element, { extensionElements: ext });

      results[elementId] = { success: true, extensionsApplied };
      configuredCount++;
    } catch (e: any) {
      results[elementId] = {
        success: false,
        error: e.message || String(e),
        extensionsApplied,
      };
    }
  }

  await syncXml(diagram);

  const failedCount = Object.values(results).filter(r => !r.success).length;

  const result = jsonResult({
    success: failedCount === 0,
    configured: configuredCount,
    failed: failedCount,
    results,
    ...(warnings.length > 0 ? { warnings } : {}),
    message:
      failedCount === 0
        ? `Configured Zeebe extensions on ${configuredCount} element(s)`
        : `Configured ${configuredCount} element(s), ${failedCount} failed`,
  });

  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'configure_bpmn_zeebe_extensions',
  description:
    'Batch-configure Zeebe (Camunda 8) extensions on multiple BPMN elements in a single call. ' +
    'Supports task definitions, I/O mappings, task headers, form definitions, user task markers, ' +
    'called decisions, and assignment definitions. Each element is configured independently — ' +
    'one failure does not block others.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: {
        type: 'string',
        description: 'The diagram ID to configure elements in',
      },
      elements: {
        type: 'object',
        description: 'Map of element IDs to their Zeebe configuration',
        additionalProperties: {
          type: 'object',
          properties: {
            taskDefinition: {
              type: 'object',
              description: 'Zeebe task definition (type + optional retries)',
              properties: {
                type: {
                  type: 'string',
                  description: 'Task type (e.g. "io.camunda:http-json:1")',
                },
                retries: {
                  type: 'number',
                  description: 'Number of retries (default: 3)',
                },
              },
              required: ['type'],
            },
            ioMapping: {
              type: 'object',
              description: 'I/O mappings for the element',
              properties: {
                inputs: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      source: { type: 'string', description: 'Source (FEEL expression or value)' },
                      target: { type: 'string', description: 'Target variable name' },
                    },
                    required: ['source', 'target'],
                  },
                },
                outputs: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      source: { type: 'string', description: 'Source expression' },
                      target: { type: 'string', description: 'Target variable name' },
                    },
                    required: ['source', 'target'],
                  },
                },
              },
            },
            taskHeaders: {
              type: 'object',
              description: 'Task headers (key-value pairs)',
              additionalProperties: { type: 'string' },
            },
            formDefinition: {
              type: 'object',
              description: 'Form definition for user tasks',
              properties: {
                formId: { type: 'string', description: 'References a deployed .form file' },
              },
              required: ['formId'],
            },
            userTask: {
              type: 'boolean',
              description: 'If true, adds <zeebe:userTask/> marker (required for native Camunda user tasks)',
            },
            calledDecision: {
              type: 'object',
              description: 'Called decision for business rule tasks',
              properties: {
                decisionId: { type: 'string', description: 'Decision ID to call' },
                resultVariable: { type: 'string', description: 'Variable to store result in' },
              },
              required: ['decisionId', 'resultVariable'],
            },
            assignment: {
              type: 'object',
              description: 'Assignee/candidate configuration for user tasks',
              properties: {
                assignee: { type: 'string', description: 'Assignee (FEEL expression)' },
                candidateGroups: { type: 'string', description: 'Comma-separated candidate groups' },
                candidateUsers: { type: 'string', description: 'Comma-separated candidate users' },
              },
            },
          },
        },
      },
    },
    required: ['diagramId', 'elements'],
  },
} as const;
