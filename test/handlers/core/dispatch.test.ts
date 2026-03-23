import { describe, test, expect, beforeEach } from 'vitest';
import { dispatchToolCall } from '../../../src/handlers';
import { parseResult, clearDiagrams } from '../../helpers';

describe('dispatchToolCall', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('routes create_bpmn_diagram correctly', async () => {
    const res = parseResult(await dispatchToolCall('create_bpmn_diagram', {}));
    expect(res.success).toBe(true);
  });

  test('routes new tools correctly', async () => {
    const createRes = parseResult(await dispatchToolCall('create_bpmn_diagram', {}));
    const diagramId = createRes.diagramId;

    // inspect_bpmn diagrams
    const listRes = parseResult(await dispatchToolCall('inspect_bpmn', { mode: 'diagrams' }));
    expect(listRes.count).toBe(1);

    // inspect_bpmn validation
    const validateRes = parseResult(
      await dispatchToolCall('inspect_bpmn', { mode: 'validation', diagramId })
    );
    expect(validateRes.issues).toBeDefined();

    // inspect_bpmn element summary
    const diagramRes = parseResult(
      await dispatchToolCall('inspect_bpmn', { mode: 'diagram', diagramId })
    );
    expect(diagramRes.diagramName).toBeDefined();
  });

  test('throws for unknown tool', async () => {
    await expect(dispatchToolCall('no_such_tool', {})).rejects.toThrow(/Unknown tool/);
  });
});
