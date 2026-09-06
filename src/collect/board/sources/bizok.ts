import { absolutize, parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

const YY_MD = /\b(\d{2})-(\d{2})-(\d{2})\b/g;

/** 인천 비즈OK 목록 — 신청기간 2자리 연도를 4자리로 바꾸고 행별 주관기관을 쓴다. */
export function parseBizokList(html: string, cfg: BoardConfig): BoardRow[] {
  const root = parseHtml(html);
  const out: BoardRow[] = [];
  for (const li of root.querySelectorAll("ul.list01 li")) {
    const a = li.querySelector('a[href*="policyno="]');
    if (!a) continue;
    const title = (a.querySelector("dt p")?.text ?? "").trim();
    const href = (a.getAttribute("href") ?? "").trim();
    if (!title || !href) continue;
    let dateText = "";
    let agency = "";
    for (const p of a.querySelectorAll("dd p")) {
      const raw = (p.text ?? "").trim();
      if (raw.includes("신청기간")) {
        // 라벨·「접수중」 배지·탭이 섞인 원문에서 변환 후 범위만 추린다(첫 수집 실측 — 화면 기간 문구 오염).
        const conv = raw.replace(YY_MD, "20$1-$2-$3");
        const m = conv.match(/20\d{2}-\d{2}-\d{2}\s*~\s*20\d{2}-\d{2}-\d{2}/);
        dateText = m ? m[0].replace(/\s+/g, "") .replace("~", " ~ ") : "";
      } else if (raw.includes("주관기관")) {
        agency = raw.replace(/^.*?주관기관\s*:\s*/, "").trim();
      }
    }
    out.push({
      title,
      detailUrl: absolutize(href, cfg.baseUrl),
      dateText,
      category: (li.querySelector("span.cat")?.text ?? "").trim(),
      agency: agency || cfg.agency,
    });
  }
  return out;
}

export const bizokConfig: BoardConfig = {
  id: "bizok",
  label: "인천 비즈OK",
  agency: "인천광역시",
  region: "인천",
  baseUrl: "https://bizok.incheon.go.kr/",
  charset: "utf-8",
  list: {
    url: (p) => `https://bizok.incheon.go.kr/open_content/support.do?act=list&pgno=${p}`,
    maxPages: 10,
    rowSelector: "ul.list01 li",
    fields: {
      title: { selector: "dt p" },
      detailUrl: { selector: 'a[href*="policyno="]', attr: "href" },
      date: {},
      category: { selector: "span.cat" },
    },
  },
  customParse: (html) => parseBizokList(html, bizokConfig),
  detailContentSelector: "div.board_view",
  // 상세 상단·바닥에 「BizOK 이용자 매뉴얼」 PDF 가 있어 전체 수확이 오염된다(적대 리뷰) — 공고 구역만.
  attachmentsScopeSelector: "div.board_view",
  expectMinRows: 5,
};
