import { describe, expect, it } from "vitest";
import { buildSourcesSummary, mergeSourceCounts, type SourcesEntry } from "./sources-summary";
import { collectSourceNames } from "../collect/source-names";

const NAMES = collectSourceNames();
const find = (entries: SourcesEntry[], id: string) => entries.find((e) => e.id === id)!;

function build(over: Partial<Parameters<typeof buildSourcesSummary>[0]> = {}) {
  return buildSourcesSummary({
    names: NAMES,
    countBy: new Map(),
    ledgerValue: null,
    capRows: [],
    capsUnknown: false,
    ...over,
  });
}

describe("mergeSourceCounts — 두 표의 건수 합치기", () => {
  it("공고 표와 상시 상품 표를 더한다 — 덮지 않는다", () => {
    const m = mergeSourceCounts(
      [{ source: "bizinfo", count: 1500 }],
      [{ source: "product-kinfa", count: 325 }, { source: "bizinfo", count: 3 }],
    );
    expect(m.get("bizinfo")).toBe(1503);
    expect(m.get("product-kinfa")).toBe(325);
  });
});

describe("수집원 현황 — 명부 + 건수 + 마지막 수집", () => {
  it("연결된 수집원에 건수와 마지막 저장 수가 붙는다", () => {
    const { entries, summary } = build({
      countBy: new Map([["bizinfo", 1500]]),
      ledgerValue: { lastReport: { ranAt: "2026-08-29T08:12:12Z",
        perSource: [{ name: "bizinfo", saved: 1500, error: null }] } },
    });
    const bizinfo = find(entries, "bizinfo");
    expect(bizinfo.status).toBe("connected");
    expect(bizinfo.count).toBe(1500);
    expect(bizinfo.lastSaved).toBe(1500);
    expect(bizinfo.hitCap).toBe(false);
    expect(summary.connected).toBeGreaterThan(20);
    expect(summary.lastRanAt).toBe("2026-08-29T08:12:12Z");
    // 미연결 행도 실려 온다
    expect(entries.some((e) => e.status === "waiting")).toBe(true);
  });

  it("쪽수 상한 장부를 행에 싣되 비고(note)는 건드리지 않는다", () => {
    const { entries } = build({
      ledgerValue: { lastReport: { ranAt: "2026-09-01T00:00:00Z", perSource: [] } },
      capRows: [{ key: "board-cap:semas", value: { hitCap: true, lastPageNew: 4, at: "2026-09-01T00:00:00.000Z" } }],
    });
    const semas = find(entries, "semas");
    expect(semas.hitCap).toBe(true);
    expect(semas.lastPageNew).toBe(4);
    expect(semas.note).toBe("");
  });

  it("⑦ 장부를 못 읽었으면 hitCap 을 false 로 만들지 않는다", () => {
    const { entries } = build({
      ledgerValue: { lastReport: { ranAt: "2026-09-02T00:00:00Z", perSource: [] } },
      capsUnknown: true,
    });
    const semas = find(entries, "semas");
    expect(semas.hitCap).not.toBe(false);
    expect(semas.hitCap).toBeNull();
  });

  it("★상시 상품은 다른 표에 있다 — 건수를 합쳐 준다(안 합치면 0 으로 보인다)", () => {
    const { entries } = build({
      countBy: mergeSourceCounts([{ source: "bizinfo", count: 10 }], [{ source: "product-kinfa", count: 325 }]),
      ledgerValue: { lastReport: { ranAt: "2026-09-03T00:00:00Z", perSource: [] } },
    });
    expect(find(entries, "product-kinfa").count).toBe(325);
    expect(find(entries, "bizinfo").count).toBe(10); // 두 표가 서로를 덮지 않는다
  });

  it("상품 표를 못 읽었으면 그 줄은 0 건 — 화면 전체가 죽지 않는다", () => {
    const { entries } = build({
      countBy: mergeSourceCounts([{ source: "bizinfo", count: 10 }], []),
      ledgerValue: { lastReport: { ranAt: "2026-09-03T00:00:00Z", perSource: [] } },
    });
    expect(find(entries, "product-kinfa").count).toBe(0);
  });

  it("연결됐는데 최근 회차 저장 0 + 오류면 status error 로 주고 요약에도 센다", () => {
    const { entries, summary } = build({
      ledgerValue: { lastReport: { ranAt: "2026-09-04T11:55:31Z", perSource: [
        { name: "kiat", saved: 0, error: "게시판 추출 전 단계 실패: selector: 행 0개" },
        { name: "bizinfo", saved: 1500, error: null },
      ] } },
    });
    const kiat = find(entries, "kiat");
    expect(kiat.status).toBe("error");
    expect(kiat.lastError).toContain("행 0개");
    expect(find(entries, "bizinfo").status).toBe("connected");
    expect(summary.error).toBe(1);
    expect(summary.excluded).toBeGreaterThanOrEqual(3);
  });

  it("★이어하기 중인 회차 결과가 완주한 보고서를 덮는다 — 배포에 끊긴 실패가 안 묻히게", () => {
    const { entries, summary } = build({
      countBy: new Map([["sida", 17]]),
      ledgerValue: {
        lastReport: { ranAt: "2026-09-04T00:00:00Z", perSource: [
          { name: "sida", saved: 17, error: null },
          { name: "bizinfo", saved: 1500, error: null },
        ] },
        cycle: { perSource: [{ name: "sida", saved: 0, error: "목록 행 0개" }] },
      },
    });
    const sida = find(entries, "sida");
    expect(sida.status).toBe("error");
    expect(sida.lastError).toBe("목록 행 0개");
    expect(sida.lastSaved).toBe(0);
    // 진행 중 회차에 없는 줄은 완주한 보고서 값 그대로
    expect(find(entries, "bizinfo").status).toBe("connected");
    expect(summary.error).toBe(1);
  });

  it("회차 장부가 손상돼도(perSource 가 배열이 아님) 값을 낸다", () => {
    const { entries } = build({
      ledgerValue: {
        lastReport: { ranAt: "2026-09-05T00:00:00Z", perSource: [{ name: "bizinfo", saved: 3, error: null }] },
        cycle: { perSource: "깨짐" },
      },
    });
    expect(find(entries, "bizinfo").lastSaved).toBe(3);
  });

  it("이번 회차 목록에 없는 출처에는 옛 회차의 오류·건수를 붙이지 않는다", () => {
    // 시험 환경엔 국내 경유 설정이 없어 djsinbo 는 회차 밖 → 명부 자리값 waiting
    const { entries } = build({
      ledgerValue: { lastReport: { ranAt: "2026-09-05T11:58:21Z", perSource: [
        { name: "djsinbo", saved: 0, error: "게시판 추출 전 단계 실패: selector: fetch failed" },
      ] } },
    });
    const dj = find(entries, "djsinbo");
    expect(dj.status).toBe("waiting");
    expect(dj.lastError).toBeNull();
    expect(dj.lastSaved).toBeNull();
    expect(dj.note).toContain("국내 경유");
  });

  it("꼬리 시각은 글자일 때만 싣는다 — 장부가 깨져도 죽지 않는다", () => {
    expect(build({ ledgerValue: { lastTailAt: "2026-09-06T00:00:00Z" } }).summary.lastTailAt)
      .toBe("2026-09-06T00:00:00Z");
    expect(build({ ledgerValue: { lastTailAt: { 깨짐: 1 } } }).summary.lastTailAt).toBeNull();
  });

  it("★쪽수 상한 판정은 회차가 **시작한** 시각으로 잰다 — 재개 시각으로 재면 경고가 사라진다", () => {
    const capRows = [{ key: "board-cap:semas", value: { hitCap: true, lastPageNew: 4, at: "2026-09-05T09:00:00.000Z" } }];
    // 시작 09시 · 마지막 재개 15시. 시작 시각으로 재야 「그 뒤에 다시 안 돌았다」가 유지된다.
    const started = build({
      capRows,
      ledgerValue: { lastReport: { startedAt: "2026-09-05T08:00:00Z", ranAt: "2026-09-05T15:00:00Z", perSource: [] } },
    });
    expect(find(started.entries, "semas").hitCap).toBe(true);
  });
});
