import { X509Certificate } from "node:crypto";
import * as tls from "node:tls";

/**
 * `tls.getCACertificates` 는 이 Node(22.23 실측)에는 있는데 설치된 타입 정의에는 아직 없다.
 * 정적 import 로 쓰면 타입검사가 깨지므로 있으면 쓰고 없으면 건너뛰는 형태로 잡는다.
 */
type GetCACertificates = (kind: "default" | "bundled" | "system" | "extra") => string[];
const getCACertificates = (tls as unknown as { getCACertificates?: GetCACertificates })
  .getCACertificates;

/**
 * 서버가 TLS 사슬에서 빠뜨린 중간 인증서를 `NODE_EXTRA_CA_CERTS` 로 보탠다.
 * ★이 묶음은 「새 신뢰 앵커 추가」가 아니다 — 「서버가 빠뜨린 사슬 한 칸 채우기」다.
 * 실험(undici 8.10.0 · Node 22.23.1): `ca:[중간 1장]` 만 주면 Node 는 그걸 앵커로
 * 못 쓰고 `UNABLE_TO_GET_ISSUER_CERT` 로 실패한다. 스스로 서명한 뿌리까지 닿아야 검증이 끝난다.
 * 넓어지는 범위는 「이미 공개 신뢰되는 CA 가 발급했는데 서버가 중간을 빼먹은 경우」뿐이다.
 * 그래도 아무 CA 나 못 들어오게 막는 값어치는 그대로다(운영 DB·앤트로픽·노션 TLS 에
 * 이 파일이 실리므로) — 그 관문은 extra-ca.test.ts 가 지킨다. 시험을 약하게 만들지 마라.
 * 여기 지문이 **유일한 정본**이다 — `certs/extra-intermediates.pem` 과 이 목록이 어긋나면
 * `extra-ca.test.ts` 가 빌드에서 막는다.
 */
export const EXPECTED_EXTRA_CA_SHA256 = [
  // Sectigo Public Server Authentication CA DV R36 — www.dgtp.or.kr (대구테크노파크)
  "8C:54:C3:34:B6:6B:A4:E4:26:77:2A:F4:A3:F9:13:6C:19:A1:AE:C7:29:FD:B2:8C:53:5C:07:A5:A4:EF:22:E0",
  // Sectigo RSA Domain Validation Secure Server CA — www.cwip.or.kr (창원산업진흥원)
  // 그 서버는 사슬에 잎사귀만 보낸다(2026-09-01 실측). 상위는 이미 신뢰되는 USERTrust RSA CA.
  "7F:A4:FF:68:EC:04:A9:9D:75:28:D5:08:5F:94:90:7F:4D:1D:D1:C5:38:1B:AC:DC:83:2E:D5:C9:60:21:46:76",
  // GoGetSSL RSA DV SSL CA 2 — www.jica.or.kr (전주정보문화산업진흥원)
  // 그 서버는 잎 + 엉뚱한 교차서명 뿌리만 보내고 진짜 중간을 빠뜨린다(2026-09-01 실측).
  "B5:28:67:96:DA:DF:16:52:1D:E4:17:72:AB:2F:DB:58:18:72:99:71:B5:27:47:21:14:6C:6E:81:72:BE:FE:07",
  // Thawte TLS RSA CA G1 — www.koreaexim.go.kr (한국수출입은행)
  // 국내에서 열면 사슬 3장이 다 오는데, 운영 서버(Railway·미국)가 닿는 쪽은 중간을 빼먹어
  // UNABLE_TO_VERIFY_LEAF_SIGNATURE 로 죽었다(2026-09-02 컨테이너 안 실측). 상위는 DigiCert Global Root G2.
  "4B:CC:5E:23:4F:E8:1E:DE:4E:AF:88:3A:A1:9C:31:33:5B:0B:26:E8:5E:06:6B:99:45:E4:CB:61:53:EB:20:C2",
  // Let's Encrypt YR2 — www.cbf.or.kr (춘천바이오산업진흥원). 서버가 잎만 보내 중간 2단계가 다 빠진다(2026-09-03 실측).
  // 발급자가 뿌리가 아니라 아래 Root YR 이라 두 장이 한 벌이다.
  "23:8B:85:A0:09:9C:65:B9:70:47:7D:57:24:F1:A1:D4:75:CE:50:58:CF:FE:4E:FA:87:33:89:9B:DB:86:3C:47",
  // ISRG Root YR — YR2 의 상위(발급자 ISRG Root X1 = Node 기본 뿌리)
  "07:26:39:D0:B1:40:D5:BF:FA:E1:6A:D9:C3:F6:CC:60:86:04:06:21:F5:1E:E6:1A:6D:46:A8:91:5C:07:CF:76",
  // DigiCert Global G2 TLS RSA SHA256 2020 CA1 — www.seoulshinbo.co.kr (서울신용보증재단). 서버가 잎만 보낸다(2026-09-03 실측, 로컬·운영 둘 다 UNABLE_TO_VERIFY_LEAF_SIGNATURE). 상위는 DigiCert Global Root G2.
  "C8:02:5F:9F:C6:5F:DF:C9:5B:3C:A8:CC:78:67:B9:A5:87:B5:27:79:73:95:79:17:46:3F:C8:13:D0:B6:25:A9",
  // RapidSSL TLS RSA CA G1 — bepa.kr (부산경제진흥원). 서버가 잎만 보낸다(2026-09-03 실측). 상위는 DigiCert Global Root G2.
  "44:22:E9:63:EE:53:CD:58:CC:9F:85:CD:40:BF:5F:FE:C0:09:5F:DF:1A:15:45:35:66:1C:1C:06:BC:AD:C6:9B",
];

export interface ExtraCaStatus {
  configured: boolean;
  loaded: string[];
  missing: string[];
  /** 실려 있긴 한데 유효기간이 끝난 지문. 빌드 시험(30일 전 차단)을 한 번도 안 거친 낡은 이미지가 재시작될 때만 생긴다. */
  expired: string[];
  ok: boolean;
  reason?: string;
}

/**
 * 설정값이 실제로 **먹었는지** 확인한다.
 *
 * 왜 필요한가: 파일이 이미지에 안 실리거나 경로가 틀리면 Node 는 경고 한 줄만 내고 그냥 뜬다.
 * 그러면 대구TP·창원·전주 수집이 고치기 전과 **똑같은 오류**로 실패하는데, 원인이 「인증서가 안 실렸다」인지
 * 「사이트가 또 바뀌었다」인지 구분할 신호가 없다(적대 리뷰 중대 3).
 *
 * 네트워크를 타지 않는다 — Node 가 지금 들고 있는 신뢰 목록만 본다.
 */
/**
 * 바깥 상태(환경변수·Node 신뢰 목록)를 **인자로 받는다.**
 *
 * 왜 이렇게까지: 처음엔 이 함수가 `process.env` 와 Node 신뢰 목록을 직접 읽었는데,
 * 그러면 시험이 「그 설정값이 없는 컴퓨터」에서만 통과한다. 실제로 2026-08-28 운영에
 * 설정값을 켠 순간 **배포 빌드가 그 시험 하나 때문에 실패했고, 같은 시각 다른 세션의
 * 배포까지 함께 막혔다.** 판정 로직과 바깥 상태 읽기를 갈라 둔다.
 */
export function judgeExtraCa(input: {
  configured: boolean;
  /** 실린 인증서 지문들. `null` 이면 이 Node 판에 조회 통로가 없다는 뜻. */
  loadedFingerprints: string[] | null;
  /** 지문 → 만료 시각(ISO). 없으면 만료 판정을 건너뛴다(지문만 대조). */
  validToByFingerprint?: Record<string, string>;
  now?: Date;
  readError?: string;
}): ExtraCaStatus {
  const { configured, loadedFingerprints, readError, validToByFingerprint, now } = input;
  if (!configured) {
    return { configured: false, loaded: [], missing: [], expired: [], ok: true, reason: "설정값 없음 — 확인 건너뜀" };
  }
  if (readError) {
    return {
      configured, loaded: [], missing: [...EXPECTED_EXTRA_CA_SHA256], expired: [], ok: false,
      reason: `신뢰 목록을 읽지 못했다: ${readError}`,
    };
  }
  if (loadedFingerprints === null) {
    // 못 본 것을 「고장」으로도 「정상」으로도 단정하지 않는다 — 확인을 건너뛴다.
    return { configured, loaded: [], missing: [], expired: [], ok: true, reason: "이 Node 판은 신뢰 목록 조회를 지원하지 않음" };
  }
  const missing = EXPECTED_EXTRA_CA_SHA256.filter((f) => !loadedFingerprints.includes(f));
  // 지문이 있어도 유효기간이 끝났으면 Node 는 그 사슬을 거부한다 — 「실렸다」만 보고 정상이라 적으면 거짓이다(코덱스 지적 2026-09-03).
  const nowMs = (now ?? new Date()).getTime();
  const expired = EXPECTED_EXTRA_CA_SHA256.filter((f) => {
    if (missing.includes(f)) return false;
    const to = validToByFingerprint?.[f];
    if (!to) return false;
    const toMs = Date.parse(to);
    return Number.isFinite(toMs) && toMs < nowMs;
  });
  const ok = missing.length === 0 && expired.length === 0;
  return { configured, loaded: loadedFingerprints, missing, expired, ok, reason: expired.length ? `만료된 중간 인증서 ${expired.length}장` : undefined };
}

/** 진짜 바깥 상태를 읽어 판정한다. 시험은 이걸 안 쓰고 `judgeExtraCa` 를 직접 부른다. */
export function checkExtraCaLoaded(): ExtraCaStatus {
  const configured = !!process.env.NODE_EXTRA_CA_CERTS;
  if (!configured) return judgeExtraCa({ configured: false, loadedFingerprints: null });
  if (typeof getCACertificates !== "function") {
    return judgeExtraCa({ configured, loadedFingerprints: null });
  }
  try {
    const certs = getCACertificates("extra").map((pem) => new X509Certificate(pem));
    const loaded = certs.map((c) => c.fingerprint256);
    const validToByFingerprint = Object.fromEntries(certs.map((c) => [c.fingerprint256, c.validTo]));
    return judgeExtraCa({ configured, loadedFingerprints: loaded, validToByFingerprint });
  } catch (e) {
    return judgeExtraCa({
      configured, loadedFingerprints: null,
      readError: e instanceof Error ? e.message : String(e),
    });
  }
}

/** 부팅 때 한 번 불러 조용한 실패를 크게 알린다. 실패해도 앱을 멈추지는 않는다. */
export function logExtraCaStatus(log: Pick<Console, "error" | "log"> = console): ExtraCaStatus {
  const s = checkExtraCaLoaded();
  if (!s.configured) return s;
  if (s.ok) {
    log.log(`[extra-ca] 중간 인증서 ${s.loaded.length}장 실림 — 정상`);
  } else {
    log.error(
      `[extra-ca] ★설정값은 있는데 중간 인증서가 온전히 안 실렸다 — NODE_EXTRA_CA_CERTS=${process.env.NODE_EXTRA_CA_CERTS} · ` +
        `빠진 지문 ${s.missing.length}개 · 만료 ${s.expired.length}개${s.reason ? ` · ${s.reason}` : ""}. ` +
        `이 상태면 중간 인증서가 필요한 수집원(certs/extra-intermediates.pem 의 「쓰는 곳」 주석 참조 — 대구TP·창원·전주·수출입은행·춘천바이오·서울신보·부산경제진흥원)이 ` +
        `인증서 오류로 계속 실패한다(파일이 배포에 안 실렸거나 낡은 이미지일 가능성). 빠진/만료 지문: ${[...s.missing, ...s.expired].join(", ") || "없음"}`,
    );
  }
  return s;
}
