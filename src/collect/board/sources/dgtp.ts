import type { BoardConfig, BoardRow } from "../types";

const BBS_ID = "BBSMSTR_000000000003";
const LIST = `https://www.dgtp.or.kr/bbs/BoardControll.do?bbsId=${BBS_ID}`;
/** 글번호는 그대로 주소에 들어간다 — 숫자만 받는다. */
const NTT_ID = /^\d+$/;
/** 접수기간 칸이 "2026-08-28 ~ 2026-09-11" 형태일 때만 날짜로 인정한다. */
const PERIOD = /\d{4}-\d{2}-\d{2}\s*~\s*\d{4}-\d{2}-\d{2}/;

const strip = (s: string) =>
  s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();

/**
 * 대구테크노파크 사업공고.
 * 이 게시판은 ① 제목 칸에 같은 링크가 툴팁 사본과 본문으로 **두 번** 들어 있고
 * ② 그 툴팁 안 <a> 가 안 닫힌 채 </span> 가 온다. 그래서 일반 선택자 추출로는
 * 제목이 두 번 이어붙고, 맨손 파서는 <table> 을 통째로 놓친다 — 원문을 <tr 로 잘라 읽는다.
 */
export function parseDgtpList(html: string): BoardRow[] {
  const t0 = html.indexOf('<table class="nth3left tablelist"');
  if (t0 < 0) return [];
  const t1 = html.indexOf("</table>", t0);
  const table = html.slice(t0, t1 < 0 ? undefined : t1);

  const out: BoardRow[] = [];
  const pinned: BoardRow[] = [];
  for (const raw of table.split(/<tr\b[^>]*>/).slice(1)) {
    // 툴팁 사본을 먼저 지운다 — 안 지우면 제목이 두 번 붙는다.
    const chunk = raw.replace(/<span class="tooltiptext">[\s\S]*?<\/span>/g, "");
    const id = chunk.match(/fn_egov_inqire_notice\('([^']*)'/)?.[1] ?? "";
    if (!NTT_ID.test(id)) continue;
    const title = strip(chunk.match(/<a[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? "");
    if (!title) continue;

    const tds = [...chunk.matchAll(/<td\b[^>]*>([\s\S]*?)(?=<\/td>|<td\b|$)/g)].map((m) => strip(m[1]));
    const period = tds[3] ?? "";
    const row: BoardRow = {
      title,
      detailUrl: `https://www.dgtp.or.kr/bbs/BoardControllView.do?bbsId=${BBS_ID}&nttId=${id}`,
      // 기간이 온전할 때만 날짜로 쓴다. 고정 공지는 기간 칸이 비어 있어 자동으로 "" 가 된다 —
      // 등록일을 시작일로 넣으면 「개시 90일 자동 마감」이 아직 붙어 있는 공지를 닫는다(충북과 같은 이유).
      dateText: PERIOD.test(period) ? period : "",
      category: tds[1] || undefined,
    };
    if (/class="notice"/.test(raw)) pinned.push(row);
    else out.push(row);
  }

  // 고정 공지는 아래 목록에도 한 번 더 나온다. 제목이 겹치면 기간을 가진 일반 행을 남긴다.
  const seen = new Set(out.map((r) => r.title));
  return [...pinned.filter((r) => !seen.has(r.title)), ...out];
}

export const dgtpConfig: BoardConfig = {
  id: "dgtp",
  label: "대구테크노파크",
  agency: "대구테크노파크",
  region: "대구",
  baseUrl: "https://www.dgtp.or.kr/bbs/BoardControll.do",
  charset: "utf-8",
  list: {
    url: (p) => `${LIST}&pageIndex=${p}`,
    // 2026-09-02 30쪽 탐침: 상한 밖 살아 있는 2026년 지원사업 25건(R&D 과제기획·기술닥터·스타기업)
    maxPages: 30,
    rowSelector: "table.tablelist tbody tr",
    fields: {
      title: { selector: "div.tooltip a" },
      detailUrl: { selector: "div.tooltip a", attr: "href" },
      date: {},
      category: {},
    },
  },
  customParse: (html) => parseDgtpList(html),
  // 상세에 `table.tableview` 가 **둘** 있다 — 본문표와 「다음글/이전글」 표.
  // `form` 안쪽으로 좁히지 않으면 옆 공고 제목이 본문에 섞여 들어가 AI 구조화를 오염시킨다
  // (실측: table.tableview = 2요소·다음글 포함 / form table.tableview = 1요소·오염 없음).
  detailContentSelector: "form table.tableview",
  attachmentsScopeSelector: "form table.tableview",
  // 10건/쪽이라 5건 아래로 떨어지면 서식이 바뀐 것으로 보고 멈춘다.
  expectMinRows: 5,
};
