import type { ResolvedOptions } from '../../types';

type StructuredData = ResolvedOptions['structuredData'];
type Organization = NonNullable<StructuredData['organization']>;

/**
 * The nuxt-schema-org module options for this module's `structuredData` options. No `identity`:
 * nuxt-schema-org prefers a module-level identity over the per-host one each host's site config carries.
 */
export const toSchemaOrgConfig = (structuredData: StructuredData) => ({
  enabled: structuredData.enabled,
  defaults: true as const,
});

// nuxt-schema-org spreads the identity over the host's own name and URL, so an explicit
// `undefined` would erase them. Only configured fields are passed.
export const toIdentity = ({ sameAs, ...organization }: Organization): Record<string, unknown> => ({
  ...Object.fromEntries(Object.entries(organization).filter(([, value]) => value !== undefined)),
  ...(sameAs.length > 0 && { sameAs }),
});
