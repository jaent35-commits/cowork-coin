import type { ImportResult } from '@/lib/authApi';
import './ImportResults.css';

/** 사용자 일괄 등록 결과 — 초기 비밀번호는 DM 을 못 보낸 사람만 (이 화면에서 한 번) */
export default function ImportResults({ results }: { results: ImportResult[] }) {
  return (
    <ul className="import-results">
      {results.map(r => (
        <li key={r.employeeNo} className={`import-results__row is-${r.status}`}>
          <span className="import-results__who">{r.name} <small>{r.employeeNo}</small></span>
          <span className="import-results__state">
            {r.status === 'created' ? (r.dm ? '등록 · DM 보냄' : '등록 · DM 실패') : r.status === 'exists' ? '이미 있음' : '실패'}
          </span>
          {r.message && <span className="import-results__msg">{r.message}</span>}
          {r.tempPassword && (
            <span className="import-results__pw">초기 비밀번호 <code>{r.tempPassword}</code> 본인에게 직접 전달하세요</span>
          )}
        </li>
      ))}
    </ul>
  );
}
