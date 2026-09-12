/**
 * TIPS — 중소벤처기업부 공식 「2026년 팁스(TIPS) 창업기업 지원계획 수정 공고」
 * (공고 제2026-188호, 2026-03-19, bcIdx=1066440) 수집기.
 *
 * 매 회차 공고 HTML 에서 계획 PDF 주소를 읽고, 그 PDF 평문으로 네 개 출연 트랙을 만든다.
 * 옛 jointips about.php·1+5+2 합산·지분투자 취급·insecureHTTPParser·고정본 폴백은 쓰지 않는다.
 * 절·금액·기간이 없으면 기본값을 넣지 않고 던진다.
 */
import { parse } from "node-html-parser";
import { fetchAttachmentTexts, type AttachmentTextResult } from "../../attachment-text";
import { wonOf } from "../../../funding/amount-rate-extract";
import { fetchProductText } from "../fetch";
import type { NormalizedProduct, ProductSource, ProductTargetRules } from "../types";

const SOURCE_ID = "product-tips";
const MSS_HOST = "www.mss.go.kr";
const DOWNLOAD_PATH = "/common/board/Download.do";
export const TIPS_DETAIL_URL =
  "https://www.mss.go.kr/site/smba/ex/bbs/View.do?bcIdx=1066440&cbIdx=310";
const MSS_FETCH = { id: SOURCE_ID, baseUrl: "https://www.mss.go.kr/" };
const INSTITUTION = "중소벤처기업부";
const IRIS_APPLY_URL = "https://www.iris.go.kr/";
const KSTARTUP_APPLY_URL = "https://www.k-startup.go.kr/";
const CHANNEL_RND = "TIPS 운영사 추천 · IRIS";
const CHANNEL_NONRND = "K-Startup";
const ATTACH_OPTS = {
  extractHwpx: () => "",
  maxFiles: 1 as const,
  maxBytes: 5_000_000,
  totalCharCap: 60_000,
  timeoutMs: 30_000,
};

const GENERAL_NAME = "TIPS (민간투자주도형 기술창업지원)";
const DEEPTECH_NAME = "TIPS (딥테크트랙)";
const COMMERCIAL_NAME = "TIPS (창업사업화)";
const OVERSEAS_NAME = "TIPS (해외마케팅)";

const GENERAL_HEAD = /\(\s*1\s*\)\s*팁스\s*R&D\s*일반트랙/;
const DEEP_HEAD = /\(\s*2\s*\)\s*팁스\s*R&D\s*딥테크트랙/;
const NONRND_HEAD = /\(\s*4\s*\)\s*팁스\s*비\s*R&D\s*연계사업/;
const AFTER_NONRND = /4\.\s*기술료\s*징수관리/;

function sourceIdOf(name: string): string {
  return name.replace(/\s+/g, "").replace(/[()（）]/g, "");
}

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function unescapeHref(raw: string): string {
  return raw
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .trim();
}

function fail(detail: string): never {
  throw new Error(`TIPS: ${detail} — 값을 지어내지 않는다`);
}

function planPlainText(text: string): string {
  return text.replace(/^\s*\[첨부:[^\]]*\]\s*/u, "").replace(/\r\n/g, "\n");
}

function requireWon(amountText: string): number {
  const n = wonOf(amountText);
  if (n === null || n <= 0) fail(`금액 '${amountText}'를 숫자로 읽지 못했다`);
  return n;
}

function requireMatch(section: string, re: RegExp, label: string): RegExpMatchArray {
  const m = section.match(re);
  if (!m) fail(`${label}을(를) 해당 절에서 찾지 못했다`);
  return m;
}

function headingIndex(text: string, re: RegExp, label: string): number {
  const m = text.match(re);
  if (!m || m.index === undefined) fail(`공식 계획서에서 ${label} 절을 찾지 못했다`);
  return m.index;
}

function sectionBetween(text: string, start: number, end: number, label: string): string {
  if (end <= start) fail(`${label} 절 경계가 올바르지 않다`);
  const slice = text.slice(start, end).trim();
  if (!slice) fail(`${label} 절이 비어 있다`);
  return slice;
}

function officialExcerpt(section: string): string {
  const t = compact(section);
  if (!t) fail("원문 절이 비어 있다");
  return t;
}

function requireConditionalAge(section: string): { human: string } {
  const g = compact(section);
  if (!/7\s*년/.test(g)) fail("창업 7년 요건을 해당 절에서 찾지 못했다");
  if (!/10\s*년/.test(g) || !/신산업/.test(g)) {
    fail("신산업 10년 조건부 업력 요건을 해당 절에서 찾지 못했다");
  }
  return {
    human: "창업 7년 이내(신산업 창업 분야는 10년 이내, 조건부 최대 10년)",
  };
}

/** 조건부 자격과 제외 사항을 잘라내지 않고 검토 항목으로 보존한다. */
function eligibilityExcerpt(section: string, nonRndTrack?: "commercial" | "overseas"): string {
  const start = headingIndex(section, /□\s*(?:지원\s*대상|신청자격)/, "신청 자격");
  const end = headingIndex(section, /□\s*선정\s*절차/, "선정 절차");
  let text = sectionBetween(section, start, end, "신청 자격 및 제외 사항");
  if (nonRndTrack) {
    const commercial = headingIndex(text, /<\s*창업사업화\s*>/, "창업사업화 제외 사항");
    const overseas = headingIndex(text, /<\s*해외마케팅\s*>/, "해외마케팅 제외 사항");
    text = text.slice(0, commercial) + (nonRndTrack === "commercial" ? text.slice(commercial, overseas) : text.slice(overseas));
  }
  return compact(text);
}

function requireOperatorInvestCheck(section: string): string {
  const g = compact(section);
  if (!/추천/.test(g)) fail("일반트랙 운영사 추천 요건을 해당 절에서 찾지 못했다");
  const pair = g.match(
    /([\d.]+)\s*억원\s*이상\s*\(\s*비수도권[^)]*?([\d.]+)\s*억원\s*이상\s*\)/,
  );
  if (pair) {
    return `팁스 운영사 투자(수도권 ${pair[1]}억원 이상, 비수도권 ${pair[2]}억원 이상) 및 추천`;
  }
  const capital = g.match(/수도권[\s\S]{0,50}?([\d.]+)\s*억원\s*이상/);
  const other = g.match(/비수도권[\s\S]{0,80}?([\d.]+)\s*억원\s*이상/);
  if (!capital || !other) fail("일반트랙 운영사 투자 요건(수도권·비수도권)을 해당 절에서 찾지 못했다");
  return `팁스 운영사 투자(수도권 ${capital[1]}억원 이상, 비수도권 ${other[1]}억원 이상) 및 추천`;
}

function requireYearPeriod(section: string): { months: number; text: string } {
  const m = requireMatch(compact(section), /최대\s*(\d+)\s*년/, "지원 기간(년)");
  const years = Number(m[1]);
  if (!Number.isFinite(years) || years <= 0) fail("지원 기간(년) 숫자가 올바르지 않다");
  const months = years * 12;
  return { months, text: `최대 ${years}년(${months}개월)` };
}

function requireMonthPeriod(section: string): { months: number; text: string } {
  const g = compact(section);
  const m = g.match(/최대\s*(\d+)\s*개월/) ?? g.match(/(\d+)\s*개월\s*이내/);
  if (!m) fail("지원 기간(개월)을 해당 절에서 찾지 못했다");
  const months = Number(m[1]);
  if (!Number.isFinite(months) || months <= 0) fail("지원 기간(개월) 숫자가 올바르지 않다");
  return { months, text: `최대 ${months}개월` };
}

function requireRndIntake(section: string): string {
  const m = compact(section).match(/1\s*[·･•.]\s*2\s*[·･•.]\s*3\s*분기[^.。]{0,24}접수(?:\s*예정)?/);
  if (!m) fail("R&D 접수 시기(1·2·3분기)를 해당 절에서 찾지 못했다");
  return compact(m[0]);
}

function requireNonRndIntake(section: string, full: string): string {
  const local = compact(section);
  if (/1\s*분기/.test(local) && /접수/.test(local)) {
    const m = local.match(/1\s*분기\s*접수(?:\s*\(\s*총\s*1회\s*\))?/);
    if (m) return compact(m[0]);
  }
  const all = compact(full);
  const m = all.match(/비\s*R&D\s*[•·]?\s*(1\s*분기\s*접수(?:\s*\(\s*총\s*1회\s*\))?)/);
  if (!m) fail("비R&D 접수 시기(1분기)를 공식 계획서에서 찾지 못했다");
  return compact(m[1]);
}

function grantProduct(input: {
  name: string;
  targetText: string;
  targetRules: ProductTargetRules;
  limitText: string;
  limitMaxWon: number;
  termText: string;
  channel: string;
  applyUrl: string;
  deadlineText: string;
  sourceText: string;
}): NormalizedProduct {
  if (/상시|현재 접수|currently accepting|always open/i.test(input.deadlineText)) {
    fail("접수 시기를 상시·현재 접수로 단정하지 않는다");
  }
  return {
    source: SOURCE_ID,
    sourceId: sourceIdOf(input.name),
    fundingGroup: "grant",
    institution: INSTITUTION,
    institutionType: "policy",
    name: input.name,
    productType: "grant",
    targetText: input.targetText,
    targetRules: input.targetRules,
    limitText: input.limitText,
    limitMaxWon: input.limitMaxWon,
    rateText: "",
    rateMin: null,
    rateMax: null,
    feeText: "",
    termText: input.termText,
    channel: input.channel,
    applyUrl: input.applyUrl,
    detailUrl: TIPS_DETAIL_URL,
    deadlineText: input.deadlineText,
    raw: { sourceText: input.sourceText, sourceUrl: TIPS_DETAIL_URL },
  };
}

function parseGeneral(section: string): NormalizedProduct {
  const g = compact(section);
  const amount =
    g.match(/R&D\s*자금\s*최대\s*([\d.]+)\s*억원/) ??
    g.match(/연구개발비\s*최대\s*([\d.]+)\s*억원/) ??
    g.match(/정부지원\s*연구개발비[\s\S]{0,40}?최대\s*([\d.]+)\s*억원/);
  if (!amount) fail("일반트랙 정부지원 금액(최대 N억원)을 해당 절에서 찾지 못했다");
  const period = requireYearPeriod(section);
  const age = requireConditionalAge(section);
  const invest = requireOperatorInvestCheck(section);
  const target = requireMatch(
    g,
    /[｢「]중소기업창업\s*지원법[｣」]\s*제2조.{10,420}?신청\s*가능/,
    "일반트랙 지원 대상 원문",
  );
  return grantProduct({
    name: GENERAL_NAME,
    targetText: eligibilityExcerpt(section),
    targetRules: { humanCheck: [age.human, invest, eligibilityExcerpt(section)] },
    limitText: `최대 ${amount[1]}억원`,
    limitMaxWon: requireWon(`${amount[1]}억원`),
    termText: period.text,
    channel: CHANNEL_RND,
    applyUrl: IRIS_APPLY_URL,
    deadlineText: requireRndIntake(section),
    sourceText: officialExcerpt(section),
  });
}

function parseDeeptech(section: string): NormalizedProduct {
  const g = compact(section);
  const amount =
    g.match(/3년간\s*최대\s*([\d.]+)\s*억원/) ??
    g.match(/후속R&D[\s\S]{0,40}?최대\s*([\d.]+)\s*억원/) ??
    g.match(/연구개발비\s*최대\s*([\d.]+)\s*억원/) ??
    g.match(/정부지원연구개발비\s*\(?\s*최대\s*([\d.]+)\s*억원/);
  if (!amount) fail("딥테크트랙 정부지원 금액(최대 N억원)을 해당 절에서 찾지 못했다");
  if (!/일반트랙/.test(g) || !/완료/.test(g)) {
    fail("딥테크트랙 일반트랙 완료 요건을 해당 절에서 찾지 못했다");
  }
  const follow =
    g.match(/후속투자[\s\S]{0,90}?([\d.]+)\s*억원\s*이상/) ??
    g.match(/후속투자\s*([\d.]+)\s*억원\s*이상/);
  if (!follow) fail("딥테크트랙 후속투자 요건을 해당 절에서 찾지 못했다");
  if (!/추천/.test(g)) fail("딥테크트랙 운영사 추천 요건을 해당 절에서 찾지 못했다");
  const age = requireConditionalAge(section);
  const period = requireYearPeriod(section);
  const target = requireMatch(
    g,
    /아래의\s*필수요건을\s*모두\s*충족하는\s*기업.{10,2000}?([\d.]+)\s*억원\s*이상\s*유치한\s*창업기업/,
    "딥테크트랙 지원 대상 원문",
  );
  return grantProduct({
    name: DEEPTECH_NAME,
    targetText: eligibilityExcerpt(section),
    targetRules: {
      humanCheck: [
        "팁스 일반트랙 최종평가 '완료' 판정",
        `후속투자 ${follow[1]}억원 이상`,
        "팁스 운영사 추천",
        age.human,
        eligibilityExcerpt(section),
      ],
    },
    limitText: `최대 ${amount[1]}억원`,
    limitMaxWon: requireWon(`${amount[1]}억원`),
    termText: period.text,
    channel: CHANNEL_RND,
    applyUrl: IRIS_APPLY_URL,
    deadlineText: requireRndIntake(section),
    sourceText: officialExcerpt(section),
  });
}

function parseNonRnd(section: string, full: string, name: typeof COMMERCIAL_NAME | typeof OVERSEAS_NAME): NormalizedProduct {
  const g = compact(section);
  const each = g.match(/각\s*최대\s*([\d.]+)\s*억원/);
  const combined = g.match(/합계\s*최대\s*([\d.]+)\s*억원/);
  if (!each) fail("비R&D 사업별 한도(각 최대 N억원)를 해당 절에서 찾지 못했다");
  if (!combined) fail("비R&D 합계 한도(합계 최대 N억원)를 해당 절에서 찾지 못했다");
  if (!/2025년\s*까지/.test(g) && !/[’']25년\s*까지/.test(g)) {
    fail("비R&D 2025년 이전 R&D 협약 요건을 해당 절에서 찾지 못했다");
  }
  if (!/2026년\s*팁스\s*R&D\s*선정기업은\s*2027년부터\s*신청\s*가능/.test(g)) {
    fail("비R&D 2026년 선정기업 2027년 신청 제한을 해당 절에서 찾지 못했다");
  }
  // 공식 표의 순서: 정부지원 상한, 현금 하한, 현물 상한, 자기부담 합계 하한.
  // 첫 '10% 이상'은 현금 부분이라 총 자기부담으로 읽으면 안 된다.
  const shares = g.match(/사업비\s*구성\s*>[\s\S]{0,300}?총\s*사업비의\s*(\d+)\s*%\s*이하\s*총\s*사업비의\s*(\d+)\s*%\s*이상\s*총\s*사업비의\s*(\d+)\s*%\s*이하\s*총\s*사업비의\s*(\d+)\s*%\s*이상/);
  if (!shares || Number(shares[1]) + Number(shares[4]) !== 100) {
    fail("비R&D 자기부담 합계와 정부지원 비율을 사업비 표에서 확인하지 못했다");
  }
  const age = requireConditionalAge(section);
  const period = requireMonthPeriod(section);
  const eligibility = requireMatch(
    g,
    /\(지원대상\)\s*2025년.{10,420}?신청\s*가능/,
    "비R&D 지원 대상 원문",
  );
  const exclusion = requireMatch(
    g,
    /2026년\s*팁스\s*R&D\s*선정기업은\s*2027년부터\s*신청\s*가능/,
    "비R&D 2026년 제외 원문",
  );
  return grantProduct({
    name,
    targetText: eligibilityExcerpt(section, name === COMMERCIAL_NAME ? "commercial" : "overseas"),
    targetRules: {
      humanCheck: [
        "2025년까지 팁스 R&D 협약 완료",
        "2026년 팁스 R&D 선정기업은 2027년부터 신청 가능",
        `자기부담 총 사업비의 ${shares[4]}% 이상`,
        age.human,
        eligibilityExcerpt(section, name === COMMERCIAL_NAME ? "commercial" : "overseas"),
      ],
    },
    limitText: `최대 ${each[1]}억원(창업사업화·해외마케팅 합계 최대 ${combined[1]}억원)`,
    limitMaxWon: requireWon(`${each[1]}억원`),
    termText: period.text,
    channel: CHANNEL_NONRND,
    applyUrl: KSTARTUP_APPLY_URL,
    deadlineText: requireNonRndIntake(section, full),
    sourceText: officialExcerpt(section),
  });
}

/** 공식 계획 PDF 평문 → 출연 트랙 4건. 절·금액이 없으면 던진다. */
export function parseTips(text: string): NormalizedProduct[] {
  const src = planPlainText(text);
  if (!compact(src)) fail("공식 계획서 본문이 없다");
  if (!/제\s*2026\s*[–-]\s*188호/.test(src) && !/2026\s*[–-]\s*188/.test(src)) {
    fail("공식 수정 공고(제2026-188호) 표시를 찾지 못했다");
  }
  if (!/2026년\s*팁스\s*\(?TIPS\)?\s*창업기업\s*지원계획/.test(src)) {
    fail("공식 지원계획 제목을 찾지 못했다");
  }

  const generalAt = headingIndex(src, GENERAL_HEAD, "일반트랙");
  const deepAt = headingIndex(src, DEEP_HEAD, "딥테크트랙");
  const nonRndAt = headingIndex(src, NONRND_HEAD, "비R&D 연계사업");
  const afterNonRnd = src.search(AFTER_NONRND);
  if (deepAt <= generalAt || nonRndAt <= deepAt) fail("세부사업 절 순서가 공식 계획서와 다르다");

  const general = parseGeneral(sectionBetween(src, generalAt, deepAt, "일반트랙"));
  const deep = parseDeeptech(sectionBetween(src, deepAt, nonRndAt, "딥테크트랙"));
  const nonRndSection = sectionBetween(
    src,
    nonRndAt,
    afterNonRnd < 0 ? src.length : afterNonRnd,
    "비R&D 연계사업",
  );
  if (!/창업사업화/.test(nonRndSection) || !/해외마케팅/.test(nonRndSection)) {
    fail("비R&D 절에서 창업사업화·해외마케팅을 찾지 못했다");
  }
  const commercial = parseNonRnd(nonRndSection, src, COMMERCIAL_NAME);
  const overseas = parseNonRnd(nonRndSection, src, OVERSEAS_NAME);

  const rows = [general, deep, commercial, overseas];
  if (rows[0].sourceId !== sourceIdOf(GENERAL_NAME)) fail("일반트랙 sourceId 가 안정 계약과 다르다");
  if (new Set(rows.map((r) => r.sourceId)).size !== 4) fail("네 트랙 sourceId 가 겹친다");
  return rows;
}

type HrefHit = { href: string; name: string };

function nearbyName(el: { text: string; parentNode?: unknown; querySelector?: (s: string) => { text: string } | null }): string {
  let cur: { text?: string; parentNode?: unknown; querySelector?: (s: string) => { text: string } | null } | null = el;
  for (let i = 0; i < 6 && cur; i++) {
    if (typeof cur.querySelector === "function") {
      const named = cur.querySelector(".name");
      if (named?.text) {
        return compact(named.text).replace(/\[\s*[\d.]+\s*KB\s*\]/i, "").trim();
      }
    }
    cur = (cur.parentNode as typeof cur) ?? null;
  }
  const own = compact(el.text ?? "");
  if (own && !/^(내려받기|다운로드|외부 내려받기)$/.test(own)) return own;
  return "";
}

function collectHrefHits(html: string): HrefHit[] {
  const root = parse(html);
  const out: HrefHit[] = [];
  const seen = new Set<string>();
  const push = (href: string, name: string) => {
    const h = unescapeHref(href);
    if (!h || seen.has(h)) return;
    seen.add(h);
    out.push({ href: h, name });
  };
  for (const el of root.querySelectorAll("[href], [data-href]")) {
    const href = el.getAttribute("href") || el.getAttribute("data-href") || "";
    if (href) push(href, nearbyName(el));
  }
  const attrRe = /(?:href|data-href)\s*=\s*(["'])(.*?)\1/gi;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(html))) push(m[2], "");
  return out;
}

function fileNameOf(u: URL): string {
  const stre = u.searchParams.get("streFileNm") ?? "";
  try {
    return decodeURIComponent(stre);
  } catch {
    return stre;
  }
}

function officialPlanPdfUrl(href: string): { url: URL; foreign: boolean; malformed: boolean } {
  let u: URL;
  try {
    u = new URL(unescapeHref(href), TIPS_DETAIL_URL);
  } catch {
    return { url: new URL(TIPS_DETAIL_URL), foreign: false, malformed: true };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { url: u, foreign: false, malformed: true };
  }
  if (u.username || u.password) return { url: u, foreign: false, malformed: true };
  if (u.hostname !== MSS_HOST) return { url: u, foreign: true, malformed: false };
  if (u.pathname !== DOWNLOAD_PATH) return { url: u, foreign: false, malformed: true };
  u.protocol = "https:";
  u.hash = "";
  u.port = "";
  return { url: u, foreign: false, malformed: false };
}

function noticeQuery(): { bcIdx: string; cbIdx: string } {
  const u = new URL(TIPS_DETAIL_URL);
  return { bcIdx: u.searchParams.get("bcIdx") ?? "", cbIdx: u.searchParams.get("cbIdx") ?? "" };
}

function pdfScore(u: URL, name: string, notice: { bcIdx: string; cbIdx: string }): number {
  const file = fileNameOf(u);
  if (/\.zip$/i.test(file) || /\.zip$/i.test(name)) return -100;
  if (!/\.pdf$/i.test(file) && !/\.pdf$/i.test(name)) return -100;
  let s = 1;
  if (notice.bcIdx && u.searchParams.get("bcIdx") === notice.bcIdx) s += 8;
  if (notice.cbIdx && u.searchParams.get("cbIdx") === notice.cbIdx) s += 2;
  if (/지원계획|팁스|TIPS/i.test(name) || /지원계획|팁스|TIPS/i.test(file)) s += 4;
  return s;
}

function planPdfFromHtml(html: string): { name: string; url: string; kind: "pdf" } {
  const hits = collectHrefHits(html);
  if (hits.length === 0) fail("공식 계획 PDF 주소를 공고에서 찾지 못했다");

  const official: Array<{ url: URL; name: string; score: number }> = [];
  let sawForeign = false;
  let sawMalformed = false;
  const notice = noticeQuery();

  for (const hit of hits) {
    if (!/Download\.do|\.pdf|\.zip/i.test(hit.href)) continue;
    const judged = officialPlanPdfUrl(hit.href);
    if (judged.malformed) {
      sawMalformed = true;
      continue;
    }
    if (judged.foreign) {
      sawForeign = true;
      continue;
    }
    const file = fileNameOf(judged.url);
    if (/\.zip$/i.test(file)) continue;
    if (!/\.pdf$/i.test(file)) continue;
    const name = hit.name || file;
    official.push({ url: judged.url, name, score: pdfScore(judged.url, name, notice) });
  }

  if (official.length === 0) {
    if (sawForeign) fail("첨부 주소가 공식 호스트(www.mss.go.kr)가 아니다");
    if (sawMalformed) fail("첨부 주소가 공식 Download.do PDF 경로가 아니다");
    fail("공식 계획 PDF 주소를 공고에서 찾지 못했다");
  }

  const matched = notice.bcIdx
    ? official.filter((p) => p.url.searchParams.get("bcIdx") === notice.bcIdx)
    : [];
  const pool = matched.length > 0 ? matched : official;
  pool.sort((a, b) => b.score - a.score);
  const best = pool[0];
  if (!best || best.score < 0) fail("계획 PDF가 아니라 관련 없는 첨부만 있다");
  return { name: best.name, url: best.url.toString(), kind: "pdf" };
}

function actualPdfTextOf(att: AttachmentTextResult): string {
  if (att.proxyFailed) fail("첨부 PDF를 받는 통로가 실패했다");
  if (att.failedFiles.length > 0) fail("첨부 PDF를 읽지 못했다");
  if (att.skippedFiles.length > 0) fail("첨부 PDF가 잘렸거나 건너뛰어졌다");
  if (att.readFiles.length === 0) fail("첨부 PDF에서 실제 글을 얻지 못했다");
  const body = planPlainText(att.text).replace(/\[(읽지 못한 첨부|미확인 첨부|허용되지 않은 첨부 주소):[^\]]*\]/g, "").trim();
  if (!body) fail("첨부 PDF에서 실제 글을 얻지 못했다");
  return body;
}

export async function fetchTipsAll(): Promise<NormalizedProduct[]> {
  const html = await fetchProductText(MSS_FETCH, TIPS_DETAIL_URL);
  const pdf = planPdfFromHtml(html);
  const att = await fetchAttachmentTexts([pdf], ATTACH_OPTS);
  return parseTips(actualPdfTextOf(att));
}

export const tipsSource: ProductSource = {
  id: SOURCE_ID,
  label: "TIPS(민간투자주도형기술창업지원)",
  url: TIPS_DETAIL_URL,
  fetchAll: fetchTipsAll,
};
