import type { BoardConfig } from "../types";

/** 경남·전남지역산업진흥원 공용 — 같은 마크업, 호스트만 다르다. */
function riiaConfig(opts: {
  id: "riia-gn" | "riia-jn";
  label: string;
  region: string;
  host: string;
}): BoardConfig {
  const origin = `https://${opts.host}`;
  return {
    id: opts.id,
    label: opts.label,
    agency: opts.label,
    region: opts.region,
    baseUrl: `${origin}/`,
    charset: "utf-8",
    list: {
      url: (p) => `${origin}/board/businessAnnouncement?page=${p}`,
      maxPages: 3,
      rowSelector: "table tbody tr",
      fields: {
        // 고정본: 제목은 첫 span.mr_5, 그다음 span.mr_5 는 첨부 아이콘, jn 은 그 뒤 new 배지.
        title: { selector: "td.content_td a > span.mr_5" },
        detailUrl: { selector: "td.content_td a", attr: "href" },
        date: { selector: "td:nth-child(3)" },
      },
    },
    detailContentSelector: ".ck-content",
    expectMinRows: 5,
  };
}

export const riiaGnConfig: BoardConfig = riiaConfig({
  id: "riia-gn",
  label: "경남지역산업진흥원",
  region: "경남",
  host: "gn.riia.or.kr",
});

export const riiaJnConfig: BoardConfig = riiaConfig({
  id: "riia-jn",
  label: "전남지역산업진흥원",
  region: "전남",
  host: "jn.riia.or.kr",
});
