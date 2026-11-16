import type { ReactNode } from 'react';
import type { Project } from '@/types';
import { PROJECT_GROUP, TEAM_GROUP, TEAM_TYPES } from '@/lib/budget';

/**
 * 예산 유형 목록 — <Select> 자식으로 그대로 넣는다 (컴포넌트가 아니라 함수: Select 가 option 을 직접 읽음)
 * [팀 운영] 팀 회의비 · 업무비 (고정) / [프로젝트 운영] 진행 중인 내 프로젝트
 */
export function budgetTypeOptions(projects: Pick<Project, 'id' | 'name'>[], { icons = false, extra, work = true, meeting = true }: {
  icons?: boolean; extra?: ReactNode;
  /** false = 업무비 선택지 숨김 (업무비 권한이 없는 사용자) */
  work?: boolean;
  /** false = 팀 회의비 선택지 숨김 (팀 회의비 편집 권한이 없는 사용자) */
  meeting?: boolean;
} = {}) {
  const team = TEAM_TYPES.filter(t => (work || t.key !== 'work') && (meeting || t.key !== 'meeting'));
  return (
    <>
      {team.length > 0 && (
        <optgroup label={TEAM_GROUP}>
          {team.map(t => <option key={t.key} value={t.key}>{icons ? `${t.icon} ${t.name}` : t.name}</option>)}
        </optgroup>
      )}
      {(projects.length > 0 || extra) && (
        <optgroup label={PROJECT_GROUP}>
          {projects.map(p => <option key={p.id} value={`p:${p.id}`}>{icons ? `📁 ${p.name}` : p.name}</option>)}
          {extra}
        </optgroup>
      )}
    </>
  );
}
