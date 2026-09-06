import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isSmtechDropTitle, parseSmtechList, smtechConfig } from "./smtech";

/**
 * ★손으로 쓴 HTML 대신 **실사이트 고정본**으로 잰다.
 * 고정본: 2026-09-03 실측 `notice02_list.do?sysGubun=smtech&pageIndex=1|2` · 상세 1건.
 * ⚠️ 고정본 안의 `;jsessionid=…` 값만 `SESSIONID` 로 가렸다(세션 표는 비밀값이라 저장소에 안 남긴다).
 *    **자리 자체는 실물 그대로** 남겨 뒀다 — 쿠키 없이 부르면 이 사이트는 모든 링크에 세션 표를
 *    박아 주기 때문에, 그걸 안 떼면 회차마다 같은 공고가 새 줄로 저장된다.
 */
const listHtml = readFileSync(join(__dirname, "../__fixtures__/smtech-list.html"), "utf-8");
const listP2Html = readFileSync(join(__dirname, "../__fixtures__/smtech-list-p2.html"), "utf-8");
const detailHtml = readFileSync(join(__dirname, "../__fixtures__/smtech-detail.html"), "utf-8");
const rows = parseSmtechList(listHtml);
const rowsP2 = parseSmtechList(listP2Html);
const combined = [...rows, ...rowsP2];

const DETAIL = "https://www.smtech.go.kr/front/ifg/no/notice02_detail.do";

describe("중소기업기술정보진흥원(SMTECH) R&D 사업공고 목록 읽기 — 실사이트 고정본", () => {
  it("1쪽 15줄을 그대로 읽고 첫 행이 맞다", () => {
    expect(rows).toHaveLength(15);
    expect(rows[0]).toMatchObject({
      title: "2026년 중소기업 연구인력지원사업(파견) 9월 공고",
      detailUrl: `${DETAIL}?ancmId=S02847&buclCd=S6041&dtlAncmSn=8&schdSe=MO5005&aplySn=1`,
      dateText: "2026-09-01 ~ 2026-09-30",
      category: "공공연연구인력파견지원(참여기업접수용)",
    });
  });

  it("★상세 주소에서 세션 표(;jsessionid=)를 떼어낸다 — 안 떼면 회차마다 전부 새 공고가 된다", () => {
    expect(listHtml).toContain(";jsessionid=");
    expect(combined.every((r) => !r.detailUrl.includes("jsessionid"))).toBe(true);
    expect(combined.every((r) => r.detailUrl.startsWith(`${DETAIL}?`))).toBe(true);
  });

  it("★상세 주소에 쪽 번호·검색어를 넣지 않는다 — 넣으면 같은 글이 쪽마다 다른 줄이 된다", () => {
    expect(listP2Html).toContain("pageIndex=2");
    expect(combined.every((r) => !/[?&]pageIndex=/.test(r.detailUrl))).toBe(true);
    expect(combined.every((r) => !/[?&]search(Condition|Keyword)=/.test(r.detailUrl))).toBe(true);
    expect(combined.every((r) => !/[?&]buclYy=(&|$)/.test(r.detailUrl))).toBe(true);
  });

  it("같은 사업의 회차별 공고가 dtlAncmSn 으로 갈린다 — 한 줄로 뭉치면 월별 공고를 잃는다", () => {
    const monthly = combined.filter((r) => r.title.includes("연구인력지원사업(파견)"));
    expect(monthly.length).toBeGreaterThanOrEqual(6);
    expect(new Set(monthly.map((r) => r.detailUrl)).size).toBe(monthly.length);
  });

  it("접수기간은 「시작 ~ 끝」 칸 모양 그대로 넘긴다", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.dateText).toMatch(/^\d{4}-\d{2}-\d{2} ~ \d{4}-\d{2}-\d{2}$/);
  });

  it("★접수기간 칸과 공고일 칸을 헷갈리지 않는다 — 8월 공고는 접수 08-01~08-31 인데 공고일이 09-01 이다", () => {
    const r = rows.find((x) => x.title.includes("(파견) 8월 공고"));
    expect(r?.dateText).toBe("2026-08-01 ~ 2026-08-31");
    expect(r?.dateText).not.toContain("2026-09-01");
  });

  it("1쪽+2쪽을 합쳐도 상세 열쇠 중복이 없다", () => {
    const urls = combined.map((r) => r.detailUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(combined).toHaveLength(29);
  });

  it("2쪽 첫 행이 1쪽과 다르다 — pageIndex 가 진짜 먹는다", () => {
    expect(rowsP2[0]).toMatchObject({
      title: "협업형 지역생활경제 활성화 시범사업 시행계획 공고",
      detailUrl: `${DETAIL}?ancmId=S02865&buclCd=S801B&dtlAncmSn=1&schdSe=MO5005&aplySn=1`,
      dateText: "2026-05-28 ~ 2026-06-12",
      category: "시군구연고산업육성",
    });
    expect(rowsP2[0].detailUrl).not.toBe(rows[0].detailUrl);
  });

  it("DROP 거르개가 실측 제목을 실제로 버린다 — 2쪽 「배심원단 모집」 1건", () => {
    expect(listP2Html).toContain("민간전문가 배심원단 모집 안내");
    expect(rowsP2).toHaveLength(14);
    expect(rowsP2.some((r) => r.title.includes("배심원단"))).toBe(false);
    expect(isSmtechDropTitle("2026년 DCP(생태계혁신형) 민간전문가 배심원단 모집 안내")).toBe(true);
    expect(isSmtechDropTitle("사업공고 제안서 평가위원 모집")).toBe(true);
    expect(isSmtechDropTitle("2026년 사무보조원 채용 공고")).toBe(true);
  });

  it("「채용」을 통째로 버리지 않는다 — 연구인력 채용 지원사업이 죽으면 안 된다", () => {
    // 실측 3쪽 제목 그대로(2026-09-03). 고정본은 1·2쪽이라 거르개 함수로 직접 잰다.
    expect(isSmtechDropTitle("2026년 중소기업 연구인력지원사업(채용, 신진) 공고")).toBe(false);
    expect(isSmtechDropTitle("2026년 중소기업 연구인력지원사업(채용, 고경력) 공고")).toBe(false);
  });

  it("1쪽은 한 줄도 안 버린다 — 거르개가 지원사업까지 먹지 않는지 확인", () => {
    expect(rows.map((r) => r.title).some(isSmtechDropTitle)).toBe(false);
    expect(rows).toHaveLength(15);
  });

  it("★IRIS 로 넘기는 줄은 담지 않는다 — 상세 주소가 없어 전 줄이 한 열쇠로 뭉친다", () => {
    const irisish = listHtml.replace(
      /<a href="\/front\/ifg\/no\/notice02_detail\.do[^"]*" class="board">/,
      '<a href="javascript:goMove()" class="board">',
    );
    expect(irisish).not.toBe(listHtml);
    expect(parseSmtechList(irisish)).toHaveLength(14);
  });
});

describe("중소기업기술정보진흥원 설정", () => {
  it("쪽넘김은 GET pageIndex + sysGubun=smtech", () => {
    expect(smtechConfig.list.url(1)).toBe(
      "https://www.smtech.go.kr/front/ifg/no/notice02_list.do?sysGubun=smtech&pageIndex=1",
    );
    expect(smtechConfig.list.url(2)).toBe(
      "https://www.smtech.go.kr/front/ifg/no/notice02_list.do?sysGubun=smtech&pageIndex=2",
    );
    expect(smtechConfig.list.maxPages).toBe(5);
  });

  it("id·기관·지역·글자표가 맞다", () => {
    expect(smtechConfig.id).toBe("smtech");
    expect(smtechConfig.agency).toBe("중소기업기술정보진흥원");
    expect(smtechConfig.region).toBe("전국");
    expect(smtechConfig.charset).toBe("utf-8");
    expect(smtechConfig.baseUrl).toBe("https://www.smtech.go.kr/");
  });

  it("서식 변경 감지가 살아 있다 — 1은 검사를 끈 것과 같다", () => {
    expect(smtechConfig.expectMinRows).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeGreaterThanOrEqual(smtechConfig.expectMinRows!);
  });

  it("★추측 단계를 끈다 — 추측은 세션 표를 안 떼어 매 회차 중복을 쌓는다", () => {
    expect(smtechConfig.skipHeuristic).toBe(true);
  });
});

describe("상세 조달 — 첨부 내려받기 주소를 실제 주소로 바꿔 준다", () => {
  const fetchDetail = async (html: string) => {
    let asked = "";
    const out = await smtechConfig.detailFetch!(`${DETAIL}?ancmId=S02847`, async (u) => {
      asked = u;
      return html;
    });
    return { out, asked };
  };

  it("본문 구역만 잘라 오고 로그인 알림창·바닥글은 안 딸려 온다", async () => {
    const { out, asked } = await fetchDetail(detailHtml);
    expect(asked).toBe(`${DETAIL}?ancmId=S02847`);
    expect(out).toContain("2026년 중소기업 연구인력지원사업(파견) 9월 공고");
    expect(out).toContain("국가과학기술연구회");
    expect(out).not.toContain("SMTECH에서 사용할 ID, PW 입력");
    // ★바닥글이 딸려 오면 자격조건에 「관계사이트·개인정보처리방침」이 섞이고 링크가 26개가 된다.
    expect(detailHtml).toContain("개인정보처리방침");
    expect(out).not.toContain("개인정보처리방침");
    expect(out).not.toContain("관계사이트");
  });

  it("링크는 첨부 4개 + 공고문 안 링크 3개뿐이다 — 바닥글 링크가 첨부로 수확되면 안 된다", async () => {
    const { out } = await fetchDetail(detailHtml);
    // ★대소문자를 함께 센다 — 공고 본문은 한글에서 붙여 넣은 것이라 `<A HREF=…>` 대문자다.
    expect(out.match(/<a\s[^>]*>/gi) ?? []).toHaveLength(7);
    expect(out.match(/\/front\/comn\/AtchFileDownload\.do\?atchFileId=/g) ?? []).toHaveLength(4);
    expect(out).not.toContain("/front/ifg/no/notice02_list.do");
    expect(out).not.toContain("bizinfo.go.kr");
  });

  it("표식이 사라져도 caption 으로 표를 찾아 본문을 건진다", async () => {
    const { out } = await fetchDetail(
      detailHtml.replaceAll("공지사항 내용 시작입니다", "딴 표식").replaceAll("공지사항 내용 마침니다", "딴 표식"),
    );
    expect(out).toContain("2026년 중소기업 연구인력지원사업(파견) 9월 공고");
    expect(out).toContain("/front/comn/AtchFileDownload.do?atchFileId=");
  });

  it("★javascript: 내려받기를 GET 주소로 바꾼다 — 안 바꾸면 공고문 HWP 를 영영 못 읽는다", async () => {
    const { out } = await fetchDetail(detailHtml);
    expect(detailHtml).toContain("javascript:cfn_AtchFileDownload(");
    expect(out).toContain(
      'href="/front/comn/AtchFileDownload.do?atchFileId=17E8E860551E9A52555B147467D191EF"',
    );
    // href="#list" + onclick 으로 된 서식 첨부도 같이 살린다.
    expect(out).toContain(
      'href="/front/comn/AtchFileDownload.do?atchFileId=EC1A1CEE2A787A20550364CEE42F081E"',
    );
    expect(out).not.toContain("javascript:cfn_AtchFileDownload(");
    expect(out).not.toContain('href="#list"');
  });

  it("표식도 caption 도 없으면 빈 글자를 돌려준다 — 메뉴·바닥글을 자격조건으로 저장하지 않는다", async () => {
    const { out } = await fetchDetail(
      detailHtml
        .replaceAll("공지사항 내용 시작입니다", "딴 표식")
        .replaceAll("공지사항 내용 마침니다", "딴 표식")
        .replaceAll("사업공고 목록보기 내용", "딴 표"),
    );
    expect(out).toBe("");
  });
});

/**
 * ★판정기를 망가뜨려 본다 — 안 하면 위 시험들이 「그냥 통과하는 글」일 뿐이다.
 */
describe("망가뜨려 보기", () => {
  it("행 선택자가 한 글자 틀리면 0행이다", () => {
    expect(parseSmtechList(listHtml.replaceAll("tbl_type01", "tbl_type01-x"))).toHaveLength(0);
  });

  it("제목 링크 표식(class=board)이 바뀌면 한 줄도 못 읽는다", () => {
    expect(parseSmtechList(listHtml.replaceAll('class="board"', 'class="board-x"'))).toHaveLength(0);
  });

  it("접수기간 칸이 비면 공고일을 개시형으로 쓴다(오늘 날짜를 지어내지 않는다)", () => {
    const noPeriod = listHtml.replaceAll(/2026\. \d{2}\. \d{2} ~ 2026\. \d{2}\. \d{2}/g, "");
    const r = parseSmtechList(noPeriod);
    expect(r).toHaveLength(15);
    expect(r[0].dateText).toBe("2026-09-01 ~");
    expect(r.every((x) => /^\d{4}-\d{2}-\d{2} ~$/.test(x.dateText))).toBe(true);
  });

  it("날짜 칸이 통째로 사라지면 날짜를 비운다 — 행 전체 글자에서 주워 오지 않는다", () => {
    const noDates = listHtml.replaceAll(/\d{4}[.-] ?\d{2}[.-] ?\d{2}/g, "");
    expect(parseSmtechList(noDates).every((r) => r.dateText === "")).toBe(true);
  });
});
