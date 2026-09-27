import type { ExecRecord } from '@/types';

/**
 * 집행 이력은 1건 = 1항목. 예전 형식(1건에 여러 항목)은 항목별 기록으로 나눈다.
 * 항목 금액 합 = 기존 합계라 예산 사용액·월별 집계는 바뀌지 않음.
 */
export function splitRecords(records: ExecRecord[]): ExecRecord[] {
  return records.flatMap(r =>
    r.items.length <= 1
      ? [r]
      : r.items.map((it, i) => ({ ...r, id: i === 0 ? r.id : `${r.id}-${i}`, items: [it], total: it.amount })),
  );
}
