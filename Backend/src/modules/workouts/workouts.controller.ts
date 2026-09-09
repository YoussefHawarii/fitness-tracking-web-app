import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { WorkoutsService } from './workouts.service';
import { CreateWorkoutSessionDto } from './dto/create-workout-session.dto';

@UseGuards(JwtAuthGuard)
@Controller()
export class WorkoutsController {
  constructor(private readonly workoutsService: WorkoutsService) {}

  @Get('workout-exercises')
  getExerciseCatalog() {
    return this.workoutsService.getExerciseCatalog();
  }

  @Post('workout-sessions')
  createSession(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWorkoutSessionDto,
  ) {
    return this.workoutsService.createSession(user.userId, dto);
  }
}
