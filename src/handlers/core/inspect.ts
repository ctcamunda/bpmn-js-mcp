import { type ToolResult } from '../../types';
import { validateArgs } from '../helpers';
import { handleListDiagrams } from './list-diagrams';
import { handleListProcessVariables } from './list-process-variables';
import { handleValidate } from './validate';
import { handleListElements } from '../elements/list-elements';
import { handleGetProperties } from '../elements/get-properties';

export interface InspectBpmnArgs {
  mode: 'diagrams' | 'diagram' | 'diff' | 'elements' | 'element' | 'validation' | 'variables';
  diagramId?: string;
  compareWith?: string;
  elementId?: string;
  namePattern?: string;
  elementType?: string;
  property?: { key: string; value?: string };
  topology?: boolean;
  config?: any;
  lintMinSeverity?: 'error' | 'warning';
}

export async function handleInspectBpmn(args: InspectBpmnArgs): Promise<ToolResult> {
  validateArgs(args, ['mode']);

  switch (args.mode) {
    case 'diagrams':
      return handleListDiagrams();
    case 'diagram':
      validateArgs(args, ['diagramId']);
      return handleListDiagrams({ diagramId: args.diagramId });
    case 'diff':
      validateArgs(args, ['diagramId', 'compareWith']);
      return handleListDiagrams({ diagramId: args.diagramId, compareWith: args.compareWith });
    case 'elements':
      validateArgs(args, ['diagramId']);
      return handleListElements({
        diagramId: args.diagramId!,
        ...(args.namePattern ? { namePattern: args.namePattern } : {}),
        ...(args.elementType ? { elementType: args.elementType } : {}),
        ...(args.property ? { property: args.property } : {}),
        ...(args.topology !== undefined ? { topology: args.topology } : {}),
      });
    case 'element':
      validateArgs(args, ['diagramId', 'elementId']);
      return handleGetProperties({ diagramId: args.diagramId!, elementId: args.elementId! });
    case 'validation':
      validateArgs(args, ['diagramId']);
      return handleValidate({
        diagramId: args.diagramId!,
        ...(args.config ? { config: args.config } : {}),
        ...(args.lintMinSeverity ? { lintMinSeverity: args.lintMinSeverity } : {}),
      });
    case 'variables':
      validateArgs(args, ['diagramId']);
      return handleListProcessVariables({ diagramId: args.diagramId! });
    default:
      throw new Error(`Unsupported inspect mode: ${String((args as any).mode)}`);
  }
}

export const TOOL_DEFINITION = {
  name: 'inspect_bpmn',
  description:
    'Unified read-only inspection interface for BPMN diagrams. ' +
    'Use mode=diagrams to list all diagrams, mode=diagram for a summary of one diagram, mode=diff to compare two diagrams, ' +
    'mode=elements to list/filter elements, mode=element to inspect one element, mode=validation to run bpmnlint validation, ' +
    'and mode=variables to list process variables referenced in a diagram.',
  inputSchema: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['diagrams', 'diagram', 'diff', 'elements', 'element', 'validation', 'variables'],
        description: 'Inspection mode selecting which BPMN state to read.',
      },
      diagramId: {
        type: 'string',
        description: 'Diagram ID for diagram-, element-, validation-, variables-, and diff-scoped inspection.',
      },
      compareWith: {
        type: 'string',
        description: 'Second diagram ID for mode=diff.',
      },
      elementId: {
        type: 'string',
        description: 'Element ID for mode=element.',
      },
      namePattern: {
        type: 'string',
        description: 'Optional case-insensitive regex filter for mode=elements.',
      },
      elementType: {
        type: 'string',
        description: 'Optional BPMN element type filter for mode=elements.',
      },
      property: {
        type: 'object',
        description: 'Optional property filter for mode=elements.',
        properties: {
          key: { type: 'string', description: 'Property key to test.' },
          value: { type: 'string', description: 'Optional property value to match.' },
        },
        required: ['key'],
      },
      topology: {
        type: 'boolean',
        description: 'When true in mode=elements, return resolved incoming/outgoing flow topology.',
      },
      config: {
        type: 'object',
        description: 'Optional bpmnlint config override for mode=validation.',
      },
      lintMinSeverity: {
        type: 'string',
        enum: ['error', 'warning'],
        description: 'Optional blocking severity threshold for mode=validation.',
      },
    },
    required: ['mode'],
  },
} as const;