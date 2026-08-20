import { z } from 'zod/v4';

/** Package name and Nuxt config key. Cockpit only permits app config under the package name. */
export { MODULE_NAME } from './runtime/shared/moduleName';

const PageTypeSeoSchema = z.object({
  pageType: z.string(),
  priority: z.number().min(0).max(1).optional(),
  changefreq: z.enum(['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never']).optional(),
});

/**
 * The `og:type` of the canonical page types for which the generic `website` would be wrong. Merged
 * under whatever a project configures, so overriding one page type keeps the rest.
 *
 * Every other canonical page type falls through to `defaultType`: the `core/*` set, both blog
 * listings, product listing and search, and `location/finder` really are pages of a website, and
 * `article` on a content page would promise an author and a publication date it does not have.
 *
 * Page types that other packages register are deliberately absent. This module does not own that
 * vocabulary, and a wrong guess about someone else's page type is worse than the fall-through.
 *
 * Written as string literals rather than imported from `@laioutr-core/canonical-types`: its
 * `definePageTypeToken` registers into a module-global registry as an import side effect, so
 * importing the tokens to spell three strings would run page-type registration inside this build.
 */
export const DEFAULT_OG_PAGE_TYPES: Record<string, string> = {
  'blog/post-single': 'article',
  'ecommerce/product-detail-page': 'product',
  'location/detail': 'place',
};

export const OpenGraphOptionsSchema = z.object({
  enabled: z.boolean().default(true),
  /** Used for every page type without an entry in `pageTypes`. */
  defaultType: z.string().default('website'),
  /**
   * `og:type` keyed by page type, e.g. `{ 'blog/post-single': 'article' }`. Free-form on both sides:
   * the page type vocabulary is open-ended and so is the `og:type` one.
   *
   * The merge happens here rather than at lookup time so that everything downstream — runtime config
   * included — reads one effective map instead of a partial one. To move a page type off its default
   * there is no deletion marker: set it to the type you want, `'website'` included.
   */
  pageTypes: z
    .record(z.string(), z.string())
    .default({})
    .transform((configured) => ({ ...DEFAULT_OG_PAGE_TYPES, ...configured })),
});

const RobotsGroupSchema = z.object({
  userAgent: z.array(z.string()).default(['*']),
  allow: z.array(z.string()).default([]),
  disallow: z.array(z.string()).default([]),
});

export const SitemapOptionsSchema = z.object({
  enabled: z.boolean().default(true),
  excludePageTypes: z.array(z.string()).default([]),
  pageTypes: z.array(PageTypeSeoSchema).default([]),
  defaultChangefreq: PageTypeSeoSchema.shape.changefreq,
  defaultPriority: z.number().min(0).max(1).optional(),
  includeImages: z.boolean().default(true),
  /** Entries a single request may pull for a snapshot rebuild pass. Bounds the work one request can do. */
  entriesPerRequest: z.number().int().min(1).default(10_000),
});

export const RobotsOptionsSchema = z.object({
  enabled: z.boolean().default(true),
  blockAiBots: z.boolean().default(false),
  blockNonSeoBots: z.boolean().default(false),
  extraDisallow: z.array(z.string()).default([]),
  customGroups: z.array(RobotsGroupSchema).default([]),
});

export const ModuleOptionsSchema = z.object({
  siteName: z.string().optional(),
  indexable: z.enum(['auto', 'always', 'never']).default('auto'),
  environment: z.enum(['production', 'staging', 'preview', 'development']).optional(),
  sitemap: SitemapOptionsSchema.prefault({}),
  robots: RobotsOptionsSchema.prefault({}),
  openGraph: OpenGraphOptionsSchema.prefault({}),
});

export type ModuleOptions = z.input<typeof ModuleOptionsSchema>;
export type ResolvedOptions = z.output<typeof ModuleOptionsSchema>;

/** Parses and fills defaults. Throws on invalid input so a bad Cockpit value fails the build loudly. */
export const resolveOptions = (input: unknown): ResolvedOptions => ModuleOptionsSchema.parse(input ?? {});
