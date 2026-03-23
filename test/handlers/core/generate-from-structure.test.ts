import { beforeEach, describe, expect, test } from 'vitest';
import { handleGenerateFromStructure } from '../../../src/handlers';
import { clearDiagrams, getRegistry, parseResult } from '../../helpers';

describe('generate_bpmn_from_structure', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('creates a fresh participant with lanes and assigns elements by lane', async () => {
    const res = parseResult(
      await handleGenerateFromStructure({
        name: 'Lane Process',
        lanes: [
          { id: 'requester', name: 'Requester' },
          { id: 'approver', name: 'Approver' },
        ],
        elements: [
          { id: 'start', type: 'startEvent', lane: 'requester' },
          { id: 'review', type: 'userTask', name: 'Review', lane: 'approver' },
          { id: 'end', type: 'endEvent', lane: 'approver' },
        ],
        autoLayout: false,
      })
    );

    expect(res.success).toBe(true);

    const registry = getRegistry(res.diagramId);
    const lanes = registry.filter((el: any) => el.type === 'bpmn:Lane');
    expect(lanes).toHaveLength(2);

    const requesterLane = lanes.find((lane: any) => lane.businessObject?.name === 'Requester');
    const approverLane = lanes.find((lane: any) => lane.businessObject?.name === 'Approver');

    expect(requesterLane.businessObject.flowNodeRef.map((node: any) => node.id)).toContain(
      res.elementIdMap.start
    );
    expect(approverLane.businessObject.flowNodeRef.map((node: any) => node.id)).toContain(
      res.elementIdMap.review
    );
    expect(approverLane.businessObject.flowNodeRef.map((node: any) => node.id)).toContain(
      res.elementIdMap.end
    );
  });

  test('creates and wires child elements inside subprocesses', async () => {
    const res = parseResult(
      await handleGenerateFromStructure({
        name: 'Subprocess Process',
        elements: [
          { id: 'start', type: 'startEvent' },
          {
            id: 'sub',
            type: 'subProcess',
            name: 'Handle Request',
            children: [
              { id: 'childStart', type: 'startEvent' },
              { id: 'childTask', type: 'userTask', name: 'Work Item' },
              { id: 'childEnd', type: 'endEvent' },
            ],
          },
          { id: 'end', type: 'endEvent' },
        ],
        autoLayout: false,
      })
    );

    expect(res.success).toBe(true);

    const registry = getRegistry(res.diagramId);
    const subProcess = registry.get(res.elementIdMap.sub);
    const childStart = registry.get(res.elementIdMap.childStart);
    const childTask = registry.get(res.elementIdMap.childTask);
    const childEnd = registry.get(res.elementIdMap.childEnd);

    expect(childStart.parent.id).toBe(subProcess.id);
    expect(childTask.parent.id).toBe(subProcess.id);
    expect(childEnd.parent.id).toBe(subProcess.id);

    expect(childStart.outgoing.some((flow: any) => flow.target?.id === childTask.id)).toBe(true);
    expect(childTask.outgoing.some((flow: any) => flow.target?.id === childEnd.id)).toBe(true);
  });

  test('supports explicit child-level connections inside subprocesses', async () => {
    const res = parseResult(
      await handleGenerateFromStructure({
        name: 'Explicit Subprocess Flows',
        elements: [
          {
            id: 'sub',
            type: 'subProcess',
            name: 'Review Loop',
            children: [
              { id: 'childStart', type: 'startEvent' },
              { id: 'childTask', type: 'userTask', name: 'Review Request' },
              { id: 'childEnd', type: 'endEvent' },
            ],
            connections: [
              { from: 'childStart', to: 'childTask', label: 'Begin review' },
              { from: 'childStart', to: 'childEnd', label: 'Skip review' },
              { from: 'childTask', to: 'childEnd', label: 'Complete review' },
            ],
          },
        ],
        autoLayout: false,
      })
    );

    expect(res.success).toBe(true);

    const registry = getRegistry(res.diagramId);
    const childStart = registry.get(res.elementIdMap.childStart);
    const childTask = registry.get(res.elementIdMap.childTask);
    const childEnd = registry.get(res.elementIdMap.childEnd);

    expect(childStart.outgoing.some((flow: any) => flow.target?.id === childTask.id)).toBe(true);
    expect(childStart.outgoing.some((flow: any) => flow.target?.id === childEnd.id)).toBe(true);

    const skipFlow = childStart.outgoing.find((flow: any) => flow.target?.id === childEnd.id);
    const completeFlow = childTask.outgoing.find((flow: any) => flow.target?.id === childEnd.id);

    expect(skipFlow.businessObject?.name).toBe('Skip review');
    expect(completeFlow.businessObject?.name).toBe('Complete review');
  });

  test('creates and wires child elements inside ad hoc subprocesses', async () => {
    const res = parseResult(
      await handleGenerateFromStructure({
        name: 'Ad Hoc Agent Process',
        elements: [
          {
            id: 'agentSub',
            type: 'adHocSubProcess',
            name: 'Run Agents',
            children: [
              { id: 'childStart', type: 'startEvent' },
              { id: 'childTask', type: 'userTask', name: 'Coordinate' },
              { id: 'childEnd', type: 'endEvent' },
            ],
          },
        ],
        autoLayout: false,
      })
    );

    expect(res.success).toBe(true);

    const registry = getRegistry(res.diagramId);
    const subprocess = registry.get(res.elementIdMap.agentSub);
    const childStart = registry.get(res.elementIdMap.childStart);
    const childTask = registry.get(res.elementIdMap.childTask);
    const childEnd = registry.get(res.elementIdMap.childEnd);

    expect(subprocess.type).toBe('bpmn:AdHocSubProcess');
    expect(childStart.parent.id).toBe(subprocess.id);
    expect(childTask.parent.id).toBe(subprocess.id);
    expect(childEnd.parent.id).toBe(subprocess.id);
  });

  test('maps multi-pool participant results by input order', async () => {
    const res = parseResult(
      await handleGenerateFromStructure({
        name: 'Collaboration Process',
        participants: [
          { id: 'BuyerPool', name: 'Buyer' },
          { id: 'VendorPool', name: 'Vendor', collapsed: true },
        ],
        elements: [
          { id: 'start', type: 'startEvent' },
          { id: 'task', type: 'userTask', name: 'Prepare Order' },
        ],
        autoLayout: false,
      })
    );

    expect(res.success).toBe(true);
    expect(res.elementIdMap.BuyerPool).toBe('BuyerPool');
    expect(res.elementIdMap.VendorPool).toBe('VendorPool');

    const registry = getRegistry(res.diagramId);
    const start = registry.get(res.elementIdMap.start);
    expect(start.parent.id).toBe('BuyerPool');
  });

  test('surfaces cyclic after dependencies as errors', async () => {
    const res = parseResult(
      await handleGenerateFromStructure({
        name: 'Cycle Process',
        elements: [
          { id: 'taskA', type: 'userTask', after: 'taskB' },
          { id: 'taskB', type: 'userTask', after: 'taskA' },
        ],
        autoLayout: false,
      })
    );

    expect(res.success).toBe(false);
    expect(res.summary.errors.join('\n')).toContain('Cyclic element dependencies detected');
  });
});