import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractBySelector } from "../layers/selector";
import { parseHtml } from "../html";
import {
  canonicalMolitDetailUrl,
  isMolitDropTitle,
  molitConfig,
  molitDetailAttachments,
  parseMolitList,
  parseMolitRaw,
} from "./molit";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 고정본: 2026-09-13 공식 공지 1·2쪽, 스마트도시 검색 쪽, 규제샌드박스 상세(idx=267090).
 */
const FIX = join(__dirname, "../__fixtures__");
const listHtml = readFileSync(join(FIX, "molit-list.html"), "utf-8");
const listP2Html = readFileSync(join(FIX, "molit-page2.html"), "utf-8");
const businessHtml = readFileSync(join(FIX, "molit-business.html"), "utf-8");
const detailHtml = readFileSync(join(FIX, "molit-detail.html"), "utf-8");
const rows = parseMolitList(listHtml);
const rowsP2 = parseMolitList(listP2Html);
const raw = parseMolitRaw(listHtml);
const rawP2 = parseMolitRaw(listP2Html);
const business = parseMolitList(businessHtml);
const CANON =
  /^https:\/\/www\.molit\.go\.kr\/USR\/BORD0201\/m_69\/DTL\.jsp\?id=N01_B&mode=view&idx=\d+$/;

function idxOf(url: string): string {
  return new URL(url).searchParams.get("idx") ?? "";
}

function poison(html: string, extra: string): string {
  return html.replace("</tbody>", `${extra}\n</tbody>`);
}

describe("국토교통부 공지사항 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 고정본에서 거르개 뒤 행을 읽고 첫 행이 맞다", () => {
    expect(raw).toHaveLength(10);
    expect(rows.length).toBeLessThan(raw.length);
    expect(rows[0]).toMatchObject({
      title: "순환골재 품질인증 사용중지 공고",
      detailUrl: "https://www.molit.go.kr/USR/BORD0201/m_69/DTL.jsp?id=N01_B&mode=view&idx=269566",
      dateText: "2026-09-11 ~",
      category: "건설산업과",
    });
  });

  it("숫자 HTML 실체 참조가 한글 제목으로 풀려 있다", () => {
    expect(rows[0].title).not.toContain("&#");
    expect(rows[0].title).not.toContain("&amp;");
    expect(rows[0].title).toBe("순환골재 품질인증 사용중지 공고");
    expect(listHtml).toContain("&#49692;");
  });

  it("★상세 주소는 같은 호스트 https 에 id·mode·idx 만 남긴다", () => {
    for (const r of [...rows, ...rowsP2, ...business]) {
      expect(r.detailUrl).toMatch(CANON);
      expect(r.detailUrl).not.toMatch(/lcmspage/);
      expect(r.detailUrl).not.toMatch(/search_regdate/);
      expect(r.detailUrl).not.toMatch(/jsessionid/i);
      expect(r.detailUrl).not.toMatch(/search=/);
    }
  });

  it("1쪽과 2쪽의 안정 글번호가 겹치지 않는다 — lcmspage 가 진짜 먹는다", () => {
    const a = new Set(rows.map((r) => idxOf(r.detailUrl)));
    const b = new Set(rowsP2.map((r) => idxOf(r.detailUrl)));
    expect(a.size).toBe(rows.length);
    expect(b.size).toBe(rowsP2.length);
    for (const id of a) expect(b.has(id)).toBe(false);
    expect(rowsP2[0]?.detailUrl).not.toBe(rows[0]?.detailUrl);
    expect(rowsP2.some((r) => r.title.includes("주거복지대전"))).toBe(true);
  });

  it("목록은 등록일만 준다 — 전 행을 개시형(`YYYY-MM-DD ~`)으로 넘기고 마감을 지어내지 않는다", () => {
    for (const r of [...raw, ...rawP2, ...business]) {
      expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~$/);
      expect(r.dateText).not.toContain("2099");
      expect(r.dateText).not.toContain("1900");
      expect(r.dateText.split("~").length).toBe(2);
    }
  });

  it("스마트도시 검색 고정본에 규제샌드박스 idx=267090 이 남는다", () => {
    const sandbox = business.find((r) => idxOf(r.detailUrl) === "267090");
    expect(sandbox).toMatchObject({
      title: "스마트도시 규제샌드박스 공모 공고문 및 공모안내서",
      detailUrl: "https://www.molit.go.kr/USR/BORD0201/m_69/DTL.jsp?id=N01_B&mode=view&idx=267090",
      dateText: "2026-02-02 ~",
    });
    expect(isMolitDropTitle(sandbox!.title)).toBe(false);
  });

  it("검증용 raw 는 거르개 전 행을 모두 담는다", () => {
    expect(raw.some((r) => r.title.includes("징계"))).toBe(true);
    expect(rows.some((r) => r.title.includes("징계"))).toBe(false);
    expect(molitConfig.validationParse).toBe(parseMolitRaw);
    expect(molitConfig.customParse).toBe(parseMolitList);
    expect(molitConfig.validationParse?.(listHtml, 1)).toEqual(raw);
  });
});

describe("제목 거르개 — 버릴 것만 지정한다", () => {
  it("징계·입찰·위원 명단은 고정본에서 실제로 버린다", () => {
    const titles = [...rows, ...rowsP2].map((r) => r.title);
    expect(titles.some((t) => t.includes("징계"))).toBe(false);
    expect(titles.some((t) => t.includes("입찰"))).toBe(false);
    expect(titles.some((t) => t.includes("명단"))).toBe(false);
    expect(isMolitDropTitle("감정평가사 징계사실 공고")).toBe(true);
    expect(isMolitDropTitle("'가덕도신공항 부지조성공사' 일괄입찰 설계심의위원 명단")).toBe(true);
    expect(isMolitDropTitle("제3기 건설엔지니어링 종합심사낙찰제 심사위원회 위원 명단(2026.9.4 기준)")).toBe(
      true,
    );
    expect(isMolitDropTitle("직원 채용 공고")).toBe(true);
    expect(isMolitDropTitle("공개 채용 안내")).toBe(true);
    expect(isMolitDropTitle("2026년 우선협상대상자 공고")).toBe(true);
    expect(isMolitDropTitle("선정 결과 발표")).toBe(true);
  });

  it("채용·근로자 지원사업과 애매한 정책·인증·스마트도시 공모는 남긴다", () => {
    for (const t of [
      "청년 채용 지원사업 참여기업 모집 공고",
      "채용 지원사업",
      "직원 채용 지원사업",
      "근로자 지원사업",
      "혁신제품 지정을 위한 심의예정 공고",
      "스마트도시 규제샌드박스 공모 공고문 및 공모안내서",
      "2026년 스마트도시 인증 공모",
      "순환골재 품질인증 사용중지 공고",
      "건설신기술 지정 신청(2814)",
    ]) {
      expect(isMolitDropTitle(t)).toBe(false);
    }
    expect(rowsP2.some((r) => r.title.includes("혁신제품"))).toBe(true);
  });
});

describe("주소 울타리 — 잘못된·바깥 링크는 버린다", () => {
  const bait = poison(
    listHtml,
    `
    <tr>
      <td class="bd_title"><a href="https://evil.example/USR/BORD0201/m_69/DTL.jsp?id=N01_B&amp;mode=view&amp;idx=1">외부호스트</a></td>
      <td class="bd_date">2026-09-01</td>
    </tr>
    <tr>
      <td class="bd_title"><a href="http://www.molit.go.kr/USR/BORD0201/m_69/DTL.jsp?id=N01_B&amp;mode=view&amp;idx=2">http</a></td>
      <td class="bd_date">2026-09-01</td>
    </tr>
    <tr>
      <td class="bd_title"><a href="./DTL.jsp?id=N01_A&amp;mode=view&amp;idx=3">다른게시판</a></td>
      <td class="bd_date">2026-09-01</td>
    </tr>
    <tr>
      <td class="bd_title"><a href="./DTL.jsp?id=N01_B&amp;mode=view&amp;idx=abc">글자번호</a></td>
      <td class="bd_date">2026-09-01</td>
    </tr>
    <tr>
      <td class="bd_title"><a href="./DTL.jsp?id=N01_B&amp;mode=view">번호없음</a></td>
      <td class="bd_date">2026-09-01</td>
    </tr>
    <tr>
      <td class="bd_title"><a href="/USR/BORD0201/m_70/DTL.jsp?id=N01_B&amp;mode=view&amp;idx=4">경로다름</a></td>
      <td class="bd_date">2026-09-01</td>
    </tr>
    <tr>
      <td class="bd_title"><a href="javascript:view(5)">스크립트</a></td>
      <td class="bd_date">2026-09-01</td>
    </tr>`,
  );

  it("호스트·프로토콜·경로·게시판 id·숫자 idx 가 아니면 담지 않는다", () => {
    const got = parseMolitRaw(bait);
    const titles = got.map((r) => r.title);
    expect(titles).not.toContain("외부호스트");
    expect(titles).not.toContain("http");
    expect(titles).not.toContain("다른게시판");
    expect(titles).not.toContain("글자번호");
    expect(titles).not.toContain("번호없음");
    expect(titles).not.toContain("경로다름");
    expect(titles).not.toContain("스크립트");
    expect(got).toHaveLength(raw.length);
  });

  it("세션 조각이 붙어도 같은 글번호로 굳힌다", () => {
    expect(
      canonicalMolitDetailUrl(
        "./DTL.jsp;jsessionid=ABC?id=N01_B&mode=view&idx=267090&lcmspage=9",
      ),
    ).toBe("https://www.molit.go.kr/USR/BORD0201/m_69/DTL.jsp?id=N01_B&mode=view&idx=267090");
  });
});

describe("제목은 앵커 글자 — title 속성의 잘린 값을 쓰지 않는다", () => {
  it("title 속성이 짧아도 앵커 글자 전체를 쓴다", () => {
    const html = listHtml.replace(
      'href="./DTL.jsp?id=N01_B&amp;cate=&amp;mode=view&amp;idx=269566',
      'title="순환골재 품질…" href="./DTL.jsp?id=N01_B&amp;cate=&amp;mode=view&amp;idx=269566',
    );
    const r = parseMolitList(html).find((x) => idxOf(x.detailUrl) === "269566");
    expect(r?.title).toBe("순환골재 품질인증 사용중지 공고");
    expect(r?.title).not.toContain("…");
  });
});

describe("국토교통부 설정", () => {
  it("쪽 주소는 넓은 등록일 구간과 lcmspage 다", () => {
    expect(molitConfig.list.url(1)).toBe(
      "https://www.molit.go.kr/USR/BORD0201/m_69/LST.jsp?id=N01_B&search_regdate_s=1900-01-01&search_regdate_e=2099-12-31&lcmspage=1",
    );
    expect(molitConfig.list.url(2)).toBe(
      "https://www.molit.go.kr/USR/BORD0201/m_69/LST.jsp?id=N01_B&search_regdate_s=1900-01-01&search_regdate_e=2099-12-31&lcmspage=2",
    );
    expect(molitConfig.list.maxPages).toBe(5);
    expect(molitConfig.baseUrl).toBe("https://www.molit.go.kr/USR/BORD0201/m_69/");
  });

  it("id·기관·지역·글자표·추측 끄기", () => {
    expect(molitConfig.id).toBe("molit");
    expect(molitConfig.label).toBe("국토교통부 공고");
    expect(molitConfig.agency).toBe("국토교통부");
    expect(molitConfig.region).toBe("전국");
    expect(molitConfig.charset).toBe("utf-8");
    expect(molitConfig.skipHeuristic).toBe(true);
    expect(molitConfig.expectMinRows).toBe(1);
  });

  it("설정에 적은 선택자만으로도 1쪽 10행이 읽힌다", () => {
    const bySelector = extractBySelector(listHtml, molitConfig);
    expect(bySelector).toHaveLength(10);
    expect(bySelector[0].title).toBe("순환골재 품질인증 사용중지 공고");
    expect(bySelector[0].dateText).toContain("2026-09-11");
  });
});

describe("상세 본문·첨부 — 규제샌드박스 고정본", () => {
  const attachArgs = {
    html: detailHtml,
    pageHtml: detailHtml,
    detailUrl: "https://www.molit.go.kr/USR/BORD0201/m_69/DTL.jsp?id=N01_B&mode=view&idx=267090",
    baseUrl: molitConfig.baseUrl,
  };

  it("본문 선택자가 상세 고정본에 실제로 있고 공모 글자가 있다", () => {
    expect(molitConfig.detailContentSelector).toBe(".bd_view_cont");
    const body = parseHtml(detailHtml).querySelector(".bd_view_cont")?.text ?? "";
    expect(body).toContain("공고 제2026-65호");
    expect(body).toContain("스마트도시 규제샌드박스");
    expect(body).toContain("대상을 모집하기 위하여");
  });

  it("잘라 둔 고정본에는 .bd_view 상자가 없어도 li.file 로 첨부 칸을 집는다", () => {
    expect(molitConfig.attachmentsScopeSelector).toBe("li.file");
    expect(detailHtml).not.toMatch(/class="bd_view"/);
    expect(parseHtml(detailHtml).querySelectorAll("li.file")).toHaveLength(1);
    const scoped = parseHtml(detailHtml)
      .querySelectorAll("li.file")
      .map((el) => el.outerHTML)
      .join("\n");
    expect(molitDetailAttachments({ ...attachArgs, html: scoped })).toHaveLength(2);
  });

  it("첨부는 같은 호스트 DWN.jsp 2건이고 viewer.do 미리보기는 아니다", () => {
    const atts = molitDetailAttachments(attachArgs);
    expect(atts).toHaveLength(2);
    expect(atts[0]).toMatchObject({
      name: "(공고)_스마트도시_규제샌드박스_공모_공고문_및_공모안내서.hwpx",
      kind: "hwpx",
    });
    expect(atts[1]).toMatchObject({
      name: "(공고)_스마트도시_규제샌드박스_공모_공고문_및_공모안내서.pdf",
      kind: "pdf",
    });
    for (const a of atts) {
      expect(a.url.startsWith("https://www.molit.go.kr/LCMS/DWN.jsp?fold=/N01_B/&fileName=")).toBe(
        true,
      );
      expect(a.url).not.toContain("viewer.do");
      expect(a.url).not.toContain("%2528");
    }
    expect(atts[0].url).toContain("fileName=%28%EA%B3%B5%EA%B3%A0%29_");
    expect(atts[0].url.endsWith(".hwpx")).toBe(true);
    expect(atts[1].url.endsWith(".pdf")).toBe(true);
    expect(typeof molitConfig.detailAttachments).toBe("function");
    expect(molitConfig.detailAttachments!(attachArgs)).toEqual(atts);
  });

  it("바깥 호스트·미리보기·다른 fold 는 첨부로 담지 않는다", () => {
    const html = `
      <li class="file">
        <a href="/USR/viewer.do?mode=pc&id=267090">바로보기</a>
        <a href="https://evil.example/LCMS/DWN.jsp?fold=/N01_B/&fileName=x.pdf">바깥</a>
        <a href="/LCMS/DWN.jsp?fold=/OTHER/&fileName=x.pdf">다른폴더</a>
        <a href="/LCMS/DWN.jsp?fold=/N01_B/&fileName=ok.hwp">한글.hwp</a>
      </li>`;
    expect(molitDetailAttachments({ ...attachArgs, html }).map((a) => a.name)).toEqual(["한글.hwp"]);
  });
});

describe("망가뜨려 보기", () => {
  it("행 선택자가 한 글자 틀리면 0행이다", () => {
    expect(parseMolitRaw(listHtml.replaceAll("bd_tbl", "bd_tbl_x"))).toHaveLength(0);
  });

  it("상세 파일 이름이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseMolitRaw(listHtml.replaceAll("./DTL.jsp", "./VIEW.jsp"))).toHaveLength(0);
  });

  it("등록일 칸이 사라지면 날짜를 비운다(오늘 날짜·2099 를 지어내지 않는다)", () => {
    const broken = parseMolitRaw(listHtml.replaceAll("bd_date", "bd_date_x"));
    expect(broken.length).toBeGreaterThan(0);
    expect(broken.every((r) => r.dateText === "")).toBe(true);
  });
});
