// 영수증 글자 인식 — Google Cloud Vision (DOCUMENT_TEXT_DETECTION) · db/migrations/20261117_receipt_ocr_quota.sql
//   body: { image: JPEG/PNG base64 (data: 접두어 허용) }  →  { text }
//   · 서비스 전체 월 한도(관리자가 0 ~ 1,000 으로 정함) 안에서만 Vision 을 부름 — 다 쓰면 429 quota (앱은 휴대폰 안 인식으로 읽음)
//   · Vision 호출이 실패하면 사용 기록을 되돌림 (한도에서 빠지지 않게)
//   · API 키는 함수 비밀값 GOOGLE_VISION_API_KEY 에만 — 앱 · 저장소에 두지 않음
//   · 사진 · 인식한 글자는 저장하거나 로그로 남기지 않음
import { HttpError, admin, caller, json, serve } from '../_shared/mod.ts';

const VISION_KEY = Deno.env.get('GOOGLE_VISION_API_KEY') ?? '';
const VISION_URL = 'https://vision.googleapis.com/v1/images:annotate';
/** base64 길이 상한 (~6MB 사진) — 앱은 긴 변 2200px JPEG 로 줄여 보냄 (보통 1MB 안쪽) */
const MAX_BASE64 = 8_000_000;
const VISION_TIMEOUT = 25_000;

type VisionResponse = {
  responses?: { fullTextAnnotation?: { text?: string }; error?: { code?: number; message?: string } }[];
  error?: { code?: number; message?: string; status?: string };
};

serve(async (req, body) => {
  const me = await caller(req);
  if (!me.is_active || me.must_change_password) throw new HttpError(403, 'forbidden', '사용할 수 없는 계정입니다');
  if (!VISION_KEY) throw new HttpError(503, 'unavailable', '영수증 서버 인식이 설정되지 않았습니다');

  const image = typeof body.image === 'string' ? body.image.replace(/^data:[^,]*,/, '') : '';
  if (!image || !/^[A-Za-z0-9+/=]+$/.test(image.slice(0, 200))) throw new HttpError(400, 'bad_request', '영수증 사진을 보내 주세요');
  if (image.length > MAX_BASE64) throw new HttpError(400, 'bad_request', '사진이 너무 큽니다');

  // 한도 안이면 한 건 기록 (동시에 여러 명이 찍어도 한도를 넘지 않음)
  const { data: usageId, error: qe } = await admin.rpc('ocr_consume', { p_member_id: me.id });
  if (qe) throw new HttpError(500, 'server', '인식 한도를 확인하지 못했습니다');
  if (usageId == null) throw new HttpError(429, 'quota', '이번 달 영수증 서버 인식 한도를 다 썼습니다');

  const release = () => admin.rpc('ocr_release', { p_id: usageId }).then(() => undefined, () => undefined);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), VISION_TIMEOUT);
  let text = '';
  try {
    const res = await fetch(VISION_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': VISION_KEY },
      body: JSON.stringify({
        requests: [{
          image: { content: image },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
          imageContext: { languageHints: ['ko', 'en'] },
        }],
      }),
    });
    const data = (await res.json().catch(() => ({}))) as VisionResponse;
    const r = data.responses?.[0];
    if (!res.ok || data.error || r?.error) {
      // 원인 코드만 기록 (사진 · 글자 · 키는 남기지 않음)
      console.error('vision error', res.status, data.error?.status ?? r?.error?.code ?? '');
      await release();
      throw new HttpError(502, 'unavailable', '영수증 서버 인식에 실패했습니다');
    }
    text = r?.fullTextAnnotation?.text ?? '';
  } catch (e) {
    if (e instanceof HttpError) throw e;
    await release();
    throw new HttpError(502, 'unavailable', ctrl.signal.aborted ? '영수증 서버 인식 시간이 초과되었습니다' : '영수증 서버 인식에 실패했습니다');
  } finally {
    clearTimeout(timer);
  }

  return json({ text });
});
