import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";
import { describe, expect, it } from "vitest";
import { EXPECTED_EXTRA_CA_SHA256, checkExtraCaLoaded, judgeExtraCa } from "./extra-ca";

/**
 * 이 묶음은 「새 신뢰 앵커 추가」가 아니다 — 「서버가 빠뜨린 사슬 한 칸 채우기」다.
 * 실험(undici 8.10.0 · Node 22.23.1): `ca:[중간 1장]` 만 주면 Node 는 그걸 앵커로
 * 못 쓰고 `UNABLE_TO_GET_ISSUER_CERT` 로 실패한다. 스스로 서명한 뿌리까지 닿아야 검증이 끝난다.
 * 넓어지는 범위는 「이미 공개 신뢰되는 CA 가 발급했는데 서버가 중간을 빼먹은 경우」뿐이다.
 * 그래도 아무 CA 나 못 들어오게 막는 값어치는 그대로라 여기서 막는다
 * (운영 DB·앤트로픽·노션 TLS 에 이 파일이 실리는 것은 맞다). 이 시험을 약하게 만들지 마라.
 * 네트워크는 타지 않는다(파일 + Node 내장 뿌리만) — 오프라인 빌드에서도 돈다.
 *
 * 경로는 **이 파일 기준**으로 잡는다. cwd 기준으로 잡으면 저장소 루트 밖에서
 * vitest 를 돌릴 때 파일을 못 찾아 거짓 실패한다(적대 리뷰 경미 1).
 */
const PEM_PATH = new URL("../../../../certs/extra-intermediates.pem", import.meta.url);

/** 만료가 이보다 가까우면 **막는다**. */
const FAIL_DAYS_LEFT = 30;
/** 만료가 이보다 가까우면 경고만 한다 — 갱신할 시간을 준다(적대 리뷰 중대 2). */
const WARN_DAYS_LEFT = 90;

/**
 * 허용 지문(SHA-256)의 정본은 `extra-ca.ts` 하나다 — 시험과 부팅 확인이 **같은 목록**을 본다.
 * 여기 없는 인증서는 통과 못 한다. 없으면 「공개 뿌리에 물린 아무 CA」가 다 통과해
 * 파일 머리의 주석이 거짓말이 된다(적대 리뷰 중대 1).
 */
const ALLOWED_SHA256 = EXPECTED_EXTRA_CA_SHA256;

const BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;

describe("추가 중간 인증서 묶음", () => {
  const text = readFileSync(PEM_PATH, "utf8");
  const blocks = text.match(BLOCK) ?? [];
  const certs = blocks.map((b) => new X509Certificate(b));

  it("최소 1장은 들어 있다", () => {
    expect(certs.length).toBeGreaterThan(0);
  });

  it("★파일 안의 모든 블록이 평범한 인증서다 — 다른 머리글로 몰래 끼워 넣을 수 없다", () => {
    // 시험이 CERTIFICATE 블록만 보는데 파일에 다른 블록이 있으면, **관문이 안 보는 글자**가 된다.
    // (2026-08-28 실측: 지금 Node 는 TRUSTED CERTIFICATE 를 앵커로 안 싣는다 —
    //  그래도 Node 판이 바뀌면 실릴 수 있으니 여기서 원천 차단한다.)
    const begins = text.match(/-----BEGIN [^-]+-----/g) ?? [];
    expect(begins.length, "BEGIN 블록 수와 인증서 블록 수가 다르다").toBe(blocks.length);
    for (const b of begins) expect(b).toBe("-----BEGIN CERTIFICATE-----");
  });

  it("★비밀키가 섞여 있지 않다 — 이 파일은 저장소에서 유일하게 커밋되는 .pem 이다", () => {
    // .gitignore 예외 때문에 이 파일만 *.pem 방어를 통과한다. 누가 cert+key 묶음을
    // 여기 붙여 넣으면 비밀키가 그대로 GitHub 에 올라간다(적대 리뷰 치명 시나리오 B).
    for (const bad of ["PRIVATE KEY", "BEGIN RSA", "BEGIN EC PARAMETERS", "BEGIN OPENSSH"]) {
      expect(text.includes(bad), `파일에 "${bad}" 가 들어 있다`).toBe(false);
    }
  });

  it("허용 목록에 있는 인증서만 들어 있다", () => {
    const got = certs.map((c) => c.fingerprint256);
    expect(got).toEqual(ALLOWED_SHA256);
  });

  it("전부 CA 인증서다 — 서버(잎) 인증서가 섞이면 안 된다", () => {
    for (const c of certs) expect(c.ca, `${c.subject} 가 CA 가 아니다`).toBe(true);
  });

  it("전부 Node 기본 신뢰 저장소의 뿌리까지 닿는다 — 신뢰 범위를 넓히지 않는다(묶음 안의 상위 중간을 거쳐도 된다, 최대 3단)", () => {
    const roots = rootCertificates.map((p) => new X509Certificate(p));
    // 같은 이름의 뿌리가 여러 벌 있을 수 있다 — 첫 하나만 보면 엉뚱한 열쇠로 검증해
    // 거짓 실패한다(적대 리뷰 경미 2). 이름이 같은 것 **전부** 중 하나라도 맞으면 통과.
    const signedByRoot = (c: X509Certificate) => roots.filter((r) => r.subject === c.issuer).some((r) => c.verify(r.publicKey));
    // 2026-09-03: 춘천바이오는 서버가 중간 2단계를 다 빼먹어 「YR2 ← Root YR ← ISRG Root X1」 두 장을 한 벌로 넣는다.
    // 그래서 발급자가 뿌리가 아니면 묶음 안의 다른 CA 가 서명했는지, 그 CA 가 뿌리에 닿는지를 따라간다.
    const reachesRoot = (c: X509Certificate, depth: number): boolean => {
      if (signedByRoot(c)) return true;
      if (depth >= 3) return false;
      const parents = certs.filter((o) => o !== c && o.subject === c.issuer && c.verify(o.publicKey));
      return parents.some((o) => reachesRoot(o, depth + 1));
    };
    for (const c of certs) {
      expect(reachesRoot(c, 0), `${c.subject} 가 기본 뿌리까지 닿지 않는다(발급자 ${c.issuer})`).toBe(true);
    }
  });

  it("만료가 30일 안으로 다가오면 막는다(90일 안이면 경고만)", () => {
    for (const c of certs) {
      const left = (Date.parse(c.validTo) - Date.now()) / 86400000;
      expect(Date.parse(c.validFrom), `${c.subject} 가 아직 유효 시작 전이다`).toBeLessThan(Date.now());
      if (left < WARN_DAYS_LEFT && left >= FAIL_DAYS_LEFT) {
        console.warn(
          `[extra-ca] ${c.subject} 만료까지 ${Math.round(left)}일. ` +
            `certs/extra-intermediates.pem 을 새 중간 인증서로 갱신하고 ` +
            `이 파일의 ALLOWED_SHA256 지문을 바꿔라. ${FAIL_DAYS_LEFT}일 아래로 내려가면 빌드가 막힌다.`,
        );
      }
      expect(
        left,
        `${c.subject} 만료까지 ${Math.round(left)}일 — certs/extra-intermediates.pem 갱신 + ALLOWED_SHA256 교체 필요`,
      ).toBeGreaterThan(FAIL_DAYS_LEFT);
    }
  });

  it("사람이 읽을 주석이 붙어 있다", () => {
    // 들여쓰기에 흔들리지 않게 — 파일은 "#     쓰는 곳: …" 처럼 공백을 넣어 정렬한다.
    expect(text).toContain("쓰는 곳:");
    expect(text).toContain("검증을 끄는 것이 아니다");
  });

  it("허용 목록의 지문이 파일의 실제 인증서와 같다 — 주석·정본·파일 삼자 일치", () => {
    expect(certs.map((c) => c.fingerprint256)).toEqual(EXPECTED_EXTRA_CA_SHA256);
    for (const f of EXPECTED_EXTRA_CA_SHA256) expect(text).toContain(f);
  });
});

/**
 * ★ 이 묶음은 **바깥 상태를 인자로 넣어** 판정만 잰다.
 * 처음엔 `process.env` 를 만져 가며 쟀는데, 그러면 「그 설정값이 없는 컴퓨터」에서만 통과한다 —
 * 2026-08-28 운영에 설정값을 켠 순간 이 시험 하나 때문에 배포 빌드가 실패했고
 * 같은 시각 다른 세션의 배포까지 막혔다. 그 실수를 두 번 안 하려고 갈라 뒀다.
 */
describe("설정값이 실제로 먹었는지 판정(부팅 점검)", () => {
  it("설정값이 없으면 확인을 건너뛰고 정상으로 본다", () => {
    const s = judgeExtraCa({ configured: false, loadedFingerprints: null });
    expect(s.configured).toBe(false);
    expect(s.ok).toBe(true);
  });

  it("★설정값은 있는데 인증서가 안 실렸으면 실패로 알린다 — 조용한 실패를 잡는 자리다", () => {
    const s = judgeExtraCa({ configured: true, loadedFingerprints: [] });
    expect(s.ok).toBe(false);
    expect(s.missing).toEqual(EXPECTED_EXTRA_CA_SHA256);
  });

  it("기대한 인증서가 다 실렸으면 정상", () => {
    const s = judgeExtraCa({ configured: true, loadedFingerprints: [...EXPECTED_EXTRA_CA_SHA256] });
    expect(s.ok).toBe(true);
    expect(s.missing).toEqual([]);
  });

  it("여러 장 중 하나만 빠져도 잡는다", () => {
    const s = judgeExtraCa({ configured: true, loadedFingerprints: ["AA:BB"] });
    expect(s.ok).toBe(false);
    expect(s.missing).toEqual(EXPECTED_EXTRA_CA_SHA256);
  });

  it("신뢰 목록을 못 읽으면 실패로 본다 — 조용히 넘기지 않는다", () => {
    const s = judgeExtraCa({ configured: true, loadedFingerprints: null, readError: "boom" });
    expect(s.ok).toBe(false);
    expect(s.reason).toContain("boom");
  });

  it("★실려 있어도 유효기간이 끝난 인증서가 있으면 실패로 알린다 — 낡은 이미지 재시작 구멍(코덱스 지적 2026-09-03)", () => {
    const [first, ...rest] = EXPECTED_EXTRA_CA_SHA256;
    const validTo = Object.fromEntries([...rest.map((f) => [f, "2099-01-01T00:00:00Z"]), [first, "2026-09-01T00:00:00Z"]]);
    const s = judgeExtraCa({ configured: true, loadedFingerprints: [...EXPECTED_EXTRA_CA_SHA256], validToByFingerprint: validTo, now: new Date("2026-09-03T00:00:00Z") });
    expect(s.ok).toBe(false);
    expect(s.expired).toEqual([first]);
    expect(s.missing).toEqual([]);
    expect(s.reason).toContain("만료");
  });

  it("만료 시각이 아직 남았으면 정상 — 만료 정보가 없는 지문은 지문 대조만 한다", () => {
    const validTo = Object.fromEntries(EXPECTED_EXTRA_CA_SHA256.slice(1).map((f) => [f, "2099-01-01T00:00:00Z"]));
    const s = judgeExtraCa({ configured: true, loadedFingerprints: [...EXPECTED_EXTRA_CA_SHA256], validToByFingerprint: validTo, now: new Date("2026-09-03T00:00:00Z") });
    expect(s.ok).toBe(true);
    expect(s.expired).toEqual([]);
  });

  it("조회 통로가 없는 Node 판이면 확인을 건너뛴다 — 못 본 것을 고장으로 단정하지 않는다", () => {
    const s = judgeExtraCa({ configured: true, loadedFingerprints: null });
    expect(s.ok).toBe(true);
    expect(s.reason).toContain("지원하지 않음");
  });

  it("진짜 바깥 상태를 읽는 통로도 터지지 않는다(값은 환경에 따라 다르므로 형태만 본다)", () => {
    const s = checkExtraCaLoaded();
    expect(typeof s.ok).toBe("boolean");
    expect(Array.isArray(s.missing)).toBe(true);
  });
});
