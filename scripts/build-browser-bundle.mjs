import { readFileSync, writeFileSync } from "node:fs";

const runtime = readFileSync("dist/index.js", "utf8").replace(/\n\/\/# sourceMappingURL=.*\n?$/, "\n");
if (/\bimport\s+.*\sfrom\s+/.test(runtime)) {
  throw new Error("Browser bundle source unexpectedly contains an import dependency.");
}
writeFileSync(
  "dist/browser.bundle.js",
  `// Self-contained browser entry generated from the built runtime.\n${runtime}`,
);
