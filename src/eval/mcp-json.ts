import type { ToolResult } from '../types';

export function parseToolJson<T = any>(result: ToolResult): T {
  const text = result.content?.[0]?.text;
  if (!text) throw new Error('ToolResult had no content[0].text');
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    const e = err as Error;
    throw new Error(`Failed to parse ToolResult JSON: ${e.message}\n---\n${text.slice(0, 500)}`);
  }
}
