import { apiClient } from './apiClient';

export interface PredictionResult {
  insufficientData: boolean;
  reason?: string;
  windowDays?: number;
  predictedWeightChangeKg?: number;
  predictedWeightKg?: number;
  isDirectionalEstimate?: boolean;
}

export interface WeighInWithComparison {
  id: string;
  weightKg: string;
  loggedForDate: string;
  comparison: { predictedWeightKg: number; actualWeightKg: number; deltaKg: number } | null;
}

export async function logWeighIn(weightKg: number, date: string) {
  const { data } = await apiClient.post('/weigh-ins', { weightKg, date });
  return data;
}

export async function listWeighIns(): Promise<WeighInWithComparison[]> {
  const { data } = await apiClient.get('/weigh-ins');
  return data;
}

export async function getPrediction(endDate: string): Promise<PredictionResult> {
  const { data } = await apiClient.get('/prediction', { params: { endDate } });
  return data;
}
