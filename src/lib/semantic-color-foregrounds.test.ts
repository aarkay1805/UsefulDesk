import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HUES = [
  "slate",
  "red",
  "orange",
  "amber",
  "yellow",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
] as const;

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const chartPalette = join(sourceRoot, "components/tremor/chart-colors.ts");
const rawForeground = new RegExp(`text-(?:${HUES.join("|")})-\\d+`);
const mismatchedSubtleForeground = new RegExp(
  `bg-(${HUES.join("|")})-\\d+/\\d+[^\\n]*text-(?!\\1-foreground)(?:[a-z]+-foreground|primary-text)`,
);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("semantic colour foregrounds", () => {
  it("derives every hue token from its fill primitive and live foreground", () => {
    const css = readFileSync(join(sourceRoot, "app/globals.css"), "utf8");

    for (const hue of HUES) {
      expect(css).toContain(
        `--color-${hue}-foreground: var(--${hue}-foreground);`,
      );
      expect(css).toContain(
        `--${hue}-foreground: color-mix(in oklch, var(--color-${hue}-500), var(--foreground) 45%);`,
      );
    }

    expect(css.match(/--destructive: var\(--red-foreground\);/g)).toHaveLength(1);
  });

  it("does not bypass hue tokens in application text or icons", () => {
    const offenders = sourceFiles(sourceRoot)
      .filter((path) => path !== chartPalette)
      .flatMap((path) => {
        const lines = readFileSync(path, "utf8").split("\n");
        return lines.flatMap((line, index) =>
          rawForeground.test(line)
            ? [`${relative(sourceRoot, path)}:${index + 1}`]
            : [],
        );
      });

    expect(offenders).toEqual([]);
  });

  it("does not pair a subtle palette background with a different foreground family", () => {
    const offenders = sourceFiles(sourceRoot)
      .filter((path) => path !== chartPalette)
      .flatMap((path) => {
        const lines = readFileSync(path, "utf8").split("\n");
        return lines.flatMap((line, index) =>
          mismatchedSubtleForeground.test(line)
            ? [`${relative(sourceRoot, path)}:${index + 1}`]
            : [],
        );
      });

    expect(offenders).toEqual([]);
  });
});
