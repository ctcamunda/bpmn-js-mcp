import { describe, test, expect, beforeEach } from 'vitest';
import { handleSetInputOutput, handleExportBpmn, handleGetProperties } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../../helpers';

describe('set_bpmn_input_output_mapping', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('sets input/output parameters on a task', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'External',
    });

    const res = parseResult(
      await handleSetInputOutput({
        diagramId,
        elementId: taskId,
        inputParameters: [
          { source: '=orderId', target: 'orderId' },
          { source: '=order.total', target: 'amount' },
        ],
        outputParameters: [{ source: '=result', target: 'result' }],
      })
    );
    expect(res.success).toBe(true);
    expect(res.inputParameterCount).toBe(2);
    expect(res.outputParameterCount).toBe(1);

    // Verify it shows up in XML
    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('zeebe:ioMapping');
    expect(xml).toContain('orderId');
  });

  test('works with get_element_properties', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'IO Task',
    });

    await handleSetInputOutput({
      diagramId,
      elementId: taskId,
      inputParameters: [{ source: '=val1', target: 'var1' }],
    });

    const props = parseResult(await handleGetProperties({ diagramId, elementId: taskId }));
    expect(props.extensionElements).toBeDefined();
    const io = props.extensionElements.find((e: any) => e.type === 'zeebe:IoMapping');
    expect(io).toBeDefined();
    expect(io.inputParameters[0].target).toBe('var1');
  });
});

describe('set_bpmn_input_output_mapping — FEEL expressions', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('produces correct XML for FEEL expressions', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Expr Test',
    });

    await handleSetInputOutput({
      diagramId,
      elementId: taskId,
      inputParameters: [{ source: '=processVariable', target: 'myInput' }],
    });

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('zeebe:input');
    expect(xml).toContain('source');
    expect(xml).toContain('target');
  });

  test('round-trips via get_element_properties', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'No Source',
    });

    await handleSetInputOutput({
      diagramId,
      elementId: taskId,
      inputParameters: [{ source: '=static', target: 'var1' }],
    });

    const props = parseResult(await handleGetProperties({ diagramId, elementId: taskId }));
    const io = props.extensionElements.find((e: any) => e.type === 'zeebe:IoMapping');
    expect(io).toBeDefined();
    expect(io.inputParameters[0].source).toBe('=static');
    expect(io.inputParameters[0].target).toBe('var1');
  });
});
