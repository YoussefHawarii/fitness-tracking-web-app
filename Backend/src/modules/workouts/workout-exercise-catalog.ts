import { MuscleGroup, WorkoutExerciseType } from '@prisma/client';

// Fixed, curated catalog of strength-training movements — see
// docs/adr/0002-fixed-workout-exercise-catalog.md for why this is closed
// rather than free text, and CONTEXT.md for the Workout exercise / Muscle
// group glossary. Each exercise belongs to exactly one primary muscle group.
export interface WorkoutExerciseCatalogEntry {
  exerciseType: WorkoutExerciseType;
  label: string;
  muscleGroup: MuscleGroup;
}

export const MUSCLE_GROUP_LABELS: Record<MuscleGroup, string> = {
  CHEST: 'Chest',
  BACK: 'Back',
  SHOULDERS: 'Shoulders',
  BICEPS: 'Biceps',
  TRICEPS: 'Triceps',
  LEGS: 'Legs',
  CORE: 'Abs/Core',
};

export const WORKOUT_EXERCISE_CATALOG: WorkoutExerciseCatalogEntry[] = [
  // Chest
  {
    exerciseType: 'BARBELL_BENCH_PRESS',
    label: 'Barbell Bench Press',
    muscleGroup: 'CHEST',
  },
  {
    exerciseType: 'INCLINE_BARBELL_BENCH_PRESS',
    label: 'Incline Barbell Bench Press',
    muscleGroup: 'CHEST',
  },
  {
    exerciseType: 'DUMBBELL_BENCH_PRESS',
    label: 'Dumbbell Bench Press',
    muscleGroup: 'CHEST',
  },
  {
    exerciseType: 'INCLINE_DUMBBELL_PRESS',
    label: 'Incline Dumbbell Press',
    muscleGroup: 'CHEST',
  },
  {
    exerciseType: 'MACHINE_CHEST_PRESS',
    label: 'Machine Chest Press',
    muscleGroup: 'CHEST',
  },
  {
    exerciseType: 'INCLINE_MACHINE_CHEST_PRESS',
    label: 'Incline Chest Press (Machine)',
    muscleGroup: 'CHEST',
  },
  {
    exerciseType: 'PEC_DECK_FLY',
    label: 'Pec Deck / Chest Fly',
    muscleGroup: 'CHEST',
  },
  {
    exerciseType: 'CABLE_CROSSOVER',
    label: 'Cable Crossover',
    muscleGroup: 'CHEST',
  },
  { exerciseType: 'PUSH_UPS', label: 'Push-Ups', muscleGroup: 'CHEST' },
  { exerciseType: 'CHEST_DIPS', label: 'Chest Dips', muscleGroup: 'CHEST' },

  // Back
  { exerciseType: 'LAT_PULLDOWN', label: 'Lat Pulldown', muscleGroup: 'BACK' },
  {
    exerciseType: 'SEATED_CABLE_ROW',
    label: 'Seated Cable Row',
    muscleGroup: 'BACK',
  },
  {
    exerciseType: 'BENT_OVER_BARBELL_ROW',
    label: 'Bent-Over Barbell Row',
    muscleGroup: 'BACK',
  },
  {
    exerciseType: 'ONE_ARM_DUMBBELL_ROW',
    label: 'One-Arm Dumbbell Row',
    muscleGroup: 'BACK',
  },
  { exerciseType: 'T_BAR_ROW', label: 'T-Bar Row', muscleGroup: 'BACK' },
  { exerciseType: 'PULL_UPS', label: 'Pull-Ups', muscleGroup: 'BACK' },
  { exerciseType: 'CHIN_UPS', label: 'Chin-Ups', muscleGroup: 'BACK' },
  {
    exerciseType: 'STRAIGHT_ARM_PULLDOWN',
    label: 'Straight-Arm Pulldown',
    muscleGroup: 'BACK',
  },
  { exerciseType: 'DEADLIFT', label: 'Deadlift', muscleGroup: 'BACK' },

  // Shoulders
  {
    exerciseType: 'BARBELL_OVERHEAD_PRESS',
    label: 'Barbell Overhead Press',
    muscleGroup: 'SHOULDERS',
  },
  {
    exerciseType: 'DUMBBELL_SHOULDER_PRESS',
    label: 'Dumbbell Shoulder Press',
    muscleGroup: 'SHOULDERS',
  },
  {
    exerciseType: 'MACHINE_SHOULDER_PRESS',
    label: 'Machine Shoulder Press',
    muscleGroup: 'SHOULDERS',
  },
  {
    exerciseType: 'LATERAL_RAISE',
    label: 'Lateral Raise',
    muscleGroup: 'SHOULDERS',
  },
  {
    exerciseType: 'FRONT_RAISE',
    label: 'Front Raise',
    muscleGroup: 'SHOULDERS',
  },
  {
    exerciseType: 'REAR_DELT_FLY',
    label: 'Rear Delt Fly',
    muscleGroup: 'SHOULDERS',
  },
  {
    exerciseType: 'CABLE_LATERAL_RAISE',
    label: 'Cable Lateral Raise',
    muscleGroup: 'SHOULDERS',
  },
  {
    exerciseType: 'ARNOLD_PRESS',
    label: 'Arnold Press',
    muscleGroup: 'SHOULDERS',
  },
  { exerciseType: 'SHRUGS', label: 'Shrugs', muscleGroup: 'SHOULDERS' },

  // Biceps
  {
    exerciseType: 'BARBELL_CURL',
    label: 'Barbell Curl',
    muscleGroup: 'BICEPS',
  },
  {
    exerciseType: 'DUMBBELL_CURL',
    label: 'Dumbbell Curl',
    muscleGroup: 'BICEPS',
  },
  { exerciseType: 'HAMMER_CURL', label: 'Hammer Curl', muscleGroup: 'BICEPS' },
  {
    exerciseType: 'PREACHER_CURL',
    label: 'Preacher Curl',
    muscleGroup: 'BICEPS',
  },
  {
    exerciseType: 'CONCENTRATION_CURL',
    label: 'Concentration Curl',
    muscleGroup: 'BICEPS',
  },
  { exerciseType: 'CABLE_CURL', label: 'Cable Curl', muscleGroup: 'BICEPS' },
  {
    exerciseType: 'INCLINE_DUMBBELL_CURL',
    label: 'Incline Dumbbell Curl',
    muscleGroup: 'BICEPS',
  },

  // Triceps
  {
    exerciseType: 'CABLE_TRICEPS_PUSHDOWN',
    label: 'Cable Triceps Pushdown',
    muscleGroup: 'TRICEPS',
  },
  {
    exerciseType: 'OVERHEAD_TRICEPS_EXTENSION',
    label: 'Overhead Triceps Extension',
    muscleGroup: 'TRICEPS',
  },
  {
    exerciseType: 'SKULL_CRUSHERS',
    label: 'Skull Crushers',
    muscleGroup: 'TRICEPS',
  },
  {
    exerciseType: 'CLOSE_GRIP_BENCH_PRESS',
    label: 'Close-Grip Bench Press',
    muscleGroup: 'TRICEPS',
  },
  {
    exerciseType: 'TRICEPS_DIPS',
    label: 'Triceps Dips',
    muscleGroup: 'TRICEPS',
  },
  {
    exerciseType: 'ROPE_PUSHDOWN',
    label: 'Rope Pushdown',
    muscleGroup: 'TRICEPS',
  },

  // Legs
  {
    exerciseType: 'BARBELL_SQUAT',
    label: 'Barbell Squat',
    muscleGroup: 'LEGS',
  },
  { exerciseType: 'LEG_PRESS', label: 'Leg Press', muscleGroup: 'LEGS' },
  {
    exerciseType: 'LEG_EXTENSION',
    label: 'Leg Extension',
    muscleGroup: 'LEGS',
  },
  { exerciseType: 'LEG_CURL', label: 'Leg Curl', muscleGroup: 'LEGS' },
  {
    exerciseType: 'ROMANIAN_DEADLIFT',
    label: 'Romanian Deadlift',
    muscleGroup: 'LEGS',
  },
  { exerciseType: 'LUNGES', label: 'Lunges', muscleGroup: 'LEGS' },
  {
    exerciseType: 'BULGARIAN_SPLIT_SQUAT',
    label: 'Bulgarian Split Squat',
    muscleGroup: 'LEGS',
  },
  { exerciseType: 'HIP_THRUST', label: 'Hip Thrust', muscleGroup: 'LEGS' },
  { exerciseType: 'CALF_RAISE', label: 'Calf Raise', muscleGroup: 'LEGS' },

  // Abs/Core
  { exerciseType: 'CRUNCHES', label: 'Crunches', muscleGroup: 'CORE' },
  { exerciseType: 'SIT_UPS', label: 'Sit-Ups', muscleGroup: 'CORE' },
  { exerciseType: 'PLANK', label: 'Plank', muscleGroup: 'CORE' },
  {
    exerciseType: 'HANGING_LEG_RAISE',
    label: 'Hanging Leg Raise',
    muscleGroup: 'CORE',
  },
  { exerciseType: 'CABLE_CRUNCH', label: 'Cable Crunch', muscleGroup: 'CORE' },
  {
    exerciseType: 'RUSSIAN_TWIST',
    label: 'Russian Twist',
    muscleGroup: 'CORE',
  },
  {
    exerciseType: 'AB_WHEEL_ROLLOUT',
    label: 'Ab Wheel Rollout',
    muscleGroup: 'CORE',
  },
  { exerciseType: 'LEG_RAISE', label: 'Leg Raise', muscleGroup: 'CORE' },
];
