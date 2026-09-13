import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MuscleGroup, Prisma, WorkoutExerciseType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WORKOUT_EXERCISE_CATALOG } from './workout-exercise-catalog';
import { CreateWorkoutSessionDto } from './dto/create-workout-session.dto';

const SESSION_INCLUDE = {
  exercises: {
    orderBy: { order: 'asc' },
    include: { sets: { orderBy: { setNumber: 'asc' } } },
  },
} satisfies Prisma.WorkoutSessionInclude;

@Injectable()
export class WorkoutsService {
  constructor(private readonly prisma: PrismaService) {}

  getExerciseCatalog() {
    return WORKOUT_EXERCISE_CATALOG;
  }

  async getLastLoggedExercise(
    userId: string,
    exerciseType: WorkoutExerciseType,
  ) {
    const exercise = await this.prisma.workoutExercise.findFirst({
      where: { exerciseType, workoutSession: { userId } },
      orderBy: [
        { workoutSession: { loggedForDate: 'desc' } },
        { workoutSession: { createdAt: 'desc' } },
        { order: 'desc' },
      ],
      include: {
        sets: { orderBy: { setNumber: 'asc' } },
        workoutSession: { select: { loggedForDate: true } },
      },
    });
    if (!exercise) return null;
    return {
      loggedForDate: exercise.workoutSession.loggedForDate,
      sets: exercise.sets,
    };
  }

  async createSession(userId: string, dto: CreateWorkoutSessionDto) {
    this.assertNotFutureDate(dto.date);
    const loggedForDate = new Date(dto.date);

    // Exercises for the same day are often saved one at a time (Save
    // clicked after each), not all at once — fold each save into the
    // existing same-day, same-muscle-group session instead of leaving one
    // history entry per click.
    const sameDaySessions = await this.prisma.workoutSession.findMany({
      where: { userId, loggedForDate },
      include: SESSION_INCLUDE,
    });
    const existing = sameDaySessions.find((session) =>
      this.sameMuscleGroups(session.muscleGroups, dto.muscleGroups),
    );

    if (existing) {
      const startOrder = existing.exercises.length
        ? Math.max(...existing.exercises.map((exercise) => exercise.order)) + 1
        : 0;
      return this.prisma.workoutSession.update({
        where: { id: existing.id },
        data: {
          exercises: {
            create: this.buildExercisesCreateInput(dto.exercises, startOrder),
          },
        },
        include: SESSION_INCLUDE,
      });
    }

    return this.prisma.workoutSession.create({
      data: {
        userId,
        muscleGroups: dto.muscleGroups,
        loggedForDate,
        exercises: { create: this.buildExercisesCreateInput(dto.exercises) },
      },
      include: SESSION_INCLUDE,
    });
  }

  async listSessions(userId: string, muscleGroup?: MuscleGroup) {
    const exerciseTypeFilter = muscleGroup
      ? WORKOUT_EXERCISE_CATALOG.filter(
          (entry) => entry.muscleGroup === muscleGroup,
        ).map((entry) => entry.exerciseType)
      : undefined;

    return this.prisma.workoutSession.findMany({
      where: {
        userId,
        ...(exerciseTypeFilter && {
          exercises: { some: { exerciseType: { in: exerciseTypeFilter } } },
        }),
      },
      orderBy: [{ loggedForDate: 'desc' }, { createdAt: 'desc' }],
      include: {
        exercises: {
          where: exerciseTypeFilter
            ? { exerciseType: { in: exerciseTypeFilter } }
            : undefined,
          orderBy: { order: 'asc' },
          include: { sets: { orderBy: { setNumber: 'asc' } } },
        },
      },
    });
  }

  // Always the full, unfiltered session — used to reopen the Log form for
  // editing, which must never operate on a muscleGroup-filtered subset of
  // exercises (that would silently drop the hidden ones on save).
  async getSession(userId: string, id: string) {
    const session = await this.prisma.workoutSession.findFirst({
      where: { id, userId },
      include: SESSION_INCLUDE,
    });
    if (!session) {
      throw new NotFoundException('Workout session not found.');
    }
    return session;
  }

  async updateSession(
    userId: string,
    id: string,
    dto: CreateWorkoutSessionDto,
  ) {
    await this.requireOwnedSession(userId, id);
    this.assertNotFutureDate(dto.date);

    // Full replace, not a partial patch: drop every existing exercise (sets
    // cascade) and recreate from the submitted draft. Wrapped in a
    // transaction so the session is never briefly left with zero exercises
    // if the recreate step fails.
    return this.prisma.$transaction(async (tx) => {
      await tx.workoutExercise.deleteMany({ where: { workoutSessionId: id } });
      return tx.workoutSession.update({
        where: { id },
        data: {
          muscleGroups: dto.muscleGroups,
          loggedForDate: new Date(dto.date),
          exercises: { create: this.buildExercisesCreateInput(dto.exercises) },
        },
        include: SESSION_INCLUDE,
      });
    });
  }

  async deleteSession(userId: string, id: string) {
    await this.requireOwnedSession(userId, id);
    await this.prisma.workoutSession.delete({ where: { id } });
  }

  private async requireOwnedSession(userId: string, id: string) {
    const existing = await this.prisma.workoutSession.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      throw new NotFoundException('Workout session not found.');
    }
    return existing;
  }

  private assertNotFutureDate(date: string) {
    const todayUtc = new Date().toISOString().slice(0, 10);
    if (date > todayUtc) {
      throw new BadRequestException('Workout date cannot be in the future.');
    }
  }

  private buildExercisesCreateInput(
    exercises: CreateWorkoutSessionDto['exercises'],
    startOrder = 0,
  ) {
    return exercises.map((exercise, exerciseIndex) => ({
      exerciseType: exercise.exerciseType,
      order: startOrder + exerciseIndex,
      sets: {
        create: exercise.sets.map((set, setIndex) => ({
          setNumber: setIndex,
          reps: set.reps,
          weightKg: set.weightKg,
        })),
      },
    }));
  }

  // Order-independent: chip-selection order isn't meaningful, so ['CHEST',
  // 'TRICEPS'] and ['TRICEPS', 'CHEST'] must be treated as the same session.
  private sameMuscleGroups(a: MuscleGroup[], b: MuscleGroup[]): boolean {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((group, index) => group === sortedB[index]);
  }
}
