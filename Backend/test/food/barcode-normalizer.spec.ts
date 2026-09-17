import { normalizeBarcode } from '../../src/modules/food/barcode-normalizer';

describe('normalizeBarcode', () => {
  it('accepts a well-formed EAN-13 unchanged', () => {
    expect(normalizeBarcode('3017620422003')).toEqual({
      raw: '3017620422003',
      canonical: '3017620422003',
      format: 'EAN_13',
    });
  });

  it('accepts a well-formed EAN-8 unchanged', () => {
    expect(normalizeBarcode('96385074')).toEqual({
      raw: '96385074',
      canonical: '96385074',
      format: 'EAN_8',
    });
  });

  it('canonicalizes a 12-digit UPC-A to its 13-digit EAN-13 equivalent (leading zero)', () => {
    expect(normalizeBarcode('012345678905')).toEqual({
      raw: '012345678905',
      canonical: '0012345678905',
      format: 'UPC_A',
    });
  });

  it('accepts a compressed 6-digit UPC-E without attempting an unverified expansion', () => {
    expect(normalizeBarcode('425261')).toEqual({
      raw: '425261',
      canonical: '425261',
      format: 'UPC_E',
    });
  });

  it('trims surrounding whitespace before validating', () => {
    expect(normalizeBarcode('  3017620422003  ')).toEqual({
      raw: '3017620422003',
      canonical: '3017620422003',
      format: 'EAN_13',
    });
  });

  it('rejects a string containing non-digit characters rather than stripping them', () => {
    expect(normalizeBarcode('301762-0422003')).toBeNull();
    expect(normalizeBarcode('EAN:3017620422003')).toBeNull();
  });

  it('rejects an EAN-13 with an incorrect check digit', () => {
    // Same as the valid fixture above but with the last digit corrupted.
    expect(normalizeBarcode('3017620422004')).toBeNull();
  });

  it('rejects a UPC-A with an incorrect check digit', () => {
    expect(normalizeBarcode('012345678901')).toBeNull();
  });

  it('rejects an EAN-8 with an incorrect check digit', () => {
    expect(normalizeBarcode('96385075')).toBeNull();
  });

  it('does not reject a 6-digit UPC-E for its check digit (not validated for this format)', () => {
    expect(normalizeBarcode('425261')).not.toBeNull();
  });

  it('rejects lengths that are not a recognized retail barcode format', () => {
    expect(normalizeBarcode('123')).toBeNull();
    expect(normalizeBarcode('12345678901234')).toBeNull();
    expect(normalizeBarcode('')).toBeNull();
  });

  it('rejects non-string input', () => {
    expect(normalizeBarcode(undefined as unknown as string)).toBeNull();
    expect(normalizeBarcode(12345678 as unknown as string)).toBeNull();
  });
});
