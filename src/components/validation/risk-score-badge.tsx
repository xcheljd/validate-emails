import { Badge } from '@/components/ui/badge';
import {
  calculateRiskScore,
  getRiskLevel,
  getRiskColor,
} from '@/lib/risk-scorer';
import { ValidationResult } from '@/lib/types';

export function RiskScoreBadge({ result }: { result: ValidationResult }) {
  const score = calculateRiskScore(result);
  const level = getRiskLevel(score);
  const colorClass = getRiskColor(score);

  return (
    <Badge className={`${colorClass} text-white ml-2`} title={level}>
      {score}
    </Badge>
  );
}
