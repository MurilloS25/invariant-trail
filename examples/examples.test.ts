import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildGoldenFiles } from '../packages/engine/src';

const dir = fileURLToPath(new URL('.', import.meta.url));

describe('golden examples', () => {
  for (const file of buildGoldenFiles()) {
    it(`${file.templateId} matches examples/${file.templateId}.expected.json`, () => {
      const onDisk = JSON.parse(
        readFileSync(join(dir, `${file.templateId}.expected.json`), 'utf8'),
      );
      // Run `npm run examples:update` after an intentional change to semantics, then review the diff.
      expect(file).toEqual(onDisk);
    });
  }

  it('records a known shortest counterexample and a safe configuration for every workflow', () => {
    for (const file of buildGoldenFiles()) {
      expect(file.examples.some((e) => e.status === 'violated' && (e.shortest ?? 0) > 0)).toBe(
        true,
      );
      expect(file.examples.some((e) => e.status === 'bounded-safe' && e.complete === true)).toBe(
        true,
      );
    }
  });
});
