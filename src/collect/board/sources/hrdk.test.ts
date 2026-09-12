import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeBody } from "../html";
import { pagingParamsOf } from "../engine";
import { hrdkConfig, hrdkDetailAttachments, isHrdkDropTitle, parseHrdkList, parseJavaDate } from "./hrdk";
import { safeAttachmentUrl } from "../../attachment-text";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다(창원 사고 — 지어낸 HTML 은 선택자 오타를 통과시킨다).
 * 고정본: 2026-09-06 실측 공지사항 1쪽(`/3/1/1`)·상세(`?k=56065`).
 * ★고정본은 **euc-kr 원본 바이트 그대로** 저장했다 — UTF-8 로 읽으면 제목이 깨지는 것까지 재려면
 *  디코딩을 시험이 직접 지나가야 한다(그래서 `readFileSync(.., "utf-8")` 이 아니라 바이트를 읽는다).
 */
const FIX = join(__dirname, "../__fixtures__");
const listBytes = readFileSync(join(FIX, "hrdk-list.html"));
const detailBytes = readFileSync(join(FIX, "hrdk-detail.html"));
const listHtml = decodeBody(listBytes, "euc-kr");
const detailHtml = decodeBody(detailBytes, "euc-kr");
const rows = parseHrdkList(listHtml);

describe("한국산업인력공단 공지사항 — 실사이트 고정본", () => {
  it("★고정본은 euc-kr 바이트다 — UTF-8 로 읽으면 한글이 깨진다", () => {
    expect(listBytes.includes(Buffer.from("공지사항", "utf-8"))).toBe(false);
    expect(listBytes.includes(Buffer.from("공지사항", "latin1"))).toBe(false);
    expect(decodeBody(listBytes, "utf-8")).not.toContain("대한민국산업현장교수");
    expect(listHtml).toContain("대한민국산업현장교수");
    expect(hrdkConfig.charset).toBe("euc-kr");
  });

  it("1쪽 고정본에서 거르개 뒤 5건을 읽고 첫 행이 맞다", () => {
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({
      title: "대한민국산업현장교수 18기 신규모집 관련 안내",
      detailUrl: "https://www.hrdkorea.or.kr/3/1/1?k=56099",
      dateText: "2026-09-02 ~",
      agency: "한국산업인력공단",
    });
  });

  it("★상세 주소에 쪽 변수를 남기지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄이 된다", () => {
    expect(
      rows.every((r) => /^https:\/\/www\.hrdkorea\.or\.kr\/3\/1\/1\?k=\d+$/.test(r.detailUrl)),
    ).toBe(true);
    expect(rows.every((r) => !r.detailUrl.includes("pageNo"))).toBe(true);
    expect(rows.every((r) => !r.detailUrl.includes("searchText"))).toBe(true);
  });

  it("고정 공지가 아래 일반 행과 같은 글이면 한 줄로 접힌다(k 중복 제거)", () => {
    const ks = rows.map((r) => r.detailUrl);
    expect(new Set(ks).size).toBe(ks.length);
    // 고정 공지(k=56078 카드뉴스)는 거르개에도 걸린다 — 두 방어가 겹쳐 있다.
    expect(rows.some((r) => r.detailUrl.includes("k=56078"))).toBe(false);
  });

  it("날짜는 세 번째 td 칸에서만 집는다 — 행 전체 글자면 번호와 붙는다", () => {
    expect(rows.every((r) => /^20\d{2}-\d{2}-\d{2} ~$/.test(r.dateText))).toBe(true);
    expect(rows.every((r) => !/^\d{3}20/.test(r.dateText))).toBe(true);
  });

  it("날짜 칸을 프록시 ISO 로 바꿔도 같은 행이 나온다", () => {
    const isoHtml = listHtml
      .replaceAll("Wed Sep 02 15:17:41 KST 2026", "2026-09-02")
      .replaceAll("Mon Aug 31 18:43:29 KST 2026", "2026-08-31")
      .replaceAll("Fri Aug 28 10:00:59 KST 2026", "2026-08-28")
      .replaceAll("Fri Aug 21 17:56:41 KST 2026", "2026-08-21")
      .replaceAll("Fri Aug 21 10:01:15 KST 2026", "2026-08-21")
      .replaceAll("Fri Jul 31 13:49:44 KST 2026", "2026-07-31")
      .replaceAll("Thu Jul 30 14:15:48 KST 2026", "2026-07-30")
      .replaceAll("Thu Jul 23 18:01:36 KST 2026", "2026-07-23")
      .replaceAll("Tue Jul 14 10:11:38 KST 2026", "2026-07-14")
      .replaceAll("Mon Jul 13 15:01:08 KST 2026", "2026-07-13");
    expect(isoHtml).toContain(">2026-09-02<");
    expect(isoHtml).not.toMatch(/KST 20\d{2}/);
    expect(parseHrdkList(isoHtml)).toEqual(rows);
  });

  it("쪽 주소는 pageNo 로 넘어간다", () => {
    expect(hrdkConfig.list.url(1)).toBe("https://www.hrdkorea.or.kr/3/1/1?pageNo=1");
    expect(hrdkConfig.list.url(3)).toBe("https://www.hrdkorea.or.kr/3/1/1?pageNo=3");
    expect(pagingParamsOf(hrdkConfig)).toContain("pageNo");
  });
});

/** 목록 날짜는 `parseJavaDate` 가 집는다 — 자바 `Date.toString()` 과 프록시 ISO 를 같이 잰다. */
describe("자바 날짜(`Wed Sep 02 15:17:41 KST 2026`)·ISO(`2026-09-02`) 읽기", () => {
  it("달 이름을 숫자로 바꿔 ISO 로 낸다", () => {
    expect(parseJavaDate("Wed Sep 02 15:17:41 KST 2026")).toBe("2026-09-02");
    expect(parseJavaDate("Fri Aug 28 10:00:59 KST 2026")).toBe("2026-08-28");
    expect(parseJavaDate("Mon Jul 13 15:01:08 KST 2026")).toBe("2026-07-13");
    expect(parseJavaDate("Thu Jan 1 09:00:00 KST 2026")).toBe("2026-01-01");
    expect(parseJavaDate("Wed Sep 02 00:00:00 KST 2026")).toBe("2026-09-02");
    expect(parseJavaDate("Wed Sep 02 23:59:59 KST 2026")).toBe("2026-09-02");
  });

  it("프록시 ISO 날짜도 같은 YYYY-MM-DD 로 낸다 — 앞뒤 공백은 자른다", () => {
    expect(parseJavaDate("2026-09-02")).toBe("2026-09-02");
    expect(parseJavaDate("  2026-09-02  ")).toBe("2026-09-02");
    expect(parseJavaDate("  Wed Sep 02 15:17:41 KST 2026  ")).toBe("2026-09-02");
  });

  it("윤년 2월 29일은 허용하고 평년·없는 날은 빈 문자열이다 — 지어내지 않는다", () => {
    expect(parseJavaDate("2024-02-29")).toBe("2024-02-29");
    expect(parseJavaDate("Thu Feb 29 00:00:00 KST 2024")).toBe("2024-02-29");
    expect(parseJavaDate("2026-02-29")).toBe("");
    expect(parseJavaDate("Sun Feb 29 00:00:00 KST 2026")).toBe("");
    expect(parseJavaDate("2026-02-30")).toBe("");
    expect(parseJavaDate("2026-09-31")).toBe("");
    expect(parseJavaDate("Wed Sep 31 15:17:41 KST 2026")).toBe("");
    expect(parseJavaDate("2026-04-31")).toBe("");
    expect(parseJavaDate("2026-13-01")).toBe("");
    expect(parseJavaDate("2026-00-10")).toBe("");
  });

  it("모르는 서식·달 이름은 빈 문자열이다 — 지어내지 않는다", () => {
    expect(parseJavaDate("Wed Foo 02 15:17:41 KST 2026")).toBe("");
    expect(parseJavaDate("")).toBe("");
  });
});

describe("제목 거르개 — 버릴 것만 지정한다", () => {
  it("기관 행정·개인 대상 글은 버린다", () => {
    expect(isHrdkDropTitle("공공데이터 홍보 카드뉴스")).toBe(true);
    expect(isHrdkDropTitle("2026년도 공공기관 종합청렴도 평가 관련 개인정보 제3자 제공사항 알림")).toBe(true);
    expect(isHrdkDropTitle("2026 울산 지역사회 문제 해결을 위한 아이디어 공모전 공고")).toBe(true);
    expect(isHrdkDropTitle("2026년 대한민국명장 등 우수 숙련기술인 및 기특한명장(2기) 선정자 발표")).toBe(true);
    expect(isHrdkDropTitle("2026년 신규 직원 채용 공고")).toBe(true);
  });

  it("기업 대상 지원사업은 남긴다 — 「채용」이 든 제목도 통과한다", () => {
    expect(isHrdkDropTitle("2026년도 중소기업 인재 키움 프리미엄 훈련 지원과정 풀(Pool) 최신화 안내")).toBe(false);
    expect(isHrdkDropTitle("2026년 채용문화 우수기업 어워즈 참가기업 모집 안내")).toBe(false);
    expect(isHrdkDropTitle("2026년도 사업주 직업능력개발훈련 우수사례 경진대회 발표심사 결과 공고")).toBe(false);
    expect(rows.map((r) => r.title)).toContain("2026년 채용문화 우수기업 어워즈 참가기업 모집 안내");
  });
});

describe("상세 — 본문·첨부(POST)", () => {
  it("본문 선택자가 상세 고정본에 실제로 있다", () => {
    expect(hrdkConfig.detailContentSelector).toBe("div.content > div.se-contents");
    expect(detailHtml).toContain('<div class="se-contents">');
    expect(detailHtml).toContain("기업훈련 우수사례 발굴 및 확산을 위한");
  });

  it("★첨부는 POST 다 — goDown() 의 base64 가 attachSeq2 본문으로 나간다", () => {
    const atts = hrdkDetailAttachments(detailHtml);
    expect(atts).toHaveLength(1);
    expect(atts[0]).toEqual({
      name: "[공고] 2026년 사업주 직업능력개발훈련 우수사례 경진대회 발표 심사 결과 공고.hwp",
      url: "https://www.hrdkorea.or.kr/cms/download/downloadFile2.hrd",
      kind: "hwp",
      method: "POST",
      body: "attachSeq2=MjA3MjIzOQ%3D%3D",
    });
  });

  it("첨부 주소가 내려받기 검문(허용 호스트)을 통과한다", () => {
    const atts = hrdkDetailAttachments(detailHtml);
    expect(safeAttachmentUrl(atts[0].url)).toBe(atts[0].url);
  });

  it("★첨부 상자(div.file_) 밖의 같은 호출은 담지 않는다 — 고정본에 미끼가 심어져 있다", () => {
    expect(detailHtml).toContain("goDown('RkFLRV9ERUNPWQ==')"); // 본문 안 미끼가 실제로 있다
    const atts = hrdkDetailAttachments(detailHtml);
    expect(atts.every((a) => !a.name.includes("미끼"))).toBe(true);
    expect(atts.every((a) => !a.body?.includes("RkFLRV9ERUNPWQ"))).toBe(true);
  });

  it("★범위 선택자를 흔들면 0건이 된다 — 미끼를 대신 집어 오지 않는다", () => {
    expect(hrdkDetailAttachments(detailHtml.replace(/class="file_/g, 'class="file_X'))).toEqual([]);
  });

  it("그림 첨부는 담지 않는다 — 글자가 0인데 개수 상한을 차지한다", () => {
    const html = `<div class="file_">
      <a href="#" onclick="goDown('QQ==');">포스터.jpg</a>
      <a href="#" onclick="goDown('Ug==');">공고문.hwp</a>
    </div>`;
    expect(hrdkDetailAttachments(html).map((a) => a.name)).toEqual(["공고문.hwp"]);
  });

  it("base64 의 `+`·`/` 는 인코딩해 내보낸다 — 날 것으로 보내면 빈칸이 된다", () => {
    const html = `<div class="file_"><a href="#" onclick="goDown('a+b/c==');">첨부.pdf</a></div>`;
    expect(hrdkDetailAttachments(html)[0].body).toBe("attachSeq2=a%2Bb%2Fc%3D%3D");
  });

  it("설정이 상세 첨부 손잡이를 실제로 물고 있다", () => {
    expect(typeof hrdkConfig.detailAttachments).toBe("function");
    const viaCfg = hrdkConfig.detailAttachments!({
      html: detailHtml,
      pageHtml: detailHtml,
      detailUrl: "https://www.hrdkorea.or.kr/3/1/1?k=56065",
      baseUrl: hrdkConfig.baseUrl,
    });
    expect(viaCfg).toEqual(hrdkDetailAttachments(detailHtml));
  });
});

/**
 * 돌연변이 1회 — 목록 행 선택자가 흔들리면 그 자리에서 0건이 되는지.
 * (선택자가 실제로 일을 하고 있다는 증거. 안 깨뜨리면 시험이 아무것도 지키지 않는다.)
 */
describe("돌연변이", () => {
  it("표 class 를 바꾸면 목록이 0건이 된다", () => {
    expect(parseHrdkList(listHtml.replace(/class="board"/g, 'class="boardX"'))).toEqual([]);
  });

  it("goDown 이름이 바뀌면 첨부가 0건이 된다 — 헛주소를 만들지 않는다", () => {
    expect(hrdkDetailAttachments(detailHtml.replace(/goDown\(/g, "goDownX("))).toEqual([]);
  });
});
