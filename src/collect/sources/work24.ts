// 고용24(work24.go.kr) 고용정책 제도 어댑터 — 번호 훑기.
// 목록 페이지는 자동 수집을 차단하지만 상세는 번호 하나로 열린다(설계서 §2 실측).
// 로그인·열쇠 불필요. robots.txt 허용 경로. 하루 1회 · 요청 간격 700ms.
import type { NormalizedAnnouncement } from "../types";

const DETAIL = "https://www.work24.go.kr/cm/c/f/1100/selecSystInfo.do";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
export const FETCH_TIMEOUT_MS = 10_000;
const SEED_START = 1;
const SEED_END = 600;
const FRONTIER = 200; // 아는 최대 번호 뒤로 이만큼 탐색
const SUMMARY_MAX = 3000;
const CONSECUTIVE_NET_FAIL_ABORT = 10;
/**
 * 한 회차에 훑는 최대 시간. 번호 716개를 700ms 간격으로 다 돌면 **13분**인데(2026-09-02 실측),
 * 배포가 **중앙값 9분**마다 컨테이너를 갈아치워서 통째로는 끝나지 않는다 — 배포가 잦은 낮이면
 * 매 회차 저장 0건으로 고정된다. 6분씩 끊어 훑고 **다음 회차가 그 자리부터 잇는다.**
 */
export const SCAN_BUDGET_MS = 6 * 60_000;
/** 다음에 이어볼 번호를 적어 두는 장부 열쇠. */
export const WORK24_CURSOR_KEY = "policy-match-work24-cursor";
/**
 * 비율 안전선(통신 실패율·파싱 성공률)을 적용할 최소 표본. 6분씩 쪼개 훑으면 한 구간에
 * 아는 번호가 한둘만 걸릴 수 있는데, 그 하나가 **정상적으로 없어진 제도**면 「0/1 = 표식 소실」로
 * 오인해 멀쩡한 회차를 통째로 버린다. 운영에선 한 구간에 아는 번호가 수십 개 걸리므로
 * 20 이면 진짜 개편은 그대로 잡는다.
 */
export const RATIO_MIN_SAMPLE_DEFAULT = 20;

const decodeEntities = (v: string) =>
  v
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, "&");
const stripTags = (v: string) =>
  decodeEntities(v.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

export interface Work24Sections {
  개요: string;
  지원내용: string;
  지원자격: string;
}

export interface Work24Detail {
  title: string;
  summary: string;    // 지원내용 앞 3000자
  targetText: string; // 지원자격 원문(태그 제거)
  applyUrl: string;   // 본문 속 「신청」 근처 링크 (없으면 "")
  sections: Work24Sections;
}

/** https 이고 호스트가 .go.kr / .or.kr 로 끝날 때만 채택. 아니면 빈값. */
function acceptedApplyUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return "";
    const host = u.hostname.toLowerCase();
    if (host.endsWith(".go.kr") || host.endsWith(".or.kr")) return raw;
    return "";
  } catch {
    return "";
  }
}

/** 상세 HTML → 추출. 내용 h3(지원내용 또는 자격조건류 표제 중 하나)가 하나도 없으면 null(빈 번호·개편 감지). */
export function parseWork24Detail(html: string, systId: string): Work24Detail | null {
  // 제도명: h2_sb 전부 중 빈 머리·「고객센터」를 빼고 마지막.
  // 첫 번째는 사이트 머리 함정, 맨 끝은 글자 없는 빈 머리가 실전에 있음. class 속성 순서 무관.
  const h2Matches = [...html.matchAll(/<h2\b[^>]*class="[^"]*\bh2_sb\b[^"]*"[^>]*>([\s\S]*?)<\/h2>/g)];
  const titled = h2Matches.filter((m) => {
    const t = stripTags(m[1]);
    return t !== "" && !t.startsWith("고객센터");
  });
  const titleMatch = titled.length ? titled[titled.length - 1] : undefined;
  const title = titleMatch ? stripTags(titleMatch[1]) : "";
  // 본문 기준점: 제목 h2 가 있으면 그것, 없으면(B변형) 「첫 빈 h2_sb」 — 빈 머리가 곧 본문 머리 자리다(실측).
  // 기준점이 아예 없으면 개요를 비운다 — 문서 전체를 개요로 삼으면 사이트 메뉴 글자가 오염된다(리뷰 치명 C3).
  const emptyHeads = h2Matches.filter((m) => stripTags(m[1]) === "");
  const anchorMatch = titleMatch ?? emptyHeads[0];
  const afterH2 = anchorMatch ? html.slice((anchorMatch.index ?? 0) + anchorMatch[0].length) : "";
  const firstH3Rel = afterH2.search(/<h3[^>]*>/);
  const overview = anchorMatch ? stripTags(firstH3Rel >= 0 ? afterH2.slice(0, firstH3Rel) : afterH2) : "";

  // 섹션: <h3 …>이름</h3> 뒤부터 다음 h3 전까지가 본문.
  const parts = html.split(/<h3[^>]*>/);
  const sections = new Map<string, string>();
  for (const part of parts.slice(1)) {
    const nameEnd = part.indexOf("</h3>");
    if (nameEnd < 0) continue;
    const name = stripTags(part.slice(0, nameEnd));
    const bodyHtml = part.slice(nameEnd + 5);
    if (name && !sections.has(name)) sections.set(name, bodyHtml);
  }
  // 자격조건 표제가 제도마다 다른 낱말을 쓴다(2026-08-31 실측: SI00000306 「가입대상」·
  // SI00000307/311 「신청자격」·SI00000350 「지원대상」·SI00000333/365 「신청대상」·
  // SI00000370/438 「지원조건」·SI00000335 「참여대상」(fable 리뷰 중요1 실측) — 「지원자격」은
  // 그중 하나일 뿐이었다. 실 데이터 56건 재확인 결과 이 7개로 21→26건 해결, 나머지는 표제가
  // 제각각(예: 「고용허가제 요건」)이거나 그 제도에 자격조건 구역 자체가 없어 무리하게 늘리지
  // 않는다(오탐 위험 대비 실익 낮음). 못 찾으면 자격조건이 빈 채로 저장돼 회사 조건 대조가
  // 안 된다 — 우선순위대로 훑는다.
  const QUALIFY_HEADINGS = ["지원자격", "신청자격", "가입대상", "지원대상", "신청대상", "지원조건", "참여대상"];
  const firstMatchingSection = (names: string[]): string => {
    for (const n of names) {
      const v = sections.get(n);
      // 표제는 있는데 본문이 공백뿐인 경우 그냥 truthy 로 잡으면 안 된다 — 다음 우선순위
      // 후보(예: 「지원자격」이 빈 채로 있고 그 아래 「신청자격」에 진짜 내용이 있는 경우)를
      // 못 본다(fable 리뷰 중요2 실측).
      if (v && stripTags(v)) return v;
    }
    return "";
  };
  const qualifyHtml = firstMatchingSection(QUALIFY_HEADINGS); // 한 번만 구해 아래(contentHtml·targetText)에서 같이 쓴다.
  const contentHtml = (sections.get("지원내용") ?? "") + qualifyHtml;
  if (!contentHtml) return null;

  // 신청 주소: 제목 h2 이후 본문 전체에서 찾는다 — 실측상 「(기업의 사업신청 URL)」 링크가
  // 지원내용 h3 보다 앞의 「개요」 구역에 있다(고정본 실측: anchor @3176 < 첫 h3 @5290).
  // 규칙: 「신청」 낱말이 직전 200자 안에 있는 http 링크 중 첫 허용(.go.kr/.or.kr https) 채택.
  // 창의 시작은 직전 후보 링크의 끝 이후 — 한 「신청」이 거부된 링크와 그 다음 무관 링크를 둘 다 보증하지 못하게.
  // 도메인 검사에서 거부되면 다음 후보를 계속 본다(목차 #앵커·javascript 링크는 제외됨).
  const region = anchorMatch ? html.slice(anchorMatch.index ?? 0) : "";
  let applyUrl = "";
  let prevLinkEnd = 0;
  for (const m of region.matchAll(/<a\b[^>]*href="(https?:\/\/[^"]+)"/g)) {
    const windowStart = Math.max(prevLinkEnd, m.index! - 200);
    const before = region.slice(windowStart, m.index!);
    const close = region.indexOf("</a>", m.index!);
    prevLinkEnd = close >= 0 ? close + 4 : m.index! + m[0].length;
    if (!/신청/.test(stripTags(before))) continue;
    const accepted = acceptedApplyUrl(m[1]);
    if (accepted) { applyUrl = accepted; break; }
  }

  const supportHtml = sections.get("지원내용") ?? "";
  const summary = stripTags(supportHtml).slice(0, SUMMARY_MAX);
  const targetText = stripTags(qualifyHtml);
  // 제목이 비어도 null 이 아니다 — 실전에 「내용은 있는데 제목 h2 가 빈」 서버 변형이 실재
  // (2026-08-26 실측: <h2 class="h2_sb"></h2>). 제목 확보는 수집 루프가 재시도·추정으로 맡는다.
  return {
    title,
    summary,
    targetText,
    applyUrl,
    sections: {
      개요: overview,
      지원내용: stripTags(supportHtml),
      지원자격: targetText,
    },
  };
}

/** 개인 전용 판정 — 개인 낱말만 있고 기업 낱말이 전혀 없을 때만 true(애매하면 담는다). */
/**
 * 제목 h2 가 빈 서버 변형에서 본문으로 제도명을 추정한다(비상용 — 재시도·저장 제목이 먼저다).
 * 낱말 단위로만 본다: 「…장려금/지원금/지원사업/바우처/보조금」으로 끝나는 첫 낱말(조사 허용).
 * 문장 한가운데를 끌고 오지 않도록 공백 포함 조각은 아예 후보로 삼지 않는다(리뷰 상 H3).
 * 없으면 지원내용 앞 40자 + 말줄임. 그것도 없으면 빈 문자열(호출부가 그 건을 회차에서 뺀다).
 */
export function estimateTitle(sections: Work24Sections): string {
  const body = `${sections.개요} ${sections.지원내용} ${sections.지원자격}`.replace(/\s+/g, " ");
  const SUFFIX = /(장려금|지원금|지원사업|바우처|보조금)(을|를|이|가|은|는|과|와|도|의|만|으로|로)?$/;
  for (const tok of body.match(/[가-힣A-Za-z0-9·]+/g) ?? []) {
    const m = SUFFIX.exec(tok);
    if (!m) continue;
    const core = m[2] ? tok.slice(0, tok.length - m[2].length) : tok; // 조사 떼기
    const cleaned = core.replace(/^(?:19|20)\d\d년도?/, "");
    if (cleaned.length >= 5 && cleaned.length <= 24 && !/^(장려금|지원금|지원사업|바우처|보조금)$/.test(cleaned)) {
      return cleaned;
    }
  }
  const lead = sections.지원내용.trim() || sections.개요.trim();
  return lead ? `${lead.slice(0, 40)}…` : "";
}

export function isIndividualOnly(targetText: string, title: string): boolean {
  const t = `${title} ${targetText}`;
  const corp = /(사업주|기업|사업장|법인|소상공인|자영업|채용|고용(?:한|하면|유지|창출))/;
  const indiv = /(구직자|실업자|실업급여|구직급여|취업준비|취업지원|훈련생|근로자 개인)/;
  return indiv.test(t) && !corp.test(t);
}

const toId = (n: number) => `SI${String(n).padStart(8, "0")}`;
const toNum = (id: string) => {
  const m = /^SI(\d{8})$/.exec(id.trim());
  return m ? Number(m[1]) : null;
};

/** 훑을 번호 목록 — 1 ~ max(시딩끝, 아는 최대+200) 전 구간 + 아는 번호. */
export function planScanIds(knownIds: string[], seedEnd = SEED_END): string[] {
  const nums = knownIds.map(toNum).filter((n): n is number => n !== null);
  const knownMax = nums.length === 0 ? 0 : Math.max(...nums);
  const end = Math.max(seedEnd, knownMax + FRONTIER);
  const set = new Set<number>();
  for (let n = SEED_START; n <= end; n++) set.add(n);
  for (const n of nums) set.add(n);
  return [...set].sort((a, b) => a - b).map(toId);
}

export type Work24Fetcher = (systId: string) => Promise<{ status: number; text: string }>;

const realFetcher: Work24Fetcher = async (systId) => {
  const res = await fetch(`${DETAIL}?systId=${systId}`, {
    headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  return { status: res.status, text: await res.text() };
};

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

const RETRY_BUDGET_PER_RUN = 30; // 빈 제목 재시도 총량 상한(회차당)

export interface FetchWork24Options {
  knownIds?: string[];       // 미지정이면 loadKnown 으로 읽는다(앱 주입)
  knownTitles?: Map<string, string>; // 아는 번호의 저장된 진짜 제목(knownIds 와 함께 줄 때)
  fetcher?: Work24Fetcher;   // 시험 주입용
  delayMs?: number;          // 기본 700
  seedEnd?: number;          // 시험 주입용
  loadStored?: (ids: string[]) => Promise<NormalizedAnnouncement[]>;
  now?: () => number;               // 시험 주입용 시계(ms)
  budgetMs?: number;                // 이 시간이 지나면 이번 회차는 여기까지만 훑는다
  loadCursor?: () => Promise<number>;      // 이어볼 번호 읽기(앱 주입 — 없으면 SEED_START)
  saveCursor?: (n: number) => Promise<void>; // 다음에 이어볼 번호 적기(앱 주입 — 없으면 무시)
  ratioMinSample?: number;          // 비율 안전선을 적용할 최소 표본(시험 주입용)
  /**
   * 아는(열린) 고용24 번호와 그 저장 제목을 읽는다 — `knownIds` 를 안 주면 이걸 부른다.
   * 원문(ERP): `prisma.policyAnnouncement.findMany({ where:{ source:"work24", status:"open" },
   * select:{ sourceId:true, title:true } })` → `{ knownIds: rows.map(r=>r.sourceId),
   * storedTitles: Map(제목 있는 것) }`. 안 주면 아는 번호 없이(시딩 모드) 돈다.
   */
  loadKnown?: () => Promise<{ knownIds: string[]; storedTitles: Map<string, string> }>;
}

/**
 * 수집 한 바퀴. 안전선(설계서 §5):
 * - 아는 번호의 통신 실패(예외·200 아님) 비율 >= 50% → 던진다(동률 포함 — 마감 오염 방지)
 * - 비율 미만이면 실패한 아는 번호는 열린 저장 행만 되살려 내보낸다
 * - 빈 번호(200 이지만 내용 h3 없음)는 통신 실패가 아니다 — 빠져서 마감된다
 * - 아는 번호의 파싱 성공 비율 < 50% → 던진다(표식 소실·사이트 개편 의심)
 * - 통신 실패가 연속 10번 → 즉시 던진다(연쇄 장애)
 * - 「정상적인 접근 방식이 아닙니다」가 상세에서도 나오면 → 즉시 던진다(차단 감지)
 * - 시딩 모드(아는 번호 0)는 빈 번호가 정상이므로 통신 오류율로만 판단
 */
export async function fetchWork24All(opts: FetchWork24Options = {}): Promise<NormalizedAnnouncement[]> {
  const fetcher = opts.fetcher ?? realFetcher;
  const delayMs = opts.delayMs ?? 700;
  const loadStored = opts.loadStored ?? (async () => []);
  let knownIds: string[];
  let storedTitles: Map<string, string>;
  if (opts.knownIds) {
    knownIds = opts.knownIds;
    storedTitles = opts.knownTitles ?? new Map();
  } else {
    // 닫힌 행이 분모에 쌓이면 자연 폐기가 절반을 넘어 개편 감지가 매회 오발한다.
    // 닫힌 번호는 전 구간 훑기(1~끝)가 어차피 다시 방문하므로 되살아날 길은 유지된다(loadKnown 은 open 만 준다).
    const known = await (opts.loadKnown?.() ?? Promise.resolve({ knownIds: [], storedTitles: new Map<string, string>() }));
    knownIds = known.knownIds;
    storedTitles = known.storedTitles;
  }
  const ids = planScanIds(knownIds, opts.seedEnd);
  const knownSet = new Set(knownIds);

  // ── 시간 예산으로 쪼개 이어보기 ──────────────────────────────────────────
  const nowMs = opts.now ?? (() => Date.now());
  //  아는 번호가 늘어 6분 안에 다 못 보게 되면, 앞쪽만 되풀이 조회하고 뒤쪽은 **한 번도 확인
  //  안 한 채 「최신·열림」으로 보이게 된다**(복원이 lastSeenAt 을 올려 주기 때문 — 적대 리뷰 높음①).
  //  그래서 아는 번호가 다 들어갈 만큼은 예산을 늘린다(상한 10분).
  const knownCount = new Set(knownIds).size;
  const neededForKnownMs = Math.ceil(knownCount * 1.2) * 1000 + 30_000;
  const budgetMs = opts.budgetMs ?? Math.min(10 * 60_000, Math.max(SCAN_BUDGET_MS, neededForKnownMs));
  const loadCursor = opts.loadCursor ?? (async () => SEED_START);
  const saveCursor = opts.saveCursor ?? (async () => {});
  const startedMs = nowMs();
  const cursor = await loadCursor();
  // ★순서: **아는 번호를 전부 먼저**, 그다음 남은 예산으로 「새 번호 찾기」를 이어보기로 나눈다.
  //
  //  왜 이렇게 나누나(2026-09-02 실측 근거):
  //   · 아는(열린) 번호는 133개 = 2.4분. 예산 6분 안에 **매 회차 다 갱신된다** —
  //     즉 이미 아는 제도의 마감·내용은 늦어지지 않는다(전엔 한 바퀴에 1.5일 걸렸다).
  //   · 안전선(통신 실패율·파싱 성공률)의 표본이 **매번 133개로 보장**된다. 구간을 잘게 쪼갰더니
  //     한 구간에 아는 번호가 한둘만 걸려 안전선이 아예 안 돌던 문제가 사라진다.
  //   · 나머지 583개(빈 번호 탐색)만 이어보기로 나눠 도니, 늦어지는 것은 **아직 세상에 없던
  //     새 번호를 처음 발견하는 시점**뿐이다(회차 3번 ≈ 1.5일). 고용24는 상시 제도라 이 편이 낫다.
  const knownOrdered = ids.filter((id) => knownSet.has(id));
  const discovery = ids.filter((id) => !knownSet.has(id));
  const dStart = discovery.findIndex((id) => (toNum(id) ?? 0) >= cursor);
  const discoveryOrdered = dStart > 0 ? discovery.slice(dStart) : discovery;
  const ordered = [...knownOrdered, ...discoveryOrdered];
  const scanned = new Set<string>();
  let finishedSweep = true;

  const out: NormalizedAnnouncement[] = [];
  const failedKnownIds: string[] = [];
  let knownTried = 0;
  let knownParsedOk = 0;
  let netErrors = 0;
  let consecutiveNetFails = 0;
  let retryBudget = RETRY_BUDGET_PER_RUN; // 재시도 총량 상한 — 최악 회차의 요청 폭증 방지(리뷰 중 M1)
  let titleMissing = 0; // 진짜 제목을 끝내 못 얻은 건수 — 표식 소실 감시(리뷰 치명 C1)

  for (const id of ordered) {
    // 예산을 넘겼으면 여기까지 — 남은 번호는 다음 회차가 잇고, 아래에서 저장된 행으로 메꾼다.
    if (nowMs() - startedMs >= budgetMs) { finishedSweep = false; break; }
    scanned.add(id);
    const isKnown = knownSet.has(id);
    if (isKnown) knownTried++;
    try {
      const res = await fetcher(id);
      if (res.text.includes("정상적인 접근 방식이 아닙니다")) {
        throw new Error(`고용24 차단 감지(${id}) — 회차 중단`);
      }
      if (res.status === 404) {
        // ★404 는 「그런 번호가 없다」는 **정상 응답**이다. 통신 실패로 세면, 아는 번호를 앞에
        //  몰아 훑는 지금 순서에서 없어진 제도 10개가 나란히 걸리기만 해도 「연쇄 통신 실패」로
        //  회차가 통째로 중단된다(적대 리뷰 높음②). 빈 번호와 같이 다뤄 그냥 지나간다.
        consecutiveNetFails = 0;
      } else if (res.status !== 200) {
        consecutiveNetFails++;
        netErrors++;
        if (isKnown) failedKnownIds.push(id);
      } else {
        consecutiveNetFails = 0;
        let d = parseWork24Detail(res.text, id);
        // 「내용은 있는데 제목만 빈」 서버 변형(실측) — 아는 번호에 한해 최대 2회 다시 불러
        // 제목 있는 변형을 노린다(새 번호까지 3배로 두드리지 않는다 — 리뷰 중 M1).
        for (let extra = 0; d && !d.title && isKnown && retryBudget > 0 && extra < 2; extra++) {
          retryBudget--;
          await sleep(delayMs);
          try {
            const r2 = await fetcher(id);
            if (r2.text.includes("정상적인 접근 방식이 아닙니다")) {
              throw new Error(`고용24 차단 감지(${id} 재시도) — 회차 중단`); // 리뷰 상 H1
            }
            if (r2.status === 200) {
              const d2 = parseWork24Detail(r2.text, id);
              if (d2 && d2.title) d = d2;
            } else {
              netErrors++; // 리뷰 상 H2 — 재시도 실패도 안전선 계수에 반영
            }
          } catch (e2) {
            if (e2 instanceof Error && /차단 감지/.test(e2.message)) throw e2;
            netErrors++;
          }
        }
        if (isKnown && d) knownParsedOk++;
        // 표시 제목 결정 순서: 진짜 제목 → 저장된 진짜 제목 → 본문 추정 → 그래도 없으면 이 회차에서 뺀다.
        // 추정 제목은 개인전용 판정에 쓰지 않는다(엉뚱한 낱말로 판정이 뒤집힘 — 리뷰 치명 C2)
        // 저장된 진짜 제목을 추정으로 덮지 않는다(제목 오염 방지 — 리뷰 치명 C1).
        const realTitle = d?.title ?? "";
        let displayTitle = realTitle || storedTitles.get(id) || (d ? estimateTitle(d.sections) : "");
        if (d && !realTitle) titleMissing++;
        if (d && !displayTitle) d = null; // 제목을 어떤 수로도 못 정하면 담지 않는다(빈 제목 저장 금지 — 리뷰 상 H4)
        if (d && !isIndividualOnly(d.targetText, realTitle)) {
          out.push({
            source: "work24",
            sourceId: id,
            title: displayTitle,
            agency: "고용노동부(고용24)",
            category: "인력",
            region: "",
            summary: d.summary,
            targetText: d.targetText,
            applyStart: null,
            applyEnd: null,
            applyPeriodText: "상시(제도)",
            url: `${DETAIL}?systId=${id}`,
            attachments: [],
            raw: { systId: id, applyUrl: d.applyUrl, sections: d.sections },
          });
        }
      }
    } catch (e) {
      if (e instanceof Error && /차단 감지/.test(e.message)) throw e;
      consecutiveNetFails++;
      netErrors++;
      if (isKnown) failedKnownIds.push(id);
    } finally {
      await sleep(delayMs);
    }
    if (consecutiveNetFails >= CONSECUTIVE_NET_FAIL_ABORT) {
      throw new Error("연쇄 통신 실패 — 회차 중단");
    }
  }

  // 다음에 이어볼 번호. 한 바퀴 다 돌았으면 처음으로 되돌린다.
  // 이어볼 자리는 **탐색 몫에서만** 센다. 아는 번호는 매 회차 전부 훑으므로 자리 개념이 없고,
  // 그 번호(242~516)를 섞어 세면 자리가 엉뚱하게 튀어 탐색 구간을 건너뛴다.
  const lastDiscovery = [...scanned]
    .filter((id) => !knownSet.has(id))
    .map(toNum)
    .filter((n): n is number => n !== null);
  const nextCursor = finishedSweep
    ? SEED_START
    : (lastDiscovery.length ? Math.max(...lastDiscovery) + 1 : cursor);
  // ★회차를 버릴 때는 이어볼 자리도 **되돌린다.** 안 그러면 이번 구간에서 처음 본 새 번호가
  //  저장도 안 되고(회차 폐기) 아는 번호도 아니라 되살릴 수도 없어, 한 바퀴 돌아올 때까지
  //  발견 자체가 사라진다(적대 리뷰 높음①).
  //  ⚠️ 단, **되돌릴 것과 아닌 것을 가른다.** 통신 실패는 대개 일시적이라 같은 구간을 다시 보는 게 맞다.
  //  반면 「파싱 실패」는 그 구간의 제도가 **정상적으로 없어져서** 날 수도 있는데, 그때 매번 되돌리면
  //  같은 자리에서 영원히 같은 비율로 걸려 **뒤쪽 번호를 영영 못 본다**(적대 리뷰: 자기고착).
  //  그래서 파싱률로 버릴 때는 회차만 버리고 자리는 앞으로 보낸다.
  const discardRun = async (message: string, rewind: boolean): Promise<never> => {
    await saveCursor(rewind ? cursor : nextCursor);
    throw new Error(message);
  };

  // ★비율 안전선은 **표본이 어느 정도 쌓였을 때만** 본다. 6분씩 쪼개 훑으면 한 구간에 아는 번호가
  //  한둘만 걸릴 수 있는데, 그 하나가 정상적으로 없어진 제도면 「0/1 = 표식 소실」로 오인해
  //  멀쩡한 회차를 통째로 버린다(적대 리뷰 높음②).
  const RATIO_MIN_SAMPLE = opts.ratioMinSample ?? RATIO_MIN_SAMPLE_DEFAULT;
  if (knownTried >= RATIO_MIN_SAMPLE && failedKnownIds.length / knownTried >= 0.5) {
    await discardRun(
      `고용24 아는 번호 통신 실패 ${failedKnownIds.length}/${knownTried} — 50% 이상이라 회차 폐기(마감 오염 방지)`,
      true, // 통신 문제는 일시적 — 같은 구간을 다시 본다
    );
  }
  if (knownTried >= RATIO_MIN_SAMPLE) {
    const okRate = knownParsedOk / knownTried;
    // ★「거의 전부」일 때만 버린다. 절반 기준이면 **연말에 제도가 대량 정상 폐지**되기만 해도
    //  매 회차 같은 자리에서 걸려 영영 못 빠져나온다(적대 리뷰 높음③ — 아는 번호를 매번 앞에
    //  놓으면서 더 확실해졌다). 절반쯤 사라지는 것은 저장 쪽 「절반 미만이면 닫기 건너뜀」
    //  안전선이 이미 막아 주므로 여기서 두 번 막을 이유가 없다.
    if (okRate < 0.1) {
      await discardRun("표식 소실 — 사이트 개편 의심, 회차 폐기", false);
    } else if (okRate < 0.5) {
      console.warn(`[policy-match] 고용24 파싱 성공률 ${knownParsedOk}/${knownTried} — 대량 폐지인지 개편인지 확인 필요(회차는 진행)`);
    }
  }
  // 시딩(아는 번호가 없는 구간)은 **이번에 훑은 개수**로 잰다 — 전체 목록 길이로 나누면
  // 3건 중 2건이 실패해도 2/716 로 희석돼 장애를 그냥 통과시킨다(적대 리뷰 높음②).
  // 통신 오류율은 **아는 번호가 있든 없든** 이번에 훑은 구간 기준으로 본다.
  // 아는 번호가 1~19개 섞인 구간은 위 두 검사(최소표본)와 `knownTried === 0` 조건 사이로
  // 통째로 새어 나갔다 — 60% 가 500 이어도 아무 검사에 안 걸렸다(적대 리뷰 높음).
  if (scanned.size >= RATIO_MIN_SAMPLE && netErrors / scanned.size > 0.5) {
    await discardRun(`고용24 통신 오류율 ${netErrors}/${scanned.size} — 회차 폐기`, true);
  }
  // 제목 표식 소실 감시(치명 C1의 잔여 위험): 진짜 제목 확보율이 무너지면 시끄럽게 남긴다.
  // 회차를 버리진 않는다 — 저장된 진짜 제목은 위 순서 규칙이 지키고, 빈 변형 지속(실측 2회)이 실재해서다.
  if (titleMissing > 0) {
    console.warn(`[policy-match] 고용24 진짜 제목 미확보 ${titleMissing}건 — 빈 제목 변형 지속 또는 제목 표식 변경 의심`);
  }
  // ★이번에 못 본 아는 번호는 「사라진 것」이 아니라 **차례가 안 온 것**이다.
  //  저장된 열린 행을 그대로 돌려주지 않으면 markStaleClosed 가 「이번 수집에 안 실려 왔다」로 보고
  //  멀쩡히 살아 있는 제도를 통째로 닫는다 — 쪼개 훑기에서 가장 위험한 갈래라 여기서 막는다.
  const unseenKnownIds = knownIds.filter((id) => !scanned.has(id));
  const restoreIds = [...new Set([...failedKnownIds, ...unseenKnownIds])];
  if (restoreIds.length > 0) {
    out.push(...(await loadStored(restoreIds)));
  }
  // ★이어볼 자리는 **여기서** 적는다. 복원 조회가 실패하면 이 회차 결과는 통째로 버려지는데,
  //  자리만 앞으로 가 있으면 이번 구간에서 처음 본 새 번호가 한 바퀴 돌 때까지 사라진다.
  await saveCursor(nextCursor);
  return out;
}
