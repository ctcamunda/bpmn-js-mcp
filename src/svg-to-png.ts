/**
 * SVG-to-PNG conversion using @resvg/resvg-js.
 *
 * Converts SVG strings (as produced by bpmn-js `saveSVG()`) into PNG buffers
 * suitable for inclusion as base64-encoded `ImageContent` items in MCP tool
 * responses.
 *
 * resvg-js is a Rust-based SVG renderer compiled to a native addon — no
 * Canvas / node-gyp build chain required.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Resvg } from '@resvg/resvg-js';

/**
 * Platform-specific system font directories.
 *
 * @resvg/resvg-js has no access to system fonts by default — text labels
 * render as empty boxes when no font paths are provided.  We scan these
 * directories for TTF/OTF font files and pass them via `fontFiles` to the
 * Rust renderer, enabling it to find and rasterize fonts used by bpmn-js
 * SVG output (typically `font-family: Arial, sans-serif`).
 *
 * Also respects Nix-based font configuration via the `FONTCONFIG_PATH`
 * environment variable: when set, its directories are prepended to the
 * search list so that devenv/nix-provisioned fonts are found first.
 */
function getSystemFontDirs(): string[] {
  const dirs: string[] = [];

  // Nix / devenv: FONTCONFIG_PATH may point to directories with fonts.conf
  // that reference Nix store paths. We also check for a fonts directory
  // relative to the fontconfig path (e.g. /nix/store/.../share/fonts).
  const fontconfigPath = process.env.FONTCONFIG_PATH;
  if (fontconfigPath) {
    for (const p of fontconfigPath.split(':')) {
      if (p) {
        dirs.push(p);
        // Walk up to find share/fonts relative to the fontconfig dir
        const shareFonts = path.resolve(p, '..', 'fonts');
        if (fs.existsSync(shareFonts)) dirs.push(shareFonts);
      }
    }
  }

  // DEVENV_PROFILE points to the Nix profile root when running inside devenv.
  // Fonts provisioned via packages (e.g. pkgs.liberation_ttf) land in
  // $DEVENV_PROFILE/share/fonts.
  const devenvProfile = process.env.DEVENV_PROFILE;
  if (devenvProfile) {
    const profileFonts = path.join(devenvProfile, 'share', 'fonts');
    if (fs.existsSync(profileFonts)) dirs.push(profileFonts);
  }

  // Platform defaults
  switch (process.platform) {
    case 'linux':
      dirs.push('/usr/share/fonts', '/usr/local/share/fonts', path.join(os.homedir(), '.fonts'));
      break;
    case 'darwin':
      dirs.push(
        '/System/Library/Fonts',
        '/Library/Fonts',
        path.join(os.homedir(), 'Library/Fonts')
      );
      break;
    case 'win32':
      dirs.push('C:\\Windows\\Fonts');
      break;
  }
  return dirs;
}

const SYSTEM_FONT_DIRS: string[] = getSystemFontDirs();

/** Font file extensions supported by resvg-js. */
const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.woff', '.woff2']);

/**
 * Recursively collect font files from a directory.
 * Silently skips directories that don't exist or can't be read.
 */
function collectFontFiles(dir: string): string[] {
  const files: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files; // directory doesn't exist or permission denied
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFontFiles(fullPath));
    } else if (entry.isFile() && FONT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }
  return files;
}

/** Lazily collected system font file paths (collected once on first use). */
let _cachedFontFiles: string[] | null = null;

function getSystemFontFiles(): string[] {
  if (_cachedFontFiles !== null) return _cachedFontFiles;
  const files: string[] = [];
  for (const dir of SYSTEM_FONT_DIRS) {
    files.push(...collectFontFiles(dir));
  }
  _cachedFontFiles = files;
  return files;
}

/**
 * Convert an SVG string to a PNG buffer.
 *
 * Provides `fontFiles` so the Rust renderer can find system fonts and render
 * text labels inside BPMN diagrams.
 *
 * @param svg   The SVG markup (e.g. from `modeler.saveSVG()`)
 * @returns     A Buffer containing the PNG image data
 */
export function svgToPng(svg: string): Buffer {
  const fontFiles = getSystemFontFiles();
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'original' as const },
    font: {
      fontFiles,
      // Disable the built-in system font scanner so we control exactly
      // which files are loaded (avoids slow scanning and permission issues).
      loadSystemFonts: false,
    },
  });
  const rendered = resvg.render();
  return Buffer.from(rendered.asPng());
}

/**
 * Convert an SVG string to a PNG buffer with SVG fallback.
 *
 * When no system font files are found, the Rust renderer cannot rasterize
 * text labels — the resulting PNG would show empty boxes instead of labels.
 * In that case this function falls back to returning the raw SVG as a
 * base64-encodable buffer with `mimeType: "image/svg+xml"` so the client
 * still gets a useful diagram preview.
 *
 * @param svg  The SVG markup
 * @returns    `{ data: Buffer; mimeType: string }` — PNG or SVG fallback
 */
export function svgToPngWithFallback(svg: string): { data: Buffer; mimeType: string } {
  const fontFiles = getSystemFontFiles();

  if (fontFiles.length === 0) {
    // No fonts available — fall back to SVG to avoid blank labels
    return { data: Buffer.from(svg, 'utf-8'), mimeType: 'image/svg+xml' };
  }

  const pngBuffer = svgToPng(svg);
  return { data: pngBuffer, mimeType: 'image/png' };
}
