import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleSetProperties,
  handleSetInputOutput,
  handleSetEventDefinition,
  handleExportBpmn,
} from '../../../src/handlers';
import { createDiagram, addElement, clearDiagrams } from '../../helpers';

describe('Zeebe job worker workflow', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('creates a full job worker task with I/O mapping and boundary error', async () => {
    const diagramId = await createDiagram('Job Worker Process');

    // 1. Create service task with task definition
    const serviceTaskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Process Order',
      x: 300,
      y: 200,
    });
    await handleSetProperties({
      diagramId,
      elementId: serviceTaskId,
      properties: {
        'zeebe:taskDefinition': { type: 'order-processing', retries: '3' },
      },
    });

    // 2. Set input/output mappings
    await handleSetInputOutput({
      diagramId,
      elementId: serviceTaskId,
      inputParameters: [{ source: '=orderId', target: 'fetchOrderId' }],
      outputParameters: [{ source: '=result', target: 'orderResult' }],
    });

    // 3. Attach boundary error event
    const boundaryId = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      hostElementId: serviceTaskId,
      x: 320,
      y: 260,
    });
    await handleSetEventDefinition({
      diagramId,
      elementId: boundaryId,
      eventDefinitionType: 'bpmn:ErrorEventDefinition',
      errorRef: {
        id: 'Error_OrderFailed',
        name: 'Order Failed',
        errorCode: 'ORDER_ERR',
      },
    });

    // Verify the full XML
    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('zeebe:taskDefinition');
    expect(xml).toContain('order-processing');
    expect(xml).toContain('zeebe:ioMapping');
    expect(xml).toContain('orderId');
    expect(xml).toContain('errorEventDefinition');
  });

  test('sets task definition type on a service task', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
      name: 'Worker Task',
    });

    await handleSetProperties({
      diagramId,
      elementId: taskId,
      properties: {
        'zeebe:taskDefinition': { type: 'my-worker' },
      },
    });

    const xml = (await handleExportBpmn({ format: 'xml', diagramId, skipLint: true })).content[0]
      .text;
    expect(xml).toContain('zeebe:taskDefinition');
    expect(xml).toContain('my-worker');
  });
});
