import { apiClient } from './apiClient';

export type MuscleGroup = 'CHEST' | 'BACK' | 'SHOULDERS' | 'BICEPS' | 'TRICEPS' | 'LEGS' | 'CORE';

export const MUSCLE_GROUPS: MuscleGroup[] = [
  'CHEST',
  'BACK',
  'SHOULDERS',
  'BICEPS',
  'TRICEPS',
  'LEGS',
  'CORE',
];

// Mirrors Backend/src/modules/workouts/workout-exercise-catalog.ts's
// MUSCLE_GROUP_LABELS — the catalog endpoint returns a label per exercise,
// not per muscle group, so the group-header labels (used for chips and
// optgroups) are kept here rather than round-tripped through the API.
export const MUSCLE_GROUP_LABELS: Record<MuscleGroup, string> = {
  CHEST: 'Chest',
  BACK: 'Back',
  SHOULDERS: 'Shoulders',
  BICEPS: 'Biceps',
  TRICEPS: 'Triceps',
  LEGS: 'Legs',
  CORE: 'Abs/Core',
};

export interface WorkoutExerciseCatalogEntry {
  exerciseType: string;
  label: string;
  muscleGroup: MuscleGroup;
}

export async function getWorkoutExerciseCatalog(): Promise<WorkoutExerciseCatalogEntry[]> {
  const { data } = await apiClient.get('/workout-exercises');
  return data;
}

export interface WorkoutSet {
  id: string;
  reps: number;
  weightKg: string | null;
}

export interface WorkoutExercise {
  id: string;
  exerciseType: string;
  sets: WorkoutSet[];
}

export interface WorkoutSession {
  id: string;
  muscleGroups: MuscleGroup[];
  loggedForDate: string;
  exercises: WorkoutExercise[];
}

export interface CreateWorkoutSetInput {
  reps: number;
  weightKg?: number;
}

export interface CreateWorkoutExerciseInput {
  exerciseType: string;
  sets: CreateWorkoutSetInput[];
}

export interface CreateWorkoutSessionInput {
  date: string;
  muscleGroups: MuscleGroup[];
  exercises: CreateWorkoutExerciseInput[];
}

export async function createWorkoutSession(
  input: CreateWorkoutSessionInput,
): Promise<WorkoutSession> {
  const { data } = await apiClient.post('/workout-sessions', input);
  return data;
}
