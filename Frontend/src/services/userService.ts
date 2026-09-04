import { apiClient } from './apiClient';

export type Sex = 'MALE' | 'FEMALE';
export type ActivityLevel =
  | 'LIGHTLY_ACTIVE'
  | 'MODERATELY_ACTIVE'
  | 'VERY_ACTIVE';
export type GoalDirection = 'LOSE' | 'MAINTAIN' | 'GAIN';

export interface OnboardingInput {
  age: number;
  sex: Sex;
  heightCm: number;
  currentWeightKg: number;
  goalWeightKg: number;
  activityLevel: ActivityLevel;
  timezone: string;
}

export interface UpdateProfileInput {
  age?: number;
  heightCm?: number;
  currentWeightKg?: number;
  goalWeightKg?: number;
  activityLevel?: ActivityLevel;
}

export interface Baseline {
  userId: string;
  age: number;
  sex: Sex;
  heightCm: string;
  currentWeightKg: string;
  goalWeightKg: string;
  activityLevel: ActivityLevel;
  bmr: string;
  tdee: string;
  timezone: string;
  goalDirection: GoalDirection;
  dailyCalorieTarget: number;
}

export async function submitOnboarding(input: OnboardingInput) {
  const { data } = await apiClient.post('/onboarding', input);
  return data as Baseline;
}

export async function getGoals() {
  const { data } = await apiClient.get('/goals');
  return data as Baseline;
}

export async function updateGoals(input: UpdateProfileInput) {
  const { data } = await apiClient.patch('/goals', input);
  return data as Baseline;
}
