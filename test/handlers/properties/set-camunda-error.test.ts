import { describe, test, expect, beforeEach } from 'vitest';
import { handleSetEventDefinition, handleExportBpmn } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../../helpers';

describe('error event definition — Zeebe', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('sets error event definition on a boundary event', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'External Task',
    });
    const boundaryId = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      hostElementId: taskId,
    });

    const res = parseResult(
      await handleSetEventDefinition({
        diagramId,
        elementId: boundaryId,
        eventDefinitionType: 'bpmn:ErrorEventDefinition',
        errorRef: {
          id: 'Error_Biz',
          name: 'Business Error',
          errorCode: 'BIZ_ERR',
        },
      })
    );
    expect(res.success).toBe(true);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('errorEventDefinition');
    expect(xml).toContain('BIZ_ERR');
  });

  test('throws error definition on non-event element', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Service',
    });

    await expect(
      handleSetEventDefinition({
        diagramId,
        elementId: taskId,
        eventDefinitionType: 'bpmn:ErrorEventDefinition',
      })
    ).rejects.toThrow(/operation requires/);
  });
});
