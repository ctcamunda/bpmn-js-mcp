/**
 * Tests for zeebe:Script support in set_bpmn_script.
 */

import { describe, test, expect, afterEach } from 'vitest';
import { createDiagram, addElement, parseResult, clearDiagrams } from '../../helpers';
import { handleSetScript } from '../../../src/handlers/properties/set-script';
import { handleGetProperties } from '../../../src/handlers/elements/get-properties';

afterEach(() => clearDiagrams());

describe('set_bpmn_script — Zeebe script support', () => {
  test('sets an inline FEEL script', async () => {
    const diagramId = await createDiagram();
    const scriptTaskId = await addElement(diagramId, 'bpmn:ScriptTask', { name: 'Run Script' });

    const result = parseResult(
      await handleSetScript({
        diagramId,
        elementId: scriptTaskId,
        scriptFormat: 'feel',
        script: 'if x > 10 then "high" else "low"',
        resultVariable: 'category',
      })
    );

    expect(result.success).toBe(true);
    expect(result.resultVariable).toBe('category');
  });

  test('sets script with resultVariable', async () => {
    const diagramId = await createDiagram();
    const scriptTaskId = await addElement(diagramId, 'bpmn:ScriptTask', { name: 'Calculate' });

    const result = parseResult(
      await handleSetScript({
        diagramId,
        elementId: scriptTaskId,
        scriptFormat: 'feel',
        script: '= x + y',
        resultVariable: 'sum',
      })
    );

    expect(result.success).toBe(true);

    const propsResult = parseResult(
      await handleGetProperties({ diagramId, elementId: scriptTaskId })
    );
    const scriptExt = propsResult.extensionElements?.find(
      (e: any) => e.type === 'zeebe:Script'
    );
    expect(scriptExt).toBeDefined();
  });

  test('rejects on non-ScriptTask element', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Not a script' });

    await expect(
      handleSetScript({
        diagramId,
        elementId: taskId,
        scriptFormat: 'feel',
        script: '= 42',
      })
    ).rejects.toThrow(/ScriptTask/);
  });
});
