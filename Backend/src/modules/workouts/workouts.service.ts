import { Injectable } from '@nestjs/common';
import { WORKOUT_EXERCISE_CATALOG } from './workout-exercise-catalog';

@Injectable()
export class WorkoutsService {
  getExerciseCatalog() {
    return WORKOUT_EXERCISE_CATALOG;
  }
}
