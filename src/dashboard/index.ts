import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The dashboard is a real, hand-written HTML file (SPEC feature 8: no build
 * step, no framework, no CDN), so it has to be read from disk rather than
 * imported. Two candidates cover both ways the server runs: next to this
 * module (source tree, or a dist that carries its assets), and the source tree
 * as seen from `dist/dashboard/`.
 */
const CANDIDATES = ["./index.html", "../../src/dashboard/index.html"] as const;

let cached: string | null = null;

/** The dashboard page, read once and held in memory. */
export function dashboardHtml(): string {
  if (cached !== null) return cached;

  const tried: string[] = [];
  for (const candidate of CANDIDATES) {
    const path = fileURLToPath(new URL(candidate, import.meta.url));
    tried.push(path);
    try {
      cached = readFileSync(path, "utf8");
      return cached;
    } catch {
      // Try the next candidate; only the last miss is an error worth raising.
    }
  }

  throw new Error(`dashboard page not found — looked in ${tried.join(", ")}`);
}
