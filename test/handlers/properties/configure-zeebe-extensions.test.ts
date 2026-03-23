import { beforeEach, describe, expect, test } from 'vitest';
import {
  handleConfigureZeebeExtensions,
  handleGetProperties,
  handleExportBpmn,
} from '../../../src/handlers';
import { addElement, clearDiagrams, createDiagram, parseResult } from '../../helpers';

describe('configure_bpmn_zeebe_extensions', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('configures service task task definition, headers, and io mapping', async () => {
    const diagramId = await createDiagram();
    const serviceTaskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Call API' });

    const res = parseResult(
      await handleConfigureZeebeExtensions({
        diagramId,
        elements: {
          [serviceTaskId]: {
            taskDefinition: { type: 'call-api', retries: 5 },
            taskHeaders: { endpoint: '/orders', method: 'POST' },
            ioMapping: {
              inputs: [{ source: '=orderId', target: 'orderId' }],
              outputs: [{ source: '=result', target: 'apiResult' }],
            },
          },
        },
      })
    );

    expect(res.success).toBe(true);
    expect(res.configured).toBe(1);
    expect(res.results[serviceTaskId].extensionsApplied).toEqual([
      'taskDefinition',
      'ioMapping',
      'taskHeaders',
    ]);

    const props = parseResult(await handleGetProperties({ diagramId, elementId: serviceTaskId }));
    expect(props.extensionElements).toBeDefined();
    expect(props.extensionElements.find((e: any) => e.type === 'zeebe:TaskDefinition')).toMatchObject({
      workerType: 'call-api',
      retries: '5',
    });
    expect(props.extensionElements.find((e: any) => e.type === 'zeebe:IoMapping')).toBeDefined();

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0].text;
    expect(xml).toContain('zeebe:taskDefinition');
    expect(xml).toContain('type="call-api"');
    expect(xml).toContain('zeebe:taskHeaders');
  });

  test('configures user task assignment and form definition', async () => {
    const diagramId = await createDiagram();
    const userTaskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review Order' });

    const res = parseResult(
      await handleConfigureZeebeExtensions({
        diagramId,
        elements: {
          [userTaskId]: {
            userTask: true,
            assignment: { assignee: '=reviewer', candidateGroups: 'sales' },
            formDefinition: { formId: 'review-order-form' },
          },
        },
      })
    );

    expect(res.success).toBe(true);
    expect(res.results[userTaskId].extensionsApplied).toEqual([
      'formDefinition',
      'userTask',
      'assignment',
    ]);

    const props = parseResult(await handleGetProperties({ diagramId, elementId: userTaskId }));
    expect(props.extensionElements.find((e: any) => e.type === 'zeebe:FormDefinition')).toMatchObject({
      formId: 'review-order-form',
    });
    expect(props.extensionElements.find((e: any) => e.type === 'zeebe:AssignmentDefinition')).toMatchObject({
      assignee: '=reviewer',
      candidateGroups: 'sales',
    });
  });

  test('configures called decision on business rule task', async () => {
    const diagramId = await createDiagram();
    const decisionTaskId = await addElement(diagramId, 'bpmn:BusinessRuleTask', {
      name: 'Evaluate Discount',
    });

    const res = parseResult(
      await handleConfigureZeebeExtensions({
        diagramId,
        elements: {
          [decisionTaskId]: {
            calledDecision: { decisionId: 'discount-table', resultVariable: 'discount' },
          },
        },
      })
    );

    expect(res.success).toBe(true);

    const props = parseResult(await handleGetProperties({ diagramId, elementId: decisionTaskId }));
    expect(props.extensionElements.find((e: any) => e.type === 'zeebe:CalledDecision')).toMatchObject({
      decisionId: 'discount-table',
      resultVariable: 'discount',
    });
  });

  test('rejects invalid extension types per element without throwing globally', async () => {
    const diagramId = await createDiagram();
    const userTaskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Approve' });

    const res = parseResult(
      await handleConfigureZeebeExtensions({
        diagramId,
        elements: {
          [userTaskId]: {
            taskDefinition: { type: 'not-valid-on-user-task' },
          },
        },
      })
    );

    expect(res.success).toBe(false);
    expect(res.configured).toBe(0);
    expect(res.failed).toBe(1);
    expect(res.results[userTaskId].success).toBe(false);
    expect(res.results[userTaskId].error).toMatch(/requires: bpmn:ServiceTask, bpmn:SendTask, bpmn:BusinessRuleTask/);
  });

  test('reports partial success when one element fails validation', async () => {
    const diagramId = await createDiagram();
    const serviceTaskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Notify ERP' });
    const userTaskId = await addElement(diagramId, 'bpmn:UserTask', { name: 'Approve' });

    const res = parseResult(
      await handleConfigureZeebeExtensions({
        diagramId,
        elements: {
          [serviceTaskId]: {
            taskDefinition: { type: 'notify-erp', retries: 3 },
          },
          [userTaskId]: {
            calledDecision: { decisionId: 'approval-table', resultVariable: 'decision' },
          },
        },
      })
    );

    expect(res.success).toBe(false);
    expect(res.configured).toBe(1);
    expect(res.failed).toBe(1);
    expect(res.results[serviceTaskId].success).toBe(true);
    expect(res.results[userTaskId].success).toBe(false);

    const props = parseResult(await handleGetProperties({ diagramId, elementId: serviceTaskId }));
    expect(props.extensionElements.find((e: any) => e.type === 'zeebe:TaskDefinition')).toMatchObject({
      workerType: 'notify-erp',
      retries: '3',
    });
  });
});