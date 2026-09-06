import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPinnedRow, isSidaDropTitle, parseSidaList, sidaConfig } from "./sida";
import { harvestBoardAttachments } from "../detail-fill";
import { safeAttachmentUrl } from "@/lib/policy-match/attachment-text";
import { parseHtml } from "../html";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-05 실측 1·2쪽
 * (`/notification/notice.html?keyfield_s=&search_word_s=&cpage=1|2&spage=1`).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/sida-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/sida-list-p2.html"), "utf-8");
const rows = parseSidaList(listHtml);
const p2 = parseSidaList(listP2Html);
const combined = [...parseSidaList(listHtml), ...parseSidaList(listP2Html)];

describe("시흥산업진흥원 목록 읽기 — 실사이트 고정본", () => {
  it("★1쪽 고정본에서 DROP·중복을 뺀 17건을 읽고 **모든 행에 등록일이 있다**", () => {
    // 1쪽 20행 = 고정 5 + 일반 15. DROP 3건(사전 공고·신청서·표지모델) → 17건.
    expect(rows).toHaveLength(17);
    // ★날짜 빈 행이 0건이어야 게시판 전체의 날짜 검증(allowUndatedRows 없이)을 켤 수 있다.
    //  예전엔 고정 공지 3건을 빈 값으로 냈고, 그 탓에 검증을 꺼서 「날짜 칸이 밀림」을 못 잡았다.
    expect(rows.filter((r) => r.dateText === "")).toHaveLength(0);
    expect(rows[0]).toMatchObject({
      title: "2026년 DX‧AX 컨설팅 지원사업 모집공고",
      dateText: "2026-07-28 ~", // 고정 공지도 자기 등록일 그대로
      agency: "시흥산업진흥원",
    });
    expect(rows[0].detailUrl).toContain("uid=1135");
    expect(rows[0].detailUrl).toContain("https://www.sida.kr/notification/noticeView.html");
    const normal = rows.find((r) => r.detailUrl.includes("uid=1144"));
    expect(normal).toMatchObject({
      title: "2026 소비재 판촉전 참여기업 모집 공고",
      dateText: "2026-08-28 ~",
      agency: "시흥산업진흥원",
    });
  });

  it("행마다 **자기 칸의** 등록일을 집는다 — 옆 행 날짜가 새지 않는다", () => {
    // 고정 5행 등록일: 2026.07.28·03.06·03.04·03.03·2025.09.10.
    // 03.06·2025.09.10 행은 DROP 이 버리므로 결과에 그 날짜가 있으면 곧 「샜다」는 뜻이다.
    expect(rows.some((r) => r.dateText.includes("2026-03-06"))).toBe(false);
    expect(rows.some((r) => r.dateText.includes("2025-09-10"))).toBe(false);
    // 살아남은 고정 공지 2건은 자기 등록일을 그대로 갖는다(닫기는 저장 규칙 몫).
    const byUid = (uid: string) => rows.find((r) => r.detailUrl.includes(`uid=${uid}`))?.dateText;
    expect(rows.filter((r) => r.dateText === "2026-03-04 ~")).toHaveLength(1);
    expect(rows.filter((r) => r.dateText === "2026-03-03 ~")).toHaveLength(1);
    // 일반 행도 자기 날짜 — 위 고정 공지 날짜가 아래로 흘러내리지 않는다.
    expect(byUid("1144")).toBe("2026-08-28 ~");
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠(uid) 중복이 없고, 2쪽은 20건이다", () => {
    expect(p2).toHaveLength(20);
    const uids = combined.map((r) => r.detailUrl.match(/[?&]uid=(\d+)/)?.[1] ?? r.detailUrl);
    expect(new Set(uids).size).toBe(uids.length);
    expect(combined).toHaveLength(37);
  });

  it("DROP 거르개가 실측 제목을 실제로 버린다", () => {
    const titles = combined.map((r) => r.title);
    expect(titles.some((t) => t.includes("표지모델"))).toBe(false);
    expect(titles.some((t) => t.includes("지원사업 일정 사전 공고"))).toBe(false);
    expect(titles.some((t) => t.endsWith("신청서"))).toBe(false);
    expect(isSidaDropTitle("2026년 상반기 시흥시 산업동향 리포트 표지모델 모집 공고")).toBe(true);
    expect(isSidaDropTitle("2026년 시흥산업진흥원 지원사업 일정 사전 공고")).toBe(true);
    expect(isSidaDropTitle("[안내] 시흥산업진흥원 기업 애로 해결 현장 기동반 신청서")).toBe(true);
  });

  it("「채용」을 통째로 버리지 않는다 — 고용보조금은 제목에 채용을 쓴다", () => {
    expect(isSidaDropTitle("방위산업 중소기업 신규직원 채용 지원사업 참여기업 모집")).toBe(false);
  });

  it("고정 공지 판정기는 살아 있다 — 다만 날짜를 비우는 데 쓰지 않는다", () => {
    const trs = parseHtml(listHtml).querySelectorAll("table.tb_st1 > tbody > tr");
    expect(trs.filter((tr) => isPinnedRow(tr))).toHaveLength(5); // 1쪽 앞 5행이 고정 공지
    expect(trs.filter((tr) => !isPinnedRow(tr))).toHaveLength(15);
  });

  it("등록일은 td:nth-child(4) 칸에서만 집는다 — 행 전체 글자면 번호칸과 붙는다", () => {
    expect(rows.every((r) => /^\d{4}-\d{2}-\d{2} ~$/.test(r.dateText))).toBe(true);
    expect(combined.every((r) => /^\d{4}-\d{2}-\d{2} ~$/.test(r.dateText))).toBe(true);
  });
});

describe("시흥산업진흥원 설정", () => {
  it("쪽넘김은 GET cpage — 2쪽 요청이 1쪽과 다르다", () => {
    expect(sidaConfig.list.url(1)).toContain("cpage=1");
    expect(sidaConfig.list.url(2)).toContain("cpage=2");
    expect(sidaConfig.list.url(2)).toBe(
      "https://www.sida.kr/notification/notice.html?keyfield_s=&search_word_s=&cpage=2&spage=1",
    );
    expect(sidaConfig.list.maxPages).toBe(3);
  });

  it("id·기관·지역·글자표가 실측과 같다", () => {
    expect(sidaConfig.id).toBe("sida");
    expect(sidaConfig.label).toBe("시흥산업진흥원");
    expect(sidaConfig.agency).toBe("시흥산업진흥원");
    expect(sidaConfig.region).toBe("경기");
    expect(sidaConfig.charset).toBe("utf-8");
  });

  it("★날짜 검증을 끄지 않는다 — 끄면 작성일 칸이 밀려 전 행이 빈 날짜가 돼도 통과한다", () => {
    expect(sidaConfig.allowUndatedRows).toBeUndefined();
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(sidaConfig.expectMinRows).toBeGreaterThanOrEqual(2);
  });
});

/**
 * 첨부 수확 — 실사이트 상세 고정본(2026-09-06 `noticeView.html?uid=1144`).
 *
 * 고치기 전 운영 실측: 첨부 있고 본문이 빈 열린 공고 **18건 전부**가 첨부 주소로
 * `http://windows.microsoft.com/ko-kr/internet-explorer/download-ie` 를 들고 있었다.
 * 진짜 첨부는 `onclick="autoRchk('…')"` 안에만 있어 수확기가 못 봤고, 대신 쪽 바닥의
 * 「Internet Explorer Update」가 `/download/i` 에 걸린 것이다.
 */
describe("시흥산업진흥원 첨부 수확 — 실사이트 상세 고정본", () => {
  const detailHtml = readFileSync(join(__dirname, "../__fixtures__/sida-detail.html"), "utf-8");
  const scoped = parseHtml(detailHtml)
    .querySelectorAll(sidaConfig.attachmentsScopeSelector!)
    .map((el) => el.outerHTML)
    .join("\n");

  it("onclick=autoRchk('…') 안의 진짜 첨부 2건을 집는다", () => {
    const atts = harvestBoardAttachments(scoped, sidaConfig.baseUrl, detailHtml, sidaConfig.charset);
    expect(atts).toHaveLength(2);
    // 실호출 200 / `content-disposition: attachment` / HWP 904,704바이트(OLE d0cf11e0) — 열쇠 붙였을 때.
    expect(atts[0].url).toContain("https://www.sida.kr/config/download_home.php?filename=GoV20260901143459.hwp");
    expect(atts[0].name).toBe("2026년 소비재 판촉전(시흥 월곶포구 축제 연계) 참여기업 모집공고.hwp");
    expect(atts[0].kind).toBe("hwp");
    expect(atts[1].url).toContain("filename=O3o20260828144111.jpg");
    for (const a of atts) expect(safeAttachmentUrl(a.url)).not.toBeNull();
  });

  it("★마이크로소프트 안내 링크가 첨부로 안 들어간다 — 범위를 안 좁히면 들어간다", () => {
    const atts = harvestBoardAttachments(scoped, sidaConfig.baseUrl, detailHtml, sidaConfig.charset);
    expect(atts.filter((a) => a.url.includes("windows.microsoft.com"))).toHaveLength(0);
    // 범위 제한이 실제로 일하는지 — 쪽 전체를 주면 그 링크가 섞여 들어온다(허용 호스트 밖 = 첨부 0건 효과).
    const whole = harvestBoardAttachments(detailHtml, sidaConfig.baseUrl, detailHtml, sidaConfig.charset);
    expect(whole.some((a) => a.url.includes("windows.microsoft.com"))).toBe(true);
  });

  it("첨부 상자 선택자가 바뀌면 0건이 된다 — 서식 변경을 조용히 넘기지 않는다", () => {
    const broken = parseHtml(detailHtml.replaceAll('class="dl_st1"', 'class="dl_st1-x"'))
      .querySelectorAll(sidaConfig.attachmentsScopeSelector!)
      .map((el) => el.outerHTML)
      .join("\n");
    expect(broken).toBe("");
  });

  it("autoRchk 갈래는 같은 사이트 안의 내려받기꼴 경로만 받는다", () => {
    const html =
      `<a href="#void" onclick="autoRchk('https://evil.example/config/download_home.php?f=1')">공고문.hwp</a>` +
      `<a href="#void" onclick="autoRchk('/notification/notice.html?cpage=1')">목록</a>` +
      `<a href="#void" onclick="autoRchk('/config/download_home.php?filename=ok.hwp')">진짜.hwp</a>`;
    const out = harvestBoardAttachments(html, sidaConfig.baseUrl, html, sidaConfig.charset);
    expect(out.map((a) => a.url)).toEqual(["https://www.sida.kr/config/download_home.php?filename=ok.hwp"]);
  });
});
