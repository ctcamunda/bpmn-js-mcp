import { describe, test, expect, beforeEach } from 'vitest';
import { handleSetFormData, handleExportBpmn, handleGetProperties } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../../helpers';

describe('set_bpmn_form_data', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('links a deployed form by formId', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Fill Form',
    });

    const res = parseResult(
      await handleSetFormData({
        diagramId,
        elementId: taskId,
        formId: 'invoice-form',
      })
    );
    expect(res.success).toBe(true);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('zeebe:formDefinition');
    expect(xml).toContain('formId="invoice-form"');
  });

  test('sets a custom formKey', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Select',
    });

    const res = parseResult(
      await handleSetFormData({
        diagramId,
        elementId: taskId,
        formKey: 'custom:my-form',
      })
    );
    expect(res.success).toBe(true);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('zeebe:formDefinition');
    expect(xml).toContain('formKey="custom:my-form"');
  });

  test('embeds Camunda Form JSON via formJson', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Validated',
    });

    const formJson = JSON.stringify({
      components: [
        { key: 'email', label: 'Email', type: 'textfield', validate: { required: true } },
      ],
    });

    const res = parseResult(
      await handleSetFormData({
        diagramId,
        elementId: taskId,
        formJson,
      })
    );
    expect(res.success).toBe(true);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('zeebe:userTaskForm');
    expect(xml).toContain('zeebe:formDefinition');
  });

  test('works on a StartEvent', async () => {
    const diagramId = await createDiagram();
    const startId = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
    });

    const res = parseResult(
      await handleSetFormData({
        diagramId,
        elementId: startId,
        formId: 'start-form',
      })
    );
    expect(res.success).toBe(true);

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('zeebe:formDefinition');
  });

  test('throws for non-UserTask/StartEvent elements', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Service',
    });

    await expect(
      handleSetFormData({
        diagramId,
        elementId: taskId,
        formId: 'some-form',
      })
    ).rejects.toThrow(/operation requires/);
  });

  test('is visible via get_element_properties', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Props Test',
    });

    await handleSetFormData({
      diagramId,
      elementId: taskId,
      formId: 'test-form',
    });

    const props = parseResult(await handleGetProperties({ diagramId, elementId: taskId }));
    expect(props.extensionElements).toBeDefined();
    const fd = props.extensionElements.find((e: any) => e.type === 'zeebe:FormDefinition');
    expect(fd).toBeDefined();
    expect(fd.formId).toBe('test-form');
  });
});
