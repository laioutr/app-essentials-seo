import type { ResolvedOptions } from '../../types';

type StructuredData = ResolvedOptions['structuredData'];
type Organization = NonNullable<StructuredData['organization']>;

/** The nuxt-schema-org module options for this module's `structuredData` options. */
export const toSchemaOrgConfig = (structuredData: StructuredData) => ({
  enabled: structuredData.enabled,
  defaults: true as const,
  ...(structuredData.organization && { identity: toIdentity(structuredData.organization) }),
});

// nuxt-schema-org spreads the identity over the host's own name and URL, so an explicit
// `undefined` would erase them. Only configured fields are passed.
const toIdentity = ({ sameAs, ...organization }: Organization): Record<string, unknown> => ({
  ...Object.fromEntries(Object.entries(organization).filter(([, value]) => value !== undefined)),
  ...(sameAs.length > 0 && { sameAs }),
});
