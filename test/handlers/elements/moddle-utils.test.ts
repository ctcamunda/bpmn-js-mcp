/**
 * Tests for moddle-utils: upsertExtensionElement, createBusinessObject, fixConnectionId.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  upsertExtensionElement,
  createBusinessObject,
  fixConnectionId,
} from '../../../src/handlers/moddle-utils';
import { createDiagram, addElement, clearDiagrams } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('moddle-utils', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  describe('createBusinessObject', () => {
    test('creates a business object with the specified ID', async () => {
      const id = await createDiagram();
      const diagram = getDiagram(id)!;

      const bo = createBusinessObject(diagram.modeler, 'bpmn:UserTask', 'MyTask_42');
      expect(bo).toBeDefined();
      expect(bo.id).toBe('MyTask_42');
      expect(bo.$type).toBe('bpmn:UserTask');
    });
  });

  describe('fixConnectionId', () => {
    test('fixes mismatched business object ID', () => {
      const mockConnection = {
        businessObject: { id: 'auto_generated_123' },
      };

      fixConnectionId(mockConnection, 'Flow_Approve');
      expect(mockConnection.businessObject.id).toBe('Flow_Approve');
    });

    test('no-ops when IDs already match', () => {
      const mockConnection = {
        businessObject: { id: 'Flow_Approve' },
      };

      fixConnectionId(mockConnection, 'Flow_Approve');
      expect(mockConnection.businessObject.id).toBe('Flow_Approve');
    });

    test('handles connection without business object gracefully', () => {
      const mockConnection = { businessObject: undefined };
      // Should not throw
      expect(() => fixConnectionId(mockConnection as any, 'Flow_1')).not.toThrow();
    });
  });

  describe('upsertExtensionElement', () => {
    test('adds extension element to existing extensionElements', async () => {
      const id = await createDiagram();
      const taskId = await addElement(id, 'bpmn:UserTask', { name: 'Test' });
      const diagram = getDiagram(id)!;
      const moddle = diagram.modeler.get('moddle');
      const modeling = diagram.modeler.get('modeling');
      const registry = diagram.modeler.get('elementRegistry');
      const element = registry.get(taskId);
      const bo = element.businessObject;

      // Create a FormDefinition element
      const formDef = moddle.create('zeebe:FormDefinition', { formId: 'testForm' });

      upsertExtensionElement(moddle, bo, modeling, element, 'zeebe:FormDefinition', formDef);

      // Verify extension element was added
      const extensions = bo.extensionElements?.values || [];
      const found = extensions.find((v: any) => v.$type === 'zeebe:FormDefinition');
      expect(found).toBeDefined();
    });

    test('replaces existing extension element of same type', async () => {
      const id = await createDiagram();
      const taskId = await addElement(id, 'bpmn:UserTask', { name: 'Test' });
      const diagram = getDiagram(id)!;
      const moddle = diagram.modeler.get('moddle');
      const modeling = diagram.modeler.get('modeling');
      const registry = diagram.modeler.get('elementRegistry');
      const element = registry.get(taskId);
      const bo = element.businessObject;

      // Add first FormDefinition
      const formDef1 = moddle.create('zeebe:FormDefinition', { formId: 'first' });
      upsertExtensionElement(moddle, bo, modeling, element, 'zeebe:FormDefinition', formDef1);

      // Add second FormDefinition (should replace first)
      const formDef2 = moddle.create('zeebe:FormDefinition', { formId: 'second' });
      upsertExtensionElement(moddle, bo, modeling, element, 'zeebe:FormDefinition', formDef2);

      // Should only have one FormDefinition
      const extensions = bo.extensionElements?.values || [];
      const formDefs = extensions.filter((v: any) => v.$type === 'zeebe:FormDefinition');
      expect(formDefs).toHaveLength(1);
      expect(formDefs[0].formId).toBe('second');
    });
  });
});
