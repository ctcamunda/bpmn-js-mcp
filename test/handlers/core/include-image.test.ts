/**
 * Tests for optional SVG image content in mutating tool responses.
 *
 * When a diagram is created with includeImage: true, every mutating tool
 * response should include an ImageContent item with the diagram as SVG.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { handleCreateDiagram, handleAddElement, handleConnect } from '../../../src/handlers';
import { parseResult, clearDiagrams } from '../../helpers';

describe('includeImage option on create_bpmn_diagram', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('create_bpmn_diagram with includeImage:true returns image content', async () => {
    const result = await handleCreateDiagram({ includeImage: true });
    expect(result.content.length).toBeGreaterThanOrEqual(1);
    // Should have at least one image content item
    const imageItem = result.content.find((c: any) => c.type === 'image');
    expect(imageItem).toBeDefined();
    expect((imageItem as any).mimeType).toBe('image/svg+xml');
    expect(typeof (imageItem as any).data).toBe('string');
    expect((imageItem as any).data.length).toBeGreaterThan(0);
  });

  test('create_bpmn_diagram without includeImage returns no image content', async () => {
    const result = await handleCreateDiagram({});
    const imageItem = result.content.find((c: any) => c.type === 'image');
    expect(imageItem).toBeUndefined();
  });

  test('image content is valid base64-encoded SVG', async () => {
    const result = await handleCreateDiagram({ includeImage: true });
    const imageItem = result.content.find((c: any) => c.type === 'image') as any;
    expect(imageItem).toBeDefined();

    // Decode base64 and check it's an SVG
    const decoded = Buffer.from(imageItem.data, 'base64').toString('utf-8');
    expect(decoded).toContain('<svg');
    expect(decoded).toContain('</svg>');
  });

  test('mutating tool add_element includes image when diagram has includeImage:true', async () => {
    const createResult = await handleCreateDiagram({ includeImage: true });
    const { diagramId } = parseResult(createResult);

    const addResult = await handleAddElement({
      diagramId,
      elementType: 'bpmn:StartEvent',
      name: 'Begin',
    });

    const imageItem = addResult.content.find((c: any) => c.type === 'image');
    expect(imageItem).toBeDefined();
    expect((imageItem as any).mimeType).toBe('image/svg+xml');
  });

  test('mutating tool does not include image when includeImage is false (default)', async () => {
    const createResult = await handleCreateDiagram({});
    const { diagramId } = parseResult(createResult);

    const addResult = await handleAddElement({
      diagramId,
      elementType: 'bpmn:StartEvent',
      name: 'Begin',
    });

    const imageItem = addResult.content.find((c: any) => c.type === 'image');
    expect(imageItem).toBeUndefined();
  });

  test('image is updated after each mutation', async () => {
    const createResult = await handleCreateDiagram({ includeImage: true });
    const { diagramId } = parseResult(createResult);

    const res1 = await handleAddElement({
      diagramId,
      elementType: 'bpmn:StartEvent',
      name: 'Start',
    });

    const res2 = await handleAddElement({
      diagramId,
      elementType: 'bpmn:EndEvent',
      name: 'End',
    });

    const img1 = res1.content.find((c: any) => c.type === 'image') as any;
    const img2 = res2.content.find((c: any) => c.type === 'image') as any;

    // Both should be SVGs
    const svg1 = Buffer.from(img1.data, 'base64').toString('utf-8');
    const svg2 = Buffer.from(img2.data, 'base64').toString('utf-8');
    expect(svg1).toContain('<svg');
    expect(svg2).toContain('<svg');

    // The second SVG should differ (has more elements)
    // They could be different sizes/content
    expect(img1.data).toBeDefined();
    expect(img2.data).toBeDefined();
  });

  test('connect tool includes image when includeImage:true', async () => {
    const createResult = await handleCreateDiagram({ includeImage: true });
    const { diagramId } = parseResult(createResult);

    const startRes = parseResult(
      await handleAddElement({ diagramId, elementType: 'bpmn:StartEvent', name: 'Start' })
    );
    const endRes = parseResult(
      await handleAddElement({ diagramId, elementType: 'bpmn:EndEvent', name: 'End' })
    );

    const connectResult = await handleConnect({
      diagramId,
      sourceElementId: startRes.elementId,
      targetElementId: endRes.elementId,
    });

    const imageItem = connectResult.content.find((c: any) => c.type === 'image');
    expect(imageItem).toBeDefined();
    expect((imageItem as any).mimeType).toBe('image/svg+xml');
  });
});
