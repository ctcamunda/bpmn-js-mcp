/**
 * Tests for Zeebe extension element coverage:
 * - Listener serialization in get_bpmn_element_properties
 * - Call activity variable serialization in get_bpmn_element_properties
 * - Tool-discovery hints after add/replace
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleGetProperties,
  handleSetCamundaListeners,
  handleSetCallActivityVariables,
  handleAddElement,
  handleReplaceElement,
} from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../../helpers';

describe('get_bpmn_element_properties — listener serialization', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('serializes execution listener details', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'My Task',
      x: 200,
      y: 100,
    });
    await handleSetCamundaListeners({
      diagramId,
      elementId: taskId,
      executionListeners: [
        { eventType: 'start', type: 'start-worker' },
        { eventType: 'end', type: 'end-worker', retries: '3' },
      ],
    });

    const res = parseResult(await handleGetProperties({ diagramId, elementId: taskId }));
    const listenersExt = res.extensionElements.find(
      (e: any) => e.type === 'zeebe:ExecutionListeners'
    );
    expect(listenersExt).toBeDefined();
    expect(listenersExt.listeners).toHaveLength(2);
    expect(listenersExt.listeners[0].eventType).toBe('start');
    expect(listenersExt.listeners[0].type).toBe('start-worker');
  });

  test('serializes task listener details', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Review',
      x: 200,
      y: 100,
    });
    await handleSetCamundaListeners({
      diagramId,
      elementId: taskId,
      taskListeners: [{ eventType: 'complete', type: 'complete-worker' }],
    });

    const res = parseResult(await handleGetProperties({ diagramId, elementId: taskId }));
    const listenersExt = res.extensionElements.find(
      (e: any) => e.type === 'zeebe:TaskListeners'
    );
    expect(listenersExt).toBeDefined();
    expect(listenersExt.listeners).toHaveLength(1);
    expect(listenersExt.listeners[0].eventType).toBe('complete');
    expect(listenersExt.listeners[0].type).toBe('complete-worker');
  });
});

describe('get_bpmn_element_properties — call activity variable serialization', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('serializes call activity calledElement and I/O mappings', async () => {
    const diagramId = await createDiagram();
    const callId = await addElement(diagramId, 'bpmn:CallActivity', {
      name: 'Call Sub',
      x: 200,
      y: 100,
    });
    await handleSetCallActivityVariables({
      diagramId,
      elementId: callId,
      processId: 'child-process',
      inputMappings: [{ source: '=orderId', target: 'id' }],
      outputMappings: [{ source: '=result', target: 'subResult' }],
    });

    const res = parseResult(await handleGetProperties({ diagramId, elementId: callId }));
    const calledElement = res.extensionElements.find(
      (e: any) => e.type === 'zeebe:CalledElement'
    );
    expect(calledElement).toBeDefined();
    expect(calledElement.processId).toBe('child-process');

    const ioMapping = res.extensionElements.find(
      (e: any) => e.type === 'zeebe:IoMapping'
    );
    expect(ioMapping).toBeDefined();
  });
});

describe('tool-discovery hints', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('add_bpmn_element returns nextSteps for UserTask', async () => {
    const diagramId = await createDiagram();
    const res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Review',
      })
    );
    expect(res.nextSteps).toBeDefined();
    expect(res.nextSteps.length).toBeGreaterThan(0);
    expect(res.nextSteps.some((h: any) => h.tool === 'set_bpmn_form_data')).toBe(true);
  });

  test('add_bpmn_element returns nextSteps for ServiceTask', async () => {
    const diagramId = await createDiagram();
    const res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Call API',
      })
    );
    expect(res.nextSteps).toBeDefined();
    expect(res.nextSteps.some((h: any) => h.tool === 'set_bpmn_element_properties')).toBe(true);
  });

  test('add_bpmn_element returns nextSteps for ScriptTask', async () => {
    const diagramId = await createDiagram();
    const res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ScriptTask',
        name: 'Run Script',
      })
    );
    expect(res.nextSteps).toBeDefined();
    expect(res.nextSteps.some((h: any) => h.tool === 'set_bpmn_element_properties')).toBe(true);
  });

  test('add_bpmn_element returns nextSteps for CallActivity', async () => {
    const diagramId = await createDiagram();
    const res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:CallActivity',
        name: 'Call Sub',
      })
    );
    expect(res.nextSteps).toBeDefined();
    expect(res.nextSteps.some((h: any) => h.tool === 'set_bpmn_call_activity_variables')).toBe(
      true
    );
  });

  test('replace_bpmn_element returns nextSteps for new type', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:Task', { name: 'Generic' });

    const res = parseResult(
      await handleReplaceElement({
        diagramId,
        elementId: taskId,
        newType: 'bpmn:UserTask',
      })
    );
    expect(res.nextSteps).toBeDefined();
    expect(res.nextSteps.some((h: any) => h.tool === 'set_bpmn_form_data')).toBe(true);
  });

  test('add_bpmn_element returns no nextSteps for StartEvent', async () => {
    const diagramId = await createDiagram();
    const res = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
      })
    );
    expect(res.nextSteps).toBeUndefined();
  });
});
