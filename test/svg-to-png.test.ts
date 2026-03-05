import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, test, expect } from 'vitest';
import {
  svgToPng,
  svgToPngWithFallback,
  getBundledFontDir,
  cropSvgToViewBox,
  tightenSvgViewBox,
  computeElementBounds,
} from '../src/svg-to-png';

const BLANK_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
  <rect width="200" height="100" fill="white"/>
</svg>`;

const TEXT_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
  <rect width="200" height="100" fill="white"/>
  <text x="20" y="60" font-family="Liberation Sans,Arial,sans-serif" font-size="20" fill="black">Hello World</text>
</svg>`;

// Simulates bpmn-js saveSVG() output where width = viewBox.x + viewBox.w
const VIEWBOX_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="346" height="255" viewBox="146 155 200 100" version="1.1">
  <rect x="146" y="155" width="200" height="100" fill="white"/>
</svg>`;

describe('cropSvgToViewBox', () => {
  test('strips origin offset: sets width/height to viewBox dimensions', () => {
    const cropped = cropSvgToViewBox(VIEWBOX_SVG);
    expect(cropped).toContain('width="200"');
    expect(cropped).toContain('height="100"');
    // viewBox is preserved unchanged
    expect(cropped).toContain('viewBox="146 155 200 100"');
  });

  test('returns SVG unchanged when no viewBox attribute is present', () => {
    const result = cropSvgToViewBox(BLANK_SVG);
    expect(result).toBe(BLANK_SVG);
  });
});

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

  test('PNG dimensions are 2\u00d7 SVG dimensions by default (hi-DPI)', () => {
    // PNG IHDR chunk starts at byte 16 and contains width (4 bytes) then height (4 bytes).
    const png = svgToPng(BLANK_SVG);
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    // Default scale=2 doubles the SVG’s 200×100 viewport
    expect(width).toBe(400);
    expect(height).toBe(200);
  });

  test('scale parameter is honoured (scale=1 gives 1:1 dimensions)', () => {
    const png = svgToPng(BLANK_SVG, 1);
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    expect(width).toBe(200);
    expect(height).toBe(100);
  });

  test('viewBox offset is cropped: bpmn-js-style SVG renders at viewBox size (2×)', () => {
    const png = svgToPng(VIEWBOX_SVG);
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    // After crop, SVG is 200×100; with 2× scale → 400×200
    expect(width).toBe(400);
    expect(height).toBe(200);
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

// ── tightenSvgViewBox ──────────────────────────────────────────────────────

// bpmn-js saveSVG() output: large canvas with content in the middle
const PADDED_BPMN_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="800" viewBox="0 0 1000 800" version="1.1">
  <rect x="100" y="200" width="100" height="80" fill="white" stroke="black"/>
  <rect x="300" y="200" width="100" height="80" fill="white" stroke="black"/>
</svg>`;

/** Fake bpmn-js shape elements at known positions. */
const FAKE_ELEMENTS = [
  { x: 100, y: 200, width: 100, height: 80 }, // right edge at 200, bottom at 280
  { x: 300, y: 200, width: 100, height: 80 }, // right edge at 400, bottom at 280
];

describe('computeElementBounds', () => {
  test('returns tight bounds for shape elements', () => {
    const bounds = computeElementBounds(FAKE_ELEMENTS);
    expect(bounds).not.toBeNull();
    expect(bounds!.minX).toBe(100);
    expect(bounds!.minY).toBe(200);
    expect(bounds!.maxX).toBe(400); // 300 + 100
    expect(bounds!.maxY).toBe(280); // 200 + 80
  });

  test('includes waypoint bounds for connections', () => {
    const connEls = [
      ...FAKE_ELEMENTS,
      {
        waypoints: [
          { x: 200, y: 240 },
          { x: 300, y: 240 },
        ],
      }, // connection between shapes
    ];
    const bounds = computeElementBounds(connEls);
    expect(bounds).not.toBeNull();
    // Waypoints are within shape bounds, so result is same
    expect(bounds!.minX).toBe(100);
    expect(bounds!.maxX).toBe(400);
  });

  test('includes label bounds', () => {
    const withLabel = [
      { x: 100, y: 200, width: 100, height: 80, label: { x: 90, y: 290, width: 120, height: 14 } },
    ];
    const bounds = computeElementBounds(withLabel);
    expect(bounds!.minX).toBe(90); // label extends beyond shape left
    expect(bounds!.maxY).toBe(304); // label bottom: 290 + 14
  });

  test('returns null for empty array', () => {
    expect(computeElementBounds([])).toBeNull();
  });

  test('returns null for elements with no position data', () => {
    expect(computeElementBounds([{ type: 'bpmn:SequenceFlow' }])).toBeNull();
  });
});

describe('tightenSvgViewBox', () => {
  test('falls back to cropSvgToViewBox when no elements provided', () => {
    const result = tightenSvgViewBox(PADDED_BPMN_SVG);
    // cropSvgToViewBox does not change a SVG where viewBox already matches (0 0 1000 800)
    expect(result).toContain('viewBox="0 0 1000 800"');
  });

  test('falls back to cropSvgToViewBox when empty array provided', () => {
    const result = tightenSvgViewBox(PADDED_BPMN_SVG, []);
    expect(result).toContain('viewBox="0 0 1000 800"');
  });

  test('tightens viewBox to element bounds + padding', () => {
    const result = tightenSvgViewBox(PADDED_BPMN_SVG, FAKE_ELEMENTS, 10);
    // minX=100, minY=200, maxX=400, maxY=280
    // viewBox: (100-10, 200-10, 300+20, 80+20) = (90 190 320 100)
    expect(result).toContain('viewBox="90 190 320 100"');
    expect(result).toContain('width="320"');
    expect(result).toContain('height="100"');
  });

  test('default padding is 10px', () => {
    const result = tightenSvgViewBox(PADDED_BPMN_SVG, FAKE_ELEMENTS);
    expect(result).toContain('viewBox="90 190 320 100"');
  });

  test('custom padding is respected', () => {
    const result = tightenSvgViewBox(PADDED_BPMN_SVG, FAKE_ELEMENTS, 5);
    // viewBox: (100-5, 200-5, 300+10, 80+10) = (95 195 310 90)
    expect(result).toContain('viewBox="95 195 310 90"');
    expect(result).toContain('width="310"');
    expect(result).toContain('height="90"');
  });

  test('reduces canvas from 1000×800 to tight content size', () => {
    const result = tightenSvgViewBox(PADDED_BPMN_SVG, FAKE_ELEMENTS, 10);
    // Original SVG is 1000×800; tightened is 320×100 — much smaller
    expect(result).not.toContain('width="1000"');
    expect(result).not.toContain('height="800"');
  });
});
