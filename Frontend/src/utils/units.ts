import type { Units } from '../services/accountService';

const KG_TO_LB = 2.20462;

export function kgToLb(valueKg: number): number {
  return valueKg * KG_TO_LB;
}

// Display-only conversion (specs/008-sidebar-profile-account/research.md §4)
// — never changes what's actually stored, which stays in kilograms.
export function formatWeight(valueKg: number, unit: Units, fractionDigits = 1): string {
  const value = unit === 'LB' ? kgToLb(valueKg) : valueKg;
  return `${value.toFixed(fractionDigits)} ${unit.toLowerCase()}`;
}
