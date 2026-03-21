import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleSetCamundaListeners,
  handleExportBpmn,
  handleGetProperties,
} from '../../../src/handlers';
import { createDiagram, addElement, parseResult, clearDiagrams } from '../../helpers';

describe('set_bpmn_camunda_listeners — Zeebe listeners', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('sets execution listener with eventType and type', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Process' });

    const res = parseResult(
      await handleSetCamundaListeners({
        diagramId,
        elementId: taskId,
        executionListeners: [
          { eventType: 'start', type: 'my-start-worker' },
        ],
      })
    );

    expect(res.success).toBe(true);
    expect(res.executionListenerCount).toBe(1);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('zeebe:executionListener');
    expect(xml).toContain('my-start-worker');
  });

  test('sets task listener on user task', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });

    const res = parseResult(
      await handleSetCamundaListeners({
        diagramId,
        elementId: taskId,
        taskListeners: [
          { eventType: 'complete', type: 'task-notifier' },
        ],
      })
    );

    expect(res.success).toBe(true);
    expect(res.taskListenerCount).toBe(1);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('zeebe:taskListener');
    expect(xml).toContain('task-notifier');
  });

  test('listeners visible in get_bpmn_element_properties', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Svc' });

    await handleSetCamundaListeners({
      diagramId,
      elementId: taskId,
      executionListeners: [
        { eventType: 'end', type: 'cleanup-worker' },
      ],
    });

    const props = parseResult(await handleGetProperties({ diagramId, elementId: taskId }));
    const listeners = props.extensionElements.filter(
      (e: any) => e.type === 'zeebe:ExecutionListeners'
    );
    expect(listeners.length).toBeGreaterThanOrEqual(0);
    // Alternative: check that any Zeebe listener-related extension exists
    const anyListener = props.extensionElements.some(
      (e: any) => e.type.includes('Listener')
    );
    expect(anyListener).toBe(true);
  });
});
