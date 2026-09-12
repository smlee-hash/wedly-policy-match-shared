import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../html";
import {
  isSnipDropTitle,
  parseSnipList,
  snipConfig,
  snipDetailAttachments,
  snipOfficialDetailUrl,
} from "./snip";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 창원 사고: 지어낸 HTML 로 시험하면 선택자 오타가 그대로 통과한다.
 * 고정본: 2026-09-02 실측 1·2쪽 (`Business1.do?page=1|2`).
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/snip-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/snip-list-p2.html"), "utf-8");
const publicDetailHtml = readFileSync(join(__dirname, "../__fixtures__/snip-public-detail.html"), "utf-8");
const wrapperHtml = readFileSync(join(__dirname, "../__fixtures__/snip-detail.html"), "utf-8");
const rows = parseSnipList(listHtml);
const combined = parseSnipList(listHtml + listP2Html);

const STORED_DETAIL =
  "https://portal.snip.or.kr:8443/portal/snip/MainMenu/businessManagement/application.page?portlet=2026-0253&portlet2=4167&homeYn=Y";
const OFFICIAL_DETAIL =
  "https://portal.snip.or.kr:8443/user/snip/busin/businDetail.face?pjtAnncSn=2026-0253&pjtCd=4167&stateChk=N";
const ANNOUNCE_IMAGE =
  "https://portal.snip.or.kr:8443/gwCustSnip/2026/202609111144439170.png";
const HWP_HEX = "4EA62D6FB90D5191F52D052A866FB18922C223BD88E5A7F833DDE1431D21DADB";
const HWP_URL =
  `https://portal.snip.or.kr:8443/user/snip/attatchFileDownload.face?comAtchFileId=${HWP_HEX}&dataType=biz`;
const HWP_NAME = "2_개별참가(해외 전시회) 진원신청서 (1).hwp";
const IMAGE_NAME = "1_해외 전시회 개별 참가 지원 모집공고문.png";

describe("성남산업진흥원 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 DROP·중복을 뺀 10건을 읽고 첫 행의 제목·상세주소·날짜가 맞다", () => {
    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatchObject({
      title: "성남 중장년 기술창업센터 신규입주기업 모집",
      detailUrl:
        "https://portal.snip.or.kr:8443/portal/snip/MainMenu/businessManagement/application.page?portlet=2026-0246&portlet2=4100&homeYn=Y",
      // 접수기간은 td.term 을 직접 집는다. 행 전체 글자면 조회수 142 + 작성일 2026-08-31 이 붙는다.
      dateText: "2026-08-31 ~ 2026-09-17",
      agency: "성남산업진흥원",
    });
  });

  it("1쪽+2쪽을 합쳐 파싱해도 상세 열쇠 중복이 없고, DROP 1건을 뺀 19건이다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(19);
  });

  it("DROP 거르개가 실측 제목 「강사 인력 Pool 모집」을 실제로 버린다", () => {
    expect(combined.some((r) => r.title.includes("강사 인력 Pool"))).toBe(false);
    expect(isSnipDropTitle("RA 전문가 양성교육 교육 강사 인력 Pool 모집")).toBe(true);
  });

  it("「~ 안내」로 끝나는 진짜 지원사업은 살린다 — 허용목록(KEEP)을 쓰지 않는다", () => {
    expect(rows.some((r) => r.title.includes("지식재산 거래 지원사업 신청 안내"))).toBe(true);
    expect(isSnipDropTitle("[성남특허센터] 지식재산 거래 지원사업 신청 안내 (기술이전, 기술거래)")).toBe(
      false,
    );
  });

  it("「채용」을 통째로 버리지 않는다 — 고용보조금은 제목에 채용을 쓴다", () => {
    expect(isSnipDropTitle("방위산업 중소기업 신규직원 채용 지원사업 참여기업 모집")).toBe(false);
  });

  it("접수기간은 td.term 칸에서만 집는다 — 작성일 칸(td.data)으로 떨어지면 안 된다", () => {
    // 1쪽 세 번째 행: 접수기간 08-28~09-04, 작성일 08-27. 작성일을 집으면 끝이 08-27 이 된다.
    const r = rows.find((x) => x.title.includes("Indocomtech"));
    expect(r?.dateText).toBe("2026-08-28 ~ 2026-09-04");
  });

  it("같은 쪽 안에서도 상세 열쇠 중복이 없다", () => {
    const urls = rows.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe("성남산업진흥원 설정", () => {
  it("쪽넘김은 GET page — pageIndex·pageNo·currentPage 는 실측에서 안 먹는다", () => {
    expect(snipConfig.list.url(1)).toBe("https://www.snip.or.kr/SNIP/contents/Business1.do?page=1");
    expect(snipConfig.list.url(2)).toBe("https://www.snip.or.kr/SNIP/contents/Business1.do?page=2");
    expect(snipConfig.list.url(2)).not.toContain("pageIndex");
    expect(snipConfig.list.url(2)).not.toContain("pageNo");
    expect(snipConfig.list.url(2)).not.toContain("currentPage");
    expect(snipConfig.list.maxPages).toBe(10);
  });

  it("상세가 다른 호스트(포트 포함)라 allowedHosts 에 portal.snip.or.kr:8443 이 있다", () => {
    expect(snipConfig.allowedHosts).toEqual(["portal.snip.or.kr:8443"]);
  });

  it("지역은 경기 — 전국에 노출되면 안 된다", () => {
    expect(snipConfig.region).toBe("경기");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(snipConfig.expectMinRows).toBeGreaterThanOrEqual(2);
  });

  it("공개 상세를 채우므로 skipDetailFill 을 쓰지 않고, 본문 선택자·첨부 손잡이가 있다", () => {
    expect(snipConfig.skipDetailFill).toBeUndefined();
    expect(typeof snipConfig.detailFetch).toBe("function");
    expect(typeof snipConfig.detailAttachments).toBe("function");
    expect(snipConfig.detailContentSelector).toBe("#snip-detail-body");
    expect(snipConfig.detailApplyPeriod).toBeUndefined();
  });
});

describe("목록 접수기간은 그대로 둔다", () => {
  it("상세를 읽어도 마감은 목록 td.term 값이다 — 상세 기간 칸을 덧씌우지 않는다", () => {
    const withRange = rows.filter((r) => /^20\d{2}-\d{2}-\d{2} ~ 20\d{2}-\d{2}-\d{2}$/.test(r.dateText));
    expect(withRange.length).toBe(rows.length);
    expect(snipOfficialDetailUrl(rows[0].detailUrl)).toBe(
      "https://portal.snip.or.kr:8443/user/snip/busin/businDetail.face?pjtAnncSn=2026-0246&pjtCd=4100&stateChk=N",
    );
  });
});

describe("상세 주소 — 저장 주소만 공개 상세로 옮긴다", () => {
  it("목록에 저장된 application.page 를 businDetail.face 로 옮긴다", () => {
    expect(snipOfficialDetailUrl(STORED_DETAIL)).toBe(OFFICIAL_DETAIL);
  });

  it("틀린 입력은 요청 전에 거절한다 — 껍데기·비밀번호 iframe 을 열지 않는다", async () => {
    const bad = [
      "http://portal.snip.or.kr:8443/portal/snip/MainMenu/businessManagement/application.page?portlet=2026-0253&portlet2=4167",
      "https://portal.snip.or.kr/portal/snip/MainMenu/businessManagement/application.page?portlet=2026-0253&portlet2=4167",
      "https://portal.snip.or.kr:443/portal/snip/MainMenu/businessManagement/application.page?portlet=2026-0253&portlet2=4167",
      OFFICIAL_DETAIL,
      "https://user:pass@portal.snip.or.kr:8443/portal/snip/MainMenu/businessManagement/application.page?portlet=2026-0253&portlet2=4167",
      "https://portal.snip.or.kr:8443/portal/snip/MainMenu/businessManagement/application.page?portlet=2026&portlet2=4167",
      "https://portal.snip.or.kr:8443/portal/snip/MainMenu/businessManagement/application.page?portlet=1999-0253&portlet2=4167",
      "https://portal.snip.or.kr:8443/portal/snip/MainMenu/businessManagement/application.page?portlet=2026-0253&portlet2=0",
      "https://portal.snip.or.kr:8443/portal/snip/MainMenu/businessManagement/application.page?portlet=2026-0253&portlet2=-3",
      "https://portal.snip.or.kr:8443/portal/snip/MainMenu/businessManagement/application.page?portlet=2026-0253&portlet2=04",
      "https://evil.example/portal/snip/MainMenu/businessManagement/application.page?portlet=2026-0253&portlet2=4167",
      "https://www.snip.or.kr/portal/snip/MainMenu/businessManagement/application.page?portlet=2026-0253&portlet2=4167",
      "https://portal.snip.or.kr:8443/x",
    ];
    for (const url of bad) {
      let called = 0;
      const html = await snipConfig.detailFetch!(url, async () => {
        called += 1;
        return publicDetailHtml;
      });
      expect(html).toBe("");
      expect(called).toBe(0);
      expect(snipOfficialDetailUrl(url)).toBeNull();
    }
  });
});

describe("상세 조달 — 익명 공개 고정본", () => {
  async function fetchPublic() {
    const asked: Array<{ url: string; init?: unknown }> = [];
    const html = await snipConfig.detailFetch!(STORED_DETAIL, async (url, init) => {
      asked.push({ url, init });
      return publicDetailHtml;
    });
    return { html, asked };
  }

  it("저장 주소가 아니라 공개 상세만 GET 하고, 본문 선택자에 그림 주소가 남는다", async () => {
    const { html, asked } = await fetchPublic();
    expect(asked).toEqual([{ url: OFFICIAL_DETAIL, init: undefined }]);
    expect(asked[0].url).not.toContain("application.page");
    expect(html).toContain(ANNOUNCE_IMAGE);
    expect(html).not.toContain("passwordChange");
    expect(html).not.toContain("사업 공고문 내용을 입력합니다");
    expect(html).not.toContain("passwordChange.jsp");
    const body = parseHtml(html).querySelector(snipConfig.detailContentSelector!);
    expect(body).not.toBeNull();
    expect(body!.innerHTML).toContain(ANNOUNCE_IMAGE);
    expect(body!.querySelector("img")?.getAttribute("src")).toBe(ANNOUNCE_IMAGE);
    const text = (body!.text ?? "").replace(/\s+/g, " ").trim();
    expect(text).toBe("");
    // 공용 상세 채움은 변환 HTML 전체의 text를 저장한다. 파일명·안내문으로 채우면
    // 첨부에서 자격 조건을 읽는 빈 본문 대기줄에서 영구히 빠진다.
    expect(parseHtml(html).text.trim()).toBe("");
    expect(text).not.toContain("사업 공고문 내용을 입력합니다");
    expect(parseHtml(html).text).not.toContain("passwordChange");
  });

  it("일반 파이프라인은 그림 원문 URL 과 이름 있는 HWP 첨부를 돌려준다", async () => {
    const { html } = await fetchPublic();
    const fromFetch = snipConfig.detailAttachments!({
      html,
      pageHtml: html,
      detailUrl: STORED_DETAIL,
      baseUrl: snipConfig.baseUrl,
    });
    const expected = [
      { name: IMAGE_NAME, url: ANNOUNCE_IMAGE, kind: "etc" },
      { name: HWP_NAME, url: HWP_URL, kind: "hwp" },
    ];
    expect(fromFetch).toEqual(expected);
    expect(snipDetailAttachments(html)).toEqual(expected);
    expect(snipDetailAttachments(publicDetailHtml)).toEqual(expected);
    expect(fromFetch.every((a) => !a.url.includes("filePreview"))).toBe(true);
    expect(fromFetch.every((a) => !a.url.includes("application.page"))).toBe(true);
    expect(html).not.toContain("&amp;amp;");
  });

  it("비밀번호 껍데기를 본문으로 쓰지 않는다", async () => {
    expect(wrapperHtml).toContain("passwordChange.jsp");
    const html = await snipConfig.detailFetch!(STORED_DETAIL, async () => wrapperHtml);
    expect(html).toBe("");
    expect(html).not.toContain("passwordChange");
    expect(snipDetailAttachments(wrapperHtml)).toEqual([]);
  });
});

describe("상세 조달 — 글자만 있는 인코딩된 textarea", () => {
  it("엔티티로 감싼 본문 마크업을 풀어 선택자 안에 남기고, 그림 안내를 붙이지 않는다", async () => {
    const page = `<html><body>
      <textarea id="summernote" name="content">&lt;p&gt;지원 대상은 성남시 소재 중소기업입니다.&lt;/p&gt;</textarea>
    </body></html>`;
    const asked: string[] = [];
    const html = await snipConfig.detailFetch!(STORED_DETAIL, async (url) => {
      asked.push(url);
      return page;
    });
    expect(asked).toEqual([OFFICIAL_DETAIL]);
    const body = parseHtml(html).querySelector(snipConfig.detailContentSelector!);
    expect(body?.querySelector("p")?.text.trim()).toBe("지원 대상은 성남시 소재 중소기업입니다.");
    expect((body?.text ?? "").replace(/\s+/g, " ").trim()).toBe("지원 대상은 성남시 소재 중소기업입니다.");
    expect(html).not.toContain("원문 공고는 그림입니다");
    expect(html).not.toContain("사업 공고문 내용을 입력합니다");
    expect(
      snipConfig.detailAttachments!({
        html,
        pageHtml: html,
        detailUrl: STORED_DETAIL,
        baseUrl: snipConfig.baseUrl,
      }),
    ).toEqual([]);
  });
});

describe("첨부 — 잘못된 토큰·바깥 주소는 거절한다", () => {
  const tit = (inner: string) => `<div class="titArea4"><p class="tit">${inner}</p></div>`;

  it("hex 가 아니거나 짧으면 첨부가 0건이다", () => {
    expect(
      snipDetailAttachments(tit(`<a>${HWP_NAME}</a><a onclick="fn_fileDown('ZZZ')">다운로드</a>`)),
    ).toEqual([]);
    expect(
      snipDetailAttachments(
        tit(`<a>${HWP_NAME}</a><a onclick="fn_fileDown('${HWP_HEX}GG')">다운로드</a>`),
      ),
    ).toEqual([]);
    expect(
      snipDetailAttachments(
        tit(`<a>${HWP_NAME}</a><a onclick="fn_fileDown('${HWP_HEX.slice(0, 16)}')">다운로드</a>`),
      ),
    ).toEqual([]);
  });

  it("미리보기는 내려받기가 아니다", () => {
    expect(
      snipDetailAttachments(
        tit(
          `<a>${HWP_NAME}</a><a onclick="fn_Preview('202609111251196920.hwp','${HWP_HEX}')">바로보기</a>`,
        ),
      ),
    ).toEqual([]);
  });

  it("이름 칸이 없으면 내려받기 열쇠만으로 파일을 짓지 않는다", () => {
    expect(
      snipDetailAttachments(tit(`<a onclick="fn_fileDown('${HWP_HEX}')">다운로드</a>`)),
    ).toEqual([]);
  });

  it("같은 HEX 는 한 번만 담는다", () => {
    const html = tit(
      `<a>${HWP_NAME}</a><a onclick="fn_fileDown('${HWP_HEX}')">다운로드</a>` +
        `<a>${HWP_NAME}</a><a onclick="fn_fileDown('${HWP_HEX}')">다운로드</a>`,
    );
    expect(snipDetailAttachments(html)).toEqual([{ name: HWP_NAME, url: HWP_URL, kind: "hwp" }]);
  });

  it("바깥 호스트 그림·다른 경로 그림은 안 담는다", () => {
    expect(
      snipDetailAttachments(
        `<div id="snip-detail-body"><img src="https://evil.example/gwCustSnip/x.png" title="x.png"></div>`,
      ),
    ).toEqual([]);
    expect(
      snipDetailAttachments(
        `<div id="snip-detail-body"><img src="https://portal.snip.or.kr:8443/other/x.png" title="x.png"></div>`,
      ),
    ).toEqual([]);
    expect(
      snipDetailAttachments(
        `<div id="snip-detail-body"><img src="http://portal.snip.or.kr:8443/gwCustSnip/x.png" title="x.png"></div>`,
      ),
    ).toEqual([]);
  });

  it(" titArea4 밖의 fn_fileDown 은 안 담는다 — 스크립트 정의를 실행하지 않는다", () => {
    const html = `<script>function fn_fileDown(fileId){ location.href='/user/snip/attatchFileDownload.face?comAtchFileId='+fileId; }</script>
      <a onclick="fn_fileDown('${HWP_HEX}')">${HWP_NAME}</a>`;
    expect(snipDetailAttachments(html)).toEqual([]);
  });
});
