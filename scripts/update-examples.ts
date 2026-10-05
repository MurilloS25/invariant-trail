import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGoldenFiles } from '../packages/engine/src';

const dir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'examples');
mkdirSync(dir, { recursive: true });
for (const file of buildGoldenFiles()) {
  const path = join(dir, `${file.templateId}.expected.json`);
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
  console.log(`wrote ${path}`);
}
