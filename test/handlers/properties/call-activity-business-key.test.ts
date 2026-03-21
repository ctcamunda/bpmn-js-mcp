import { describe, test, expect, beforeEach } from 'vitest';
import { handleSetCallActivityVariables, handleExportBpmn } from '../../../src/handlers';
import { createDiagram, addElement, parseResult, clearDiagrams } from '../../helpers';

describe('set_bpmn_call_activity_variables — Zeebe CalledElement', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('sets processId on zeebe:CalledElement', async () => {
    const diagramId = await createDiagram();
    const callId = await addElement(diagramId, 'bpmn:CallActivity', { name: 'Call Sub' });

    const res = parseResult(
      await handleSetCallActivityVariables({
        diagramId,
        elementId: callId,
        processId: 'sub-process-id',
      })
    );
    expect(res.success).toBe(true);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('zeebe:calledElement');
    expect(xml).toContain('sub-process-id');
  });

  test('processId coexists with input/output mappings', async () => {
    const diagramId = await createDiagram();
    const callId = await addElement(diagramId, 'bpmn:CallActivity', { name: 'Sub' });

    const res = parseResult(
      await handleSetCallActivityVariables({
        diagramId,
        elementId: callId,
        processId: 'my-sub',
        inputMappings: [{ source: '=orderId', target: 'id' }],
        outputMappings: [{ source: '=result', target: 'subResult' }],
      })
    );
    expect(res.success).toBe(true);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('zeebe:calledElement');
    expect(xml).toContain('orderId');
    expect(xml).toContain('subResult');
  });
});
