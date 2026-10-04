// 서류별 칸 뽑기가 함께 쓰는 도우미 — 금액 단위 환산·날짜 다듬기·주소 자르기. 순수 함수(저장·네트워크 없음).
//
// ★모르면 지어내지 않고 null/빈 결과를 돌려준다. 틀린 값이 칸에 들어가는 것보다 비워 두는 편이 낫다.
// ★주소는 **시도 + 시군구까지만** 남긴다. 도로명·번지·건물명은 결과 어디에도 내보내지 않는다.

import { readRegionFromAddress } from "../engine/profile-derive";
import type { SheetData } from "./extract-text";
import type { DocumentFields } from "./types";

/** 서류 하나에서 읽은 결과. year 는 서류 기준 연도(재무제표·부가세), note 는 못 읽었을 때의 짧은 안내. */
export interface ParsedDocument {
  fields: DocumentFields;
  year?: number;
  note?: string;
}

/* ───────── 금액 ───────── */

/** 단위 없는 숫자는 이 값 이상일 때만 「원」으로 본다. 그보다 작으면 원인지 만원인지 알 수 없다. */
const PLAIN_WON_MIN = 1_000_000;
const MAX_KRW = 1e15;

/** 「2천5백」「12000」 같은 억·만 아래 덩어리의 값. 모양이 다르면 null. */
function chunkValue(chunk: string): number | null {
  const m = /^(?:(\d+)천)?(?:(\d+)백)?(\d+(?:\.\d+)?)?$/.exec(chunk);
  if (!m || chunk === "") return null;
  return Number(m[1] ?? 0) * 1000 + Number(m[2] ?? 0) * 100 + Number(m[3] ?? 0);
}

/**
 * 「1억 2천」「12,000만원」「120,000,000」 같은 금액 글자를 원 단위 정수로. 모르면 null.
 * - 단위(억·만·원)가 하나도 없는 작은 숫자(「12000」)는 모른다. 「5천」처럼 천·백만 있는 글도 모른다.
 * - 억 뒤에 만 없이 천만 오면(「1억 2천」) 줄임말로 보고 천만 단위로 읽는다.
 */
export function parseKrwAmount(text: string): number | null {
  const t = text.normalize("NFC").replace(/[,\s]/g, "").replace(/^(?:약|대략)/, "");
  const hasWon = t.endsWith("원");
  const body = hasWon ? t.slice(0, -1) : t;
  if (body === "") return null;

  const eokMatch = /^(?:(\d+(?:\.\d+)?)억)?(.*)$/.exec(body);
  if (!eokMatch) return null;
  const eok = eokMatch[1] === undefined ? null : Number(eokMatch[1]);
  const rest = eokMatch[2];

  const manMatch = /^(?:([^만]*)만)?([^만]*)$/.exec(rest);
  if (!manMatch) return null;
  const manChunk = manMatch[1];
  const lowChunk = manMatch[2];

  let total = 0;
  if (eok !== null) total += eok * 100_000_000;

  let man: number | null = null;
  if (manChunk !== undefined) {
    man = chunkValue(manChunk);
    if (man === null) return null; // 「만원」처럼 만 앞이 비었거나 모르는 글자
    total += man * 10_000;
  }

  if (lowChunk !== "") {
    const low = chunkValue(lowChunk);
    if (low === null) return null;
    const hasThousandUnit = /[천백]/.test(lowChunk);
    if (eok !== null && man === null && !hasWon && hasThousandUnit) {
      total += low * 10_000; // 「1억 2천」 = 1억 2천만
    } else if (eok === null && man === null && !hasWon) {
      // 억·만·원이 하나도 없다 — 0 이거나 충분히 큰 숫자일 때만 원으로 읽는다.
      if (hasThousandUnit || !(low === 0 || low >= PLAIN_WON_MIN)) return null;
      total += low;
    } else {
      total += low;
    }
  }

  if (eok === null && manChunk === undefined && lowChunk === "") return null;
  const won = Math.round(total);
  return Number.isFinite(won) && won >= 0 && won <= MAX_KRW ? won : null;
}

/* ───────── 날짜 ───────── */

const SERIAL_MIN = 10_000; // 1927-05-18 — 이보다 작은 숫자(신용점수 899 같은 값)는 엑셀 날짜 번호로 보지 않는다
const SERIAL_MAX = 73_415; // 2100-12-31

function isoOf(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * 날짜 글자를 YYYY-MM-DD 로. 「2018.3.12」·「2018년 3월 12일」·「20180312」·엑셀 날짜 번호를 받는다.
 * 달력에 없는 날짜·날짜가 아닌 글은 null.
 */
export function normalizeDate(text: string): string | null {
  const t = text.normalize("NFC").trim();
  let m = /^(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*(?:일|\.)?\s*(?:[T\s].*)?$/.exec(t);
  if (m) return isoOf(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(t);
  if (m) return isoOf(Number(m[1]), Number(m[2]), Number(m[3]));
  if (/^\d{4,6}$/.test(t)) {
    const serial = Number(t);
    if (serial < SERIAL_MIN || serial > SERIAL_MAX) return null;
    const dt = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
    return isoOf(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  return null;
}

/* ───────── 쉼표 표 ───────── */

/** 쉼표 표(CSV) 한 줄을 칸으로 나눈다. 따옴표 속 쉼표와 겹따옴표(「""」)를 지킨다. */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      cells.push(cell);
      cell = "";
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells;
}

/** 칸 뽑기가 받는 서류 내용 — 글 서류는 text, 엑셀은 sheets. */
export interface DocumentBody {
  text?: string;
  sheets?: SheetData[];
}

/**
 * 서류 내용을 줄 목록으로 펼친다. 엑셀은 시트 이름 줄(「## 이름」)을 빼고 칸 사이를 공백 둘로 이어
 * 글 서류와 같은 줄 모양으로 맞춘다(숫자 속 쉼표가 칸 나눔으로 잘못 읽히지 않는다).
 */
export function bodyLines(body: DocumentBody): string[] {
  const lines: string[] = [];
  if (body.text) lines.push(...body.text.normalize("NFC").split(/\r\n|\r|\n/));
  for (const sheet of body.sheets ?? []) {
    for (const row of sheet.text.normalize("NFC").split(/\r\n|\r|\n/).slice(1)) {
      const cells = splitCsvLine(row).map((c) => c.trim()).filter(Boolean);
      if (cells.length > 0) lines.push(cells.join("  "));
    }
  }
  return lines;
}

/* ───────── 주소 ───────── */

/**
 * 주소 글자에서 시도·시군구만 꺼낸다(예: 「경기 화성시」). 도로명·번지·건물명은 버린다.
 * 시도를 못 읽으면 빈 결과. 시군구가 사전에 없으면 regionSigungu 는 비운다.
 */
export function addressFields(address: string): Pick<DocumentFields, "region" | "regionSigungu" | "businessAddress"> {
  const read = readRegionFromAddress(address);
  if (!read.region) return {};
  const out: Pick<DocumentFields, "region" | "regionSigungu" | "businessAddress"> = { region: read.region };
  if (read.regionSigungu) out.regionSigungu = read.regionSigungu;
  if (read.shortAddress) out.businessAddress = read.shortAddress;
  return out;
}
