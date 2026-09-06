import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../html";
import { pagingParamsOf } from "../engine";
import { cbtpConfig, isCbtpDropTitle, parseCbtpList } from "./cbtp";
import { harvestBoardAttachments } from "../detail-fill";
import { safeAttachmentUrl } from "../../attachment-text";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-03 실측 사업공고 1·2쪽
 * (`board_id=saup_notice` · `page=1&offset=1` · `page=2&offset=16`).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/cbtp-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/cbtp-list-p2.html"), "utf-8");
const NOW = Date.parse("2026-09-03T00:00:00Z");
const rows = parseCbtpList(listHtml, 1, NOW);
const rowsP2 = parseCbtpList(listP2Html, 2, NOW);
const combined = parseCbtpList(listHtml + listP2Html, 1, NOW);

describe("충북테크노파크 사업공고 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 15건을 읽고 첫 행이 맞다", () => {
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeLessThanOrEqual(15);
    expect(rows).toHaveLength(15);
    expect(rows[0]).toMatchObject({
      title: "2026년 과학기술분야 R&D 대체인력 활용 지원사업 4차 모집 공고",
      detailUrl: "https://www.cbtp.or.kr/index.php?control=bbs&board_id=saup_notice&mode=view&no=307&lm_uid=387",
      dateText: "2026-09-01 ~ 2026-10-13",
      agency: "충북테크노파크",
    });
  });

  it("★상세 주소에 page·offset 을 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄이 된다", () => {
    expect(rows.every((r) => !r.detailUrl.includes("page="))).toBe(true);
    expect(rows.every((r) => !r.detailUrl.includes("offset="))).toBe(true);
    expect(rowsP2.every((r) => !r.detailUrl.includes("page="))).toBe(true);
    expect(rowsP2.every((r) => !r.detailUrl.includes("offset="))).toBe(true);
    expect(
      [...rows, ...rowsP2].every((r) =>
        /^https:\/\/www\.cbtp\.or\.kr\/index\.php\?control=bbs&board_id=saup_notice&mode=view&no=[A-Za-z0-9_]+&lm_uid=387$/.test(
          r.detailUrl,
        ),
      ),
    ).toBe(true);
  });

  it("글번호는 숫자형과 contact_ 접두가 섞인다", () => {
    expect(rows.some((r) => r.detailUrl.includes("no=307&"))).toBe(true);
    expect(rows.some((r) => r.detailUrl.includes("no=contact_2590&"))).toBe(true);
  });

  it("접수기간은 시작 ~ 끝 두 날짜다", () => {
    expect(rows.every((r) => r.dateText !== "")).toBe(true);
    for (const row of [...rows, ...rowsP2]) {
      expect(row.dateText).toMatch(/^20\d{2}-\d{2}-\d{2} ~ 20\d{2}-\d{2}-\d{2}$/);
    }
  });

  it("날짜는 마지막 td 칸에서만 집는다 — 행 전체 글자면 번호와 붙는다", () => {
    const r = rows.find((x) => x.detailUrl.includes("no=307&"));
    expect(r?.dateText).toBe("2026-09-01 ~ 2026-10-13");
    expect(r?.dateText).not.toMatch(/1663|공지/);
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없고 30건이다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(30);
    expect(rowsP2).toHaveLength(15);
    expect(rows.map((r) => r.detailUrl)).not.toEqual(rowsP2.map((r) => r.detailUrl));
  });

  it("2쪽 첫 행이 1쪽과 다르고 쪽 번호가 주소에 없다", () => {
    expect(rowsP2.length).toBeGreaterThanOrEqual(2);
    expect(rowsP2.length).toBeLessThanOrEqual(15);
    expect(rowsP2[0]).toMatchObject({
      title: "2026년 글로벌 플랫폼 연계 사업화 기술지원 수혜기업 모집공고",
      detailUrl:
        "https://www.cbtp.or.kr/index.php?control=bbs&board_id=saup_notice&mode=view&no=contact_2577&lm_uid=387",
      dateText: "2026-07-30 ~ 2026-08-14",
    });
    expect(rowsP2[0].detailUrl).not.toBe(rows[0].detailUrl);
  });
});

describe("거르개 — 버릴 것만 지정한다", () => {
  it("DROP 거르개가 심은 제목을 실제로 버린다", () => {
    const dropped = parseCbtpList(
      listHtml.replace(
        /2026년 과학기술분야 R&D 대체인력 활용 지원사업 4차 모집 공고/g,
        "2026년 평가위원 모집",
      ),
      1,
      NOW,
    );
    expect(dropped.some((r) => r.title.includes("평가위원"))).toBe(false);
    expect(dropped).toHaveLength(14);
    expect(isCbtpDropTitle("2026년 평가위원 모집")).toBe(true);
    expect(isCbtpDropTitle("입찰 공고")).toBe(true);
    expect(isCbtpDropTitle("만족도 설문조사 안내")).toBe(true);
    expect(isCbtpDropTitle("합격자 발표")).toBe(true);
    expect(isCbtpDropTitle("직원 채용 공고")).toBe(true);
  });

  it("「채용」을 통째로 버리지 않는다 — 채용 지원사업이 죽으면 안 된다", () => {
    expect(isCbtpDropTitle("충북 중소기업 채용 지원사업 모집 공고")).toBe(false);
    expect(
      parseCbtpList(
        listHtml.replace(
          /2026년 과학기술분야 R&D 대체인력 활용 지원사업 4차 모집 공고/g,
          "2026년 방위산업 중소기업 신규직원 채용 지원사업 참여기업 모집공고",
        ),
        1,
        NOW,
      ).some((r) => r.title.includes("채용 지원사업")),
    ).toBe(true);
  });
});

describe("붙박이 공지 — 1년 넘은 것은 담지 않는다", () => {
  it("번호 칸 공지 아이콘 줄이 1년을 넘으면 아예 안 담는다", () => {
    const old = parseCbtpList(listHtml, 1, Date.parse("2030-01-01T00:00:00Z"));
    expect(old).toHaveLength(6);
    expect(old.some((r) => r.detailUrl.includes("no=307&"))).toBe(false);
    expect(old.some((r) => r.detailUrl.includes("no=contact_2581&"))).toBe(true);
    const fresh = parseCbtpList(listHtml, 1, NOW);
    expect(fresh.some((r) => r.detailUrl.includes("no=307&"))).toBe(true);
    expect(fresh).toHaveLength(15);
  });
});

describe("충북테크노파크 설정", () => {
  it("쪽넘김은 GET page + offset 15건씩", () => {
    expect(cbtpConfig.list.url(1)).toContain("page=1");
    expect(cbtpConfig.list.url(1)).toContain("offset=1");
    expect(cbtpConfig.list.url(2)).toContain("page=2");
    expect(cbtpConfig.list.url(2)).toContain("offset=16");
    expect(cbtpConfig.list.url(1)).not.toBe(cbtpConfig.list.url(2));
    expect(pagingParamsOf(cbtpConfig)).toEqual(expect.arrayContaining(["page", "offset"]));
    expect(cbtpConfig.list.maxPages).toBe(10);
  });

  it("지역은 충북", () => {
    expect(cbtpConfig.region).toBe("충북");
    expect(cbtpConfig.id).toBe("cbtp");
    expect(cbtpConfig.agency).toBe("충북테크노파크");
    expect(cbtpConfig.label).toBe("충북테크노파크");
    expect(cbtpConfig.charset).toBe("euc-kr");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(cbtpConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(cbtpConfig.expectMinRows).toBe(7);
  });

  it("★본문 선택자를 비운다 — 상세 substance 는 이미지·하이픈뿐이라 채우면 첨부 공고문을 건너뛴다", () => {
    expect(cbtpConfig.detailContentSelector).toBeUndefined();
    expect(cbtpConfig.attachmentsScopeSelector).toBe("table.bbs_view ul.attach");
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 * 행 선택자를 틀리게 준 고정본을 넣었을 때 0행이어야 선택자가 실제로 그 칸을 본다는 증거다.
 */
describe("망가뜨려 보기", () => {
  it("행 선택자가 한 글자 틀리면 0행이다", () => {
    const broken = cbtpConfig.list.rowSelector.replace("bbs_default_list", "bbs_default_list-x");
    expect(parseHtml(listHtml).querySelectorAll(broken)).toHaveLength(0);
    expect(parseCbtpList(listHtml.replaceAll("bbs_default_list", "bbs_default_list-x"), 1, NOW)).toHaveLength(
      0,
    );
  });

  it("제목 칸(td.subject)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseCbtpList(listHtml.replaceAll('class="subject"', 'class="subject-x"'), 1, NOW)).toHaveLength(
      0,
    );
  });

  it("접수기간 칸이 비면 날짜를 비운다(오늘 날짜를 지어내지 않는다)", () => {
    const blanked = listHtml.replaceAll(/20\d{2}-\d{2}-\d{2}/g, "");
    const parsed = parseCbtpList(blanked, 1, NOW);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed.every((r) => r.dateText === "")).toBe(true);
  });
});

/**
 * 첨부 수확 — 실사이트 상세 고정본(2026-09-06 `no=307`, euc-kr 원문을 그대로 디코딩한 것).
 *
 * 이 게시판의 첨부 href 는 파일 이름을 **날 한글**로 들고 있다. 표준대로 UTF-8 로 인코딩하면
 * 200 + `text/html` 452바이트(「요청하신 파일이 존재하지 않습니다」)가 오고, euc-kr 로 인코딩해야
 * 200 + `attachment` + PDF 799,373바이트(`%PDF-1.6`)가 온다(2026-09-06 curl 실측).
 */
describe("충북테크노파크 첨부 수확 — 파일 이름 euc-kr 인코딩", () => {
  const detailHtml = readFileSync(join(__dirname, "../__fixtures__/cbtp-detail.html"), "utf-8");
  const scoped = parseHtml(detailHtml)
    .querySelectorAll(cbtpConfig.attachmentsScopeSelector!)
    .map((el) => el.outerHTML)
    .join("\n");

  it("첨부 2건의 주소가 euc-kr 퍼센트 표기다 — 이 주소 그대로 실호출 200 + PDF 799,373바이트", () => {
    const atts = harvestBoardAttachments(scoped, cbtpConfig.baseUrl, detailHtml, cbtpConfig.charset);
    expect(atts).toHaveLength(2);
    expect(atts[0].url).toBe(
      "https://www.cbtp.or.kr/index.php?control=util&task=down&board_id=saup_notice&action=down&where=dat&dtype=up&no=307" +
        "&file=%BA%D9%C0%D31.%202026%B3%E2%20%B0%FA%C7%D0%B1%E2%BC%FA%BA%D0%BE%DF%20%B4%EB%C3%BC%C0%CE%B7%C2%20" +
        "%C8%B0%BF%EB%20%C1%F6%BF%F8%BB%E7%BE%F7%204%C2%F7%20%B8%F0%C1%FD%20%B0%F8%B0%ED%B9%AE.pdf",
    );
    expect(atts[0].name).toBe("붙임1. 2026년 과학기술분야 대체인력 활용 지원사업 4차 모집 공고문.pdf");
    expect(atts[1].url).toContain("&file=%BA%D9%C0%D32.%20%BB%E7%BE%F7%20%BD%C5%C3%BB%BC%AD.zip");
    for (const a of atts) expect(safeAttachmentUrl(a.url)).not.toBeNull();
  });

  it("★글자표를 안 넘기면 옛 UTF-8 주소가 된다 — 그 주소는 200 인데 452바이트짜리 안내 화면이었다", () => {
    const atts = harvestBoardAttachments(scoped, cbtpConfig.baseUrl, detailHtml);
    expect(atts[0].url).toContain("%EB%B6%99%EC%9E%84");
    expect(atts[0].url).not.toContain("%BA%D9%C0%D3");
  });

  it("게시판 글자표가 euc-kr 이다 — 목록 읽기뿐 아니라 첨부 주소도 이 값을 본다", () => {
    expect(cbtpConfig.charset).toBe("euc-kr");
  });
});
