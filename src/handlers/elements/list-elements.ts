/**
 * Handler for list_bpmn_elements tool.
 *
 * When no filters are given, returns all elements (backward-compatible).
 * Optional filters (namePattern, elementType, property) allow searching
 * within the same tool.
 */
// @readonly

import { type ToolResult } from '../../types';
import {
  requireDiagram,
  jsonResult,
  getVisibleElements,
  validateArgs,
  getService,
} from '../helpers';

export interface ResolvedFlow {
  id: string;
  label: string | null;
  sourceId: string;
  sourceName: string;
  sourceType: string;
  targetId: string;
  targetName: string;
  targetType: string;
}

export interface ListElementsArgs {
  diagramId: string;
  namePattern?: string;
  elementType?: string;
  property?: { key: string; value?: string };
  /**
   * When true, replaces opaque `incoming`/`outgoing` flow ID arrays with
   * resolved `incomingFlows`/`outgoingFlows` objects containing the flow
   * label and both endpoint IDs/names/types. Non-flow infrastructure
   * elements (Lane, DataObject, DataStore, Process, Participant labels)
   * are excluded from the result unless `elementType` is also set.
   */
  topology?: boolean;
}

/** Extract Zeebe extension element summaries from a business object, if any. */
function extractZeebeExtensions(bo: any): Record<string, any> | undefined {
  const exts = bo?.extensionElements?.values;
  if (!exts || exts.length === 0) return undefined;
  const result: Record<string, any> = {};
  for (const ext of exts) {
    const type = ext.$type;
    if (!type?.startsWith('zeebe:')) continue;
    const shortName = type.replace('zeebe:', '');
    // Flatten simple attribute-only extensions
    const attrs: Record<string, any> = {};
    for (const [key, value] of Object.entries(ext)) {
      if (key.startsWith('$') || key === 'values' || key === 'listeners' ||
          key === 'inputParameters' || key === 'outputParameters' || key === 'properties') continue;
      attrs[key] = value;
    }
    if (Object.keys(attrs).length > 0) {
      result[shortName] = attrs;
    } else {
      result[shortName] = true; // Marker-only extensions like zeebe:UserTask
    }
  }
  if (Object.keys(result).length === 0) return undefined;
  return result;
}

/**
 * Element types that are infrastructure / containers, not process flow nodes.
 * Excluded from topology view unless the caller sets an explicit elementType filter.
 */
const TOPOLOGY_EXCLUDED_TYPES = new Set([
  'bpmn:Lane',
  'bpmn:LaneSet',
  'bpmn:Process',
  'bpmn:Collaboration',
  'bpmn:DataObjectReference',
  'bpmn:DataObject',
  'bpmn:DataStoreReference',
  'bpmn:TextAnnotation',
  'bpmn:Group',
  'label',
]);

/** Resolve a connection element to a ResolvedFlow descriptor. */
function resolveFlow(conn: any): ResolvedFlow {
  const bo = conn.businessObject;
  return {
    id: conn.id,
    label: bo?.name || null,
    sourceId: conn.source?.id ?? bo?.sourceRef?.id ?? '',
    sourceName: conn.source?.businessObject?.name || conn.source?.id || '',
    sourceType: conn.source?.type ?? '',
    targetId: conn.target?.id ?? bo?.targetRef?.id ?? '',
    targetName: conn.target?.businessObject?.name || conn.target?.id || '',
    targetType: conn.target?.type ?? '',
  };
}

/** Convert a registry element to a serialisable list entry. */
function mapElementToEntry(el: any): Record<string, any> {
  const entry: Record<string, any> = {
    id: el.id,
    type: el.type,
    name: el.businessObject?.name || '(unnamed)',
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
  };

  if (el.type === 'bpmn:BoundaryEvent') {
    const hostId = el.host?.id || el.businessObject?.attachedToRef?.id;
    if (hostId) entry.attachedToRef = hostId;
  }

  if (el.incoming?.length) entry.incoming = el.incoming.map((c: any) => c.id);
  if (el.outgoing?.length) entry.outgoing = el.outgoing.map((c: any) => c.id);
  // topology-resolved variants are added by mapElementToEntryTopology

  if (el.source) entry.sourceId = el.source.id;
  if (el.target) entry.targetId = el.target.id;
  if (el.waypoints && el.waypoints.length > 0) {
    entry.waypoints = el.waypoints.map((wp: any) => ({ x: wp.x, y: wp.y }));
  }

  const zeebeExtensions = extractZeebeExtensions(el.businessObject);
  if (zeebeExtensions) entry.zeebeExtensions = zeebeExtensions;

  return entry;
}

/** Convert a registry element to a topology-resolved entry (resolved flows, no coordinates). */
function mapElementToEntryTopology(el: any): Record<string, any> {
  const entry: Record<string, any> = {
    id: el.id,
    type: el.type,
    name: el.businessObject?.name || '(unnamed)',
  };

  if (el.type === 'bpmn:BoundaryEvent') {
    const hostId = el.host?.id || el.businessObject?.attachedToRef?.id;
    if (hostId) entry.attachedToRef = hostId;
  }

  // Resolved incoming connections (sequence flows into this element)
  if (el.incoming?.length) {
    entry.incomingFlows = el.incoming
      .filter((c: any) => c.type === 'bpmn:SequenceFlow' || c.type === 'bpmn:MessageFlow')
      .map(resolveFlow);
  } else {
    entry.incomingFlows = [];
  }

  // Resolved outgoing connections (sequence flows out of this element)
  if (el.outgoing?.length) {
    entry.outgoingFlows = el.outgoing
      .filter((c: any) => c.type === 'bpmn:SequenceFlow' || c.type === 'bpmn:MessageFlow')
      .map(resolveFlow);
  } else {
    entry.outgoingFlows = [];
  }

  return entry;
}

/** Filter elements by a property key/value constraint. */
function filterByProperty(elements: any[], property: { key: string; value?: string }): any[] {
  return elements.filter((el: any) => {
    const bo = el.businessObject;
    if (!bo) return false;

    const key = property.key;
    let val: any;
    if (key.startsWith('zeebe:')) {
      // Check zeebe extension elements for the attribute
      const extVals = bo.extensionElements?.values || [];
      const zeebeType = 'zeebe:' + key.split(':').slice(1).join(':').split('.')[0];
      const ext = extVals.find((e: any) => e.$type === zeebeType);
      val = ext ? true : undefined;
    } else {
      val = bo[key];
    }

    if (val === undefined) return false;
    if (property.value === undefined) return true;
    return String(val) === property.value;
  });
}

export async function handleListElements(args: ListElementsArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId']);
  const { diagramId, namePattern, elementType, property, topology } = args;
  const diagram = requireDiagram(diagramId);

  const elementRegistry = getService(diagram.modeler, 'elementRegistry');
  let elements = getVisibleElements(elementRegistry);

  const hasFilters = !!(namePattern || elementType || property);

  // In topology mode, exclude infrastructure/container elements unless the
  // caller explicitly sets an elementType filter.
  if (topology && !elementType) {
    elements = elements.filter((el: any) => !TOPOLOGY_EXCLUDED_TYPES.has(el.type));
    // Also exclude bare sequence flow / message flow elements — they appear
    // inline on the source/target nodes via incomingFlows/outgoingFlows.
    elements = elements.filter(
      (el: any) => el.type !== 'bpmn:SequenceFlow' && el.type !== 'bpmn:MessageFlow'
    );
  }

  // Filter by element type
  if (elementType) {
    elements = elements.filter((el: any) => el.type === elementType);
  }

  // Filter by name pattern (case-insensitive regex)
  if (namePattern) {
    const regex = new RegExp(namePattern, 'i');
    elements = elements.filter((el: any) => regex.test(el.businessObject?.name || ''));
  }

  // Filter by property key/value
  if (property) {
    elements = filterByProperty(elements, property);
  }

  const elementList = topology
    ? elements.map(mapElementToEntryTopology)
    : elements.map(mapElementToEntry);

  return jsonResult({
    success: true,
    elements: elementList,
    count: elementList.length,
    ...(hasFilters || topology
      ? {
          filters: {
            ...(namePattern ? { namePattern } : {}),
            ...(elementType ? { elementType } : {}),
            ...(property ? { property } : {}),
            ...(topology ? { topology } : {}),
          },
        }
      : {}),
  });
}

export const TOOL_DEFINITION = {
  name: 'list_bpmn_elements',
  description:
    'List elements in a BPMN diagram. By default returns all elements with types, names, positions, and opaque flow ID arrays. ' +
    'Set topology: true for a connectivity summary: each element gets resolved incomingFlows/outgoingFlows arrays with ' +
    'flow labels, source/target IDs, names, and types — use this to understand process topology in one call without parsing XML. ' +
    'Supports optional filters to search by name pattern, element type, or property value.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      topology: {
        type: 'boolean',
        description:
          'When true, returns a connectivity summary: each element includes resolved ' +
          'incomingFlows and outgoingFlows arrays with { id, label, sourceId, sourceName, ' +
          'sourceType, targetId, targetName, targetType }. Infrastructure elements ' +
          '(lanes, data objects, annotations) are excluded. Use this to understand ' +
          'process flow and gateway branching in a single call.',
      },
      namePattern: {
        type: 'string',
        description:
          'Regular expression pattern to match against element names (case-insensitive). Only matching elements are returned.',
      },
      elementType: {
        type: 'string',
        description:
          "BPMN element type to filter by (e.g. 'bpmn:UserTask', 'bpmn:ExclusiveGateway')",
      },
      property: {
        type: 'object',
        description: 'Filter by a specific property key and optional value',
        properties: {
          key: {
            type: 'string',
            description: "Property key to check (e.g. 'zeebe:TaskDefinition', 'isExecutable')",
          },
          value: {
            type: 'string',
            description: 'Expected property value (omit to check key existence only)',
          },
        },
        required: ['key'],
      },
    },
    required: ['diagramId'],
  },
} as const;
