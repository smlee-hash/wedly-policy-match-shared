/**
 * 희망리턴패키지(소상공인시장진흥공단) — 상시 상품 수집기(설계 2026-09-03, 계획서 Task 13).
 * 폐업(예정) 소상공인·경영위기 소상공인에게 사업정리컨설팅·점포철거비·법률자문·채무조정·재기교육 등을
 * 패키지로 지원한다 — 전부 갚지 않는 돈(무상)이라 이 카탈로그에서는 fundingGroup:"urgent"
 * (설계 §3-2 6갈래 표에 「희망리턴패키지(폐업)」가 urgent 예시로 못박혀 있다).
 *
 * ★실사이트 실측(2026-09-03, 계획서 Task 13 이 못박은 「main.do 쿠키를 들고 GET」 을 실제로 돌려보고
 * 바로잡음) — 메뉴 POST(`/menu/menuLink.do`)가 302 만 돌려주는 것과 별개로, `main.do` 자체도
 * WAS 세션 필터가 걸려 있어 `fetchProductWithCookies` 로 찍으면(리다이렉트를 안 따라간다) **첫 히트에
 * 무조건 302("쿠키 받기 요청은 리다이렉트를 따라가지 않는다")** 를 던진다. 그런데 이 필터는
 * `main.do` 전용이 아니라 **쿠키 없는 요청 전부**에 걸린다 — intro·onestop 두 상세 주소도 쿠키 없이
 * 치면 자기 자신(`?null` 붙은 주소)으로 302 + `Set-Cookie: WMONID·JSESSIONID` 를 준다. 즉
 * **`fetchProductText` 하나로 충분하다** — 그 함수가 이미 리다이렉트를 최대 3홉까지 따라가며 같은
 * 호출 안에서 쿠키 항아리를 들고 다니므로, intro·onestop 주소를 쿠키 없이 그냥 GET 하면 1홉째에서
 * 쿠키를 받고 2홉째(`…?null`)에서 200 전체 본문이 온다(실측 확인: intro 31,760바이트·onestop
 * 36,509바이트, 둘 다 기대 낱말 포함). `main.do` 부트스트랩·수동 Cookie/Referer 헤더는 필요 없다.
 *   · https://www.sbiz.or.kr/nhrp/intro/bizIntroduce.do (사업소개 — 지원단계별 안내표)
 *   · https://www.sbiz.or.kr/nhrp/cnsl/bsnsArngCnslInfo.do (원스톱폐업지원 — 단일 사업 개요)
 *
 * 두 페이지는 모양이 다르다: intro 는 「구분·지원사업·지원내용」 3열 표(rowspan)에 세부 지원사업이
 * 11건 줄지어 있고, onestop 은 「원스톱폐업지원」이라는 사업 하나를 사업목적·지원대상·지원내용
 * 섹션으로 설명한다(중첩 표 안에 세부 항목이 또 있지만 여기서는 사업 단위 요약 1건으로만 담는다 —
 * intro 표의 4항목(사업정리컨설팅·점포철거비·법률자문·채무조정)을 onestop 에서 또 쪼개 세면 이중
 * 집계가 된다). `fetchHopeReturnAll` 이 두 결과를 이름으로 합치고(같은 이름은 intro 우선), intro 에
 * 없는 onestop 전용 이름(「원스톱 폐업지원」)만 보탠다.
 */
import { parse, type HTMLElement } from "node-html-parser";
import { extractAmount } from "../../../funding/amount-rate-extract";
import { fetchProductText } from "../fetch";
import type { NormalizedProduct, ProductSource, ProductTargetRules } from "../types";

/** 명부 id·FinanceProduct.source 공통 계약 — 접두어 `product-`(2026-09-03 자금 조달 지도 공통 계약). */
const SOURCE_ID = "product-hope-return";
const HOST = "https://www.sbiz.or.kr";
export const HOPE_RETURN_MAIN_URL = "https://www.sbiz.or.kr/nhrp/main.do";
export const HOPE_RETURN_INTRO_URL = "https://www.sbiz.or.kr/nhrp/intro/bizIntroduce.do";
export const HOPE_RETURN_ONESTOP_URL = "https://www.sbiz.or.kr/nhrp/cnsl/bsnsArngCnslInfo.do";
const INSTITUTION = "소상공인시장진흥공단";
const CHANNEL = "희망리턴패키지 누리집(sbiz.or.kr/nhrp)";
const CFG = { id: SOURCE_ID, baseUrl: HOST };

/** 지원단계별 안내표 캡션 — 이 글자로 「intro 표」인지 안다(원문 그대로, 실측 2026-09-03). */
const INTRO_TABLE_CAPTION = "지원단계별 지원대상 안내표";

/**
 * 폐업(예정)·경영위기 소상공인 전용 패키지 — 항목 전부 이 규칙 하나(설계 §3, 없는 값을 지어내지 않는다).
 * ★「소상공인」 규모(scale) 만으로는 실질 검증이 아니다(F3, 2026-09-03 코덱스 리뷰 — 규모 조건 하나만
 * 맞아도 「가능」으로 보이던 자리, recommend-score.ts 의 약한 pass 목록에도 companyScale 을 더해
 * 막았다). 진짜 필수조건인 「폐업(예정) 또는 경영위기」는 절대·상대 수치가 아니라 기계로 못 재는
 * 서술 조건이라 humanCheck 원문으로 남긴다 — 지운 게 아니라 사람이 확인하게 옮긴 것이다.
 */
const TARGET_RULES: ProductTargetRules = {
  scale: ["소상공인"],
  humanCheck: ["폐업(예정) 또는 경영위기 소상공인"],
};

function normalizeCell(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** sourceId = 지원사업명에서 공백·괄호만 지운 값(sbiz.ts 와 같은 관례) — 11+1건 전부 이름이 달라 겹치지 않는다. */
function sourceIdOf(name: string): string {
  return name.replace(/\s+/g, "").replace(/[()（）]/g, "");
}

/**
 * `<h4>제목</h4>` 을 감싼 `.stit_area` 의 **다음 형제 엘리먼트** 글 — intro 의 「사업대상」,
 * onestop 의 「사업목적·지원대상·지원내용」이 전부 이 모양(실측 2026-09-03). 못 찾으면 빈 글자
 * (지어내지 않는다).
 */
function sectionTextAfter(root: HTMLElement, heading: string): string {
  for (const area of root.querySelectorAll(".stit_area")) {
    const h4 = area.querySelector("h4");
    if (h4 && normalizeCell(h4.text) === heading) {
      const sib = area.nextElementSibling;
      return sib ? normalizeCell(sib.text) : "";
    }
  }
  return "";
}

/** 지원내용 칸의 `<p>` 들을 이어 붙이되, 안내 링크 글자 "[바로가기]" 는 지운다(사람이 읽을 값이 아니다). */
function contentTextOf(cell: HTMLElement): string {
  const paragraphs = cell.querySelectorAll("p");
  const parts = paragraphs.length ? paragraphs : [cell];
  return parts
    .map((p) => normalizeCell(p.text).replace(/\[바로가기\]\s*$/, "").trim())
    .filter(Boolean)
    .join(" ");
}

function buildProduct(
  name: string,
  targetText: string,
  limit: { amountText: string; amountMaxWon: number | null },
  detailUrl: string,
  raw: unknown,
): NormalizedProduct {
  return {
    source: SOURCE_ID,
    sourceId: sourceIdOf(name),
    fundingGroup: "urgent",
    institution: INSTITUTION,
    institutionType: "policy",
    name,
    productType: "grant",
    targetText,
    targetRules: TARGET_RULES,
    limitText: limit.amountText,
    limitMaxWon: limit.amountMaxWon,
    rateText: "무상",
    rateMin: null,
    rateMax: null,
    feeText: "",
    termText: "",
    channel: CHANNEL,
    applyUrl: HOPE_RETURN_MAIN_URL,
    detailUrl,
    deadlineText: "상시",
    raw,
  };
}

function findIntroTable(root: HTMLElement): HTMLElement | null {
  for (const table of root.querySelectorAll("table")) {
    const caption = table.querySelector("caption");
    if (caption && normalizeCell(caption.text) === INTRO_TABLE_CAPTION) return table;
  }
  return null;
}

/**
 * intro 표(구분·지원사업·지원내용, rowspan)를 읽는다. 「구분」 칸은 rowspan 이라 새 구분이
 * 시작할 때만 3칸, 이어지는 행은 2칸(지원사업·지원내용)뿐이다 — 칸 수로 안다(값으로 매핑표를
 * 만들지 않으니 사이트가 구분을 늘려도 그대로 읽힌다). HTML 주석으로 감싼 행(사이트가 아직 안
 * 연 「재창업지원」)은 node-html-parser 기본값이 주석을 트리에 안 넣어 애초에 안 보인다.
 */
function parseIntroTable(root: HTMLElement, table: HTMLElement): NormalizedProduct[] {
  const audienceText = sectionTextAfter(root, "사업대상");
  const out: NormalizedProduct[] = [];
  let category = "";
  for (const row of table.querySelectorAll("tbody tr")) {
    const cells = row.querySelectorAll("td");
    if (cells.length >= 3) category = normalizeCell(cells[0].text);
    const nameCell = cells.length >= 3 ? cells[1] : cells[0];
    const contentCell = cells.length >= 3 ? cells[2] : cells[1];
    if (!nameCell || !contentCell) continue; // 방어: 칸이 모자란 행(있다면) 건너뛴다
    const name = normalizeCell(nameCell.text);
    if (!name) continue;
    const contentText = contentTextOf(contentCell);
    const limit = extractAmount(contentText);
    const targetText = normalizeCell(`${audienceText} ${contentText}`);
    out.push(
      buildProduct(name, targetText, limit, HOPE_RETURN_INTRO_URL, {
        구분: category,
        지원사업: name,
        지원내용: contentText,
      }),
    );
  }
  return out;
}

/**
 * onestop 페이지는 개별 지원사업 표가 아니라 「원스톱폐업지원」 사업 하나를 소개하는 화면이다
 * (사업목적→지원규모→지원대상→지원내용 섹션 순서). intro 표의 4항목(사업정리컨설팅 등)을 다시
 * 쪼개지 않고 사업 단위 1건만 만든다 — 안 그러면 두 페이지를 합칠 때 같은 지원사업이 이름만
 * 다르게(중첩표 안 항목 이름) 두 번 잡혀 이중 집계될 위험이 크다.
 *
 * ★이름은 `h2.tit span`(사업 제목)이 아니라 **상수로 못박는다**(2026-09-03 재실측 — 리뷰가 지목한
 * main.do 부트스트랩 제거로 직접 GET 하게 되며 드러남). 이 페이지의 `h2.tit`·`h3.tit`·좌측 메뉴는
 * 서버가 세션에 들고 있는 「현재 메뉴」(cMenuNo)를 반영해 채워지는데, 그 값은 사람이 메뉴를 눌러야
 * (POST `/menu/menuLink.do`, 계획서가 이미 못 쓴다고 확인한 그 경로) 서버 세션에 실린다 — 직접 GET
 * 하면 `cMenuNo` 가 빈 문자열로 내려와 `h2.tit`·`h3.tit`·좌측 메뉴 블록 전체가 통째로 사라진다
 * (실측: 같은 주소를 지금 막 다시 받아 보니 <h2 class="tit"> 자체가 없다, 43,414→36,509바이트로
 * 좌측 메뉴만큼 줄어든 크기가 그 증거). 반대로 본문(사업목적·지원대상·지원내용, 아래 중첩표까지)은
 * 메뉴 상태와 무관하게 항상 그대로 온다(실측 확인) — 그래서 본문 섹션이 실제로 잡혔을 때만(=이
 * 주소가 맞을 때만) 상수 이름을 쓴다. 이 상수가 안전한 이유: `bsnsArngCnslInfo.do` 는 사이트
 * 전체에서 오직 이 사업 하나만 설명하는 전용 주소다(사업정리컨설팅 등 표 안 세부 항목과는 다른
 * 레벨의 고정 사실 — sbiz.ts 가 기관명 "소상공인시장진흥공단" 을 상수로 두는 것과 같은 근거).
 */
function parseOnestopOverview(root: HTMLElement): NormalizedProduct[] {
  const purposeText = sectionTextAfter(root, "사업목적");
  const audienceText = sectionTextAfter(root, "지원대상");
  const contentText = sectionTextAfter(root, "지원내용");
  if (!purposeText && !audienceText && !contentText) return []; // 본문 구조를 못 찾으면 지어내지 않는다

  const name = "원스톱 폐업지원"; // 이 주소 전용 고정 이름(위 주석 근거) — 세션 의존적인 h2.tit 을 안 쓴다
  const targetText = normalizeCell([audienceText, purposeText].filter(Boolean).join(" "));
  const limit = extractAmount(`${contentText} ${purposeText}`);

  return [
    buildProduct(name, targetText, limit, HOPE_RETURN_ONESTOP_URL, {
      사업목적: purposeText,
      지원대상: audienceText,
      지원내용: contentText,
    }),
  ];
}

/** 순수 함수 — intro·onestop 두 모양을 페이지 안의 표 유무로 스스로 가른다(실사이트 고정본 기준). */
export function parseHopeReturn(html: string): NormalizedProduct[] {
  const root = parse(html);
  const introTable = findIntroTable(root);
  if (introTable) return parseIntroTable(root, introTable);
  return parseOnestopOverview(root);
}

/** 같은 지원사업명이 두 페이지에 다 있으면 intro 쪽을 우선한다(설계: intro 가 항목별 세부값을 더 갖고 있다). */
function mergeByName(primary: NormalizedProduct[], secondary: NormalizedProduct[]): NormalizedProduct[] {
  const byName = new Map<string, NormalizedProduct>();
  for (const p of primary) if (!byName.has(p.name)) byName.set(p.name, p);
  for (const p of secondary) if (!byName.has(p.name)) byName.set(p.name, p);
  return [...byName.values()];
}

/**
 * intro·onestop 을 순서대로 GET 한다(동시에 쏘지 않는다 — 정부 사이트에 한 번에 여러 요청을
 * 몰아치지 않기 위해서다). 세션 쿠키는 각 호출 안에서 `fetchProductText`(→`fetchBoardText`)가
 * 리다이렉트를 따라가며 스스로 받아 쓴다(위 주석 실측) — 여기서 따로 쿠키를 챙기지 않는다.
 * 합계 3건 미만이면 사이트 개편 등으로 빈 셸을 받은 것으로 보고 던진다(빈 껍데기를 저장하지 않는다).
 */
export async function fetchHopeReturnAll(): Promise<NormalizedProduct[]> {
  const introHtml = await fetchProductText(CFG, HOPE_RETURN_INTRO_URL);
  const onestopHtml = await fetchProductText(CFG, HOPE_RETURN_ONESTOP_URL);
  const merged = mergeByName(parseHopeReturn(introHtml), parseHopeReturn(onestopHtml));
  if (merged.length < 3) {
    throw new Error(`hope-return 이 ${merged.length}건뿐 — 반쪽 응답(빈 셸)으로 보고 저장하지 않는다`);
  }
  return merged;
}

export const hopeReturnSource: ProductSource = {
  id: SOURCE_ID,
  label: "희망리턴패키지",
  url: HOPE_RETURN_MAIN_URL,
  fetchAll: fetchHopeReturnAll,
};
