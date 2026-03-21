import { describe, test, expect, beforeEach } from 'vitest';
import { handleSetCamundaListeners, handleExportBpmn } from '../../../src/handlers';
import { createDiagram, addElement, parseResult, clearDiagrams } from '../../helpers';

describe('set_bpmn_camunda_listeners', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('sets execution listeners on a service task', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Process' });

    const res = parseResult(
      await handleSetCamundaListeners({
        diagramId,
        elementId: taskId,
        executionListeners: [
          { eventType: 'start', type: 'start-listener-worker' },
          { eventType: 'end', type: 'end-listener-worker', retries: '3' },
        ],
      })
    );

    expect(res.success).toBe(true);
    expect(res.executionListenerCount).toBe(2);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('zeebe:executionListeners');
    expect(xml).toContain('start-listener-worker');
    expect(xml).toContain('end-listener-worker');
  });

  test('sets task listeners on a user task', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });

    const res = parseResult(
      await handleSetCamundaListeners({
        diagramId,
        elementId: taskId,
        taskListeners: [{ eventType: 'complete', type: 'task-complete-worker' }],
      })
    );

    expect(res.success).toBe(true);
    expect(res.taskListenerCount).toBe(1);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('zeebe:taskListeners');
  });

  test('rejects task listeners on non-UserTask', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Auto' });

    await expect(
      handleSetCamundaListeners({
        diagramId,
        elementId: taskId,
        taskListeners: [{ eventType: 'complete', type: 'nope-worker' }],
      })
    ).rejects.toThrow(/UserTask/);
  });

  test('sets execution listener with retries', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Retry' });

    const res = parseResult(
      await handleSetCamundaListeners({
        diagramId,
        elementId: taskId,
        executionListeners: [
          { eventType: 'start', type: 'retry-worker', retries: '5' },
        ],
      })
    );

    expect(res.success).toBe(true);
    expect(res.executionListenerCount).toBe(1);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('zeebe:executionListeners');
    expect(xml).toContain('retries="5"');
  });

  test('requires at least one listener', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'X' });

    await expect(
      handleSetCamundaListeners({
        diagramId,
        elementId: taskId,
      })
    ).rejects.toThrow(/Missing required/i);
  });
});
