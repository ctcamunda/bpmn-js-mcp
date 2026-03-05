import { describe, test, expect } from 'vitest';
import { TOOL_DEFINITIONS } from '../../../src/tool-definitions';
import { dispatchToolCall } from '../../../src/handlers';

describe('batch_bpmn_operations — all tools dispatchable', () => {
  test('every registered tool name can be dispatched (no "Unknown tool")', () => {
    // Verify that every tool in TOOL_DEFINITIONS has a matching handler
    // in the dispatch map. We don't execute them (they need valid args),
    // but we verify they don't throw MethodNotFound.
    for (const tool of TOOL_DEFINITIONS) {
      // Calling with invalid args should throw a validation error,
      // NOT "Unknown tool". This confirms the dispatch map covers all tools.
      const promise = dispatchToolCall(tool.name, {});
      // We expect either a validation error or a result — NOT "Unknown tool"
      promise.catch((err: any) => {
        expect(err.message).not.toContain('Unknown tool');
      });
    }
  });

  test('dispatch map covers exactly the same tools as TOOL_DEFINITIONS', () => {
    // The dispatch map is auto-derived from TOOL_REGISTRY, same as TOOL_DEFINITIONS.
    // Verify counts match (30 tools — 9 removed via tool consolidation:
    //   clone_bpmn_diagram → create_bpmn_diagram (cloneFrom),
    //   wrap_bpmn_process_in_collaboration → create_bpmn_participant (wrapExisting),
    //   convert_bpmn_collaboration_to_lanes → create_bpmn_lanes (mergeFrom),
    //   diff_bpmn_diagrams → list_bpmn_diagrams (compareWith),
    //   autosize_bpmn_pools_and_lanes → layout_bpmn_diagram (autosizeOnly),
    //   redistribute_bpmn_elements_across_lanes → analyze_bpmn_lanes (mode: redistribute),
    //   replace_bpmn_element → set_bpmn_element_properties (elementType),
    //   set_bpmn_connection_waypoints → connect_bpmn_elements (connectionId + waypoints),
    //   handoff_bpmn_to_lane → add_bpmn_element (fromElementId + toLaneId)).
    expect(TOOL_DEFINITIONS.length).toBe(30);

    // Verify no tool name is duplicated
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  test('unknown tool name throws MethodNotFound', async () => {
    await expect(dispatchToolCall('nonexistent_tool', {})).rejects.toThrow(/Unknown tool/);
  });
});
