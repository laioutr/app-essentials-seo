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

const contentPreferenceSchema = <Shape extends z.ZodRawShape>(
  preferences: z.ZodObject<Shape>,
  values: readonly string[],
  fallback: string[] = []
) => z.union([z.array(contentRuleSchema(Object.keys(preferences.shape), values)), preferences]).default(fallback);

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

const LlmsTxtLinkSchema = z.object({
  title: z.string(),
  href: z.string(),
  description: z.string().optional(),
});

const LlmsTxtSectionSchema = z.object({
  title: z.string(),
  description: z.union([z.string(), z.array(z.string())]).optional(),
  links: z.array(LlmsTxtLinkSchema).default([]),
  /** Rendered under `## Optional`, which the llms.txt proposal marks as skippable. */
  optional: z.boolean().default(false),
});

export type LlmsTxtSectionOption = z.output<typeof LlmsTxtSectionSchema>;

/**
 * Mirrors nuxt-ai-ready's `aiReady` options, so the resolved value can be handed to that module
 * unchanged once frontends run Nuxt 4. `llmsTxt.pageTypes` is this module's own addition.
 */
export const AiReadyOptionsSchema = z.object({
  enabled: z.boolean().default(true),
  /** Redirect requests that prefer Markdown (by `Accept` or a known AI agent) to the `.md` URL. */
  contentNegotiation: z.boolean().default(true),
  /** Advertise `/llms.txt` as `rel="describedby"` in the page head and `Link` headers. */
  describedby: z.boolean().default(true),
  /** Merged over this module's defaults; see `DEFAULT_MDREAM_OPTIONS`. */
  mdreamOptions: z.record(z.string(), z.unknown()).default({}),
  markdownCacheHeaders: z
    .union([z.literal(false), z.object({ maxAge: z.number().int().min(0).default(3600), swr: z.boolean().default(true) })])
    .prefault({}),
  llmsTxtCacheSeconds: z.number().int().min(0).default(600),
  llmsTxt: z
    .object({
      /** Link listed pages to their `.md` URL. Upstream defaults to false; every page here has one. */
      markdownLinks: z.boolean().default(true),
      notes: z.union([z.string(), z.array(z.string())]).default([]),
      sections: z.array(LlmsTxtSectionSchema).default([]),
      /** Title/description per dynamic page type in `## Page Types`; `false` leaves the type out. */
      pageTypes: z
        .record(z.string(), z.union([z.literal(false), z.object({ title: z.string().optional(), description: z.string().optional() })]))
        .default({}),
    })
    .prefault({}),
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
  /** Repeat each Allow/Disallow rule under the language prefixes the requested host serves, so a
   *  rule written once covers a market's other languages. See `localizeRobotsTxt`. */
  localizeRules: z.boolean().default(true),
  /**
   * `Content-Usage` for the `*` group. Defaults to allowing search and AI answers. Training is left
   * unstated: allowing or reserving it is the site owner's legal decision, and "no preference" is
   * the only answer this module can give on their behalf. `[]` emits none.
   */
  contentUsage: contentPreferenceSchema(ContentUsagePreferencesSchema, CONTENT_USAGE_VALUES, ['search=y, ai-output=y']),
  /** `Content-Signal` for the `*` group. Same defaults, other vocabulary. */
  contentSignal: contentPreferenceSchema(ContentSignalPreferencesSchema, CONTENT_SIGNAL_VALUES, ['search=yes, ai-input=yes']),
});

const PostalAddressSchema = z.object({
  streetAddress: z.string(),
  postalCode: z.string(),
  addressLocality: z.string(),
  addressRegion: z.string().optional(),
  addressCountry: z.string(),
});

const OrganizationSchema = z.object({
  /** nuxt-schema-org derives the node's resolver from this name, so only types it resolves are allowed. */
  type: z.enum(['Organization', 'LocalBusiness']).default('Organization'),
  /** Leave unset to name the organization after each host's own site name. */
  name: z.string().optional(),
  legalName: z.string().optional(),
  /** A path or an absolute URL. */
  logo: z.string().optional(),
  sameAs: z.array(z.string()).default([]),
  email: z.string().optional(),
  telephone: z.string().optional(),
  address: PostalAddressSchema.optional(),
  vatID: z.string().optional(),
});

export const StructuredDataOptionsSchema = z.object({
  /** Off installs no schema.org module at all. */
  enabled: z.boolean().default(true),
  /** Without it there is no Organization node; WebSite and WebPage are still emitted. */
  organization: OrganizationSchema.optional(),
});

export const ModuleOptionsSchema = z.object({
  siteName: z.string().optional(),
  indexable: z.enum(['auto', 'always', 'never']).default('auto'),
  environment: z.enum(['production', 'staging', 'preview', 'development']).optional(),
  sitemap: SitemapOptionsSchema.prefault({}),
  robots: RobotsOptionsSchema.prefault({}),
  openGraph: OpenGraphOptionsSchema.prefault({}),
  aiReady: AiReadyOptionsSchema.prefault({}),
  structuredData: StructuredDataOptionsSchema.prefault({}),
});

export type ModuleOptions = z.input<typeof ModuleOptionsSchema>;
export type ResolvedOptions = z.output<typeof ModuleOptionsSchema>;

/** Parses and fills defaults. Throws on invalid input so a bad Cockpit value fails the build loudly. */
export const resolveOptions = (input: unknown): ResolvedOptions => ModuleOptionsSchema.parse(input ?? {});
