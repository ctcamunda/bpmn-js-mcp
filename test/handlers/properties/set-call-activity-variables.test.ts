import { describe, test, expect, beforeEach } from 'vitest';
import { handleSetCallActivityVariables, handleExportBpmn } from '../../../src/handlers';
import { createDiagram, addElement, parseResult, clearDiagrams } from '../../helpers';

describe('set_bpmn_call_activity_variables', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('sets processId and I/O mappings on a CallActivity', async () => {
    const diagramId = await createDiagram();
    const callId = await addElement(diagramId, 'bpmn:CallActivity', { name: 'Subprocess' });

    const res = parseResult(
      await handleSetCallActivityVariables({
        diagramId,
        elementId: callId,
        processId: 'child-process',
        inputMappings: [
          { source: '=orderId', target: 'inputOrderId' },
          { source: '=customer.name', target: 'customerName' },
        ],
        outputMappings: [{ source: '=result', target: 'subprocessResult' }],
      })
    );

    expect(res.success).toBe(true);
    expect(res.inputMappingCount).toBe(2);
    expect(res.outputMappingCount).toBe(1);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('zeebe:calledElement');
    expect(xml).toContain('processId="child-process"');
    expect(xml).toContain('zeebe:ioMapping');
  });

  test('supports propagateAllChildVariables', async () => {
    const diagramId = await createDiagram();
    const callId = await addElement(diagramId, 'bpmn:CallActivity', { name: 'Sub' });

    const res = parseResult(
      await handleSetCallActivityVariables({
        diagramId,
        elementId: callId,
        processId: 'sub-process',
        propagateAllChildVariables: true,
      })
    );

    expect(res.success).toBe(true);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('zeebe:calledElement');
    expect(xml).toContain('processId="sub-process"');
  });

  test('rejects on non-CallActivity elements', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });

    await expect(
      handleSetCallActivityVariables({
        diagramId,
        elementId: taskId,
        processId: 'x',
      })
    ).rejects.toThrow(/operation requires.*bpmn:CallActivity/i);
  });

  test('requires at least one argument', async () => {
    const diagramId = await createDiagram();
    const callId = await addElement(diagramId, 'bpmn:CallActivity', { name: 'Sub' });

    await expect(
      handleSetCallActivityVariables({
        diagramId,
        elementId: callId,
      })
    ).rejects.toThrow(/Missing required/i);
  });
});
