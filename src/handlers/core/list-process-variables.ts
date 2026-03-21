/**
 * Handler for list_bpmn_process_variables tool.
 *
 * Scans all elements in a diagram and extracts process variables from:
 * - I/O mappings (zeebe:IoMapping → zeebe:Input/Output)
 * - Call activity variable propagation (zeebe:CalledElement)
 * - Condition expressions on sequence flows (FEEL)
 * - Assignment definitions (zeebe:AssignmentDefinition)
 * - Script tasks (zeebe:Script resultVariable)
 * - Loop characteristics (zeebe:LoopCharacteristics)
 * - Called decisions (zeebe:CalledDecision resultVariable)
 */
// @readonly

import { type ToolResult } from '../../types';
import {
  requireDiagram,
  jsonResult,
  getVisibleElements,
  validateArgs,
  getService,
} from '../helpers';

export interface ListProcessVariablesArgs {
  diagramId: string;
}

interface VariableReference {
  name: string;
  /** How the variable is used: 'read', 'write', or 'read-write'. */
  access: 'read' | 'write' | 'read-write';
  /** Where this variable was found. */
  source: string;
  /** The element ID where this variable was found. */
  elementId: string;
  /** The element name (if any). */
  elementName?: string;
}

/** FEEL keywords and built-in names to ignore when extracting variables. */
const FEEL_KEYWORDS = new Set([
  'true', 'false', 'null', 'not', 'and', 'or',
  'if', 'then', 'else', 'for', 'in', 'return',
  'some', 'every', 'satisfies', 'between', 'instance', 'of',
  'function', 'string', 'number', 'boolean', 'context',
  'date', 'time', 'duration',
  'abs', 'ceiling', 'floor', 'round', 'decimal',
  'mean', 'sum', 'min', 'max', 'count', 'list',
  'append', 'concatenate', 'contains', 'starts', 'ends',
  'matches', 'replace', 'split', 'substring',
  'upper', 'lower', 'trim', 'now', 'today',
  'flatten', 'distinct', 'sort', 'reverse',
  'loopCounter',
]);

/**
 * Extract variable names from a FEEL expression string.
 */
function extractFeelVars(expr: string): string[] {
  if (!expr || typeof expr !== 'string') return [];
  const body = expr.startsWith('=') ? expr.slice(1) : expr;
  const cleaned = body.replace(/"[^"]*"/g, '');
  const vars: string[] = [];
  const identPattern = /\b([a-zA-Z_]\w*)\b/g;
  let match;
  while ((match = identPattern.exec(cleaned)) !== null) {
    const id = match[1];
    if (!FEEL_KEYWORDS.has(id)) vars.push(id);
  }
  return vars;
}

// ── Variable extraction from elements ──────────────────────────────────────

/** Context for extraction helpers. */
interface ExtractionContext {
  elementId: string;
  elementName?: string;
}

/** Get a Zeebe extension element by type. */
function getZeebeExt(bo: any, type: string): any | undefined {
  return (bo.extensionElements?.values || []).find((e: any) => e.$type === type);
}

/** Extract variables from zeebe:IoMapping. */
function extractFromIoMapping(ext: any, ctx: ExtractionContext): VariableReference[] {
  const refs: VariableReference[] = [];
  for (const input of ext.inputParameters || []) {
    if (input.source) {
      for (const v of extractFeelVars(input.source)) {
        refs.push({ name: v, access: 'read', source: 'ioMapping.input.source', ...ctx });
      }
    }
    if (input.target) {
      refs.push({ name: input.target, access: 'write', source: 'ioMapping.input.target', ...ctx });
    }
  }
  for (const output of ext.outputParameters || []) {
    if (output.source) {
      for (const v of extractFeelVars(output.source)) {
        refs.push({ name: v, access: 'read', source: 'ioMapping.output.source', ...ctx });
      }
    }
    if (output.target) {
      refs.push({ name: output.target, access: 'write', source: 'ioMapping.output.target', ...ctx });
    }
  }
  return refs;
}

/** Extract variables from zeebe:AssignmentDefinition. */
function extractFromAssignment(ext: any, ctx: ExtractionContext): VariableReference[] {
  const refs: VariableReference[] = [];
  for (const prop of ['assignee', 'candidateGroups', 'candidateUsers'] as const) {
    if (ext[prop] && typeof ext[prop] === 'string') {
      for (const v of extractFeelVars(ext[prop])) {
        refs.push({ name: v, access: 'read', source: `assignmentDefinition.${prop}`, ...ctx });
      }
    }
  }
  return refs;
}

/** Extract variables from zeebe:LoopCharacteristics. */
function extractFromZeebeLoop(ext: any, ctx: ExtractionContext): VariableReference[] {
  const refs: VariableReference[] = [];
  if (ext.inputCollection) {
    for (const v of extractFeelVars(ext.inputCollection)) {
      refs.push({ name: v, access: 'read', source: 'loop.inputCollection', ...ctx });
    }
  }
  if (ext.inputElement) {
    refs.push({ name: ext.inputElement, access: 'write', source: 'loop.inputElement', ...ctx });
  }
  if (ext.outputCollection) {
    refs.push({ name: ext.outputCollection, access: 'write', source: 'loop.outputCollection', ...ctx });
  }
  if (ext.outputElement) {
    for (const v of extractFeelVars(ext.outputElement)) {
      refs.push({ name: v, access: 'read', source: 'loop.outputElement', ...ctx });
    }
  }
  return refs;
}

/** Extract variables from all Zeebe extension elements. */
function extractFromExtensions(bo: any, ctx: ExtractionContext): VariableReference[] {
  const refs: VariableReference[] = [];

  const ioMapping = getZeebeExt(bo, 'zeebe:IoMapping');
  if (ioMapping) refs.push(...extractFromIoMapping(ioMapping, ctx));

  const assignment = getZeebeExt(bo, 'zeebe:AssignmentDefinition');
  if (assignment) refs.push(...extractFromAssignment(assignment, ctx));

  const script = getZeebeExt(bo, 'zeebe:Script');
  if (script) {
    if (script.expression) {
      for (const v of extractFeelVars(script.expression)) {
        refs.push({ name: v, access: 'read', source: 'script.expression', ...ctx });
      }
    }
    if (script.resultVariable) {
      refs.push({ name: script.resultVariable, access: 'write', source: 'script.resultVariable', ...ctx });
    }
  }

  const calledDecision = getZeebeExt(bo, 'zeebe:CalledDecision');
  if (calledDecision?.resultVariable) {
    refs.push({ name: calledDecision.resultVariable, access: 'write', source: 'calledDecision.resultVariable', ...ctx });
  }

  const zeebeLoop = getZeebeExt(bo, 'zeebe:LoopCharacteristics');
  if (zeebeLoop) refs.push(...extractFromZeebeLoop(zeebeLoop, ctx));

  return refs;
}

function extractFromElement(el: any): VariableReference[] {
  const bo = el.businessObject;
  if (!bo) return [];

  const ctx: ExtractionContext = {
    elementId: el.id,
    elementName: bo.name || undefined,
  };

  const refs: VariableReference[] = [];

  refs.push(...extractFromExtensions(bo, ctx));

  // Condition expression on sequence flows → read
  if (bo.conditionExpression?.body) {
    for (const v of extractFeelVars(bo.conditionExpression.body)) {
      refs.push({ name: v, access: 'read', source: 'conditionExpression', ...ctx });
    }
  }

  // Standard BPMN loop completion condition
  if (bo.loopCharacteristics?.completionCondition?.body) {
    for (const v of extractFeelVars(bo.loopCharacteristics.completionCondition.body)) {
      refs.push({ name: v, access: 'read', source: 'loop.completionCondition', ...ctx });
    }
  }

  return refs;
}

export async function handleListProcessVariables(
  args: ListProcessVariablesArgs
): Promise<ToolResult> {
  validateArgs(args, ['diagramId']);
  const { diagramId } = args;
  const diagram = requireDiagram(diagramId);

  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  const allElements = getVisibleElements(elementRegistry);

  const allRefs: VariableReference[] = [];
  for (const el of allElements) {
    allRefs.push(...extractFromElement(el));
  }

  type VarEntry = {
    name: string;
    readBy: Array<{ elementId: string; elementName?: string; source: string }>;
    writtenBy: Array<{ elementId: string; elementName?: string; source: string }>;
  };
  const varMap = new Map<string, VarEntry>();

  for (const ref of allRefs) {
    if (!varMap.has(ref.name)) {
      varMap.set(ref.name, { name: ref.name, readBy: [], writtenBy: [] });
    }
    const entry = varMap.get(ref.name)!;
    const loc = { elementId: ref.elementId, elementName: ref.elementName, source: ref.source };
    const notIn = (arr: typeof entry.readBy) =>
      !arr.some((r) => r.elementId === loc.elementId && r.source === loc.source);

    if (ref.access === 'read' || ref.access === 'read-write') {
      if (notIn(entry.readBy)) entry.readBy.push(loc);
    }
    if (ref.access === 'write' || ref.access === 'read-write') {
      if (notIn(entry.writtenBy)) entry.writtenBy.push(loc);
    }
  }

  const variables = Array.from(varMap.values()).sort((a, b) => a.name.localeCompare(b.name));

  return jsonResult({
    success: true,
    variableCount: variables.length,
    referenceCount: allRefs.length,
    variables,
  });
}

export const TOOL_DEFINITION = {
  name: 'list_bpmn_process_variables',
  description:
    'List all process variables referenced in a BPMN diagram. Extracts variables from form fields, input/output parameter mappings, condition expressions, script result variables, loop characteristics, call activity variable mappings, and Camunda properties (assignee, candidateGroups, etc.). Returns each variable with its read/write access pattern and the elements that reference it.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
    },
    required: ['diagramId'],
  },
} as const;
