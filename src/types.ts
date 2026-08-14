import { z } from 'zod/v4';

/** Package name and Nuxt config key. Cockpit only permits app config under the package name. */
export { MODULE_NAME } from './runtime/shared/moduleName';

const PageTypeSeoSchema = z.object({
  pageType: z.string(),
  priority: z.number().min(0).max(1).optional(),
  changefreq: z.enum(['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never']).optional(),
});

/**
 * `Allow`/`Disallow` say whether a crawler may fetch a URL. The two vocabularies below say what it
 * may then do with what it fetched — train on it, ground an answer in it, show it in search. They
 * are competing IETF drafts covering the same ground, down to spelling the same yes/no differently,
 * so a site that wants to be understood by both camps states its preference in both.
 * @see https://ietf-wg-aipref.github.io/drafts/draft-ietf-aipref-vocab.html (Content-Usage)
 * @see https://www.ietf.org/archive/id/draft-romm-aipref-contentsignals-00.html (Content-Signal)
 */
const CONTENT_USAGE_VALUES = ['y', 'n'] as const;
const CONTENT_SIGNAL_VALUES = ['yes', 'no'] as const;

/** Strict so a mistyped category fails the build. A stripped-through unknown key would leave an
 *  empty preference set, which emits no line at all — the one failure mode a crawler can't report. */
const ContentUsagePreferencesSchema = z.strictObject({
  /** Automated processing. */
  'bots': z.enum(CONTENT_USAGE_VALUES).optional(),
  /** Foundation model production. */
  'train-ai': z.enum(CONTENT_USAGE_VALUES).optional(),
  /** AI output. */
  'ai-output': z.enum(CONTENT_USAGE_VALUES).optional(),
  /** Search. */
  'search': z.enum(CONTENT_USAGE_VALUES).optional(),
});

const ContentSignalPreferencesSchema = z.strictObject({
  /** Search. */
  'search': z.enum(CONTENT_SIGNAL_VALUES).optional(),
  /** AI input — RAG, grounding, generative search. */
  'ai-input': z.enum(CONTENT_SIGNAL_VALUES).optional(),
  /** AI training — training or fine-tuning a model. */
  'ai-train': z.enum(CONTENT_SIGNAL_VALUES).optional(),
});

/**
 * One raw preference line, in the grammar `@nuxtjs/robots` parses: a single assignment
 * (`train-ai=n`), a comma-separated list (`bots=y, search=y`), or either of those scoped to a path
 * (`/private train-ai=n`) — the path-scoped form being the one the object shape cannot express.
 *
 * Validated here rather than left to upstream, which only collects rule errors when it answers a
 * request. A typo would otherwise survive the build and ship as a line no crawler acts on.
 * Categories are read off the object schema so the two spellings cannot drift apart.
 */
const contentRuleSchema = (categories: readonly string[], values: readonly string[]) => {
  const assignment = `(?:${categories.join('|')})=(?:${values.join('|')})`;
  const pattern = new RegExp(`^(?:/\\S*[ \\t]+)?${assignment}(?:[ \\t]*,[ \\t]*${assignment})*$`);
  return z
    .string()
    .regex(
      pattern,
      `Expected "<category>=<value>", a comma-separated list of them, or either scoped to a path ` +
        `("/private ${categories[0]}=${values[0]}"). Categories: ${categories.join(', ')}. Values: ${values.join(', ')}.`
    );
};

const contentPreferenceSchema = <Shape extends z.ZodRawShape>(preferences: z.ZodObject<Shape>, values: readonly string[]) =>
  z.union([z.array(contentRuleSchema(Object.keys(preferences.shape), values)), preferences]).default([]);

const RobotsGroupSchema = z.object({
  userAgent: z.array(z.string()).default(['*']),
  allow: z.array(z.string()).default([]),
  disallow: z.array(z.string()).default([]),
  /** `Content-Usage` lines for this group. Empty emits none, which is not the same as allowing —
   *  it leaves the question unanswered, exactly as upstream does when the option is unset. */
  contentUsage: contentPreferenceSchema(ContentUsagePreferencesSchema, CONTENT_USAGE_VALUES),
  /** `Content-Signal` lines for this group. Same shape, other vocabulary. */
  contentSignal: contentPreferenceSchema(ContentSignalPreferencesSchema, CONTENT_SIGNAL_VALUES),
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
});

export type ModuleOptions = z.input<typeof ModuleOptionsSchema>;
export type ResolvedOptions = z.output<typeof ModuleOptionsSchema>;

/** Parses and fills defaults. Throws on invalid input so a bad Cockpit value fails the build loudly. */
export const resolveOptions = (input: unknown): ResolvedOptions => ModuleOptionsSchema.parse(input ?? {});
