/**
 * Tests for list_bpmn_process_variables — extended coverage (Zeebe).
 *
 * Covers: zeebe:AssignmentDefinition expressions, call activity
 * variable mappings, I/O mappings, zeebe:Script result variables,
 * and deduplication of variable references.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleListProcessVariables,
  handleSetProperties,
  handleSetCallActivityVariables,
  handleSetInputOutput,
  handleSetLoopCharacteristics,
} from '../../../src/handlers';
import { parseResult, createDiagram, addElement, connect, clearDiagrams } from '../../helpers';

describe('list_bpmn_process_variables — extended', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('extracts variables from zeebe:assignmentDefinition assignee expression', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });

    await handleSetProperties({
      diagramId,
      elementId: taskId,
      properties: { 'zeebe:assignmentDefinition': { assignee: '=initiator' } },
    });

    const res = parseResult(await handleListProcessVariables({ diagramId }));
    const names = res.variables.map((v: any) => v.name);
    expect(names).toContain('initiator');
  });

  test('extracts variables from zeebe:assignmentDefinition candidateGroups expression', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Approve' });

    await handleSetProperties({
      diagramId,
      elementId: taskId,
      properties: { 'zeebe:assignmentDefinition': { candidateGroups: '=department' } },
    });

    const res = parseResult(await handleListProcessVariables({ diagramId }));
    const names = res.variables.map((v: any) => v.name);
    expect(names).toContain('department');
  });

  test('extracts variables from call activity input/output mappings', async () => {
    const diagramId = await createDiagram();
    const callId = await addElement(diagramId, 'bpmn:CallActivity', { name: 'Sub Process' });

    await handleSetCallActivityVariables({
      diagramId,
      elementId: callId,
      processId: 'subProcess',
      inputMappings: [{ source: '=orderId', target: 'id' }],
      outputMappings: [{ source: '=result', target: 'subResult' }],
    });

    const res = parseResult(await handleListProcessVariables({ diagramId }));
    const names = res.variables.map((v: any) => v.name);
    expect(names).toContain('orderId');
    expect(names).toContain('subResult');
  });

  test('extracts variables from zeebe:Script resultVariable', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ScriptTask', { name: 'Calculate' });

    await handleSetProperties({
      diagramId,
      elementId: taskId,
      properties: { 'zeebe:script': { expression: '=price * quantity', resultVariable: 'total' } },
    });

    const res = parseResult(await handleListProcessVariables({ diagramId }));
    const names = res.variables.map((v: any) => v.name);
    expect(names).toContain('total');
    expect(names).toContain('price');
    expect(names).toContain('quantity');
  });

  test.skip('extracts variables from loop with expression collection (pending zeebe:LoopCharacteristics support)', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Process' });

    await handleSetLoopCharacteristics({
      diagramId,
      elementId: taskId,
      loopType: 'sequential',
      collection: '=myList',
      elementVariable: 'item',
    });

    const res = parseResult(await handleListProcessVariables({ diagramId }));
    const names = res.variables.map((v: any) => v.name);
    expect(names).toContain('myList');
    expect(names).toContain('item');
  });

  test('extracts variables from I/O mapping output target', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Fetch' });

    await handleSetInputOutput({
      diagramId,
      elementId: taskId,
      inputParameters: [{ source: '=orderId', target: 'id' }],
      outputParameters: [{ source: '=response.data', target: 'processedData' }],
    });

    const res = parseResult(await handleListProcessVariables({ diagramId }));
    const names = res.variables.map((v: any) => v.name);
    expect(names).toContain('orderId');
    expect(names).toContain('processedData');
  });

  test('deduplicates same variable read from multiple elements', async () => {
    const diagramId = await createDiagram();
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Check' });
    const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Yes' });
    const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'No' });

    await connect(diagramId, gw, taskA, { conditionExpression: '=status = "approved"' });
    await connect(diagramId, gw, taskB, { conditionExpression: '=status = "rejected"' });

    const res = parseResult(await handleListProcessVariables({ diagramId }));
    const statusVar = res.variables.find((v: any) => v.name === 'status');
    expect(statusVar).toBeDefined();
    // Should be read by both flows
    expect(statusVar.readBy.length).toBe(2);
  });

  test('handles diagram with no variables gracefully', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    const res = parseResult(await handleListProcessVariables({ diagramId }));
    expect(res.success).toBe(true);
    expect(res.variableCount).toBe(0);
    expect(res.referenceCount).toBe(0);
    expect(res.variables).toEqual([]);
  });
});
