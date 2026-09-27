import { describe, expect, it } from 'vitest';
import { toSchemaOrgConfig } from '../../src/runtime/shared/toSchemaOrgConfig';
import { resolveOptions } from '../../src/types';

const build = (structuredData?: object) => toSchemaOrgConfig(resolveOptions({ structuredData }).structuredData);

describe('toSchemaOrgConfig', () => {
  it('keeps the WebSite and WebPage defaults and adds no identity without an organization', () => {
    expect(build()).toEqual({ enabled: true, defaults: true });
  });

  it('passes the enabled switch through', () => {
    expect(build({ enabled: false }).enabled).toBe(false);
  });

  it('leaves name and url out when they are not configured, so each host keeps its own', () => {
    const identity = build({ organization: { telephone: '+49 30 0000000' } }).identity;
    expect(identity).toEqual({ type: 'Organization', telephone: '+49 30 0000000' });
    expect(identity).not.toHaveProperty('name');
    expect(identity).not.toHaveProperty('url');
  });

  it('passes every configured field', () => {
    const address = { streetAddress: 'Musterstraße 1', postalCode: '10115', addressLocality: 'Berlin', addressCountry: 'DE' };
    expect(
      build({
        organization: {
          type: 'LocalBusiness',
          name: 'Acme',
          legalName: 'Acme GmbH',
          logo: '/logo.png',
          sameAs: ['https://social.example/acme'],
          email: 'info@example.com',
          telephone: '+49 30 0000000',
          address,
          vatID: 'DE000000000',
        },
      }).identity
    ).toEqual({
      type: 'LocalBusiness',
      name: 'Acme',
      legalName: 'Acme GmbH',
      logo: '/logo.png',
      sameAs: ['https://social.example/acme'],
      email: 'info@example.com',
      telephone: '+49 30 0000000',
      address,
      vatID: 'DE000000000',
    });
  });

  it('drops an empty sameAs list', () => {
    expect(build({ organization: { legalName: 'Acme GmbH' } }).identity).not.toHaveProperty('sameAs');
  });
});
