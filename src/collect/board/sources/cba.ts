// 2026-09-03 상한 올림: 감시 장치 실측 상한 밖 225건(사장님 누락 0 지시)
import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

const YMD = /\b(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\b/;
/** 글번호에 허용하는 글자 — 그대로 주소에 넣으므로 좁게 잡는다(이미 인코딩된 값을 또 인코딩하지 않으려고). */
const SAFE_NO = /^[A-Za-z0-9._~-]+$/;
/**
 * 공고가 아닌 정보성 글. 실측 30건 중 「비지자체 대상 공모사업 동향(26-NN호)」 소식지 4건·입시설명회 1건이 섞여 있었다
 * — 이 게시판은 기간을 안 주기 때문에 걸러 내지 않으면 등록일부터 90일간 모집중으로 보인다.
 */
const NOT_ANNOUNCEMENT = /공모사업\s*동향|입시설명회/;

/** 칸 위치로만 분류·등록일을 알 수 있고, 고정 공지가 한 쪽에 두 번 나와 no 로 중복을 지운다. */
export function parseCbaList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  const seen = new Set<string>();
  for (const tr of parseHtml(html).querySelectorAll("table.board tbody tr")) {
    const a = tr.querySelector("td.txt_left a");
    const href = a?.getAttribute("href") ?? "";
    const no = href.match(/[?&]no=([^&#]+)/)?.[1] ?? "";
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!no || !SAFE_NO.test(no) || !title || seen.has(no)) continue;
    if (NOT_ANNOUNCEMENT.test(title)) continue;
    seen.add(no);
    const tds = tr.querySelectorAll("td");
    // 첫 칸 <img alt="공지글"> 은 게시판 맨 위 붙박이 공지 — 이 게시판은 등록일만 주는데,
    // 붙박이 글에 등록일을 시작일로 넣으면 저장 쪽 「개시 90일 자동 마감」이 아직 붙어 있는 공지를 닫아 버린다.
    // 제목에 `[공지]` 를 붙여 그 규칙을 피하는 길도 있지만, 제목이 중복판정 열쇠(제목+기관)라
    // 다른 출처의 같은 공고와 묶이지 않게 된다 — 그래서 **날짜를 비운다**.
    // 시작일이 없으면 90일 규칙이 아예 안 걸리고, 고정이 풀려 목록에서 사라지면 30일 미수집 마감이 정리한다.
    const pinned = Boolean(tds[0]?.querySelector('img[alt="공지글"]'));
    const category = (tds[1]?.text ?? "").replace(/\s+/g, " ").trim() || undefined;
    const d = pinned ? null : (tds[4]?.text ?? "").match(YMD);
    out.push({
      title,
      detailUrl: `https://www.cba.ne.kr/home/sub.php?menukey=172&mod=view&no=${no}`,
      dateText: d ? `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")} ~` : "",
      category,
    });
  }
  return out;
}

export const cbaConfig: BoardConfig = {
  id: "cba",
  label: "충북기업진흥원",
  agency: "충북기업진흥원",
  region: "충북",
  baseUrl: "https://www.cba.ne.kr/home/",
  charset: "utf-8",
  list: {
    url: (p) => `https://www.cba.ne.kr/home/sub.php?menukey=172&page=${p}`,
    maxPages: 30,
    rowSelector: "table.board tbody tr",
    fields: {
      title: { selector: "td.txt_left a" },
      detailUrl: { selector: "td.txt_left a", attr: "href" },
      date: {},
    },
  },
  customParse: (html) => parseCbaList(html),
  detailContentSelector: ".substance",
  // 고정 공지 중복을 지운 뒤 한 쪽에 15건 안팎. 고정 공지가 늘면 더 줄 수 있어 8.
  expectMinRows: 8,
};
