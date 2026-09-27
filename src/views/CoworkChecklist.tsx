import { useState } from 'react';
import type { View } from '@/types';
import { Btn, PageHead } from '@/components/ui';
import { IconClose } from '@/components/icons';
import ProjectChecklist, { resetChecklistFilters } from './ProjectChecklist';
import { openProjectTab } from './Project';
import './Project.css';

/**
 * 코웍 체크리스트 (대메뉴) — 배분받아 참여하는 프로젝트에서 주관 팀이 공개한 체크리스트
 * 금액은 주관 팀의 My 경비 배분 금액 기준 (우리 팀 배분 예산과 별개), 참여 팀도 체크 가능
 */
export default function CoworkChecklist({ onNavigate }: { onNavigate: (v: View) => void }) {
  // 메뉴로 들어올 때마다 조회 조건 기본값
  useState(() => { resetChecklistFilters('cowork'); return null; });
  const goMy = () => { openProjectTab('My 체크리스트'); onNavigate('project'); };

  return (
    <div className="view-enter">
      <PageHead
        title="코웍 체크리스트"
        actions={<>
          {/* PC: My 체크리스트 탭으로 / 모바일: 집행 현황 안에서 여는 화면이므로 닫기 = 집행 현황으로 */}
          <Btn variant="secondary" className="cowork-go-my" onClick={goMy}>My 체크리스트 확인</Btn>
          <Btn variant="secondary" className="cowork-go-exec" onClick={() => onNavigate('exec')}><IconClose size={14} />코웍 체크리스트 닫기</Btn>
        </>}
      />
      <ProjectChecklist scope="cowork" />
    </div>
  );
}
