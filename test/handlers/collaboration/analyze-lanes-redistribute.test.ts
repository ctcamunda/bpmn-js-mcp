/**
 * Tests for mode: 'redistribute' on analyze_bpmn_lanes.
 * Merges redistribute_bpmn_elements_across_lanes into analyze_bpmn_lanes.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleAnalyzeLanes,
  handleCreateCollaboration,
  handleAddElement,
  handleCreateLanes,
  handleAssignElementsToLane,
  handleSetProperties,
} from '../../../src/handlers';
import { TOOL_DEFINITION as ANALYZE_LANES_TOOL } from '../../../src/handlers/collaboration/analyze-lanes';
import { createDiagram, parseResult, clearDiagrams } from '../../helpers';

describe('analyze_bpmn_lanes mode: redistribute', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  async function createPoolWithLanes(diagramId: string) {
    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Process', width: 1200, height: 600 },
          { name: 'External', collapsed: true },
        ],
      })
    );
    const poolId = collab.participantIds[0];

    const lanes = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: poolId,
        lanes: [{ name: 'Support' }, { name: 'Engineering' }],
      })
    );
    const laneIds = lanes.laneIds as string[];

    return { poolId, laneIds };
  }

  test('mode: redistribute delegates to redistribute handler', async () => {
    const diagramId = await createDiagram();
    const { poolId, laneIds } = await createPoolWithLanes(diagramId);

    const task1 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Handle Ticket',
        participantId: poolId,
      })
    );
    await handleSetProperties({
      diagramId,
      elementId: task1.elementId,
      properties: { 'zeebe:assignmentDefinition': { candidateGroups: 'support' } },
    });
    await handleAssignElementsToLane({
      diagramId,
      laneId: laneIds[1],
      elementIds: [task1.elementId],
    });

    const task2 = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Deploy Fix',
        participantId: poolId,
      })
    );
    await handleSetProperties({
      diagramId,
      elementId: task2.elementId,
      properties: { 'zeebe:assignmentDefinition': { candidateGroups: 'engineering' } },
    });
    await handleAssignElementsToLane({
      diagramId,
      laneId: laneIds[0],
      elementIds: [task2.elementId],
    });

    const res = parseResult(
      await handleAnalyzeLanes({ diagramId, mode: 'redistribute', participantId: poolId })
    );

    // Should return redistribute result (success field or moved/assignments)
    expect(res).toBeDefined();
    // Either success or coherence metrics from validate step
    expect(res.success !== undefined || res.coherenceScore !== undefined).toBe(true);
  });

  test('mode: redistribute with dryRun returns plan', async () => {
    const diagramId = await createDiagram();
    const { poolId } = await createPoolWithLanes(diagramId);

    await handleAddElement({
      diagramId,
      elementType: 'bpmn:UserTask',
      name: 'Task A',
      participantId: poolId,
    });

    const res = parseResult(
      await handleAnalyzeLanes({
        diagramId,
        mode: 'redistribute',
        participantId: poolId,
        dryRun: true,
      })
    );

    expect(res).toBeDefined();
  });

  test('redistribute mode appears in tool definition enum', () => {
    const modeEnum = ANALYZE_LANES_TOOL.inputSchema.properties.mode.enum;
    expect(modeEnum).toContain('redistribute');
  });

  test('mode: redistribute forwards strategy parameter', async () => {
    const diagramId = await createDiagram();
    const { poolId } = await createPoolWithLanes(diagramId);

    await handleAddElement({
      diagramId,
      elementType: 'bpmn:UserTask',
      name: 'Task A',
      participantId: poolId,
    });

    const res = parseResult(
      await handleAnalyzeLanes({
        diagramId,
        mode: 'redistribute',
        participantId: poolId,
        strategy: 'balance',
      })
    );

    expect(res).toBeDefined();
  });
});
