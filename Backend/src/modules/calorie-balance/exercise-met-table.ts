import { SportType } from '@prisma/client';

// MET (Metabolic Equivalent of Task) values: general/moderate-intensity
// estimates per sport, per the standard MET compendium convention.
// See specs/004-exercise-tracking-page/research.md for sourcing rationale.
export const MET_TABLE: Record<SportType, number> = {
  RUNNING: 9.8,
  FOOTBALL: 7.0,
  SWIMMING: 7.0,
  PADEL: 6.0,
  BASKETBALL: 6.5,
  GYM_WEIGHTS: 5.0,
  TENNIS: 7.3,
  OTHER: 5.0,
};

export interface SportCatalogEntry {
  sportType: SportType;
  label: string;
}

export const SPORT_CATALOG: SportCatalogEntry[] = [
  { sportType: SportType.RUNNING, label: 'Running' },
  { sportType: SportType.FOOTBALL, label: 'Football' },
  { sportType: SportType.SWIMMING, label: 'Swimming' },
  { sportType: SportType.PADEL, label: 'Padel' },
  { sportType: SportType.BASKETBALL, label: 'Basketball' },
  { sportType: SportType.GYM_WEIGHTS, label: 'Gym / Weight Training' },
  { sportType: SportType.TENNIS, label: 'Tennis' },
  { sportType: SportType.OTHER, label: 'Other' },
];
