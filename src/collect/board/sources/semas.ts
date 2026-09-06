// 2026-09-03 상한 올림: 감시 장치 실측 상한 밖 40건(사장님 누락 0 지시)
import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * `.tag_dday` 원문(`D - 34` / `D - DAY`)을 수집 시점(KST)+N일의 YYYY-MM-DD 로 바꾼다.
 * D-DAY(및 D - 0) = 오늘. 못 읽으면 "".
 */
export function ddayToYmd(tag: string, now: Date = new Date()): string {
  const compact = tag.replace(/\s+/g, " ").trim();
  let days: number | null = null;
  if (/^D\s*-\s*DAY$/i.test(compact)) days = 0;
  else {
    const m = compact.match(/^D\s*-\s*(\d+)$/i);
    if (m) days = Number(m[1]);
  }
  if (days == null || !Number.isFinite(days)) return "";
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  const out = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + days));
  const y = out.getUTCFullYear();
  const mo = String(out.getUTCMonth() + 1).padStart(2, "0");
  const d = String(out.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

/** 소진공 목록 — sbiz24 SPA 링크를 원문 주소로 두고 D-day 를 날짜로 환산한다. */
export function parseSemasList(html: string, cfg: BoardConfig, now: Date = new Date()): BoardRow[] {
  const root = parseHtml(html);
  const out: BoardRow[] = [];
  for (const a of root.querySelectorAll('a[href*="sbiz24.kr"]')) {
    const href = (a.getAttribute("href") ?? "").trim();
    if (!href.includes("/#/pbanc/")) continue;
    const title = (a.querySelector(".cut_text1")?.text ?? "").trim();
    if (!title) continue;
    // 카드의 .date 에 정확한 「시작 ~ 종료」가 있다(적대 리뷰가 고정본에서 발견) — D-day 환산은 그게 없을 때만.
    const exact = (a.querySelector(".date")?.text ?? "").trim();
    const tag = (a.querySelector(".tag_dday")?.text ?? "").trim();
    // 상세(sbiz24)가 스크립트 화면이라 lazy 채움이 안 된다 — 목록 요약(.cut_text2, 지원대상 포함)을
    // 자격조건 원문으로 실어 보낸다(같은 이유로 이 요약이 이 출처의 유일한 조건 텍스트다).
    const summary = (a.querySelector(".cut_text2")?.text ?? "").replace(/\s+/g, " ").trim();
    out.push({
      title,
      detailUrl: href,
      dateText: /20\d{2}-\d{2}-\d{2}/.test(exact) ? exact : ddayToYmd(tag, now),
      category: "",
      agency: cfg.agency,
      targetText: summary,
    });
  }
  return out;
}

export const semasConfig: BoardConfig = {
  id: "semas",
  label: "소상공인시장진흥공단",
  agency: "소상공인시장진흥공단",
  region: "",
  baseUrl: "https://www.semas.or.kr/",
  allowedHosts: ["www.sbiz24.kr"],
  charset: "utf-8",
  list: {
    url: (p) => `https://www.semas.or.kr/web/board/webBoardList.kmdc?bCd=2001&pNm=BOA0101&page=${p}`,
    // 2026-09-02 30쪽 탐침: 상한 밖 살아 있는 2026년 지원사업 40건(사회보험료·희망리턴·정책자금)
    maxPages: 45,
    rowSelector: 'a[href*="sbiz24.kr"]',
    fields: {
      title: { selector: ".cut_text1" },
      detailUrl: { attr: "href" },
      date: { selector: ".tag_dday" },
    },
  },
  customParse: (html) => parseSemasList(html, semasConfig),
  // sbiz24 는 스크립트 화면이라 lazy 채움이 empty 로 끝나는 게 정상.
  detailContentSelector: "#no-ssr-spa",
  expectMinRows: 5,
};
