import { describe, test, expect } from 'vitest';
import { TOOL_DEFINITIONS } from '../src/tool-definitions';

/** Helper to extract typed inputSchema from a tool definition. */
function getSchema(tool: (typeof TOOL_DEFINITIONS)[number] | undefined) {
  return tool?.inputSchema as {
    type: string;
    required?: string[];
    properties?: Record<string, any>;
  };
}

describe('tool-definitions', () => {
  const toolNames = TOOL_DEFINITIONS.map((t) => t.name);

  test('exports the expected number of tools', () => {
    expect(TOOL_DEFINITIONS.length).toBe(25);
  });

  test.each([
    'create_bpmn_diagram',
    'add_bpmn_element',
    'connect_bpmn_elements',
    'delete_bpmn_element',
    'move_bpmn_element',
    'export_bpmn',
    'set_bpmn_element_properties',
    'import_bpmn_xml',
    'inspect_bpmn',
    'set_bpmn_input_output_mapping',
    'set_bpmn_event_definition',
    'set_bpmn_form_data',
    'layout_bpmn_diagram',
    'set_bpmn_loop_characteristics',
    'bpmn_history',
    'batch_bpmn_operations',
    'set_bpmn_camunda_listeners',
    'set_bpmn_call_activity_variables',
    'manage_bpmn_root_elements',
    'create_bpmn_lanes',
    'create_bpmn_participant',
    'manage_bpmn_lanes',
    // redistribute_bpmn_elements_across_lanes removed — use manage_bpmn_lanes with mode: redistribute
    // replace_bpmn_element removed — use set_bpmn_element_properties with elementType
    // clone_bpmn_diagram removed — use create_bpmn_diagram with cloneFrom
    // diff_bpmn_diagrams removed — use inspect_bpmn with mode: diff
    'add_bpmn_element_chain',
    // set_bpmn_connection_waypoints removed — use connect_bpmn_elements with connectionId + waypoints
    'generate_bpmn_from_structure',
    'configure_bpmn_zeebe_extensions',
    // wrap_bpmn_process_in_collaboration removed — use create_bpmn_participant with wrapExisting
    // handoff_bpmn_to_lane removed — use add_bpmn_element with fromElementId + toLaneId
    // convert_bpmn_collaboration_to_lanes removed — use create_bpmn_lanes with mergeFrom
    // autosize_bpmn_pools_and_lanes removed — use layout_bpmn_diagram with autosizeOnly
  ])("includes tool '%s'", (name) => {
    expect(toolNames).toContain(name);
  });

  test('create_bpmn_diagram has cloneFrom parameter (merged from clone_bpmn_diagram)', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'create_bpmn_diagram');
    const schema = getSchema(tool);
    expect(schema.properties).toHaveProperty('cloneFrom');
  });

  test('create_bpmn_participant has wrapExisting parameter (merged from wrap_bpmn_process_in_collaboration)', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'create_bpmn_participant');
    const schema = getSchema(tool);
    expect(schema.properties).toHaveProperty('wrapExisting');
  });

  test('create_bpmn_lanes has mergeFrom parameter (merged from convert_bpmn_collaboration_to_lanes)', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'create_bpmn_lanes');
    const schema = getSchema(tool);
    expect(schema.properties).toHaveProperty('mergeFrom');
  });

  test('inspect_bpmn supports diagram diff mode', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'inspect_bpmn');
    const schema = getSchema(tool);
    expect(schema.properties).toHaveProperty('compareWith');
    expect(schema.properties!.mode.enum).toContain('diff');
  });

  test('layout_bpmn_diagram has autosizeOnly parameter (merged from autosize_bpmn_pools_and_lanes)', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'layout_bpmn_diagram');
    const schema = getSchema(tool);
    expect(schema.properties).toHaveProperty('autosizeOnly');
  });

  test('manage_bpmn_lanes has assign and redistribute modes', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'manage_bpmn_lanes');
    const schema = getSchema(tool);
    expect(schema.properties!.mode.enum).toContain('assign');
    expect(schema.properties!.mode.enum).toContain('redistribute');
  });

  test('set_bpmn_element_properties has elementType parameter (merged from replace_bpmn_element)', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'set_bpmn_element_properties');
    const schema = getSchema(tool);
    expect(schema.properties).toHaveProperty('elementType');
  });

  test('connect_bpmn_elements has connectionId and waypoints parameters (merged from set_bpmn_connection_waypoints)', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'connect_bpmn_elements');
    const schema = getSchema(tool);
    expect(schema.properties).toHaveProperty('connectionId');
    expect(schema.properties).toHaveProperty('waypoints');
  });

  test("every tool has an inputSchema with type 'object'", () => {
    for (const tool of TOOL_DEFINITIONS) {
      const schema = getSchema(tool);
      expect(schema.type).toBe('object');
    }
  });

  test('add_bpmn_element requires diagramId and elementType', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'add_bpmn_element');
    const schema = getSchema(tool);
    expect(schema.required).toEqual(expect.arrayContaining(['diagramId', 'elementType']));
  });

  test('add_bpmn_element enum includes BoundaryEvent and CallActivity', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'add_bpmn_element');
    const schema = getSchema(tool);
    const enumValues = schema.properties!.elementType.enum;
    expect(enumValues).toContain('bpmn:BoundaryEvent');
    expect(enumValues).toContain('bpmn:CallActivity');
    expect(enumValues).toContain('bpmn:TextAnnotation');
  });

  test('export_bpmn requires diagramId and format', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'export_bpmn');
    const schema = getSchema(tool);
    expect(schema.required).toEqual(expect.arrayContaining(['diagramId', 'format']));
    expect(schema.properties!.format.enum).toEqual(['xml', 'svg', 'both']);
  });

  test('connect_bpmn_elements has connectionType and conditionExpression params', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'connect_bpmn_elements');
    const schema = getSchema(tool);
    expect(schema.properties!.connectionType).toBeDefined();
    expect(schema.properties!.conditionExpression).toBeDefined();
  });

  test('set_bpmn_input_output_mapping has inputParameters and outputParameters with source/target', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'set_bpmn_input_output_mapping');
    const schema = getSchema(tool);
    expect(schema.properties!.inputParameters).toBeDefined();
    expect(schema.properties!.outputParameters).toBeDefined();
    // Zeebe I/O mappings use source and target
    const inputItemProps = schema.properties!.inputParameters.items.properties;
    expect(inputItemProps.source).toBeDefined();
    expect(inputItemProps.target).toBeDefined();
  });

  test('set_bpmn_event_definition requires eventDefinitionType', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'set_bpmn_event_definition');
    const schema = getSchema(tool);
    expect(schema.required).toContain('eventDefinitionType');
  });

  test('set_bpmn_form_data requires diagramId and elementId', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'set_bpmn_form_data');
    const schema = getSchema(tool);
    expect(schema.required).toEqual(expect.arrayContaining(['diagramId', 'elementId']));
  });

  test('layout_bpmn_diagram has align/distribute parameters', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'layout_bpmn_diagram');
    const schema = getSchema(tool);
    expect(schema.properties!.compact).toBeDefined();
    expect(schema.properties!.compact.type).toBe('boolean');
    expect(schema.properties!.orientation).toBeDefined();
    expect(schema.properties!.gap).toBeDefined();
    expect(schema.properties!.gap.type).toBe('number');
    expect(schema.properties!.elementIds).toBeDefined();
  });

  test('connect_bpmn_elements has isDefault parameter', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'connect_bpmn_elements');
    const schema = getSchema(tool);
    expect(schema.properties!.isDefault).toBeDefined();
    expect(schema.properties!.isDefault.type).toBe('boolean');
  });

  test('add_bpmn_element enum includes Participant and Lane', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'add_bpmn_element');
    const schema = getSchema(tool);
    const enumValues = schema.properties!.elementType.enum;
    expect(enumValues).toContain('bpmn:Participant');
    expect(enumValues).toContain('bpmn:Lane');
  });

  test('layout_bpmn_diagram requires diagramId', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'layout_bpmn_diagram');
    const schema = getSchema(tool);
    expect(schema.required).toContain('diagramId');
  });

  test('layout_bpmn_diagram supports align/distribute modes', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'layout_bpmn_diagram');
    const schema = getSchema(tool);
    expect(schema.properties).toHaveProperty('mode');
    expect(schema.properties!.mode.enum).toEqual(
      expect.arrayContaining(['layout', 'align', 'distribute', 'labels', 'autosize'])
    );
    expect(schema.properties).toHaveProperty('alignment');
    expect(schema.properties).toHaveProperty('orientation');
  });

  test('inspect_bpmn supports validation and element inspection modes', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'inspect_bpmn');
    const schema = getSchema(tool);
    expect(schema.properties!.mode.enum).toEqual(
      expect.arrayContaining(['elements', 'element', 'validation', 'variables'])
    );
    expect(schema.properties).toHaveProperty('elementId');
    expect(schema.properties).toHaveProperty('lintMinSeverity');
  });

  test('set_bpmn_camunda_listeners has taskListeners parameter', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'set_bpmn_camunda_listeners');
    const schema = getSchema(tool);
    expect(schema.properties!.taskListeners).toBeDefined();
    expect(schema.properties!.taskListeners.type).toBe('array');
  });

  test('set_bpmn_loop_characteristics requires loopType', () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'set_bpmn_loop_characteristics');
    const schema = getSchema(tool);
    expect(schema.required).toEqual(expect.arrayContaining(['diagramId', 'elementId', 'loopType']));
  });
});
