import { parseCsv, loadCatalog } from '../../prisma/egyptian-food-catalog';

const HEADER =
  'category,nameEn,nameAr,aliasesEn,aliasesAr,caloriesPer100g,proteinPer100g,carbsPer100g,fatPer100g,notes';

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join('\r\n') + '\r\n';
}

// Direct tests of the hand-rolled CSV parser — this is a hand-edited data
// file's only safety net, so a malformed row should throw, not silently
// mangle or drop data. See the "worth fixing" findings from the 2026-09-14
// code review.
describe('parseCsv', () => {
  it('parses a quoted field containing a comma', () => {
    expect(parseCsv('a,"b,c",d\r\n')).toEqual([['a', 'b,c', 'd']]);
  });

  it('parses an escaped double-quote inside a quoted field', () => {
    expect(parseCsv('a,"say ""hi""",c\r\n')).toEqual([['a', 'say "hi"', 'c']]);
  });

  it('throws on an unterminated quoted field at EOF', () => {
    expect(() => parseCsv('a,"unterminated,c\r\n')).toThrow(/unterminated/);
  });

  it('throws on a quote character appearing mid-field (not at the start)', () => {
    expect(() => parseCsv('a,b"c,d\r\n')).toThrow(/inside an unquoted field/);
  });

  it('throws on stray characters right after a closing quote', () => {
    expect(() => parseCsv('a,"b"c,d\r\n')).toThrow(
      /right after a closing quote/,
    );
  });

  it('allows an empty quoted field', () => {
    expect(parseCsv('a,"",c\r\n')).toEqual([['a', '', 'c']]);
  });
});

describe('loadCatalog', () => {
  it('parses a valid minimal CSV into SeedFood entries', () => {
    const result = loadCatalog(
      csv('Grains,"Barley, grains",شعير حب,barley,شعير,335,10.7,69.6,1.5,'),
    );
    expect(result).toEqual([
      {
        nameEn: 'Barley, grains',
        nameAr: 'شعير حب',
        aliasesEn: ['barley'],
        aliasesAr: ['شعير'],
        caloriesPer100g: 335,
        proteinPer100g: 10.7,
        carbsPer100g: 69.6,
        fatPer100g: 1.5,
      },
    ]);
  });

  it('treats an empty aliases cell as an empty array', () => {
    const result = loadCatalog(csv('Misc,Foo,فو,,,100,,,,'));
    expect(result[0].aliasesEn).toEqual([]);
    expect(result[0].aliasesAr).toEqual([]);
  });

  it('throws when a row has a different column count than the header', () => {
    expect(() => loadCatalog(csv('Grains,Foo,فو,,,,100,,,,extra'))).toThrow(
      /has 11 columns, expected 10/,
    );
  });

  it('throws when nameEn or nameAr is missing', () => {
    expect(() => loadCatalog(csv('Grains,,فو,,,100,,,,'))).toThrow(
      /missing nameEn or nameAr/,
    );
  });

  it('throws on a duplicate nameEn', () => {
    expect(() =>
      loadCatalog(csv('Grains,Foo,فو,,,100,,,,', 'Grains,Foo,فو2,,,110,,,,')),
    ).toThrow(/duplicate nameEn "Foo"/);
  });

  it('throws instead of silently reading a whitespace-only required numeric cell as 0', () => {
    // `Number(' ')` is 0 in JS — this is the exact bug the loader must not have.
    expect(() => loadCatalog(csv('Grains,Foo,فو,,, ,,,,'))).toThrow(
      /non-numeric caloriesPer100g/,
    );
  });

  it('throws on a non-numeric optional nutrient cell', () => {
    expect(() => loadCatalog(csv('Grains,Foo,فو,,,100,abc,,,'))).toThrow(
      /non-numeric proteinPer100g/,
    );
  });

  it('leaves an optional nutrient undefined when its cell is blank', () => {
    const result = loadCatalog(csv('Grains,Foo,فو,,,100,,,,'));
    expect(result[0].proteinPer100g).toBeUndefined();
  });
});
