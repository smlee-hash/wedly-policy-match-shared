// 글자·시트 내용으로 서류 종류를 가른다 — 순수 함수(저장·네트워크·AI 없음).
//
// ★가르는 근거는 **글 내용**이다. 파일 이름은 보조 단서일 뿐이라 이름만으로는 종류를 정하지 않는다.
// ★두 종류의 단서가 비슷하면 지어내지 않고 unknown 으로 둔다(틀린 서류로 읽는 것보다 「모르는 서류」가 낫다).
//
// 점수 = (제목급 단서가 있으면 3) + (뒷받침 단서 개수, 최대 3) + (파일 이름 단서가 있으면 2).
// 1등이 3점 이상이고 2등과 2점 이상 벌어질 때만 1등으로 정한다.

import type { SheetData } from "./extract-text";
import type { DocumentType } from "./types";

export interface ClassifyInput {
  fileName: string;
  /** 글 파일·PDF 에서 꺼낸 글 */
  text?: string;
  /** 엑셀 시트들 */
  sheets?: SheetData[];
}

type Typed = Exclude<DocumentType, "unknown">;

interface Clues {
  /** 서류 제목·고유 낱말 — 하나라도 있으면 3점 */
  title: RegExp;
  /** 뒷받침 낱말 — 하나당 1점(최대 3점) */
  support: RegExp[];
  /** 파일 이름 낱말 — 있으면 2점 */
  name: RegExp;
}

/** 기업상태표 칸 이름(공백을 뺀 글). 3개 이상 보이면 기업상태표로 본다. 칸 뽑기도 이 목록으로 읽을 시트를 고른다. */
export const COMPANY_STATUS_LABELS = [
  "기업상태표",
  "업체명(법인은㈜)",
  "개업년월일",
  "사업자등록증주업종",
  "사업장소재지",
  "당해년도매출",
  "전년도(-1년)매출",
  "4대보험인원수",
  "특허출원이나등록여부",
  "연구소/기업인증보유여부",
  "정책자금기대출",
  "국세체납여부",
  "4대보험료체납여부",
];

const MIN_SCORE = 3;
const MIN_MARGIN = 2;
const NAME_SCORE = 2;
const TITLE_SCORE = 3;
const SUPPORT_MAX = 3;

const CLUES: Record<Exclude<Typed, "company-status">, Clues> = {
  // 「사업자등록증 주업종」은 기업상태표의 칸 이름이라 사업자등록증 제목으로 세지 않는다.
  "biz-registration": {
    title: /사업자등록증(?!주업종)/,
    support: [/사업장소재지/, /개업(?:연|년)월일/, /법인등록번호/, /업태/, /종목/, /발급사유/, /사업의종류/],
    name: /사업자등록/,
  },
  "financial-statement": {
    title: /재무제표|손익계산서|재무상태표|대차대조표/,
    support: [/매출액/, /매출원가/, /매출총이익/, /영업이익/, /당기순이익/, /자산총계/, /부채총계/, /자본총계/],
    name: /재무제표|손익계산서|재무상태표/,
  },
  "vat-return": {
    title: /부가가치세(?:확정|예정|조기환급)?신고서?|부가세신고서|과세표준증명/,
    support: [/과세표준/, /매출세액/, /세금계산서발급분/, /과세기간/, /납부세액/, /신고서/],
    name: /부가세|부가가치세|과세표준/,
  },
  "employment-insurance": {
    title: /고용산재|고용보험|산재보험|고용현황|가입자명부|보험관계성립|피보험자/,
    support: [/근로자이름/, /근로자주민번호/, /고용상태/, /취득일/, /상실일/, /근로자수/, /상시근로자/],
    name: /고용|산재|가입자명부|보험관계/,
  },
};

const COMPANY_STATUS_NAME = /기업상태표/;

/** 글자 사이 공백·줄바꿈을 모두 없애고 맥(NFD) 자모를 합친다 — 「사 업 자 등 록 증」도 같게 본다. */
function compact(s: string): string {
  return s.normalize("NFC").replace(/\s+/g, "");
}

function scoreOf(clues: Clues, body: string, name: string): number {
  let score = 0;
  if (clues.title.test(body)) score += TITLE_SCORE;
  score += Math.min(SUPPORT_MAX, clues.support.filter((re) => re.test(body)).length);
  if (clues.name.test(name)) score += NAME_SCORE;
  return score;
}

function companyStatusScore(body: string, name: string): number {
  const hits = COMPANY_STATUS_LABELS.filter((label) => body.includes(label)).length;
  const base = hits >= 3 ? TITLE_SCORE + hits : hits;
  return base + (COMPANY_STATUS_NAME.test(name) ? NAME_SCORE : 0);
}

/** 글·시트 내용으로 서류 종류를 가린다. 못 가리면 "unknown". */
export function classifyDocument(input: ClassifyInput): DocumentType {
  const parts: string[] = [];
  if (input.text) parts.push(input.text);
  for (const sheet of input.sheets ?? []) parts.push(sheet.name, sheet.text);
  const body = compact(parts.join("\n"));
  const name = compact(input.fileName);

  const scores: Array<[Typed, number]> = [
    ["company-status", companyStatusScore(body, name)],
    ...(Object.entries(CLUES) as Array<[Exclude<Typed, "company-status">, Clues]>).map(
      ([type, clues]): [Typed, number] => [type, scoreOf(clues, body, name)],
    ),
  ];
  scores.sort((a, b) => b[1] - a[1]);

  const [top, second] = scores;
  if (top[1] >= MIN_SCORE && top[1] - second[1] >= MIN_MARGIN) return top[0];
  return "unknown";
}
