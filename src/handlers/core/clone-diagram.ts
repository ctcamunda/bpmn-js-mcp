/**
 * Legacy standalone clone helper retained for internal reuse.
 * External callers should use create_bpmn_diagram with cloneFrom.
 */
// @mutating

import { type ToolResult } from '../../types';
import { storeDiagram, generateDiagramId, createModelerFromXml } from '../../diagram-manager';
import { requireDiagram, jsonResult } from '../helpers';

export interface CloneDiagramArgs {
  diagramId: string;
  name?: string;
}

export async function handleCloneDiagram(args: CloneDiagramArgs): Promise<ToolResult> {
  const { diagramId, name } = args;
  const source = requireDiagram(diagramId);

  const { xml } = await source.modeler.saveXML({ format: true });
  const newDiagramId = generateDiagramId();
  const modeler = await createModelerFromXml(xml || '');

  storeDiagram(newDiagramId, {
    modeler,
    xml: xml || '',
    name: name || source.name,
  });

  return jsonResult({
    success: true,
    diagramId: newDiagramId,
    clonedFrom: diagramId,
    name: name || source.name,
    message: `Cloned diagram ${diagramId} → ${newDiagramId}`,
  });
}

export const TOOL_DEFINITION = {
  name: '__legacy_internal_clone_diagram',
  description:
    'Legacy standalone clone schema retained for internal reference. External callers should use create_bpmn_diagram with cloneFrom.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: {
        type: 'string',
        description: 'The ID of the diagram to clone',
      },
      name: {
        type: 'string',
        description: 'Optional name for the cloned diagram',
      },
    },
    required: ['diagramId'],
  },
} as const;
