import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WORKOUT_EXERCISE_CATALOG } from './workout-exercise-catalog';
import { CreateWorkoutSessionDto } from './dto/create-workout-session.dto';

@Injectable()
export class WorkoutsService {
  constructor(private readonly prisma: PrismaService) {}

  getExerciseCatalog() {
    return WORKOUT_EXERCISE_CATALOG;
  }

  async createSession(userId: string, dto: CreateWorkoutSessionDto) {
    const todayUtc = new Date().toISOString().slice(0, 10);
    if (dto.date > todayUtc) {
      throw new BadRequestException('Workout date cannot be in the future.');
    }

    return this.prisma.workoutSession.create({
      data: {
        userId,
        muscleGroups: dto.muscleGroups,
        loggedForDate: new Date(dto.date),
        exercises: {
          create: dto.exercises.map((exercise, exerciseIndex) => ({
            exerciseType: exercise.exerciseType,
            order: exerciseIndex,
            sets: {
              create: exercise.sets.map((set, setIndex) => ({
                setNumber: setIndex,
                reps: set.reps,
                weightKg: set.weightKg,
              })),
            },
          })),
        },
      },
      include: {
        exercises: {
          orderBy: { order: 'asc' },
          include: { sets: { orderBy: { setNumber: 'asc' } } },
        },
      },
    });
  }
}
