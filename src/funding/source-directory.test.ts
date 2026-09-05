import { describe, expect, it } from "vitest";
import { SOURCE_DIRECTORY, resolveDirectory } from "./source-directory";

describe("수집원 명부 — 상태 5종(2026-09-05 P0)", () => {
  it("연결됐는데 최근 회차 저장 0 + 오류면 status 가 error 로 덮인다", () => {
    const rows = resolveDirectory(["djsinbo"], new Map(), {
      runs: new Map([["djsinbo", { saved: 0, error: "게시판 추출 전 단계 실패: selector: fetch failed" }]]),
    });
    expect(rows.find((r) => r.id === "djsinbo")?.status).toBe("error");
  });

  it("저장이 1건이라도 있으면 오류 글이 있어도 connected 다(부분 실패는 비고로만)", () => {
    const rows = resolveDirectory(["bizinfo"], new Map(), {
      runs: new Map([["bizinfo", { saved: 12, error: "상세 3건 실패" }]]),
    });
    expect(rows.find((r) => r.id === "bizinfo")?.status).toBe("connected");
  });

  it("runs 를 안 넘기면 예전과 같이 connected 다(랩·일루아처럼 장부가 없는 호출자)", () => {
    expect(resolveDirectory(["bizinfo"]).find((r) => r.id === "bizinfo")?.status).toBe("connected");
  });

  it("대상 아님(excluded) 줄은 id 가 없고 사유가 있으며 connected 로 덮이지 않는다", () => {
    const rows = resolveDirectory(SOURCE_DIRECTORY.filter((s) => s.id).map((s) => s.id as string));
    const excluded = rows.filter((r) => r.status === "excluded");
    expect(excluded.length).toBeGreaterThanOrEqual(3);
    for (const r of excluded) {
      expect(r.id, r.label).toBeUndefined();
      expect(r.note.length, r.label).toBeGreaterThan(10);
    }
    expect(excluded.map((r) => r.label)).toEqual(
      expect.arrayContaining(["사업주훈련 훈련과정 API", "지역 데이터포털·공공데이터포털", "대한상공회의소"]),
    );
  });

  it("「기초지자체 산하 미확인(8곳 묶음)」 줄은 없고 시흥·고양·유통원은 id 가 있는 줄이다", () => {
    expect(SOURCE_DIRECTORY.some((s) => s.label.includes("8곳 묶음"))).toBe(false);
    const byId = new Map(SOURCE_DIRECTORY.filter((s) => s.id).map((s) => [s.id, s.label]));
    expect(byId.get("sida")).toBe("시흥산업진흥원");
    expect(byId.get("gipa")).toBe("고양산업진흥원");
    expect(byId.get("kodma")).toBe("중소벤처기업유통원");
  });

  it("국내 IP 전용 4곳은 연결 목록에 없으면 waiting 이고 비고에 「국내 경유」가 있다", () => {
    const rows = resolveDirectory([]);
    // ★서울신보는 2026-09-05 부터 여기 없다 — 국내 데이터센터 IP 까지 막혀 blocked 로 옮겼다(아래 시험).
    for (const id of ["tp-jeonbuk", "djsinbo", "sjtp", "aca"]) {
      const r = rows.find((x) => x.id === id);
      expect(r?.status, id).toBe("waiting");
      expect(r?.note, id).toContain("국내 경유");
    }
    const anyang = rows.find((x) => x.label === "안양산업진흥원");
    expect(anyang?.id).toBe("aca");
    expect(anyang?.status).toBe("waiting");
  });

  // ── 2026-09-05: 정적 blocked/excluded 가 실행 결과보다 우선한다 ──
  it("blocked 줄은 연결 목록에 있고 저장 0 + 오류여도 blocked 다(error 로 안 덮인다)", () => {
    const rows = resolveDirectory(["seoulsinbo"], new Map(), {
      runs: new Map([["seoulsinbo", { saved: 0, error: "게시판 추출 전 단계 실패: selector: fetch failed" }]]),
    });
    expect(rows.find((r) => r.id === "seoulsinbo")?.status).toBe("blocked");
  });

  it("같은 blocked 줄도 실제로 저장이 생기면(saved 3) connected 로 올라온다", () => {
    const rows = resolveDirectory(["seoulsinbo"], new Map(), {
      runs: new Map([["seoulsinbo", { saved: 3, error: null }]]),
    });
    expect(rows.find((r) => r.id === "seoulsinbo")?.status).toBe("connected");
  });

  it("기존 error 판정은 status 가 waiting 인 줄에서 그대로다", () => {
    const rows = resolveDirectory(["djsinbo"], new Map(), {
      runs: new Map([["djsinbo", { saved: 0, error: "fetch failed" }]]),
    });
    expect(SOURCE_DIRECTORY.find((s) => s.id === "djsinbo")?.status).toBe("waiting");
    expect(rows.find((r) => r.id === "djsinbo")?.status).toBe("error");
  });

  it("서울신보는 blocked 이고 비고에 실측 근거(주거용 회선·서울 VM)가 있다", () => {
    const s = SOURCE_DIRECTORY.find((x) => x.id === "seoulsinbo");
    expect(s?.status).toBe("blocked");
    expect(s?.note).toContain("주거용 회선");
    expect(s?.note).toContain("Vultr");
  });

  it("id 중복이 없고, 미연결 줄은 전부 비고가 있다", () => {
    const withId = SOURCE_DIRECTORY.filter((s) => s.id).map((s) => s.id);
    expect(new Set(withId).size).toBe(withId.length);
    for (const s of resolveDirectory([])) {
      // connected 는 연결 목록이 비면 자리값(candidate + 빈 비고)으로 남는다.
      // 빈 비고는 연결된 곳 규칙(noteTextOf 가 회차 건수를 가림)이라, 미연결은 대기·차단·대상 아님만 본다.
      if (s.status === "waiting" || s.status === "blocked" || s.status === "excluded") {
        expect(s.note.length, `${s.label} 비고 없음`).toBeGreaterThan(3);
      }
    }
  });
});
