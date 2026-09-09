import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { WorkoutExerciseType } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { WorkoutsService } from './workouts.service';
import { CreateWorkoutSessionDto } from './dto/create-workout-session.dto';
import { ListWorkoutSessionsDto } from './dto/list-workout-sessions.dto';

@UseGuards(JwtAuthGuard)
@Controller()
export class WorkoutsController {
  constructor(private readonly workoutsService: WorkoutsService) {}

  @Get('workout-exercises')
  getExerciseCatalog() {
    return this.workoutsService.getExerciseCatalog();
  }

  @Get('workout-exercises/:exerciseType/last')
  getLastLoggedExercise(
    @CurrentUser() user: AuthenticatedUser,
    @Param('exerciseType', new ParseEnumPipe(WorkoutExerciseType))
    exerciseType: WorkoutExerciseType,
  ) {
    return this.workoutsService.getLastLoggedExercise(
      user.userId,
      exerciseType,
    );
  }

  @Post('workout-sessions')
  createSession(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWorkoutSessionDto,
  ) {
    return this.workoutsService.createSession(user.userId, dto);
  }

  @Get('workout-sessions')
  listSessions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListWorkoutSessionsDto,
  ) {
    return this.workoutsService.listSessions(user.userId, query.muscleGroup);
  }

  @Get('workout-sessions/:id')
  getSession(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.workoutsService.getSession(user.userId, id);
  }

  @Patch('workout-sessions/:id')
  updateSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateWorkoutSessionDto,
  ) {
    return this.workoutsService.updateSession(user.userId, id, dto);
  }

  @Delete('workout-sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.workoutsService.deleteSession(user.userId, id);
  }
}
