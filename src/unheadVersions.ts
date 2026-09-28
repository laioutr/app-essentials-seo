import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

type Installed = { file: string; version: string };

const numeric = (version: string) =>
  version
    .split('-')[0]!
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);

/** How `other` relates to `project`, by major, minor and patch. */
const compareVersions = (project: string, other: string): 'same' | 'older' | 'newer' => {
  const [a, b] = [numeric(project), numeric(other)];
  for (let index = 0; index < 3; index++) {
    if ((b[index] ?? 0) > (a[index] ?? 0)) return 'newer';
    if ((b[index] ?? 0) < (a[index] ?? 0)) return 'older';
  }
  return 'same';
};

// Node's own lookup order from `fromFile`, following real paths so pnpm's symlinked layout finds a
// package's own dependency next to it rather than a hoisted one.
const findInstalled = (fromFile: string | undefined, name: string): Installed | undefined => {
  if (!fromFile) return undefined;
  for (const base of createRequire(fromFile).resolve.paths(name) ?? []) {
    const candidate = join(base, name, 'package.json');
    if (!existsSync(candidate)) continue;
    try {
      const file = realpathSync(candidate);
      const { version } = JSON.parse(readFileSync(file, 'utf8'));
      return typeof version === 'string' ? { file, version } : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
};

/**
 * Compares the unhead behind nuxt-schema-org's `@unhead/schema-org` with the unhead behind the
 * project's `@unhead/vue`. A newer second copy is linked as the server bundle's top-level unhead, and
 * the renderer's own unhead import then fails on every page.
 */
export const checkUnheadVersions = (rootDir: string, selfFile: string): { level: 'ok' | 'warn' | 'error'; message?: string } => {
  const rootFile = join(rootDir, 'package.json');
  // Without hoisting the project root may not see @unhead/vue at all; Nuxt always depends on it.
  const vue = findInstalled(rootFile, '@unhead/vue') ?? findInstalled(findInstalled(rootFile, 'nuxt')?.file, '@unhead/vue');
  const projectUnhead = findInstalled(vue?.file, 'unhead');
  const schemaOrgUnhead = findInstalled(
    findInstalled(findInstalled(selfFile, 'nuxt-schema-org')?.file, '@unhead/schema-org')?.file,
    'unhead'
  );
  if (!projectUnhead || !schemaOrgUnhead) return { level: 'ok' };

  const relation = compareVersions(projectUnhead.version, schemaOrgUnhead.version);
  if (relation === 'same') return { level: 'ok' };

  const fix =
    'Align them with `pnpm update --depth Infinity @unhead/vue @unhead/schema-org unhead`, then check that pnpm-lock.yaml lists a single unhead version.';
  return relation === 'newer' ?
      {
        level: 'error',
        message: `nuxt-schema-org brings unhead ${schemaOrgUnhead.version}, but this project's @unhead/vue uses unhead ${projectUnhead.version}. The newer copy makes every server-rendered page fail. ${fix}`,
      }
    : {
        level: 'warn',
        message: `nuxt-schema-org brings unhead ${schemaOrgUnhead.version} next to this project's unhead ${projectUnhead.version}. ${fix}`,
      };
};
