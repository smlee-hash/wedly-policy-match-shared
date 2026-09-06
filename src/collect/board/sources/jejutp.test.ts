import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isJejutpDropTitle, jejutpConfig, parseJejutpList } from "./jejutp";

/**
 * ★손으로 쓴 JSON 대신 **실사이트 고정본**으로 잰다(ccei 와 같은 방식).
 * 손으로 지어낸 고정본은 칸 이름 오타를 그대로 통과시킨다.
 *
 * 고정본(2026-09-03 실측 원문):
 * · `jejutp-list.json`    = GET `/board/business/list?keyword=&page=0&size=30&businessDiv=`
 * · `jejutp-list-p2.json` = 같은 주소 `page=1`
 * · `jejutp-detail.json`  = GET `/board/business/detail/json/1cc3758db5e042d0a86aee8e4683a338`
 */
const p1 = readFileSync(join(__dirname, "../__fixtures__/jejutp-list.json"), "utf-8");
const p2 = readFileSync(join(__dirname, "../__fixtures__/jejutp-list-p2.json"), "utf-8");
const detailJson = readFileSync(join(__dirname, "../__fixtures__/jejutp-detail.json"), "utf-8");
const rows = parseJejutpList(p1);

describe("제주테크노파크 사업공고 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 30건에서 지원사업 아닌 2건을 뺀 28건을 읽고 첫 행이 정확하다", () => {
    expect(rows).toHaveLength(28);
    expect(rows[0]).toMatchObject({
      title: "2026년 ICT 중소기업 정보보호 지원 사업 수요기업 모집 공고",
      detailUrl: "https://www.jejutp.or.kr/board/business/detail/1cc3758db5e042d0a86aee8e4683a338",
      dateText: "2026-06-26 ~ 2026-11-30",
      category: "기타",
    });
  });

  it("★접수시작일·접수종료일을 **둘 다** 싣는다 — 여기서 잃으면 못 되찾는다", () => {
    // 30건 전부 「시작 ~ 끝」 꼴이어야 한다. 하나라도 「시작 ~」면 receiptEDate 를 놓친 것.
    const bad = rows.filter((r) => !/^20\d{2}-\d{2}-\d{2} ~ 20\d{2}-\d{2}-\d{2}$/.test(r.dateText));
    expect(bad.map((r) => `${r.title}=${r.dateText}`)).toEqual([]);
  });

  it("★제목 엔티티가 **두 겹**으로 싸여 온다 — 한 번만 풀면 「&middot;」 가 글자로 남는다", () => {
    // 원문 응답: 「…컨설팅&amp;middot;테스팅…」 (사이트 JS 도 htmlDecode 로 다시 푼다)
    expect(p1).toContain("&amp;middot;");
    const q = rows.find((r) => r.title.includes("디지털 품질관리"))!;
    expect(q.title).toBe("「제주지역 디지털 품질관리 역량강화」 디지털 품질 컨설팅·테스팅 지원 모집 공고");
    expect(q.title).not.toContain("&");

    const p2rows = parseJejutpList(p2);
    // 「스케일업&amp;amp;IPO」 → 「스케일업&IPO」 (세 겹째는 없다 — 더 풀어도 그대로)
    expect(p2rows.find((r) => r.title.includes("상장기업 육성"))!.title)
      .toBe("2026년 상장기업 육성 지원사업 스케일업&IPO프로그램 2차 모집공고");
    // 분류 칸도 같은 병을 앓는다: 「R&amp;amp;D」 → 「R&D」
    const rnd = p2rows.find((r) => r.title.includes("수요기반 R&D과제"))!;
    expect(rnd.title).toBe("2026년 수요기반 R&D과제 기획 지원사업");
    expect(rnd.category).toBe("R&D");
  });

  it("★지원사업이 아닌 글만 좁게 버린다 — 「평가용」·「용역」·「위탁정산기관」·「운영기관 모집」", () => {
    const all = [...rows, ...parseJejutpList(p2)].map((r) => r.title);
    expect(all).not.toContain("2026년 기술닥터 평가용 공고");
    expect(all).not.toContain("데이터기반 스마트제조 및 실증 솔루션 개발 용역");
    expect(all).not.toContain("2026년 제주지역기업 성장사다리 지원사업 위탁정산기관 모집공고");
    expect(all).not.toContain("「2026년 제주 리빙랩 운영 대행사업」 운영기관 모집 공고");
    expect(all.some((t) => t.includes("평가용"))).toBe(false);
  });

  it("★「채용」을 통째로 버리지 않는다 — 버리면 「채용 지원사업」이 같이 죽는다(bizbc 주석)", () => {
    expect(isJejutpDropTitle("2026년 제주 청년 채용 지원사업 참여기업 모집")).toBe(false);
    expect(isJejutpDropTitle("2026년 신입직원 채용 공고")).toBe(true);
    // 「용역」은 제목 끝(발주 공고)일 때만 버린다 — 사업 이름 가운데 낀 것은 살린다.
    expect(isJejutpDropTitle("컨설팅 용역 지원사업 참여기업 모집")).toBe(false);
    expect(isJejutpDropTitle("데이터기반 스마트제조 및 실증 솔루션 개발 용역")).toBe(true);
  });

  it("★상세 주소에 쪽 번호·분류·검색어를 붙이지 않는다 — 주소가 곧 중복 판정 열쇠(sourceId)", () => {
    // 사이트 링크는 `?cate=&pageNumber=0&keyword=` 를 달고 다닌다. 그대로 쓰면 같은 공고가
    // 쪽마다·분류 탭마다 다른 줄로 저장된다.
    for (const r of [...rows, ...parseJejutpList(p2)]) {
      expect(r.detailUrl).toMatch(/^https:\/\/www\.jejutp\.or\.kr\/board\/business\/detail\/[0-9a-f]{32}$/);
    }
  });

  it("1쪽과 2쪽을 합쳐도 중복이 없다 — page 인자가 안 먹으면 여기서 걸린다", () => {
    const all = [...rows, ...parseJejutpList(p2)];
    expect(all).toHaveLength(55);
    expect(new Set(all.map((r) => r.detailUrl)).size).toBe(55);
  });

  it("annoId 나 제목이 없는 줄은 버린다", () => {
    const j = JSON.stringify({ content: [{ annoId: "a".repeat(32) }, { annoName: "제목만 있는 줄" }] });
    expect(parseJejutpList(j)).toEqual([]);
  });

  it("같은 annoId 가 한 응답에 두 번 오면 한 줄만 남긴다", () => {
    const one = JSON.parse(p1) as { content: unknown[] };
    one.content = [one.content[0], one.content[0]];
    expect(parseJejutpList(JSON.stringify(one))).toHaveLength(1);
  });

  it("JSON 이 아니거나 모양이 다르면 빈 배열 — 수집이 통째로 죽지 않는다", () => {
    expect(parseJejutpList("<html>415 Unsupported Media Type</html>")).toEqual([]);
    expect(parseJejutpList("")).toEqual([]);
    expect(parseJejutpList(JSON.stringify({ content: null }))).toEqual([]);
  });
});

describe("제주테크노파크 설정", () => {
  it("★쪽 번호는 0부터다 — 1부터 보내면 1쪽을 통째로 건너뛴다", () => {
    expect(jejutpConfig.list.url(1)).toBe("https://www.jejutp.or.kr/board/business/list?keyword=&page=0&size=30&businessDiv=");
    expect(jejutpConfig.list.url(2)).toContain("page=1");
  });

  it("★목록 GET 에 Content-Type: application/json 을 붙인다 — 없으면 서버가 415(본문 0바이트)", () => {
    const init = jejutpConfig.list.init!(1);
    expect(init.method).toBe("GET");
    expect(init.headers?.["Content-Type"]).toBe("application/json");
  });

  it("쪽수 상한은 얕은 쪽(7)에 둔다 — 그 위로 올리려면 deep-paging 허용 목록에 먼저 올려야 한다", () => {
    expect(jejutpConfig.list.maxPages).toBeLessThanOrEqual(7);
    // 한 쪽 30건의 절반. 이보다 적으면 응답 서식이 바뀐 것으로 본다.
    expect(jejutpConfig.expectMinRows).toBe(15);
  });

  it("상세 주소 호스트가 baseUrl 과 같아 허용 호스트 검사를 통과한다", () => {
    expect(new URL(rows[0].detailUrl).host).toBe(new URL(jejutpConfig.baseUrl).host);
  });

  it("★첨부 호스트(jeis.or.kr)를 허용 목록에 올린다 — 안 올리면 공고문 PDF 를 못 내려받는다", () => {
    expect(jejutpConfig.allowedHosts).toContain("jeis.or.kr");
  });

  it("★detailContentSelector 를 **일부러 안 적는다** — 상세가 Vue 껍데기라 선택자로는 아무것도 못 읽는다", () => {
    expect(jejutpConfig.detailContentSelector).toBeUndefined();
    expect(jejutpConfig.attachmentsScopeSelector).toBeUndefined();
    expect(jejutpConfig.skipDetailFill).toBeUndefined();
  });
});

describe("상세 — JSON 통로에서 첨부만 건져 온다", () => {
  const detailUrl = "https://www.jejutp.or.kr/board/business/detail/1cc3758db5e042d0a86aee8e4683a338";

  it("상세 JSON 통로를 부르고 목록과 같은 Content-Type 헤더를 붙인다(없으면 415)", async () => {
    const calls: Array<{ url: string; init?: { method: "GET" | "POST"; headers?: Record<string, string> } }> = [];
    await jejutpConfig.detailFetch!(detailUrl, async (url, init) => {
      calls.push({ url, init });
      return detailJson;
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://www.jejutp.or.kr/board/business/detail/json/1cc3758db5e042d0a86aee8e4683a338");
    expect(calls[0].init?.headers?.["Content-Type"]).toBe("application/json");
  });

  it("★돌려주는 조각에 **글자가 없다** — 채우면 첨부 공고문을 영영 못 읽는다", async () => {
    const html = await jejutpConfig.detailFetch!(detailUrl, async () => detailJson);
    const { parseHtml } = await import("../html");
    // 상세 본문(annoContents)은 엔티티를 다 풀어도 40자짜리 표지문 한 줄뿐이다(실측).
    // 그것을 targetText 에 넣으면 뒷단계의 「첨부에서 본문 뽑기」가 targetText === "" 조건에서
    // 이 공고를 영영 건너뛴다.
    expect(parseHtml(html).text.trim()).toBe("");
    expect(html).not.toContain("모집 방법");
  });

  it("첨부 2건을 jeis.or.kr 내려받기 주소로 건져 오고 형식이 pdf 로 잡힌다", async () => {
    const html = await jejutpConfig.detailFetch!(detailUrl, async () => detailJson);
    const { harvestBoardAttachments } = await import("../detail-fill");
    const atts = harvestBoardAttachments(html, jejutpConfig.baseUrl);
    expect(atts).toHaveLength(2);
    expect(atts.every((a) => new URL(a.url).host === "jeis.or.kr")).toBe(true);
    expect(atts.every((a) => a.kind === "pdf")).toBe(true);
    expect(atts[0].url).toContain("fileId=fa016a3bf236436db3d2a8a118b83d2e");
    // 주소는 &amp; 가 아니라 진짜 & 로 이어져야 서버가 알아듣는다.
    expect(atts[0].url).not.toContain("&amp;");
  });

  it("상세 주소가 공고 열쇠 모양이 아니거나 응답이 깨졌으면 빈 문자열 — 수집이 안 죽는다", async () => {
    expect(await jejutpConfig.detailFetch!("https://www.jejutp.or.kr/board/business", async () => detailJson)).toBe("");
    expect(await jejutpConfig.detailFetch!(detailUrl, async () => "<html>415</html>")).toBe("");
    expect(await jejutpConfig.detailFetch!(detailUrl, async () => JSON.stringify({ anno: { fileList: [] } }))).toBe("");
  });

  it("파일 이름이 없는 첨부는 담지 않는다 — 확장자를 지어내면 형식 판정이 거짓말을 한다", async () => {
    const noName = JSON.stringify({ anno: { fileList: [{ fileId: "a".repeat(32), realFileName: "" }] } });
    expect(await jejutpConfig.detailFetch!(detailUrl, async () => noName)).toBe("");
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 이걸 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 * 칸 이름·낱말을 바꾼 응답을 넣었을 때 결과가 실제로 달라지는지 확인한다.
 */
describe("망가뜨려 보기", () => {
  it("행 담는 칸 이름(content)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseJejutpList(p1.replace('{"content":', '{"contentX":'))).toHaveLength(0);
  });

  it("제목 칸 이름(annoName)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseJejutpList(p1.replaceAll('"annoName"', '"annoNameX"'))).toHaveLength(0);
  });

  it("열쇠 칸 이름(annoId)이 바뀌면 한 줄도 못 읽는다 — 상세 주소를 지어내지 않는다", () => {
    expect(parseJejutpList(p1.replaceAll('"annoId"', '"annoIdX"'))).toHaveLength(0);
  });

  it("마감일 칸(receiptEDate)이 사라지면 「시작 ~」 개시형으로 떨어진다(마감을 지어내지 않는다)", () => {
    const broken = parseJejutpList(p1.replaceAll('"receiptEDate"', '"receiptEDateX"'));
    expect(broken).toHaveLength(28);
    expect(broken[0].dateText).toBe("2026-06-26 ~");
  });

  it("★「평가용」 낱말을 지운 고정본에서는 그 행이 되살아난다 — 판정기가 실제로 그 낱말을 본다는 증거", () => {
    const patched = p1.replaceAll("평가용", "본사업");
    expect(parseJejutpList(patched)).toHaveLength(29);
  });

  it("엔티티 푸는 단계를 지나쳤다면 잡힌다 — 원문에 두 겹 엔티티가 실제로 들어 있다", () => {
    expect(p2).toContain("R&amp;amp;D");
    expect(parseJejutpList(p2).some((r) => r.title.includes("&amp;"))).toBe(false);
  });

  it("첨부 칸 이름(fileList)이 바뀌면 첨부 0건 → 빈 조각을 돌려준다", async () => {
    const broken = detailJson.replaceAll('"fileList"', '"fileListX"');
    expect(await jejutpConfig.detailFetch!(
      "https://www.jejutp.or.kr/board/business/detail/1cc3758db5e042d0a86aee8e4683a338",
      async () => broken,
    )).toBe("");
  });
});
