import { describe, test, expect, beforeEach } from 'vitest';
import { handleSetProperties, handleExportBpmn } from '../../../src/handlers';
import { createDiagram, addElement, parseResult, clearDiagrams } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('set_bpmn_element_properties — ScriptTask script handling', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('sets scriptFormat and inline script on ScriptTask', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ScriptTask', { name: 'MyScript' });

    const res = parseResult(
      await handleSetProperties({
        diagramId,
        elementId: taskId,
        properties: {
          scriptFormat: 'feel',
          script: 'order.total * 1.1',
        },
      })
    );

    expect(res.success).toBe(true);

    // Verify on the business object
    const diagram = getDiagram(diagramId)!;
    const registry = diagram.modeler.get('elementRegistry');
    const bo = registry.get(taskId).businessObject;
    expect(bo.scriptFormat).toBe('feel');
    expect(bo.script).toBe('order.total * 1.1');
  });

  test('sets zeebe:script with resultVariable on ScriptTask', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ScriptTask');

    await handleSetProperties({
      diagramId,
      elementId: taskId,
      properties: {
        'zeebe:script': { expression: '=x + 1', resultVariable: 'myResult' },
      },
    });

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text as string;
    expect(xml).toContain('zeebe:script');
    expect(xml).toContain('resultVariable="myResult"');
  });

  test('script is present in exported XML', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ScriptTask');

    await handleSetProperties({
      diagramId,
      elementId: taskId,
      properties: {
        scriptFormat: 'feel',
        script: 'if done then "yes" else "no"',
      },
    });

    const diagram = getDiagram(diagramId)!;
    const { xml } = await diagram.modeler.saveXML({ format: true });
    expect(xml).toContain('scriptFormat="feel"');
    expect(xml).toContain('if done then "yes" else "no"');
  });
});
