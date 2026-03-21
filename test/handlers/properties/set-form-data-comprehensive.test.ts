/**
 * Comprehensive tests for set_bpmn_form_data (Zeebe / Camunda 8).
 *
 * Tests the three form-linking modes:
 *   formId  — link a deployed Camunda Form
 *   formKey — custom external form key
 *   formJson — embed Camunda Form JSON inline (zeebe:UserTaskForm)
 *
 * Also covers get_properties round-trip and element-type validation.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleSetFormData, handleGetProperties } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../../helpers';

/** Extract zeebe:FormDefinition from extensionElements returned by get_properties. */
function getFormDef(props: any): any {
  return props.extensionElements?.find((e: any) => e.type === 'zeebe:FormDefinition');
}
/** Extract zeebe:UserTaskForm from extensionElements returned by get_properties. */
function getUserTaskForm(props: any): any {
  return props.extensionElements?.find((e: any) => e.type === 'zeebe:UserTaskForm');
}

describe('set_bpmn_form_data — comprehensive (Zeebe)', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('links a deployed form by formId', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });

    const res = parseResult(
      await handleSetFormData({ diagramId, elementId: taskId, formId: 'ReviewForm_v1' })
    );
    expect(res.success).toBe(true);

    const props = parseResult(await handleGetProperties({ diagramId, elementId: taskId }));
    const formDef = getFormDef(props);
    expect(formDef).toBeDefined();
    expect(formDef.formId).toBe('ReviewForm_v1');
  });

  test('sets a custom formKey', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Select' });

    const res = parseResult(
      await handleSetFormData({ diagramId, elementId: taskId, formKey: 'custom:my-form' })
    );
    expect(res.success).toBe(true);

    const props = parseResult(await handleGetProperties({ diagramId, elementId: taskId }));
    const formDef = getFormDef(props);
    expect(formDef).toBeDefined();
    expect(formDef.formKey).toBe('custom:my-form');
  });

  test('embeds form JSON via formJson (creates UserTaskForm)', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Embedded' });

    const formBody = JSON.stringify({ components: [{ key: 'name', type: 'textfield' }] });
    const res = parseResult(
      await handleSetFormData({ diagramId, elementId: taskId, formJson: formBody })
    );
    expect(res.success).toBe(true);

    const props = parseResult(await handleGetProperties({ diagramId, elementId: taskId }));
    const userTaskForm = getUserTaskForm(props);
    expect(userTaskForm).toBeDefined();
    expect(userTaskForm.body).toBe(formBody);

    // Should also have a FormDefinition pointing to the embedded form
    const formDef = getFormDef(props);
    expect(formDef).toBeDefined();
    expect(formDef.formKey).toContain('camunda-forms:bpmn:');
  });

  test('works on StartEvent', async () => {
    const diagramId = await createDiagram();
    const startId = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start Form' });

    const res = parseResult(
      await handleSetFormData({ diagramId, elementId: startId, formId: 'StartForm_v1' })
    );
    expect(res.success).toBe(true);

    const props = parseResult(await handleGetProperties({ diagramId, elementId: startId }));
    const formDef = getFormDef(props);
    expect(formDef).toBeDefined();
    expect(formDef.formId).toBe('StartForm_v1');
  });

  test('replaces existing form definition on re-call', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Replace' });

    // First call — formId
    await handleSetFormData({ diagramId, elementId: taskId, formId: 'OldForm' });
    // Second call — formKey overwrites
    await handleSetFormData({ diagramId, elementId: taskId, formKey: 'new:key' });

    const props = parseResult(await handleGetProperties({ diagramId, elementId: taskId }));
    const formDef = getFormDef(props);
    expect(formDef.formKey).toBe('new:key');
    // formId from previous call should be gone
    expect(formDef.formId).toBeUndefined();
  });

  test('rejects unsupported element types', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Svc' });

    await expect(
      handleSetFormData({ diagramId, elementId: taskId, formId: 'SomeForm' })
    ).rejects.toThrow();
  });

  test('returns no-op message when no form config provided', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Empty' });

    const res = parseResult(
      await handleSetFormData({ diagramId, elementId: taskId })
    );
    expect(res.message).toContain('No form configuration');
  });
});
