import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

/**
 * 광주테크노파크 사업공고.
 * 상세 링크가 `?act=view…` 라 baseUrl 은 디렉터리가 아니라 목록 쪽 주소 그대로여야 한다.
 */
export function parseGjtpList(html: string): BoardRow[] {
  const out: BoardRow[] = [];
  for (const tr of parseHtml(html).querySelectorAll("table.list-table tbody tr")) {
    const a = tr.querySelector("td.tal a");
    const href = a?.getAttribute("href") ?? "";
    const id = href.match(/[?&]bsnssId=([^&#]+)/)?.[1] ?? "";
    const title = (a?.text ?? "").replace(/\s+/g, " ").trim();
    if (!id || !title) continue;
    out.push({
      title,
      detailUrl: `https://www.gjtp.or.kr/home/business.cs?act=view&bsnssId=${id}`,
      dateText: (tr.querySelector("td.period")?.text ?? "").replace(/\s+/g, " ").trim(),
    });
  }
  return out;
}

export const gjtpConfig: BoardConfig = {
  id: "gjtp",
  label: "광주테크노파크",
  agency: "광주테크노파크",
  region: "광주",
  baseUrl: "https://www.gjtp.or.kr/home/business.cs",
  charset: "utf-8",
  list: {
    url: (p) => `https://www.gjtp.or.kr/home/business.cs?pageIndex=${p}&pageUnit=30`,
    maxPages: 10,
    rowSelector: "table.list-table tbody tr",
    fields: {
      title: { selector: "td.tal a" },
      detailUrl: { selector: "td.tal a", attr: "href" },
      date: { selector: "td.period" },
    },
  },
  customParse: (html) => parseGjtpList(html),
  // bsnssId 하나로 상세가 열린다(실측) — 나머지는 쪽·검색·분류라 지운다.
  // 위 list.fields 는 customParse 가 있는 한 안 쓰인다(엔진이 customParse 를 먼저 본다). 자가수리도
  // customParse 출처는 통째로 건너뛴다(engine.ts) — 목록이 깨지면 남는 방어선은 휴리스틱 층뿐이라,
  // dropUrlParams 는 그 층이 상대 링크를 그대로 쓸 때 쪽 번호가 주소에 남는 것을 막는 몫이다.
  dropUrlParams: ["pageIndex", "pageUnit", "searchKeyword", "ctg01", "ctg02", "ctg03"],
  detailContentSelector: ".contents",
  // pageUnit=30 이지만 게시판이 15건씩으로 바뀌면 20 은 출처를 통째로 멈춘다.
  expectMinRows: 10,
};
