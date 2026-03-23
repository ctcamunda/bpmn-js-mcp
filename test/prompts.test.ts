/**
 * Tests for MCP prompts.
 */
import { describe, test, expect } from 'vitest';
import { listPrompts, getPrompt } from '../src/prompts';

describe('listPrompts', () => {
  test('returns the three style-toggle prompts', () => {
    const prompts = listPrompts();
    expect(prompts.length).toBeGreaterThanOrEqual(3);
    const names = prompts.map((p) => p.name);
    expect(names).toContain('executable');
    expect(names).toContain('executable-pool');
    expect(names).toContain('collaboration');
  });

  test('each prompt has name, title, and description', () => {
    for (const prompt of listPrompts()) {
      expect(prompt.name).toBeTruthy();
      expect(prompt.title).toBeTruthy();
      expect(prompt.description).toBeTruthy();
    }
  });
});

describe('getPrompt', () => {
  test('executable prompt instructs on flat process modeling', () => {
    const result = getPrompt('executable');
    expect(result.description).toBeTruthy();
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[0].content.text).toContain('create_bpmn_diagram');
    expect(result.messages[0].content.text).toContain('export_bpmn');
    expect(result.messages[0].content.text).toContain('executable');
    // Flat process prompt should not instruct to call create_bpmn_participant
    expect(result.messages[0].content.text).not.toContain('create_bpmn_participant');
  });

  test('executable-pool prompt instructs on pool-based process modeling', () => {
    const result = getPrompt('executable-pool');
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content.text).toContain('create_bpmn_participant');
    expect(result.messages[0].content.text).toContain('export_bpmn');
    expect(result.messages[0].content.text).toContain('lanes');
  });

  test('collaboration prompt instructs on multi-pool documentation diagrams', () => {
    const result = getPrompt('collaboration');
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content.text).toContain('message flows');
    expect(result.messages[0].content.text).toContain('export_bpmn');
    expect(result.messages[0].content.text).toContain('documentation');
  });

  test('throws on unknown prompt', () => {
    expect(() => getPrompt('nonexistent')).toThrow('Unknown prompt');
  });

  test('prompts have no required arguments', () => {
    for (const prompt of listPrompts()) {
      const result = getPrompt(prompt.name);
      expect(result.messages).toHaveLength(1);
    }
  });

  test('prompts set modeling context and wait for user assignment (not imperative)', () => {
    for (const name of ['executable', 'executable-pool', 'collaboration']) {
      const result = getPrompt(name);
      const text = result.messages[0].content.text;
      // Should be contextual — explain mode, not issue immediate build command
      expect(text).toMatch(/you are now (operating|modeling)/i);
      // Should NOT start with an imperative "Create a process named..." instruction
      expect(text).not.toMatch(/^Create an? .*(process|diagram)/i);
    }
  });

  test('prompts recommend batch_bpmn_operations for multiple operations', () => {
    for (const name of ['executable', 'executable-pool', 'collaboration']) {
      const result = getPrompt(name);
      const text = result.messages[0].content.text;
      expect(text).toContain('batch_bpmn_operations');
    }
  });

  test('prompts recommend includeImage: true for visual feedback', () => {
    for (const name of ['executable', 'executable-pool', 'collaboration']) {
      const result = getPrompt(name);
      const text = result.messages[0].content.text;
      expect(text).toContain('includeImage');
    }
  });

  test('prompts recommend hintLevel: minimal during construction', () => {
    for (const name of ['executable', 'executable-pool', 'collaboration']) {
      const result = getPrompt(name);
      const text = result.messages[0].content.text;
      expect(text).toContain('hintLevel');
    }
  });

  test('prompts do not reference removed waypoint or autosize tools', () => {
    for (const name of ['executable', 'executable-pool', 'collaboration']) {
      const result = getPrompt(name);
      const text = result.messages[0].content.text;
      expect(text).not.toContain('set_bpmn_connection_waypoints');
      expect(text).not.toContain('autosize_bpmn_pools_and_lanes');
    }
  });

  test('executable-pool prompt does not contain NaN from malformed concatenation', () => {
    const result = getPrompt('executable-pool');
    expect(result.messages[0].content.text).not.toContain('NaN');
  });

  test('executable prompt describes Zeebe service task configuration', () => {
    const result = getPrompt('executable');
    const text = result.messages[0].content.text;
    // Guidance for Zeebe job worker type configuration
    expect(text).toMatch(/zeebe:type/i);
  });

  test('executable prompts position specialized tools as primary and batch Zeebe config as optional', () => {
    for (const name of ['executable', 'executable-pool']) {
      const result = getPrompt(name);
      const text = result.messages[0].content.text;
      expect(text).toMatch(/specialized property tools.*authoritative|authoritative.*specialized/i);
      expect(text).toContain('configure_bpmn_zeebe_extensions');
      expect(text).toMatch(/optional batch shortcut/i);
      expect(text).toMatch(/does NOT replace|Do not treat it as a replacement/i);
    }
  });

  test('executable prompts prefer generate_bpmn_from_structure for first-pass construction when the workflow is already well specified', () => {
    for (const name of ['executable', 'executable-pool']) {
      const result = getPrompt(name);
      const text = result.messages[0].content.text;
      expect(text).toContain('generate_bpmn_from_structure');
      expect(text).toMatch(/reasonably complete process description|already fairly complete/i);
      expect(text).toMatch(/initial BPMN skeleton|first-pass construction/i);
      expect(text).toMatch(/incremental edit|geometry-sensitive refinement|manual modeling|pool\/lane geometry cleanup/i);
    }
  });

  test('executable prompt warns about afterElementId when using add_bpmn_element_chain', () => {
    const result = getPrompt('executable');
    const text = result.messages[0].content.text;
    expect(text).toContain('afterElementId');
    // Should warn that omitting creates a disconnected segment
    expect(text).toMatch(/afterElementId.*disconnected|disconnected.*afterElementId/i);
  });

  test('executable and executable-pool prompts include boundary event interrupt semantics guidance', () => {
    for (const name of ['executable', 'executable-pool']) {
      const result = getPrompt(name);
      const text = result.messages[0].content.text;
      // Should explain when to use interrupting vs non-interrupting
      expect(text).toMatch(/interrupting.*deadline|deadline.*interrupting/i);
      expect(text).toMatch(/non-interrupting.*escalation|escalation.*non-interrupting/i);
    }
  });

  test('executable and executable-pool prompts include compensation pattern guidance', () => {
    for (const name of ['executable', 'executable-pool']) {
      const result = getPrompt(name);
      const text = result.messages[0].content.text;
      // Should mention isForCompensation and the correct ordering
      expect(text).toContain('isForCompensation');
      expect(text).toContain('CompensateEventDefinition');
      // Should instruct to layout BEFORE connecting
      expect(text).toMatch(/layout.*before.*connect|layout_bpmn_diagram.*before/i);
    }
  });

  test('executable and executable-pool prompts note that Association edges are not re-routed by layout', () => {
    for (const name of ['executable', 'executable-pool']) {
      const result = getPrompt(name);
      const text = result.messages[0].content.text;
      // Should warn that layout doesn't fix associations
      expect(text).toMatch(/[Aa]ssociation.*not.*re-?rout|never.*re-?rout.*[Aa]ssociation/i);
    }
  });
});
