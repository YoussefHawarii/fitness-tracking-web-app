import {
  calculateGoalDirection,
  calculateDailyCalorieTarget,
} from '../../src/modules/users/goal-direction';

describe('calculateGoalDirection', () => {
  it('returns MAINTAIN when goal weight equals current weight', () => {
    expect(calculateGoalDirection(80, 80)).toBe('MAINTAIN');
  });

  it('returns MAINTAIN at exactly +0.5 kg (upper tolerance boundary)', () => {
    expect(calculateGoalDirection(80, 80.5)).toBe('MAINTAIN');
  });

  it('returns MAINTAIN at exactly -0.5 kg (lower tolerance boundary)', () => {
    expect(calculateGoalDirection(80, 79.5)).toBe('MAINTAIN');
  });

  it('returns GAIN just above the +0.5 kg tolerance', () => {
    expect(calculateGoalDirection(80, 80.51)).toBe('GAIN');
  });

  it('returns LOSE just below the -0.5 kg tolerance', () => {
    expect(calculateGoalDirection(80, 79.49)).toBe('LOSE');
  });

  it('returns LOSE for a goal weight well below current weight', () => {
    expect(calculateGoalDirection(80, 70)).toBe('LOSE');
  });

  it('returns GAIN for a goal weight well above current weight', () => {
    expect(calculateGoalDirection(60, 70)).toBe('GAIN');
  });
});

describe('calculateDailyCalorieTarget', () => {
  it('subtracts 500 kcal from TDEE for LOSE', () => {
    expect(calculateDailyCalorieTarget(2000, 'LOSE')).toBe(1500);
  });

  it('leaves TDEE unchanged for MAINTAIN', () => {
    expect(calculateDailyCalorieTarget(2000, 'MAINTAIN')).toBe(2000);
  });

  it('adds 500 kcal to TDEE for GAIN', () => {
    expect(calculateDailyCalorieTarget(2000, 'GAIN')).toBe(2500);
  });
});
