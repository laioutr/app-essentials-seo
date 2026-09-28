import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { checkUnheadVersions } from '../../src/unheadVersions';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

// A flat node_modules tree: `packages` maps a path below node_modules to that package's version.
const project = (packages: Record<string, string>) => {
  const root = mkdtempSync(join(tmpdir(), 'unhead-versions-'));
  roots.push(root);
  for (const [path, version] of Object.entries(packages)) {
    const dir = join(root, 'node_modules', path);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: path.split('/node_modules/').pop(), version }));
  }
  const selfDir = join(root, 'node_modules', '@laioutr/app-essentials-seo/dist');
  mkdirSync(selfDir, { recursive: true });
  return { root, self: join(selfDir, 'module.mjs') };
};

const schemaOrg = (version: string) => ({
  'nuxt-schema-org': '5.0.5',
  'nuxt-schema-org/node_modules/@unhead/schema-org': version,
  'nuxt-schema-org/node_modules/@unhead/schema-org/node_modules/unhead': version,
});

describe('checkUnheadVersions', () => {
  it('reports an error naming both versions and the fix when schema-org brings a newer unhead', () => {
    const { root, self } = project({ '@unhead/vue': '2.0.19', unhead: '2.0.19', ...schemaOrg('2.1.17') });
    const report = checkUnheadVersions(root, self);
    expect(report.level).toBe('error');
    expect(report.message).toContain('2.0.19');
    expect(report.message).toContain('2.1.17');
    expect(report.message).toContain('pnpm update --depth Infinity @unhead/vue @unhead/schema-org unhead');
  });

  it('warns when schema-org brings an older unhead', () => {
    const { root, self } = project({ '@unhead/vue': '2.1.17', unhead: '2.1.17', ...schemaOrg('2.0.10') });
    expect(checkUnheadVersions(root, self).level).toBe('warn');
  });

  it('is quiet when both use the same unhead', () => {
    const { root, self } = project({ '@unhead/vue': '2.1.17', unhead: '2.1.17', ...schemaOrg('2.1.17') });
    expect(checkUnheadVersions(root, self)).toEqual({ level: 'ok' });
  });

  it("finds Nuxt's own @unhead/vue when the project root has none", () => {
    const { root, self } = project({
      nuxt: '3.16.2',
      'nuxt/node_modules/@unhead/vue': '2.0.19',
      'nuxt/node_modules/unhead': '2.0.19',
      ...schemaOrg('2.1.17'),
    });
    expect(checkUnheadVersions(root, self).level).toBe('error');
  });

  it('is quiet when a package.json carries no version', () => {
    const { root, self } = project({ '@unhead/vue': '2.0.19', unhead: '2.0.19', ...schemaOrg('2.1.17') });
    writeFileSync(join(root, 'node_modules/unhead/package.json'), JSON.stringify({ name: 'unhead' }));
    expect(checkUnheadVersions(root, self)).toEqual({ level: 'ok' });
  });

  it('is quiet when nuxt-schema-org is not installed', () => {
    const { root, self } = project({ '@unhead/vue': '2.0.19', unhead: '2.0.19' });
    expect(checkUnheadVersions(root, self)).toEqual({ level: 'ok' });
  });

  it('finds one unhead version in the real install', () => {
    const fixture = fileURLToPath(new URL('../fixtures/seo', import.meta.url));
    const self = fileURLToPath(new URL('../../src/module.ts', import.meta.url));
    expect(checkUnheadVersions(fixture, self)).toEqual({ level: 'ok' });
  });
});
