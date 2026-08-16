import { z } from 'zod/v4';

/** Package name and Nuxt config key. Cockpit only permits app config under the package name. */
export { MODULE_NAME } from './runtime/shared/moduleName';

const PageTypeSeoSchema = z.object({
  pageType: z.string(),
  priority: z.number().min(0).max(1).optional(),
  changefreq: z.enum(['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never']).optional(),
});

const PageTypeOgSchema = z.object({
  pageType: z.string(),
  /** The `og:type` value, e.g. 'article' or 'product'. Free-form: the vocabulary is open-ended. */
  type: z.string(),
});

export const OpenGraphOptionsSchema = z.object({
  enabled: z.boolean().default(true),
  /** Used for every page type without an entry in `pageTypes`. */
  defaultType: z.string().default('website'),
  pageTypes: z.array(PageTypeOgSchema).default([]),
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
