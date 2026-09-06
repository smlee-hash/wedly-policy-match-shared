import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pagingParamsOf } from "../engine";
import { koficConfig, koficDetailAttachments, isKoficDropTitle, parseKoficList } from "./kofic";
import { safeAttachmentUrl } from "@/lib/policy-match/attachment-text";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 고정본: 2026-09-06 실측 공지사항 1·2쪽(`boardNumber=4`·`curPage=2`)·상세(`boardSeqNumber=75140`).
 */
const FIX = join(__dirname, "../__fixtures__");
const listHtml = readFileSync(join(FIX, "kofic-list.html"), "utf-8");
const listP2Html = readFileSync(join(FIX, "kofic-list-p2.html"), "utf-8");
const detailHtml = readFileSync(join(FIX, "kofic-detail.html"), "utf-8");
const rows = parseKoficList(listHtml);
const rowsP2 = parseKoficList(listP2Html);

describe("영화진흥위원회 공지사항 — 실사이트 고정본", () => {
  it("★고정본 원본은 15행인데 거르개 뒤 2건만 남는다(기업 대상 비율 0.12)", () => {
    // 원본 행 수: 머리줄을 뺀 tbody tr — 거르개가 실제로 13건을 걷어 냈다는 증거.
    expect((listHtml.match(/fn_goDetailPage\(/g) ?? []).length).toBe(15);
    expect(rows).toHaveLength(2);
  });

  it("첫 행이 맞다 — 기업(영화 제작사)이 신청하는 모집공고", () => {
    expect(rows[0]).toMatchObject({
      title: "2026 KOFIC x VIPO Producers Exchange @Tokyo 참가자 모집",
      detailUrl:
        "https://www.kofic.or.kr/kofic/business/board/selectBoardDetail.do?boardNumber=4&boardSeqNumber=75140",
      dateText: "2026-09-03 ~",
      category: "일반",
      agency: "영화진흥위원회",
    });
  });

  it("★2쪽 고정본도 15행 중 2건만 남는다 — 남는 둘은 기업 대상 글이다", () => {
    expect((listP2Html.match(/fn_goDetailPage\(/g) ?? []).length).toBe(15);
    expect(rowsP2).toHaveLength(2);
    expect(rowsP2.map((r) => r.title)).toEqual([
      "메가박스중앙 회생절차 관련 법률 상담 창구 안내 (운영기간: 8. 3.~9. 2.)",
      "메가박스중앙 회생절차 관련 활용 가능한 정책금융 지원사업 안내",
    ]);
  });

  it("2쪽은 1쪽과 다른 글이고 상세 열쇠가 겹치지 않는다", () => {
    const all = [...rows, ...rowsP2].map((r) => r.detailUrl);
    expect(new Set(all).size).toBe(all.length);
    expect(rows.map((r) => r.detailUrl)).not.toEqual(rowsP2.map((r) => r.detailUrl));
  });

  it("★상세 주소에 쪽 변수를 남기지 않는다", () => {
    expect(
      [...rows, ...rowsP2].every((r) =>
        /^https:\/\/www\.kofic\.or\.kr\/kofic\/business\/board\/selectBoardDetail\.do\?boardNumber=4&boardSeqNumber=\d+$/.test(
          r.detailUrl,
        ),
      ),
    ).toBe(true);
    expect([...rows, ...rowsP2].every((r) => !r.detailUrl.includes("curPage"))).toBe(true);
  });

  it("날짜는 td.date 칸에서만 집는다 — 행 전체 글자면 번호와 붙는다", () => {
    expect([...rows, ...rowsP2].every((r) => /^20\d{2}-\d{2}-\d{2} ~$/.test(r.dateText))).toBe(true);
  });

  it("쪽 주소는 curPage 로 넘어간다(화면은 POST 지만 GET 도 통한다 — 2쪽 실측 200)", () => {
    expect(koficConfig.list.url(1)).toBe(
      "https://www.kofic.or.kr/kofic/business/board/selectBoardList.do?boardNumber=4&curPage=1",
    );
    expect(koficConfig.list.url(2)).toContain("curPage=2");
    expect(pagingParamsOf(koficConfig)).toContain("curPage");
  });
});

describe("제목·분류 거르개 — 다섯 갈래를 버린다", () => {
  it("채용·상영·심사결과·교육생·잡다 공지는 버린다", () => {
    expect(isKoficDropTitle("2026년 대체인력(일반사무)-2 공개채용 공고")).toBe(true);
    expect(isKoficDropTitle("[2026년 독립예술영화 상영 프로그램] 9월 상영 라인업 안내")).toBe(true);
    expect(isKoficDropTitle("2027년 미국 아카데미영화상 국제장편영화 부문 한국대표 출품작 선정 결과")).toBe(true);
    expect(isKoficDropTitle("[한국영화아카데미] 2026학년도 글로벌 과정 [한-프 영화아카데미] 교육생 모집")).toBe(true);
    expect(isKoficDropTitle("공시송달 2차_(주)라이크콘텐츠")).toBe(true);
    expect(isKoficDropTitle("특별관(IMAX 등) 영화 암표·부정거래 관련 제보 접수 안내")).toBe(true);
    // 2026-09-06 독립 리뷰로 더한 셋 — 2쪽 고정본에 실물이 있다.
    expect(isKoficDropTitle("[알림] 위원회 시스템 안정성 강화를 위한 개선 및 점검 작업 안내(8.13.(목) 11:40~13:00)")).toBe(true);
    expect(isKoficDropTitle("2026~2027년 영화진흥위원회 해외통신원 추가 모집 선발 결과 공고")).toBe(true);
    expect(isKoficDropTitle("2026 영화스태프 근로환경 실태조사 안내(기한 연장 ~8. 9. )")).toBe(true);
  });

  it("기업 대상 모집공고는 남긴다 — 「모집」을 통째로 버리지 않는다", () => {
    expect(isKoficDropTitle("2026 KOFIC x VIPO Producers Exchange @Tokyo 참가자 모집")).toBe(false);
    expect(rows.map((r) => r.title)).toContain("2026 KOFIC x VIPO Producers Exchange @Tokyo 참가자 모집");
  });

  it("★분류 칸이 「채용」이면 제목을 안 보고 버린다(제목 거르개가 새는 날의 예비 그물)", () => {
    const html = listHtml.replace(
      /2026년 대체인력\(일반사무\)-2 공개채용 공고/,
      "2026년 대체인력 모집",
    );
    expect(parseKoficList(html).some((r) => r.title.includes("대체인력"))).toBe(false);
  });
});

describe("상세 — 본문·첨부(POST)", () => {
  it("본문 선택자가 상세 고정본에 실제로 있다", () => {
    expect(koficConfig.detailContentSelector).toBe("div.bbs_view_cont");
    expect(detailHtml).toContain('class="bbs_view_cont');
  });

  it("★첨부는 POST 다 — fileUrl·fileNm·dnFileName 이 본문으로 나간다(정적 경로 GET 은 404)", () => {
    const atts = koficDetailAttachments(detailHtml);
    expect(atts).toHaveLength(3);
    expect(atts[0]).toEqual({
      name: "참가자 모집공고 (2026 KO-PICK 쇼케이스 KOFIC x VIPO Producers Exchange Tokyo).pdf",
      url: "https://www.kofic.or.kr/kofic/business/comm/file/downloadFile.do",
      kind: "pdf",
      method: "POST",
      body:
        "fileUrl=%2Fkofic%2FuploadFile%2FattachFile%2F202609" +
        "&fileNm=8123e694232e4ec9adf85f6cc2261246.pdf" +
        "&dnFileName=%EC%B0%B8%EA%B0%80%EC%9E%90%20%EB%AA%A8%EC%A7%91%EA%B3%B5%EA%B3%A0%20(2026%20KO-PICK%20%EC%87%BC%EC%BC%80%EC%9D%B4%EC%8A%A4%20KOFIC%20x%20VIPO%20Producers%20Exchange%20Tokyo).pdf",
    });
    expect(atts.map((a) => a.kind)).toEqual(["pdf", "hwp", "hwp"]);
  });

  it("첨부 주소가 내려받기 검문(허용 호스트)을 통과한다", () => {
    expect(safeAttachmentUrl(koficDetailAttachments(detailHtml)[0].url)).toBe(
      "https://www.kofic.or.kr/kofic/business/comm/file/downloadFile.do",
    );
  });

  it("★머리표(dl.bbs_view) 밖의 같은 호출은 담지 않는다 — 고정본에 미끼가 심어져 있다", () => {
    expect(detailHtml).toContain("decoy0000000000000000000000000000.pdf"); // 본문 안 미끼가 실제로 있다
    const atts = koficDetailAttachments(detailHtml);
    expect(atts.every((a) => !a.name.includes("미끼"))).toBe(true);
    expect(atts.every((a) => !a.body?.includes("decoy00000"))).toBe(true);
  });

  it("★범위 선택자를 흔들면 0건이 된다 — 미끼를 대신 집어 오지 않는다", () => {
    expect(koficDetailAttachments(detailHtml.replace(/class="bbs_view"/g, 'class="bbs_viewX"'))).toEqual([]);
  });

  it("그림 첨부는 담지 않는다", () => {
    const html = `<dl class="bbs_view"><dd>
      <a href="#none" class="file" onclick="fn_fileDownload('1' ,'/d' , 'a.jpg',  '포스터.jpg')">포스터.jpg</a>
      <a href="#none" class="file" onclick="fn_fileDownload('2' ,'/d' , 'b.pdf',  '공고문.pdf')">공고문.pdf</a>
    </dd></dl>`;
    expect(koficDetailAttachments(html).map((a) => a.name)).toEqual(["공고문.pdf"]);
  });

  it("설정이 상세 첨부 손잡이를 실제로 물고 있다", () => {
    expect(typeof koficConfig.detailAttachments).toBe("function");
    expect(
      koficConfig.detailAttachments!({
        html: detailHtml,
        pageHtml: detailHtml,
        detailUrl: "https://www.kofic.or.kr/x",
        baseUrl: koficConfig.baseUrl,
      }),
    ).toEqual(koficDetailAttachments(detailHtml));
  });
});

/** 돌연변이 1회 — 선택자·함수 이름이 실제로 일을 하고 있다는 증거. */
describe("돌연변이", () => {
  it("표 class 를 바꾸면 목록이 0건이 된다", () => {
    expect(parseKoficList(listHtml.replace(/bbs_ltype/g, "bbs_ltypeX"))).toEqual([]);
  });

  it("fn_fileDownload 이름이 바뀌면 첨부가 0건이 된다", () => {
    expect(koficDetailAttachments(detailHtml.replace(/fn_fileDownload\(/g, "fn_fileDownloadX("))).toEqual([]);
  });
});
