/**
 * TDD tests for svgToPng font rendering.
 *
 * The @resvg/resvg-js renderer needs system font paths so that text labels
 * inside SVG diagrams are rendered as visible glyphs rather than empty boxes.
 *
 * These tests verify that:
 * 1. svgToPng returns a non-empty PNG buffer.
 * 2. An SVG containing a <text> element produces a larger PNG than a blank SVG
 *    (rough proxy for "text was rendered").
 * 3. Bundled Liberation Sans fonts provide a fallback when no system fonts exist.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, test, expect } from 'vitest';
import { svgToPng, svgToPngWithFallback, getBundledFontDir } from '../src/svg-to-png';

const BLANK_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
  <rect width="200" height="100" fill="white"/>
</svg>`;

const TEXT_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
  <rect width="200" height="100" fill="white"/>
  <text x="20" y="60" font-family="Liberation Sans,Arial,sans-serif" font-size="20" fill="black">Hello World</text>
</svg>`;

describe('svgToPng', () => {
  test('returns a non-empty Buffer', () => {
    const png = svgToPng(BLANK_SVG);
    expect(png).toBeInstanceOf(Buffer);
    expect(png.length).toBeGreaterThan(0);
  });

  test('PNG starts with the PNG magic bytes', () => {
    const png = svgToPng(BLANK_SVG);
    // PNG magic: 89 50 4E 47 0D 0A 1A 0A
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50); // 'P'
    expect(png[2]).toBe(0x4e); // 'N'
    expect(png[3]).toBe(0x47); // 'G'
  });

  test('SVG with text produces a larger PNG than blank SVG', () => {
    const blankPng = svgToPng(BLANK_SVG);
    const textPng = svgToPng(TEXT_SVG);
    // When text glyphs are rendered, the PNG contains more non-trivial pixel
    // data, resulting in a larger compressed file.  If fonts are missing resvg
    // renders the text as nothing (same as blank), so the sizes would be equal.
    expect(textPng.length).toBeGreaterThan(blankPng.length);
  });

  test('PNG dimensions match SVG viewBox', () => {
    // Verify the PNG metadata encodes correct width/height.
    // PNG IHDR chunk starts at byte 16 and contains width (4 bytes) then height (4 bytes).
    const png = svgToPng(BLANK_SVG);
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    expect(width).toBe(200);
    expect(height).toBe(100);
  });
});

describe('svgToPngWithFallback', () => {
  test('returns PNG with image/png mimeType when fonts are available', () => {
    const result = svgToPngWithFallback(TEXT_SVG);
    // On this system fonts exist, so should return PNG
    expect(result.mimeType).toBe('image/png');
    expect(result.data).toBeInstanceOf(Buffer);
    expect(result.data.length).toBeGreaterThan(0);
    // PNG magic bytes
    expect(result.data[0]).toBe(0x89);
    expect(result.data[1]).toBe(0x50);
  });

  test('returns valid buffer for blank SVG', () => {
    const result = svgToPngWithFallback(BLANK_SVG);
    expect(result.data).toBeInstanceOf(Buffer);
    expect(result.data.length).toBeGreaterThan(0);
  });
});

describe('bundled fonts', () => {
  test('getBundledFontDir returns a directory that exists', () => {
    const dir = getBundledFontDir();
    expect(dir).toBeTruthy();
    expect(fs.existsSync(dir!)).toBe(true);
  });

  test('bundled fonts directory contains Liberation Sans TTF files', () => {
    const dir = getBundledFontDir();
    expect(dir).toBeTruthy();
    const files = fs.readdirSync(dir!);
    const ttfFiles = files.filter((f) => f.endsWith('.ttf'));
    expect(ttfFiles.length).toBeGreaterThanOrEqual(1);
    expect(ttfFiles).toContain('LiberationSans-Regular.ttf');
  });

  test('bundled font renders text in SVG with font-family: Arial, sans-serif', () => {
    // This SVG uses the same font-family as bpmn-js output
    const bpmnLikeSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
  <rect width="200" height="100" fill="white"/>
  <text x="20" y="60" font-family="Arial, sans-serif" font-size="20" fill="black">Task Name</text>
</svg>`;
    const blankPng = svgToPng(BLANK_SVG);
    const textPng = svgToPng(bpmnLikeSvg);
    // The bundled font should allow text rendering even when Arial is not available
    expect(textPng.length).toBeGreaterThan(blankPng.length);
  });

  test('bundled fonts directory is under the project root', () => {
    const dir = getBundledFontDir();
    expect(dir).toBeTruthy();
    // Should be either <project>/fonts or <project>/dist/../fonts
    expect(dir!).toMatch(/fonts$/);
    expect(fs.existsSync(path.join(dir!, 'LiberationSans-Regular.ttf'))).toBe(true);
  });
});
