import type { BoardConfig, BoardFetchInit, BoardRow } from "../types";

const API = "https://www.smart-factory.kr/usr/bg/ba/ma/bsnsPbanc/selectBsnsPbancPage.do";
const DTL_API = "https://www.smart-factory.kr/usr/bg/ba/ma/bsnsPbanc/selectBsnsPbancDtlPage.do";
const YMD = /20\d{2}-\d{2}-\d{2}/g;

type SfRow = {
  pbancId?: string; pbancSn?: string | number; dtlPbancNm?: string;
  rcptYmdDa2001?: string; rcptYmdDa2002?: string; pbancYmd?: string; bizClsfYrNm?: string;
};

/** "2026-08-28 00:00 ~ 2026-09-18 23:50" → "2026-08-28 ~ 2026-09-18". 시각이 붙으면 범위 해석이 죽는다(함정4). */
function ymdRange(raw: string | undefined, fallbackStart: string | undefined): string {
  const ds = (raw ?? "").match(YMD) ?? [];
  if (ds.length >= 2) return `${ds[0]} ~ ${ds[1]}`;
  if (ds.length === 1) return `${ds[0]} ~`;
  const f = (fallbackStart ?? "").match(/20\d{2}-\d{2}-\d{2}/);
  return f ? `${f[0]} ~` : "";
}

/** 스마트공장 사업공고 — React SPA 지만 목록·상세 모두 JSON API 로 온다(2026-08-27 XHR 실측). */
export function parseSmartfactoryList(jsonText: string): BoardRow[] {
  let raw: SfRow[] = [];
  try {
    const d = JSON.parse(jsonText) as { modelAndView?: { model?: { pbancList?: SfRow[] } } };
    if (Array.isArray(d?.modelAndView?.model?.pbancList)) raw = d.modelAndView.model.pbancList;
  } catch { return []; }
  const out: BoardRow[] = [];
  for (const r of raw) {
    const title = (r.dtlPbancNm ?? "").replace(/\s+/g, " ").trim();
    const id = (r.pbancId ?? "").trim();
    const sn = String(r.pbancSn ?? "").trim();
    if (!title || !id || !sn) continue;
    out.push({
      title,
      detailUrl: `https://www.smart-factory.kr/usr/bg/ba/ma/bsnsPbancDtl?pbancId=${encodeURIComponent(id)}&pbancSn=${encodeURIComponent(sn)}`,
      // bizClsfYrNm 은 「(상생형)고도화-한국전력기술」처럼 사업·컨소시엄 이름이라 분야 알약으로 못 쓴다
      // (독립 검사 4차, 27종·최대 23자). 같은 내용이 제목에 이미 들어 있어 버려도 손실이 없다.
      dateText: ymdRange(r.rcptYmdDa2001 || r.rcptYmdDa2002, r.pbancYmd),
    });
  }
  return out;
}

/** 상세는 SPA 라 GET+선택자가 불가 — 본문 API(pbancCn HTML)를 직접 부른다. */
export async function fetchSmartfactoryDetail(
  detailUrl: string,
  fetchText: (url: string, init?: BoardFetchInit) => Promise<string>,
): Promise<string> {
  let id = "";
  let sn = "";
  try {
    const u = new URL(detailUrl);
    id = u.searchParams.get("pbancId") ?? "";
    sn = u.searchParams.get("pbancSn") ?? "";
  } catch { return ""; }
  if (!id || !sn) return "";
  const body = JSON.stringify({ key: "info", pbancId: id, pbancSn: Number(sn) || sn });
  const text = await fetchText(DTL_API, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  try {
    const d = JSON.parse(text) as { modelAndView?: { model?: { pbancInfo?: Record<string, string> } } };
    const info = d?.modelAndView?.model?.pbancInfo;
    if (!info) return "";
    const head = [info.pbancNo, info.bizClsfYrNm, info.rcptYmdDa2001 ? `접수기간 ${info.rcptYmdDa2001}` : ""]
      .filter(Boolean)
      .map((s) => `<p>${s}</p>`)
      .join("");
    return `${head}${info.pbancCn ?? ""}`;
  } catch { return ""; }
}

export const smartfactoryConfig: BoardConfig = {
  id: "smartfactory",
  label: "스마트공장 통합공고",
  agency: "스마트제조혁신추진단",
  region: "전국",
  baseUrl: "https://www.smart-factory.kr/",
  charset: "utf-8",
  list: {
    url: () => API,
    // 전체(rcptStts:"")는 등록순이라 3쪽=최신 30건 밖의 「열린」 공고가 영영 빠진다(적대 리뷰).
    // ING(접수개시·예정 탭, 실측 61건)를 7쪽까지 훑으면 열린 공고 전량이 매 회 들어온다.
    maxPages: 7,
    init: (p) => ({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "list", rcptStts: "ING", ordrSe: "REG", currentPage: p, showPage: "10" }),
    }),
    rowSelector: "table tbody tr", // JSON 소스 — selector 층은 형식상. customParse 가 실체.
    fields: { title: {}, detailUrl: {}, date: {} },
  },
  customParse: (jsonText) => parseSmartfactoryList(jsonText),
  detailFetch: fetchSmartfactoryDetail,
  expectMinRows: 5,
};
