/**
 * Tests for Zeebe extension element support in set_bpmn_element_properties.
 * (Replaces former Camunda 7 connector/field/properties tests)
 */

import { describe, test, expect, afterEach } from 'vitest';
import { createDiagram, addElement, parseResult, clearDiagrams } from '../../helpers';
import { handleSetProperties } from '../../../src/handlers/properties/set-properties';
import { handleGetProperties } from '../../../src/handlers/elements/get-properties';

afterEach(() => clearDiagrams());

describe('zeebe:TaskDefinition', () => {
  test('sets a task definition with type and retries', async () => {
    const diagramId = await createDiagram();
    const serviceTaskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Call API' });

    await handleSetProperties({
      diagramId,
      elementId: serviceTaskId,
      properties: {
        'zeebe:taskDefinition': { type: 'http-connector', retries: '3' },
      },
    });

    const propsResult = parseResult(
      await handleGetProperties({ diagramId, elementId: serviceTaskId })
    );

    const extensions = propsResult.extensionElements;
    expect(extensions).toBeDefined();
    const td = extensions.find((e: any) => e.type === 'zeebe:TaskDefinition');
    expect(td).toBeDefined();
    expect(td.taskType || td.type).toBeDefined();
  });

  test('removes task definition when set to null', async () => {
    const diagramId = await createDiagram();
    const serviceTaskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Call API' });

    await handleSetProperties({
      diagramId,
      elementId: serviceTaskId,
      properties: {
        'zeebe:taskDefinition': { type: 'http-connector' },
      },
    });

    await handleSetProperties({
      diagramId,
      elementId: serviceTaskId,
      properties: {
        'zeebe:taskDefinition': null,
      },
    });

    const propsResult = parseResult(
      await handleGetProperties({ diagramId, elementId: serviceTaskId })
    );
    const extensions = propsResult.extensionElements || [];
    const td = extensions.find((e: any) => e.type === 'zeebe:TaskDefinition');
    expect(td).toBeUndefined();
  });
});

describe('zeebe:Properties', () => {
  test('sets custom properties on a service task', async () => {
    const diagramId = await createDiagram();
    const serviceTaskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Props Task' });

    await handleSetProperties({
      diagramId,
      elementId: serviceTaskId,
      properties: {
        'zeebe:properties': { env: 'production', region: 'eu-west-1' },
      },
    });

    const propsResult = parseResult(
      await handleGetProperties({ diagramId, elementId: serviceTaskId })
    );
    const extensions = propsResult.extensionElements || [];
    const props = extensions.find((e: any) => e.type === 'zeebe:Properties');
    expect(props).toBeDefined();
  });
});
