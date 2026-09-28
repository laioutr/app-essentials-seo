import { describe, expect, it } from 'vitest';
import { toIdentity, toSchemaOrgConfig } from '../../src/runtime/shared/toSchemaOrgConfig';
import { resolveOptions } from '../../src/types';

const build = (structuredData?: object) => toSchemaOrgConfig(resolveOptions({ structuredData }).structuredData);
const identityOf = (organization: object) => toIdentity(resolveOptions({ structuredData: { organization } }).structuredData.organization!);

describe('toSchemaOrgConfig', () => {
  it('keeps the WebSite and WebPage defaults', () => {
    expect(build()).toEqual({ enabled: true, defaults: true });
  });

  it('passes the enabled switch through', () => {
    expect(build({ enabled: false }).enabled).toBe(false);
  });

  // A module-level identity would win over the per-host one in each host's site config.
  it('sets no module-level identity, even with an organization', () => {
    expect(build({ organization: { legalName: 'Acme GmbH' } })).not.toHaveProperty('identity');
  });
});

describe('toIdentity', () => {
  it('leaves name and url out when they are not configured, so each host keeps its own', () => {
    const identity = identityOf({ telephone: '+49 30 0000000' });
    expect(identity).toEqual({ type: 'Organization', telephone: '+49 30 0000000' });
    expect(identity).not.toHaveProperty('name');
    expect(identity).not.toHaveProperty('url');
  });

  it('passes every configured field', () => {
    const address = { streetAddress: 'Musterstraße 1', postalCode: '10115', addressLocality: 'Berlin', addressCountry: 'DE' };
    expect(
      identityOf({
        type: 'LocalBusiness',
        name: 'Acme',
        legalName: 'Acme GmbH',
        logo: '/logo.png',
        sameAs: ['https://social.example/acme'],
        email: 'info@example.com',
        telephone: '+49 30 0000000',
        address,
        vatID: 'DE000000000',
      })
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
    expect(identityOf({ legalName: 'Acme GmbH' })).not.toHaveProperty('sameAs');
  });
});
