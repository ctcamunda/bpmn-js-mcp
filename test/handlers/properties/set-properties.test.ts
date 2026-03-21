import { describe, test, expect, beforeEach } from 'vitest';
import { handleSetProperties, handleExportBpmn } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../../helpers';

describe('set_bpmn_element_properties', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('sets zeebe assignment definition on a user task', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Review',
    });

    const res = parseResult(
      await handleSetProperties({
        diagramId,
        elementId: taskId,
        properties: { 'zeebe:assignmentDefinition': { assignee: 'john' } },
      })
    );
    expect(res.success).toBe(true);
    expect(res.updatedProperties).toContain('zeebe:assignmentDefinition');

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('zeebe:assignmentDefinition');
    expect(xml).toContain('assignee="john"');
  });

  test('throws for unknown element', async () => {
    const diagramId = await createDiagram();
    await expect(
      handleSetProperties({
        diagramId,
        elementId: 'ghost',
        properties: { name: 'x' },
      })
    ).rejects.toThrow(/Element not found/);
  });

  test('sets zeebe task definition on a service task', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Process',
    });

    await handleSetProperties({
      diagramId,
      elementId: taskId,
      properties: { 'zeebe:taskDefinition': { type: 'process-order', retries: 3 } },
    });

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text as string;
    expect(xml).toContain('zeebe:taskDefinition');
    expect(xml).toContain('type="process-order"');
    expect(xml).toContain('retries="3"');
  });

  test('sets zeebe called decision on a business rule task', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:BusinessRuleTask', {
      name: 'Evaluate',
    });

    await handleSetProperties({
      diagramId,
      elementId: taskId,
      properties: { 'zeebe:calledDecision': { decisionId: 'myDecision', resultVariable: 'result' } },
    });

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text as string;
    expect(xml).toContain('zeebe:calledDecision');
    expect(xml).toContain('decisionId="myDecision"');
  });
});
