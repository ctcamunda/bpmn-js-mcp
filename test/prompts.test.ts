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
});
