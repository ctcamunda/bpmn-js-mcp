import { describe, test, expect, beforeEach } from 'vitest';
import { handleSetInputOutput, handleExportBpmn, handleGetProperties } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../../helpers';

describe('set_bpmn_input_output_mapping — Zeebe IoMapping', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('sets FEEL expression input mappings', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'ListTask' });

    const res = parseResult(
      await handleSetInputOutput({
        diagramId,
        elementId: taskId,
        inputParameters: [
          { source: '=["alice","bob","charlie"]', target: 'recipients' },
        ],
      })
    );
    expect(res.success).toBe(true);
    expect(res.inputParameterCount).toBe(1);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('zeebe:ioMapping');
    expect(xml).toContain('recipients');
  });

  test('sets FEEL context (map) input mapping', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'MapTask' });

    const res = parseResult(
      await handleSetInputOutput({
        diagramId,
        elementId: taskId,
        inputParameters: [
          { source: '={"Content-Type":"application/json","Accept":"text/plain"}', target: 'headers' },
        ],
      })
    );
    expect(res.success).toBe(true);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('zeebe:ioMapping');
    expect(xml).toContain('headers');
  });

  test('sets multiple input and output mappings', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'MultiIO' });

    const res = parseResult(
      await handleSetInputOutput({
        diagramId,
        elementId: taskId,
        inputParameters: [
          { source: '=items', target: 'localItems' },
          { source: '=config', target: 'localConfig' },
        ],
        outputParameters: [{ source: '=result', target: 'processResult' }],
      })
    );
    expect(res.success).toBe(true);
    expect(res.inputParameterCount).toBe(2);
    expect(res.outputParameterCount).toBe(1);
  });

  test('IoMapping is visible in get_bpmn_element_properties', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'PropTest' });

    await handleSetInputOutput({
      diagramId,
      elementId: taskId,
      inputParameters: [
        { source: '=items', target: 'localItems' },
        { source: '=config', target: 'localConfig' },
      ],
      outputParameters: [{ source: '=output', target: 'result' }],
    });

    const props = parseResult(await handleGetProperties({ diagramId, elementId: taskId }));
    const io = props.extensionElements.find((e: any) => e.type === 'zeebe:IoMapping');
    expect(io).toBeDefined();
  });
});
