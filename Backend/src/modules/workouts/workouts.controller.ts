import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkoutsService } from './workouts.service';

@UseGuards(JwtAuthGuard)
@Controller()
export class WorkoutsController {
  constructor(private readonly workoutsService: WorkoutsService) {}

  @Get('workout-exercises')
  getExerciseCatalog() {
    return this.workoutsService.getExerciseCatalog();
  }
}
