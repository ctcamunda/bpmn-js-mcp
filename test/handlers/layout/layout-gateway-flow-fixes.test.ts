/**
 * Tests for layout_bpmn_diagram tool-feedback improvements:
 * - When nonOrthogonalFlowIds includes gateway-sourced flows, the response
 *   should include concrete set_bpmn_connection_waypoints fix hints.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram } from '../../../src/handlers/layout/layout-diagram';
import { createDiagram, addElement, connect, clearDiagrams, parseResult } from '../../helpers';

describe('layout_bpmn_diagram gateway flow fix hints', () => {
  beforeEach(() => clearDiagrams());

  test('response includes gatewayFlowFixes when gateway-sourced non-orthogonal flows exist', async () => {
    // Build a simple gateway fan-out that might produce non-orthogonal flows
    const diagramId = await createDiagram('Layout Fix Hint Test');

    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Gate' });
    const t1 = await addElement(diagramId, 'bpmn:Task', { name: 'Path A' });
    const t2 = await addElement(diagramId, 'bpmn:Task', { name: 'Path B' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, gw);
    await connect(diagramId, gw, t1);
    await connect(diagramId, gw, t2);
    await connect(diagramId, t1, end);
    await connect(diagramId, t2, end);

    const res = parseResult(await handleLayoutDiagram({ diagramId }));

    expect(res.success).toBe(true);
    // qualityMetrics.nonOrthogonalFlowIds should be present or empty
    expect(res.qualityMetrics).toBeDefined();

    // If non-orthogonal gateway flows exist, gatewayFlowFixes should be present
    const nonOrthoIds: string[] = res.qualityMetrics?.nonOrthogonalFlowIds ?? [];
    if (nonOrthoIds.length > 0) {
      // gatewayFlowFixes should be present and have entries for gateway-sourced flows
      // (it may not have entries for non-gateway-sourced flows)
      expect(res).toHaveProperty('gatewayFlowFixes');
      const fixes = res.gatewayFlowFixes as any[];
      expect(Array.isArray(fixes)).toBe(true);

      for (const fix of fixes) {
        expect(fix).toHaveProperty('flowId');
        expect(fix).toHaveProperty('tool', 'set_bpmn_connection_waypoints');
        expect(fix).toHaveProperty('args');
        expect(fix.args).toHaveProperty('connectionId');
        expect(fix.args).toHaveProperty('waypoints');
        expect(Array.isArray(fix.args.waypoints)).toBe(true);
        expect(fix.args.waypoints.length).toBe(2);
      }
    }
  });
});
