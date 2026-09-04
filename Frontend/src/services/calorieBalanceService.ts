import { apiClient } from './apiClient';

export interface DailyBalance {
  caloriesConsumed: number;
  caloriesExpended: number;
  caloriesBurnedExercise: number;
  balance: number;
  dailyCalorieTarget: number;
}

export type SportType =
  | 'FOOTBALL'
  | 'SWIMMING'
  | 'PADEL'
  | 'BASKETBALL'
  | 'GYM_WEIGHTS'
  | 'RUNNING'
  | 'TENNIS'
  | 'OTHER';

export interface SportCatalogEntry {
  sportType: SportType;
  label: string;
}

export interface ExerciseSession {
  id: string;
  sportType: SportType;
  customSportName: string | null;
  durationMinutes: number;
  caloriesBurned: string;
  loggedForDate: string;
}

export interface CreateExerciseSessionInput {
  sportType: SportType;
  customSportName?: string;
  durationMinutes: number;
  date: string;
}

export interface UpdateExerciseSessionInput {
  sportType?: SportType;
  customSportName?: string;
  durationMinutes?: number;
}

export async function getSportCatalog(): Promise<SportCatalogEntry[]> {
  const { data } = await apiClient.get('/sports');
  return data;
}

export async function createExerciseSession(
  input: CreateExerciseSessionInput,
): Promise<ExerciseSession> {
  const { data } = await apiClient.post('/exercise-logs', input);
  return data;
}

export async function updateExerciseSession(
  id: string,
  input: UpdateExerciseSessionInput,
): Promise<ExerciseSession> {
  const { data } = await apiClient.patch(`/exercise-logs/${id}`, input);
  return data;
}

export async function deleteExerciseSession(id: string): Promise<void> {
  await apiClient.delete(`/exercise-logs/${id}`);
}

export async function listExerciseSessions(date: string): Promise<ExerciseSession[]> {
  const { data } = await apiClient.get('/exercise-logs', { params: { date } });
  return data;
}

export async function getDailyBalance(date: string): Promise<DailyBalance> {
  const { data } = await apiClient.get('/balance', { params: { date } });
  return data;
}
