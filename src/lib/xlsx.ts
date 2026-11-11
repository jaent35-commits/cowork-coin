/**
 * 엑셀(.xlsx) 첫 시트 → 문자열 표 — 라이브러리 없이 (사용자 일괄 등록용)
 * .xlsx = zip 안의 XML: 압축은 브라우저 DecompressionStream('deflate-raw'), XML 은 DOMParser
 * 수식 결과 · 공유 문자열 · 숫자 · 인라인 문자열을 글자 그대로 읽음 (서식 · 날짜 변환은 하지 않음)
 */

interface ZipEntry { name: string; method: number; offset: number; size: number }

function zipEntries(buf: ArrayBuffer): ZipEntry[] {
  const v = new DataView(buf);
  // 끝에서 중앙 디렉터리 끝(EOCD, 0x06054b50) 찾기
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('엑셀(.xlsx) 파일이 아닙니다');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
    // 로컬 헤더 뒤가 실제 데이터
    const lName = v.getUint16(local + 26, true), lExtra = v.getUint16(local + 28, true);
    out.push({ name, method, offset: local + 30 + lName + lExtra, size });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function readEntry(buf: ArrayBuffer, e: ZipEntry): Promise<string> {
  const raw = new Uint8Array(buf, e.offset, e.size);
  if (e.method === 0) return new TextDecoder().decode(raw);
  if (e.method !== 8) throw new Error('지원하지 않는 압축 방식입니다');
  if (typeof DecompressionStream === 'undefined') throw new Error('이 브라우저에서는 엑셀을 읽을 수 없습니다. 최신 크롬 · 엣지 · 사파리를 쓰세요');
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

const xml = (s: string) => new DOMParser().parseFromString(s, 'application/xml');
/** A1 → 0 기준 열 번호 */
const colIndex = (ref: string) => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

export async function readXlsx(file: File): Promise<string[][]> {
  const buf = await file.arrayBuffer();
  const entries = zipEntries(buf);
  const get = async (name: string) => {
    const e = entries.find(x => x.name === name);
    return e ? readEntry(buf, e) : null;
  };
  // 첫 시트 경로: workbook.xml 첫 sheet → 관계(rels) → 대상 파일 (없으면 sheet1.xml)
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = await get('xl/workbook.xml'), rels = await get('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const first = xml(wb).getElementsByTagName('sheet')[0];
    const rid = first?.getAttribute('r:id') ?? first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const target = [...xml(rels).getElementsByTagName('Relationship')].find(r => r.getAttribute('Id') === rid)?.getAttribute('Target');
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }
  const sharedXml = await get('xl/sharedStrings.xml');
  const shared = sharedXml ? [...xml(sharedXml).getElementsByTagName('si')].map(si => [...si.getElementsByTagName('t')].map(t => t.textContent ?? '').join('')) : [];
  const sheetXml = await get(sheetPath);
  if (!sheetXml) throw new Error('첫 시트를 찾지 못했습니다');

  const rows: string[][] = [];
  for (const row of [...xml(sheetXml).getElementsByTagName('row')]) {
    const cells: string[] = [];
    for (const c of [...row.getElementsByTagName('c')]) {
      const i = colIndex(c.getAttribute('r') ?? 'A1');
      const type = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      cells[i] = (type === 's' ? shared[Number(v)] ?? ''
        : type === 'inlineStr' ? [...c.getElementsByTagName('t')].map(t => t.textContent ?? '').join('')
          : v).trim();
    }
    rows.push(Array.from(cells, x => x ?? ''));
  }
  return rows;
}
