import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SportType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { getDayBoundaryUtc } from './day-boundary.util';
import { calculateDailyBalance } from './balance-calculator';
import { calculateExerciseCalories } from './exercise-calorie-calculator';
import { calculateGoalDirection } from '../users/goal-direction';
import { SPORT_CATALOG } from './exercise-met-table';
import { CreateExerciseLogDto } from './dto/create-exercise-log.dto';
import { UpdateExerciseLogDto } from './dto/update-exercise-log.dto';

@Injectable()
export class CalorieBalanceService {
  constructor(private readonly prisma: PrismaService) {}

  getSportCatalog() {
    return SPORT_CATALOG;
  }

  private async requireBaselineWeight(userId: string): Promise<number> {
    const baseline = await this.prisma.userBaseline.findUnique({
      where: { userId },
    });
    if (!baseline) {
      throw new BadRequestException(
        'Complete onboarding (baseline weight) before logging exercise.',
      );
    }
    return Number(baseline.currentWeightKg);
  }

  async logExercise(userId: string, dto: CreateExerciseLogDto) {
    const weightKg = await this.requireBaselineWeight(userId);
    const customSportName =
      dto.sportType === SportType.OTHER ? dto.customSportName : null;
    const caloriesBurned = calculateExerciseCalories(
      dto.sportType,
      weightKg,
      dto.durationMinutes,
    );

    return this.prisma.exerciseLogEntry.create({
      data: {
        userId,
        sportType: dto.sportType,
        customSportName,
        durationMinutes: dto.durationMinutes,
        caloriesBurned,
        loggedForDate: new Date(dto.date),
      },
    });
  }

  async updateExercise(userId: string, id: string, dto: UpdateExerciseLogDto) {
    const existing = await this.prisma.exerciseLogEntry.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      throw new NotFoundException('Exercise entry not found.');
    }

    const sportType = dto.sportType ?? existing.sportType;
    const durationMinutes = dto.durationMinutes ?? existing.durationMinutes;
    const customSportName =
      sportType === SportType.OTHER
        ? (dto.customSportName ?? existing.customSportName)
        : null;

    const weightKg = await this.requireBaselineWeight(userId);
    const caloriesBurned = calculateExerciseCalories(
      sportType,
      weightKg,
      durationMinutes,
    );

    return this.prisma.exerciseLogEntry.update({
      where: { id },
      data: { sportType, customSportName, durationMinutes, caloriesBurned },
    });
  }

  async deleteExercise(userId: string, id: string) {
    const existing = await this.prisma.exerciseLogEntry.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      throw new NotFoundException('Exercise entry not found.');
    }
    await this.prisma.exerciseLogEntry.delete({ where: { id } });
  }

  async listExerciseSessions(userId: string, date: string) {
    return this.prisma.exerciseLogEntry.findMany({
      where: { userId, loggedForDate: new Date(date) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getDailyBalance(userId: string, date: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      // Token references a user that no longer exists (e.g. a deleted
      // account whose access token hasn't expired yet) — fail cleanly
      // instead of letting Prisma's not-found error surface as a 500.
      throw new NotFoundException('User not found.');
    }
    const baseline = await this.prisma.userBaseline.findUnique({
      where: { userId },
    });

    const { startUtc, endUtc } = getDayBoundaryUtc(date, user.timezone);

    const [logs, exerciseEntries] = await Promise.all([
      this.prisma.foodLogEntry.findMany({
        where: { userId, loggedAtUtc: { gte: startUtc, lt: endUtc } },
      }),
      this.prisma.exerciseLogEntry.findMany({
        where: { userId, loggedForDate: new Date(date) },
      }),
    ]);

    const caloriesConsumed = logs.reduce(
      (sum, log) => sum + Number(log.caloriesComputed),
      0,
    );
    const caloriesBurnedExercise = exerciseEntries.reduce(
      (sum, entry) => sum + Number(entry.caloriesBurned),
      0,
    );

    const goalDirection = baseline
      ? calculateGoalDirection(
          Number(baseline.currentWeightKg),
          Number(baseline.goalWeightKg),
        )
      : 'MAINTAIN';

    return calculateDailyBalance({
      caloriesConsumed,
      tdee: baseline ? Number(baseline.tdee) : 0,
      caloriesBurnedExercise,
      goalDirection,
    });
  }
}
