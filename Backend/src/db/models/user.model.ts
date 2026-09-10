import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, User, UserBaseline } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

// Every query against the User and UserBaseline tables, for every module
// that needs them (auth, users, calorie-balance, weight-prediction). Centralizes
// the fetch-by-id-or-404 pattern that was previously duplicated across
// UsersService and CalorieBalanceService.
@Injectable()
export class UserModel {
  constructor(private readonly prisma: PrismaService) {}

  findById(userId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id: userId } });
  }

  async findByIdOrThrow(userId: string): Promise<User> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    return user;
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findByUsername(username: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { username } });
  }

  findByGoogleSubjectId(subjectId: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { googleSubjectId: subjectId },
    });
  }

  create(data: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({ data });
  }

  update(userId: string, data: Prisma.UserUpdateInput): Promise<User> {
    return this.prisma.user.update({ where: { id: userId }, data });
  }

  findBaselineByUserId(userId: string): Promise<UserBaseline | null> {
    return this.prisma.userBaseline.findUnique({ where: { userId } });
  }

  findBaselineWithTimezone(userId: string) {
    return this.prisma.userBaseline.findUnique({
      where: { userId },
      include: { user: { select: { timezone: true } } },
    });
  }

  upsertBaseline(
    userId: string,
    data: Omit<Prisma.UserBaselineUncheckedCreateInput, 'userId'>,
  ): Promise<UserBaseline> {
    return this.prisma.userBaseline.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  }

  updateBaseline(
    userId: string,
    data: Prisma.UserBaselineUpdateInput,
  ): Promise<UserBaseline> {
    return this.prisma.userBaseline.update({ where: { userId }, data });
  }
}
