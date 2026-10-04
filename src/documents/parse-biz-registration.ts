// 사업자등록증·사업자등록증명 글에서 정책매칭 회사 정보 칸을 뽑는다 — 정규식·줄 파싱만 쓰는 순수 함수(저장·네트워크·AI 없음).
//  - 사업자번호, 개업일, 업태·종목(→ 주업종), 사업장 소재지(→ 시도·시군구), 법인 여부
// ★대표자 이름·주민(법인)등록번호는 읽더라도 결과에 넣지 않는다. 법인등록번호는 「있는지」만 보고 값은 버린다.
// ★사업장 소재지는 시도+시군구까지만 남긴다(도로명·번지·건물명은 결과 어디에도 없다).
// (ERP 의 policy-match/taxbot-document-facts 의 parseRegistrationCertificate 를 옮겨 칸을 넓혔다.)

import { addressFields, normalizeDate, type ParsedDocument } from "./parse-common";
import type { DocumentFields } from "./types";

// 증명서 글은 글자 사이에 공백이 섞여 있다("사 업 장 소 재 지"). 항목 이름을 글자마다 공백을 허용하는 식으로 만든다.
function loose(label: string): string {
  return [...label].map((c) => (c === "(" || c === ")" ? `\\${c}` : c)).join("\\s*");
}

// 두 글자짜리 항목 이름은 값 안의 글자와 겹친다("전기공사업 태양력", "각종 목재"). 앞뒤가 다른 글자와 붙어 있으면 항목 이름이 아니다.
function standalone(source: string): string {
  return `(?<![가-힣A-Za-z0-9])${source}(?=[\\s:：]|$)`;
}

type LabelKind = "address" | "open" | "businessType" | "item" | "name" | "corpReg" | "other";

// 값은 자기 항목 이름 뒤부터 다음 항목 이름 앞까지다. 쓰지 않는 항목도 값의 끝을 알리려고 적어 둔다.
// 같은 자리에서 시작하는 이름은 긴 쪽을 앞에 둔다(「상호(법인명)」이 「상호」보다 먼저).
const LABELS: ReadonlyArray<readonly [LabelKind, string]> = [
  ["address", loose("사업장소재지")],
  // 「…중개업 일반 …」처럼 값 안의 글자가 이어져 개업일로 읽히지 않게, 앞이 다른 글자와 붙어 있으면 항목 이름이 아니다.
  ["open", `(?<![가-힣A-Za-z0-9])${loose("개업")}\\s*(?:${loose("연월일")}|${loose("년월일")}|${loose("일")})`],
  ["businessType", standalone(loose("업태"))],
  ["item", standalone(loose("종목"))],
  ["corpReg", loose("법인등록번호")],
  ["name", loose("상호(법인명)")],
  ["name", loose("법인명(단체명)")],
  ["name", standalone(loose("상호"))],
  ["name", standalone(loose("법인명"))],
  ["other", loose("사업자등록일")],
  ["other", loose("사업자등록번호")],
  ["other", standalone(loose("등록번호"))],
  ["other", loose("대표자성명")],
  ["other", loose("성명(대표자)")],
  ["other", standalone(loose("대표자"))],
  ["other", loose("주민(법인)등록번호")],
  ["other", loose("성명(법인명)")],
  ["other", loose("주민(사업자)등록번호")],
  ["other", loose("공동사업자")],
  ["other", loose("본점소재지")],
  ["other", loose("사업의종류")],
  ["other", loose("발급사유")],
];
const LABEL_RE = new RegExp(LABELS.map(([, source]) => `(${source})`).join("|"), "g");
const CERT_END_RE = new RegExp(loose("위와같이증명합니다"));
// 괄호 글은 짧다. 길이를 정해 두어 닫는 괄호가 없는 글에서도 되짚기가 길어지지 않게 한다(공백은 읽은 뒤에 뺀다).
const CERT_TITLE_RE = new RegExp(`${loose("사업자등록증")}(?:\\s*${loose("명")})?\\s*[(（]([^)）]{0,40})[)）]`);
const OPEN_DATE_RE = /^[\s:：]*(\d{4})\s*[년.\-/]\s*(\d{1,2})\s*[월.\-/]\s*(\d{1,2})/;
// 사업자번호: 「등록번호」 바로 뒤 숫자를 먼저 보고, 없으면 하이픈이 있는 3-2-5 모양을 찾는다(주민·법인등록번호는 이 모양이 아니다).
const BIZNO_LABELLED_RE = /등\s*록\s*번\s*호\s*[:：]?\s*(\d{3})\s*-?\s*(\d{2})\s*-?\s*(\d{5})(?!\d)/;
const BIZNO_SHAPE_RE = /(?<![\d-])(\d{3})\s*-\s*(\d{2})\s*-\s*(\d{5})(?![\d-])/;
// 법인등록번호 자리에 숫자(가려 쓴 *도 허용)가 채워져 있으면 법인으로 본다.
const CORP_REG_FILLED_RE = /\d{6}\s*-?\s*[\d*]{7}/;
const CORP_NAME_RE = /㈜|\(주\)|（주）|주식회사|유한회사|유한책임회사|합자회사|합명회사/;
// PDF 에서 온 한 줄 글은 업태·종목이 줄로 나뉘지 않아 항목 하나가 길다. 항목마다 재지 않고 완성된 글 전체만 잰다.
const MAX_INDUSTRY_LENGTH = 400;
const MAX_ADDRESS_LENGTH = 150;

const NOTHING_FOUND = "사업자등록증에서 읽을 수 있는 칸을 찾지 못했습니다. 글자가 있는 PDF로 올려 주세요.";

function labelledSegments(body: string): Array<{ kind: LabelKind; value: string }> {
  const marks = [...body.matchAll(LABEL_RE)].map((m) => {
    const start = m.index ?? 0;
    const group = m.findIndex((g, i) => i > 0 && g !== undefined);
    return { kind: LABELS[group - 1][0], start, stop: start + m[0].length };
  });
  return marks.map((mark, i) => ({
    kind: mark.kind,
    value: body.slice(mark.stop, i + 1 < marks.length ? marks[i + 1].start : body.length),
  }));
}

// 줄이 여러 개면 줄마다 한 항목으로 본다. 줄 안의 공백은 하나로 줄인다.
function itemsOf(segment: string): string[] {
  return segment
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/^[\s:：]+/, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function findBizno(body: string): string | undefined {
  const m = BIZNO_LABELLED_RE.exec(body) ?? BIZNO_SHAPE_RE.exec(body);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

/** 증명 종류 괄호 글: 법인이 들어 있으면 법인, 과세 유형 말이면 개인. 못 찾으면 undefined. */
function orgTypeOfTitle(body: string): "법인" | "개인" | undefined {
  const title = CERT_TITLE_RE.exec(body);
  if (!title) return undefined;
  const kind = title[1].replace(/\s/g, "");
  if (kind.includes("법인")) return "법인";
  if (/일반과세자|간이과세자|면세사업자|과세사업자|개인/.test(kind)) return "개인";
  return undefined;
}

/** 사업자등록증·증명 글에서 칸을 뽑는다. 읽은 칸이 없으면 빈 결과 + 안내. */
export function parseBizRegistration(rawText: string): ParsedDocument {
  const text = rawText.normalize("NFC");
  // 맺음 문구 뒤의 안내 글에 항목 이름이 또 나와도 읽지 않는다.
  const end = text.search(CERT_END_RE);
  const body = end >= 0 ? text.slice(0, end) : text;

  let address: string | undefined;
  let openDate: string | undefined;
  let corpRegFilled = false;
  let corpName = false;
  const businessTypes: string[] = [];
  const items: string[] = [];
  for (const segment of labelledSegments(body)) {
    if (segment.kind === "address") {
      if (address !== undefined) continue;
      const value = itemsOf(segment.value).join(" ");
      if (value && value.length <= MAX_ADDRESS_LENGTH) address = value;
    } else if (segment.kind === "open") {
      if (openDate !== undefined) continue;
      const m = OPEN_DATE_RE.exec(segment.value);
      if (m) openDate = normalizeDate(`${m[1]}-${m[2]}-${m[3]}`) ?? undefined;
    } else if (segment.kind === "businessType") {
      businessTypes.push(...itemsOf(segment.value));
    } else if (segment.kind === "item") {
      items.push(...itemsOf(segment.value));
    } else if (segment.kind === "corpReg") {
      // 값은 쓰지 않는다 — 채워져 있는지만 본다.
      if (CORP_REG_FILLED_RE.test(segment.value)) corpRegFilled = true;
    } else if (segment.kind === "name") {
      if (CORP_NAME_RE.test(segment.value)) corpName = true;
    }
  }

  const fields: DocumentFields = {};

  const bizno = findBizno(body);
  if (bizno) fields.bizno = bizno;
  if (openDate) fields.foundedDate = openDate;

  const types = [...new Set(businessTypes)];
  const sectors = [...new Set(items)];
  if (types.length && sectors.length) {
    const industry = `${types.join(", ")} / ${sectors.join(", ")}`;
    if (industry.length <= MAX_INDUSTRY_LENGTH) fields.industry = industry;
  }

  // 소재지는 시도·시군구만 꺼내고 원문은 버린다.
  if (address) Object.assign(fields, addressFields(address));

  // 법인 근거가 하나라도 있으면 법인, 없으면서 개인(과세 유형) 표시가 있으면 개인, 둘 다 없으면 모른다.
  const orgType = orgTypeOfTitle(body);
  if (orgType === "법인" || corpRegFilled || corpName) fields.isCorporation = true;
  else if (orgType === "개인") fields.isCorporation = false;

  return Object.keys(fields).length > 0 ? { fields } : { fields, note: NOTHING_FOUND };
}
