import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { organizationBrandingSchema } from '../../src/schemas/organization.schema.js';

const VALID = {
  primaryColor: '#FF5722',
  logoUrl: 'https://ripskis.com/logo.png',
};

describe('M04-P01-T04 organization branding Zod schema', () => {
  it('accepts required primaryColor and logoUrl', () => {
    const parsed = organizationBrandingSchema.parse(VALID);
    assert.equal(parsed.primaryColor, '#FF5722');
    assert.equal(parsed.logoUrl, 'https://ripskis.com/logo.png');
  });

  it('accepts documented optional tokens', () => {
    const parsed = organizationBrandingSchema.parse({
      ...VALID,
      secondaryColor: '#111827',
      accentColor: '#fbbf24',
      backgroundColor: '#090d16',
      fontFamily: 'Inter',
      bannerUrl: 'https://ripskis.com/banner.png',
      tagline: 'High-octane comedy showdowns',
    });
    assert.equal(parsed.accentColor, '#fbbf24');
    assert.equal(parsed.tagline, 'High-octane comedy showdowns');
  });

  it('accepts 3-digit hex colors', () => {
    const parsed = organizationBrandingSchema.parse({
      primaryColor: '#abc',
      logoUrl: 'https://ripskis.com/logo.png',
    });
    assert.equal(parsed.primaryColor, '#abc');
  });

  it('rejects a payload missing primaryColor', () => {
    assert.throws(() =>
      organizationBrandingSchema.parse({ logoUrl: 'https://ripskis.com/logo.png' }),
    );
  });

  it('rejects a payload missing logoUrl', () => {
    assert.throws(() => organizationBrandingSchema.parse({ primaryColor: '#FF5722' }));
  });

  it('rejects non-hex colors and non-URI logos', () => {
    assert.throws(() =>
      organizationBrandingSchema.parse({ primaryColor: 'orange', logoUrl: VALID.logoUrl }),
    );
    assert.throws(() =>
      organizationBrandingSchema.parse({ primaryColor: '#FF5722', logoUrl: '/logo.png' }),
    );
  });

  it('rejects undocumented keys (slug, status, backgroundStyle)', () => {
    assert.throws(() =>
      organizationBrandingSchema.parse({ ...VALID, slug: 'ripskis' }),
    );
    assert.throws(() =>
      organizationBrandingSchema.parse({ ...VALID, status: 'SUSPENDED' }),
    );
    assert.throws(() =>
      organizationBrandingSchema.parse({ ...VALID, backgroundStyle: 'midnight' }),
    );
  });
});
