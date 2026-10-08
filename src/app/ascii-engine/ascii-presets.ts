/**
 * Curated presets for the two "creative" inputs of the ASCII effect: which
 * characters make up the luminance ramp, and which font renders them.
 *
 * Character presets are ordered darkest-appearing (usually empty space) to
 * densest, matching how the composite shader indexes `uCharCount` by
 * quantized luminance.
 *
 * Font presets stick to fonts that are either genuinely universal system
 * fonts or already loaded by the app (no extra webfont loading/FOIT to
 * manage for a Canvas2D-drawn texture atlas).
 */

export const ASCII_CHARACTER_PRESETS = {
  classic: " .:-=+*#%@",
  minimal: " .*#",
  blocks: " ░▒▓█",
  binary: " 01",
  matrix: " .:+*|/\\10",
  detailed: " .'\"^:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
} as const;

export type AsciiCharacterPresetId = keyof typeof ASCII_CHARACTER_PRESETS;

export const ASCII_CHARACTER_PRESET_LABELS: Record<AsciiCharacterPresetId, string> = {
  binary: "Binary",
  blocks: "Blocks",
  classic: "Classic",
  detailed: "Detailed",
  matrix: "Matrix",
  minimal: "Minimal",
};

export const ASCII_FONT_PRESETS = {
  consolas: "Consolas, Menlo, 'DejaVu Sans Mono', monospace",
  courier: "'Courier New', Courier, monospace",
  impact: "Impact, 'Arial Black', sans-serif",
  lucida: "'Lucida Console', Monaco, monospace",
  serif: "Georgia, 'Times New Roman', serif",
  systemMono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
} as const;

export type AsciiFontPresetId = keyof typeof ASCII_FONT_PRESETS;

export const ASCII_FONT_PRESET_LABELS: Record<AsciiFontPresetId, string> = {
  consolas: "Consolas",
  courier: "Courier New",
  impact: "Impact",
  lucida: "Lucida Console",
  serif: "Serif",
  systemMono: "System Monospace",
};
