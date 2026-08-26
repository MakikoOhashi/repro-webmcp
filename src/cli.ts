#!/usr/bin/env node

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CONFIG_FILENAME = "repro.config.ts";
const INITIAL_CONFIG = `import { defineRepro } from "repro-webmcp";

export default defineRepro({
  states: {},
});
`;

function init(): void {
  const configPath = join(process.cwd(), CONFIG_FILENAME);

  if (existsSync(configPath)) {
    console.log(`${CONFIG_FILENAME} already exists.`);
    return;
  }

  writeFileSync(configPath, INITIAL_CONFIG, "utf8");
  console.log("Repro initialized.");
  console.log(`Created: ${CONFIG_FILENAME}`);
}

const [command] = process.argv.slice(2);

if (command === "init") {
  init();
} else {
  console.error("Usage: repro init");
  process.exitCode = 1;
}
