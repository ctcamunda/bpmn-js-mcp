/**
 * Handler for set_element_properties tool.
 *
 * Supports standard BPMN properties and Zeebe (Camunda 8) extensions with
 * the zeebe: prefix. Properties prefixed with zeebe: are mapped to the
 * corresponding Zeebe extension elements (TaskDefinition, AssignmentDefinition,
 * FormDefinition, Properties, etc.).
 *
 * Supports the `default` attribute on gateways by resolving the sequence flow
 * business object from a string ID.
 *
 * For loop characteristics, use the dedicated set_loop_characteristics tool.
 */
// @mutating

import { type ToolResult } from '../../types';
import {
  requireDiagram,
  requireElement,
  jsonResult,
  syncXml,
  validateArgs,
  upsertExtensionElement,
  getService,
  buildPropertyHints,
} from '../helpers';
import { appendLintFeedback } from '../../linter';
import { handleScriptProperties } from './set-script-properties';
import { handleReplaceElement } from '../elements/replace-element';

export interface SetPropertiesArgs {
  diagramId: string;
  elementId: string;
  properties: Record<string, any>;
  /**
   * Optional element type replacement. When provided, replaces the element type
   * (e.g. bpmn:Task → bpmn:UserTask) before setting properties.
   * Equivalent to the former replace_bpmn_element tool.
   */
  elementType?: string;
}

// ── Sub-functions for special-case property handling ───────────────────────

/**
 * Handle `default` property on gateways — requires a BO reference, not a string.
 * Uses updateModdleProperties to avoid ReplaceConnectionBehavior's postExecuted
 * handler which fails in headless mode.  Mutates `standardProps` in-place
 * (deletes the key after moddle-level BO assignment).
 */
function handleDefaultOnGateway(
  element: any,
  standardProps: Record<string, any>,
  elementRegistry: any,
  modeling: any
): void {
  if (standardProps['default'] == null) return;

  const elType = element.type || element.businessObject?.$type || '';
  if (!elType.includes('ExclusiveGateway') && !elType.includes('InclusiveGateway')) return;

  const flowId = standardProps['default'];
  if (typeof flowId === 'string') {
    const flowEl = elementRegistry.get(flowId);
    if (flowEl) {
      modeling.updateModdleProperties(element, element.businessObject, {
        default: flowEl.businessObject,
      });
      delete standardProps['default'];
    }
  }
}

/**
 * Handle `conditionExpression` — wraps plain string into a FormalExpression.
 * Mutates `standardProps` in-place.
 */
function handleConditionExpression(standardProps: Record<string, any>, moddle: any): void {
  const ceValue = standardProps['conditionExpression'];
  if (ceValue == null || typeof ceValue !== 'string') return;

  standardProps['conditionExpression'] = moddle.create('bpmn:FormalExpression', { body: ceValue });
}

/**
 * Handle `isExpanded` on SubProcess via bpmnReplace — this properly
 * creates/removes BPMNPlane elements and adjusts the shape size.
 * Setting isExpanded via updateProperties would incorrectly place it
 * on the business object instead of the DI shape.
 * Returns the (possibly replaced) element.  Mutates `props` in-place.
 */
function handleIsExpandedOnSubProcess(element: any, props: Record<string, any>, diagram: any): any {
  if (!('isExpanded' in props)) return element;

  const elType = element.type || element.businessObject?.$type || '';
  if (!elType.includes('SubProcess')) return element;

  const wantExpanded = !!props['isExpanded'];
  const currentlyExpanded = element.di?.isExpanded === true;
  delete props['isExpanded'];

  if (wantExpanded === currentlyExpanded) return element;

  try {
    const bpmnReplace = getService(diagram.modeler, 'bpmnReplace');
    const newElement = bpmnReplace.replaceElement(element, {
      type: elType,
      isExpanded: wantExpanded,
    });
    return newElement || element;
  } catch {
    // Fallback: directly set on DI if bpmnReplace fails
    if (element.di) {
      element.di.isExpanded = wantExpanded;
    }
    return element;
  }
}

/**
 * Handle `zeebe:taskDefinition` — creates/removes zeebe:TaskDefinition
 * extension element. Mutates `zeebeProps` in-place (deletes the key after processing).
 */
function handleTaskDefinition(element: any, zeebeProps: Record<string, any>, diagram: any): void {
  if (!('zeebe:taskDefinition' in zeebeProps)) return;

  const moddle = getService(diagram.modeler, 'moddle');
  const modeling = getService(diagram.modeler, 'modeling');
  const bo = element.businessObject;
  const tdDef = zeebeProps['zeebe:taskDefinition'];
  delete zeebeProps['zeebe:taskDefinition'];

  if (tdDef == null || (typeof tdDef === 'object' && !tdDef.type)) {
    // Remove existing TaskDefinition
    const extensionElements = bo.extensionElements;
    if (extensionElements?.values) {
      extensionElements.values = extensionElements.values.filter(
        (v: any) => v.$type !== 'zeebe:TaskDefinition'
      );
      modeling.updateProperties(element, { extensionElements });
    }
    return;
  }

  const attrs: Record<string, any> = {};
  if (typeof tdDef === 'string') {
    attrs.type = tdDef;
  } else {
    if (tdDef.type) attrs.type = tdDef.type;
    if (tdDef.retries != null) attrs.retries = String(tdDef.retries);
  }

  const tdEl = moddle.create('zeebe:TaskDefinition', attrs);
  upsertExtensionElement(moddle, bo, modeling, element, 'zeebe:TaskDefinition', tdEl);
}

/**
 * Handle `zeebe:assignmentDefinition` — creates/removes zeebe:AssignmentDefinition
 * extension element for user task assignment.
 * Mutates `zeebeProps` in-place (deletes the key after processing).
 */
function handleAssignmentDefinition(element: any, zeebeProps: Record<string, any>, diagram: any): void {
  if (!('zeebe:assignmentDefinition' in zeebeProps)) return;

  const moddle = getService(diagram.modeler, 'moddle');
  const modeling = getService(diagram.modeler, 'modeling');
  const bo = element.businessObject;
  const assignDef = zeebeProps['zeebe:assignmentDefinition'];
  delete zeebeProps['zeebe:assignmentDefinition'];

  if (assignDef == null || (typeof assignDef === 'object' && Object.keys(assignDef).length === 0)) {
    const extensionElements = bo.extensionElements;
    if (extensionElements?.values) {
      extensionElements.values = extensionElements.values.filter(
        (v: any) => v.$type !== 'zeebe:AssignmentDefinition'
      );
      modeling.updateProperties(element, { extensionElements });
    }
    return;
  }

  const attrs: Record<string, any> = {};
  if (assignDef.assignee) attrs.assignee = assignDef.assignee;
  if (assignDef.candidateGroups) attrs.candidateGroups = assignDef.candidateGroups;
  if (assignDef.candidateUsers) attrs.candidateUsers = assignDef.candidateUsers;

  const adEl = moddle.create('zeebe:AssignmentDefinition', attrs);
  upsertExtensionElement(moddle, bo, modeling, element, 'zeebe:AssignmentDefinition', adEl);
}

/**
 * Handle `zeebe:formDefinition` — creates/removes zeebe:FormDefinition
 * extension element for user task forms.
 * Mutates `zeebeProps` in-place (deletes the key after processing).
 */
function handleFormDefinition(element: any, zeebeProps: Record<string, any>, diagram: any): void {
  if (!('zeebe:formDefinition' in zeebeProps)) return;

  const moddle = getService(diagram.modeler, 'moddle');
  const modeling = getService(diagram.modeler, 'modeling');
  const bo = element.businessObject;
  const formDef = zeebeProps['zeebe:formDefinition'];
  delete zeebeProps['zeebe:formDefinition'];

  if (formDef == null || (typeof formDef === 'object' && !formDef.formId && !formDef.formKey)) {
    const extensionElements = bo.extensionElements;
    if (extensionElements?.values) {
      extensionElements.values = extensionElements.values.filter(
        (v: any) => v.$type !== 'zeebe:FormDefinition'
      );
      modeling.updateProperties(element, { extensionElements });
    }
    return;
  }

  const attrs: Record<string, any> = {};
  if (typeof formDef === 'string') {
    attrs.formId = formDef;
  } else {
    if (formDef.formId) attrs.formId = formDef.formId;
    if (formDef.formKey) attrs.formKey = formDef.formKey;
  }

  const fdEl = moddle.create('zeebe:FormDefinition', attrs);
  upsertExtensionElement(moddle, bo, modeling, element, 'zeebe:FormDefinition', fdEl);
}

/**
 * Handle `zeebe:properties` — creates zeebe:Properties extension element with
 * zeebe:Property children for generic key-value metadata.
 *
 * Expected format: `Record<string, string>` (key-value pairs).
 * Set to `null` or empty object to remove.
 * Mutates `zeebeProps` in-place (deletes the key after processing).
 */
function handleZeebeProperties(element: any, zeebeProps: Record<string, any>, diagram: any): void {
  if (!('zeebe:properties' in zeebeProps)) return;

  const moddle = getService(diagram.modeler, 'moddle');
  const modeling = getService(diagram.modeler, 'modeling');
  const bo = element.businessObject;
  const propsMap = zeebeProps['zeebe:properties'];
  delete zeebeProps['zeebe:properties'];

  if (propsMap == null || (typeof propsMap === 'object' && Object.keys(propsMap).length === 0)) {
    const extensionElements = bo.extensionElements;
    if (extensionElements?.values) {
      extensionElements.values = extensionElements.values.filter(
        (v: any) => v.$type !== 'zeebe:Properties'
      );
      modeling.updateProperties(element, { extensionElements });
    }
    return;
  }

  const propertyValues = Object.entries(propsMap).map(([name, value]) =>
    moddle.create('zeebe:Property', { name, value: String(value) })
  );

  const propertiesEl = moddle.create('zeebe:Properties', { values: propertyValues });
  upsertExtensionElement(moddle, bo, modeling, element, 'zeebe:Properties', propertiesEl);
}

/**
 * Handle `zeebe:calledDecision` — creates/removes zeebe:CalledDecision extension element.
 * Mutates `zeebeProps` in-place.
 */
function handleCalledDecision(element: any, zeebeProps: Record<string, any>, diagram: any): void {
  if (!('zeebe:calledDecision' in zeebeProps)) return;

  const moddle = getService(diagram.modeler, 'moddle');
  const modeling = getService(diagram.modeler, 'modeling');
  const bo = element.businessObject;
  const cdDef = zeebeProps['zeebe:calledDecision'];
  delete zeebeProps['zeebe:calledDecision'];

  if (cdDef == null) {
    const extensionElements = bo.extensionElements;
    if (extensionElements?.values) {
      extensionElements.values = extensionElements.values.filter(
        (v: any) => v.$type !== 'zeebe:CalledDecision'
      );
      modeling.updateProperties(element, { extensionElements });
    }
    return;
  }

  const attrs: Record<string, any> = {};
  if (cdDef.decisionId) attrs.decisionId = cdDef.decisionId;
  if (cdDef.resultVariable) attrs.resultVariable = cdDef.resultVariable;

  const cdEl = moddle.create('zeebe:CalledDecision', attrs);
  upsertExtensionElement(moddle, bo, modeling, element, 'zeebe:CalledDecision', cdEl);
}

/**
 * Handle `zeebe:calledElement` — creates/removes zeebe:CalledElement extension element
 * for call activities.
 * Mutates `zeebeProps` in-place.
 */
function handleCalledElement(element: any, zeebeProps: Record<string, any>, diagram: any): void {
  if (!('zeebe:calledElement' in zeebeProps)) return;

  const moddle = getService(diagram.modeler, 'moddle');
  const modeling = getService(diagram.modeler, 'modeling');
  const bo = element.businessObject;
  const ceDef = zeebeProps['zeebe:calledElement'];
  delete zeebeProps['zeebe:calledElement'];

  if (ceDef == null) {
    const extensionElements = bo.extensionElements;
    if (extensionElements?.values) {
      extensionElements.values = extensionElements.values.filter(
        (v: any) => v.$type !== 'zeebe:CalledElement'
      );
      modeling.updateProperties(element, { extensionElements });
    }
    return;
  }

  const attrs: Record<string, any> = {};
  if (typeof ceDef === 'string') {
    attrs.processId = ceDef;
  } else {
    if (ceDef.processId) attrs.processId = ceDef.processId;
    if (ceDef.propagateAllChildVariables != null) attrs.propagateAllChildVariables = ceDef.propagateAllChildVariables;
  }

  const ceEl = moddle.create('zeebe:CalledElement', attrs);
  upsertExtensionElement(moddle, bo, modeling, element, 'zeebe:CalledElement', ceEl);
}

/**
 * Handle `zeebe:script` — creates/removes zeebe:Script extension element
 * for FEEL script tasks.
 * Mutates `zeebeProps` in-place.
 */
function handleZeebeScript(element: any, zeebeProps: Record<string, any>, diagram: any): void {
  if (!('zeebe:script' in zeebeProps)) return;

  const moddle = getService(diagram.modeler, 'moddle');
  const modeling = getService(diagram.modeler, 'modeling');
  const bo = element.businessObject;
  const scriptDef = zeebeProps['zeebe:script'];
  delete zeebeProps['zeebe:script'];

  if (scriptDef == null) {
    const extensionElements = bo.extensionElements;
    if (extensionElements?.values) {
      extensionElements.values = extensionElements.values.filter(
        (v: any) => v.$type !== 'zeebe:Script'
      );
      modeling.updateProperties(element, { extensionElements });
    }
    return;
  }

  const attrs: Record<string, any> = {};
  if (scriptDef.expression) attrs.expression = scriptDef.expression;
  if (scriptDef.resultVariable) attrs.resultVariable = scriptDef.resultVariable;

  const sEl = moddle.create('zeebe:Script', attrs);
  upsertExtensionElement(moddle, bo, modeling, element, 'zeebe:Script', sEl);
}

// ── Main handler ───────────────────────────────────────────────────────────

/**
 * Apply standard and Zeebe properties to an element.
 * Handles special cases: task definition, assignment definition, form definition,
 * called decision, called element, script, zeebe properties,
 * script properties, documentation, and empty-string zeebe attribute skipping.
 */
function applyPropsToElement(
  element: any,
  standardProps: Record<string, any>,
  zeebeProps: Record<string, any>,
  diagram: ReturnType<typeof requireDiagram>
): void {
  const modeling = getService(diagram.modeler, 'modeling');

  // Handle Zeebe extension elements
  handleTaskDefinition(element, zeebeProps, diagram);
  handleAssignmentDefinition(element, zeebeProps, diagram);
  handleFormDefinition(element, zeebeProps, diagram);
  handleZeebeProperties(element, zeebeProps, diagram);
  handleCalledDecision(element, zeebeProps, diagram);
  handleCalledElement(element, zeebeProps, diagram);
  handleZeebeScript(element, zeebeProps, diagram);
  // Handle script-related properties (scriptFormat, script) on ScriptTasks
  handleScriptProperties(element, standardProps, zeebeProps, diagram);

  // Handle `documentation` — creates/updates bpmn:documentation child element
  if ('documentation' in standardProps) {
    const moddle = getService(diagram.modeler, 'moddle');
    const bo = element.businessObject;
    const docText = standardProps['documentation'];
    delete standardProps['documentation'];
    if (docText != null && docText !== '') {
      const docElement = moddle.create('bpmn:Documentation', { text: String(docText) });
      docElement.$parent = bo;
      bo.documentation = [docElement];
      modeling.updateProperties(element, { documentation: bo.documentation });
    } else {
      bo.documentation = [];
      modeling.updateProperties(element, { documentation: bo.documentation });
    }
  }

  if (Object.keys(standardProps).length > 0) {
    modeling.updateProperties(element, standardProps);
  }

  // Strip empty-string zeebe extension attributes — they are misleading
  // in the XML and should simply be omitted.
  const nonEmptyZeebeProps: Record<string, any> = {};
  for (const [key, value] of Object.entries(zeebeProps)) {
    if (value !== '') nonEmptyZeebeProps[key] = value;
  }
  if (Object.keys(nonEmptyZeebeProps).length > 0) {
    modeling.updateProperties(element, nonEmptyZeebeProps);
  }
}

export async function handleSetProperties(args: SetPropertiesArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementId', 'properties']);
  const { diagramId, elementId, properties: props } = args;

  // If elementType is provided, delegate to replace handler first
  if (args.elementType) {
    const replaceResult = await handleReplaceElement({
      diagramId,
      elementId,
      newType: args.elementType,
    });
    const replaceData = JSON.parse(replaceResult.content[0].text as string);
    // If no additional properties to set, return the replace result
    if (!props || Object.keys(props).length === 0) {
      return replaceResult;
    }
    // Use the new element ID for subsequent property setting (may have changed)
    const newElementId = replaceData.elementId || elementId;
    const updatedArgs = { ...args, elementId: newElementId, elementType: undefined };
    const propsResult = await handleSetProperties(updatedArgs);
    // Merge newType into the final result so callers can see the type change
    const propsData = JSON.parse(propsResult.content[0].text as string);
    return jsonResult({ ...propsData, newType: args.elementType });
  }

  const diagram = requireDiagram(diagramId);
  const modeling = getService(diagram.modeler, 'modeling');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');

  let element = requireElement(elementRegistry, elementId);
  element = handleIsExpandedOnSubProcess(element, props, diagram);

  const standardProps: Record<string, any> = {};
  const zeebeProps: Record<string, any> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('zeebe:')) zeebeProps[key] = value;
    else standardProps[key] = value;
  }

  handleDefaultOnGateway(element, standardProps, elementRegistry, modeling);
  handleConditionExpression(standardProps, getService(diagram.modeler, 'moddle'));

  applyPropsToElement(element, standardProps, zeebeProps, diagram);

  await syncXml(diagram);

  const hints = buildPropertyHints(props, zeebeProps, element);
  const result = jsonResult({
    success: true,
    elementId: element.id,
    updated: [{ id: element.id, changed: Object.keys(args.properties) }],
    updatedProperties: Object.keys(args.properties),
    message: `Updated properties on ${element.id}`,
    ...(element.id !== elementId
      ? { note: `Element ID changed from ${elementId} to ${element.id}` }
      : {}),
    ...(hints.length > 0 ? { nextSteps: hints } : {}),
  });
  return appendLintFeedback(result, diagram);
}

const EXAMPLE_DIAGRAM_ID = '<diagram-id>';

export const TOOL_DEFINITION = {
  name: 'set_bpmn_element_properties',
  description:
    'Set BPMN or Zeebe (Camunda 8) extension properties on an element. ' +
    'Supports standard properties (name, isExecutable, documentation, default, conditionExpression) ' +
    'and Zeebe extensions via structured objects: zeebe:taskDefinition, zeebe:assignmentDefinition, ' +
    'zeebe:formDefinition, zeebe:calledDecision, zeebe:calledElement, zeebe:script, zeebe:properties. ' +
    'Also handles: scriptFormat/script on ScriptTask, isExpanded on SubProcess, and cancelActivity on BoundaryEvent. ' +
    'For I/O mappings, use set_bpmn_input_output_mapping. ' +
    'For loop characteristics, use set_bpmn_loop_characteristics. ' +
    'Supports optional elementType to replace the element type (e.g. bpmn:Task → bpmn:UserTask) — ' +
    'equivalent to the former replace_bpmn_element tool.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      elementId: {
        type: 'string',
        description: 'The ID of the element to update',
      },
      properties: {
        type: 'object',
        description:
          'Key-value pairs of properties to set. Use zeebe: prefix for Zeebe extension elements ' +
          '(e.g. { "zeebe:taskDefinition": { "type": "my-worker", "retries": "3" } }).',
        additionalProperties: true,
      },
      elementType: {
        type: 'string',
        description:
          'Optional element type to replace the element with (e.g. "bpmn:UserTask", "bpmn:ServiceTask"). ' +
          'When provided, replaces the element type before setting properties.',
        enum: [
          'bpmn:Task',
          'bpmn:UserTask',
          'bpmn:ServiceTask',
          'bpmn:ScriptTask',
          'bpmn:ManualTask',
          'bpmn:BusinessRuleTask',
          'bpmn:SendTask',
          'bpmn:ReceiveTask',
          'bpmn:CallActivity',
          'bpmn:ExclusiveGateway',
          'bpmn:ParallelGateway',
          'bpmn:InclusiveGateway',
          'bpmn:EventBasedGateway',
          'bpmn:IntermediateCatchEvent',
          'bpmn:IntermediateThrowEvent',
          'bpmn:StartEvent',
          'bpmn:EndEvent',
          'bpmn:SubProcess',
        ],
      },
    },
    required: ['diagramId', 'elementId', 'properties'],
    examples: [
      {
        title: 'Configure a service task with Zeebe task definition',
        value: {
          diagramId: EXAMPLE_DIAGRAM_ID,
          elementId: 'ServiceTask_ProcessPayment',
          properties: {
            'zeebe:taskDefinition': { type: 'process-payment', retries: '3' },
          },
        },
      },
      {
        title: 'Assign a user task',
        value: {
          diagramId: EXAMPLE_DIAGRAM_ID,
          elementId: 'UserTask_ReviewOrder',
          properties: {
            'zeebe:assignmentDefinition': { assignee: '=assigneeEmail', candidateGroups: 'managers' },
          },
        },
      },
      {
        title: 'Set a condition on a sequence flow',
        value: {
          diagramId: EXAMPLE_DIAGRAM_ID,
          elementId: 'Flow_Approved',
          properties: {
            name: 'Yes',
            conditionExpression: '=approved',
          },
        },
      },
      {
        title: 'Set the default flow on an exclusive gateway',
        value: {
          diagramId: EXAMPLE_DIAGRAM_ID,
          elementId: 'Gateway_OrderValid',
          properties: {
            default: 'Flow_Approved',
          },
        },
      },
      {
        title: 'Set a FEEL script on a ScriptTask',
        value: {
          diagramId: EXAMPLE_DIAGRAM_ID,
          elementId: 'ScriptTask_CalcTotal',
          properties: {
            'zeebe:script': { expression: '=sum(orderItems.price * orderItems.quantity)', resultVariable: 'orderTotal' },
          },
        },
      },
    ],
  },
} as const;
