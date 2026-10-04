import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { ProjectDraft } from '@/types';
import { useAppState, useDispatch } from '@/store/StoreContext';
import { uid } from '@/lib/format';
import { requestFocus } from '@/lib/search';
import { overlapsYear, setViewYear, useViewYear } from '@/lib/viewYear';
import { Btn, Card, PageHead, SectionHead } from '@/components/ui';
import { EMPTY_PROJECT, ProjectForm, draftReady, normalizeDraft } from './Project';
import './Project.css';
import './Exec.css';

/**
 * 모바일 프로젝트 등록 — 집행 등록과 같은 풀스크린 팝업 (헤더 ‹ 뒤로, 하단 GNB 숨김)
 * 하단에 [취소] [등록] 고정. 등록하면 프로젝트 운영으로 돌아가 새 프로젝트를 선택·강조
 */
export default function ProjectNew({ onBack }: { onBack: () => void }) {
  const state = useAppState();
  const dispatch = useDispatch();
  const [draft, setDraft] = useState<ProjectDraft>(EMPTY_PROJECT);
  const canSave = draftReady(draft);
  const [year] = useViewYear();

  const save = () => {
    if (!canSave) return;
    const id = uid('p');
    dispatch({ type: 'ADD_PROJECT', id, draft: normalizeDraft(draft), team: state.session?.team ?? '' });
    // 조회 연도에 걸치지 않으면 착수 연도로 이동해 새 프로젝트가 목록에 보이도록
    if (!overlapsYear(draft.startDate, draft.endDate, year)) setViewYear(Number(draft.startDate.slice(0, 4)));
    requestFocus('project', id);
    onBack();
  };

  return (
    <div className="view-enter proj-sheet">
      {/* 모바일은 헤더에 제목·뒤로 버튼이 있어 숨김 */}
      <PageHead className="hide-mobile" title="프로젝트 등록" back={{ label: '프로젝트 운영으로', onClick: onBack }} />
      <Card pad="lg">
        <SectionHead title="신규 프로젝트 정보" sub="* 표시(사업명 · 착수일 · 종료일)는 꼭 입력해 주세요" />
        <ProjectForm draft={draft} onChange={setDraft} />
        {/* PC 전용 — 모바일은 하단 고정 바 */}
        <div className="row proj-sheet__actions hide-mobile">
          <Btn variant="secondary" onClick={onBack}>취소</Btn>
          <Btn onClick={save} disabled={!canSave}>등록</Btn>
        </div>
      </Card>

      {/* 모바일 전용 하단 고정 버튼 (화면 등장 애니메이션의 transform 이 fixed 를 가두므로 body 로 portal) */}
      {createPortal(
        <div className="exec-bar" role="region" aria-label="프로젝트 등록">
          <div className="exec-bar__btns">
            <Btn variant="secondary" onClick={onBack}>취소</Btn>
            <Btn onClick={save} disabled={!canSave}>등록</Btn>
          </div>
        </div>, document.body)}
    </div>
  );
}
