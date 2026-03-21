/**
 * Custom bpmnlint rule: undefined-variable
 *
 * Warns when a process variable is read (in condition expressions, input
 * mapping source expressions, assignee expressions, etc.) but never written
 * (by output mappings, script result variables, etc.) within the same
 * process scope.
 *
 * Variables can be defined through:
 * - Output mappings (zeebe:IoMapping → zeebe:Output target)
 * - Script result variables (zeebe:Script resultVariable)
 * - Multi-instance element variable (zeebe:LoopCharacteristics outputElement)
 * - Call activity with propagateAllChildVariables
 *
 * Variables are read through:
 * - Condition expressions on sequence flows (FEEL)
 * - Input mappings (zeebe:IoMapping → zeebe:Input source)
 * - Assignment definition (zeebe:AssignmentDefinition assignee, candidateGroups, candidateUsers)
 * - Multi-instance inputCollection (FEEL)
 * - Loop completion conditions (FEEL)
 */

import { isType } from '../utils';

/** FEEL keywords and built-in names to ignore. */
const FEEL_BUILTINS = new Set([
  'true',
  'false',
  'null',
  'not',
  'and',
  'or',
  'if',
  'then',
  'else',
  'for',
  'in',
  'return',
  'some',
  'every',
  'satisfies',
  'between',
  'instance',
  'of',
  'function',
  'string',
  'number',
  'boolean',
  'context',
  'date',
  'time',
  'duration',
  // Built-in FEEL functions
  'abs',
  'ceiling',
  'floor',
  'round',
  'decimal',
  'even',
  'odd',
  'modulo',
  'sqrt',
  'log',
  'exp',
  'mean',
  'sum',
  'min',
  'max',
  'count',
  'list',
  'append',
  'concatenate',
  'contains',
  'starts',
  'ends',
  'matches',
  'replace',
  'split',
  'substring',
  'upper',
  'lower',
  'trim',
  'now',
  'today',
  'day',
  'month',
  'year',
  'flatten',
  'distinct',
  'sort',
  'reverse',
  'index',
  'union',
  'insert',
  'remove',
  'get',
  'put',
  'entries',
  'keys',
  'values',
  'with',
  'before',
  'after',
  // Zeebe context variables
  'loopCounter',
]);

/**
 * Extract variable names from a FEEL expression string.
 * Extracts bare identifiers that look like variable references.
 * FEEL expressions are plain (no ${} wrapping) — just identifier tokens.
 */
function extractFeelVars(expr: string): string[] {
  if (!expr || typeof expr !== 'string') return [];
  // Strip leading = if present (FEEL indicator)
  const body = expr.startsWith('=') ? expr.slice(1) : expr;
  // Remove string literals before extracting identifiers
  const cleaned = body.replace(/"[^"]*"/g, '');
  const vars: string[] = [];
  const identPattern = /\b([a-zA-Z_]\w*)\b/g;
  let match;
  while ((match = identPattern.exec(cleaned)) !== null) {
    const id = match[1];
    if (!FEEL_BUILTINS.has(id)) {
      vars.push(id);
    }
  }
  return vars;
}

interface VarRef {
  name: string;
  elementId: string;
  access: 'read' | 'write';
}

/** Push FEEL expression-read refs into the refs array. */
function pushExprReads(refs: VarRef[], expr: string, elementId: string): void {
  for (const v of extractFeelVars(expr)) {
    refs.push({ name: v, elementId, access: 'read' });
  }
}

/** Get a Zeebe extension element by type from a BPMN element. */
function getZeebeExt(el: any, type: string): any | undefined {
  return (el.extensionElements?.values || []).find((e: any) => e.$type === type);
}

/** Extract variable references from zeebe:IoMapping. */
function collectFromIoMapping(ext: any, elementId: string): VarRef[] {
  const refs: VarRef[] = [];
  for (const input of ext.inputParameters || []) {
    if (input.source) pushExprReads(refs, input.source, elementId);
    // input target writes into task scope, not process scope — skip
  }
  for (const output of ext.outputParameters || []) {
    if (output.target) refs.push({ name: output.target, elementId, access: 'write' });
    if (output.source) pushExprReads(refs, output.source, elementId);
  }
  return refs;
}

/** Extract variable references from extension elements. */
function collectFromExtensions(el: any): VarRef[] {
  const refs: VarRef[] = [];
  const elementId = el.id;

  const ioMapping = getZeebeExt(el, 'zeebe:IoMapping');
  if (ioMapping) {
    refs.push(...collectFromIoMapping(ioMapping, elementId));
  }

  const assignment = getZeebeExt(el, 'zeebe:AssignmentDefinition');
  if (assignment) {
    if (assignment.assignee) pushExprReads(refs, assignment.assignee, elementId);
    if (assignment.candidateGroups) pushExprReads(refs, assignment.candidateGroups, elementId);
    if (assignment.candidateUsers) pushExprReads(refs, assignment.candidateUsers, elementId);
  }

  const script = getZeebeExt(el, 'zeebe:Script');
  if (script) {
    if (script.expression) pushExprReads(refs, script.expression, elementId);
    if (script.resultVariable) refs.push({ name: script.resultVariable, elementId, access: 'write' });
  }

  const calledElement = getZeebeExt(el, 'zeebe:CalledElement');
  if (calledElement?.propagateAllChildVariables !== false) {
    // When propagateAllChildVariables is true (default), all child variables
    // are available — we can't statically determine which ones, so skip reporting
  }

  return refs;
}

/** Extract variable references from zeebe:LoopCharacteristics. */
function collectFromLoopCharacteristics(el: any, elementId: string): VarRef[] {
  const refs: VarRef[] = [];
  const zeebeLoop = getZeebeExt(el, 'zeebe:LoopCharacteristics');
  if (!zeebeLoop) return refs;

  if (zeebeLoop.inputCollection) {
    pushExprReads(refs, zeebeLoop.inputCollection, elementId);
  }
  if (zeebeLoop.inputElement) {
    refs.push({ name: zeebeLoop.inputElement, elementId, access: 'write' });
  }
  if (zeebeLoop.outputCollection) {
    refs.push({ name: zeebeLoop.outputCollection, elementId, access: 'write' });
  }
  if (zeebeLoop.outputElement) {
    pushExprReads(refs, zeebeLoop.outputElement, elementId);
  }

  // Standard BPMN completion condition
  const lc = el.loopCharacteristics;
  if (lc?.completionCondition?.body) {
    pushExprReads(refs, lc.completionCondition.body, elementId);
  }

  return refs;
}

/** Collect all variable references from a single flow element. */
function collectVarsFromElement(el: any): VarRef[] {
  const refs: VarRef[] = [];
  const elementId = el.id;

  refs.push(...collectFromExtensions(el));
  refs.push(...collectFromLoopCharacteristics(el, elementId));

  // Condition expression on sequence flows → read
  if (el.conditionExpression?.body) {
    pushExprReads(refs, el.conditionExpression.body, elementId);
  }

  return refs;
}

function ruleFactory() {
  function check(node: any, reporter: any) {
    // Only check at the process/subprocess level
    if (!isType(node, 'bpmn:Process') && !isType(node, 'bpmn:SubProcess')) return;

    const flowElements = node.flowElements || [];
    if (flowElements.length === 0) return;

    // Collect all variable references across all flow elements
    const allRefs: VarRef[] = [];
    for (const el of flowElements) {
      allRefs.push(...collectVarsFromElement(el));
    }

    // Build sets of written and read variables
    const writtenVars = new Set<string>();
    for (const ref of allRefs) {
      if (ref.access === 'write') writtenVars.add(ref.name);
    }

    // Report variables that are read but never written
    const reported = new Set<string>();
    for (const ref of allRefs) {
      if (ref.access !== 'read') continue;
      if (writtenVars.has(ref.name)) continue;
      const key = `${ref.elementId}:${ref.name}`;
      if (reported.has(key)) continue;
      reported.add(key);

      reporter.report(
        ref.elementId,
        `Variable "${ref.name}" is used but never defined in this process — ` +
          `ensure it is set by an output mapping, script result variable, or upstream process`
      );
    }
  }

  return { check };
}

export default ruleFactory;
