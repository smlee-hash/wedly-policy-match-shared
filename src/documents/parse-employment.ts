// 고용·산재보험 가입자 명부·신고서에서 「지금 일하는 사람 수」를 센다 — 순수 함수(저장·네트워크·AI 없음).
//  (ERP 의 policy-match/taxbot-document-facts 의 readCurrentEmployees 를 옮겼다. 시트·구역 이름이 달라도 머리줄로 찾게 넓혔다.)
//
// ★고용상태가 정확히 「고용」인 줄만 센다. 같은 사람(이름+주민번호)은 한 명으로 센다.
// ★이름·주민번호는 같은 사람을 가리는 데만 쓰고 결과에 넣지 않는다. 내보내는 칸은 employeeCount 하나뿐이다.
//   (이름은 parseEmploymentWithNames 의 personNames 로만 나간다 — 다른 서류 업종 글에서 그 이름을 지우는 데만 쓴다.)
// ★글 명부(CSV·TXT 등)가 글자 상한으로 잘렸으면 엑셀 잘림과 같게 세지 않고 직접 적게 안내한다.
// ★표 모양이 믿기지 않으면(머리줄 칸 없음·줄 칸 수 어긋남=본문이 잘린 흔적) 세지 않고 이유만 알린다. 이유에는 사람 정보가 없다.

import { cleanAiPersonNames, uniquePersonNames } from "./clean-text";
import { bodyLines, splitTableRow, type DocumentBody, type ParsedDocument, type ParsedWithNames } from "./parse-common";

const STATUS_HEADER = "고용상태";
/** 같은 사람을 가리는 칸 이름(공백 뺀 글). 신고서마다 이름이 조금씩 다르다. */
const NAME_HEADERS = ["근로자이름", "성명", "이름"];
const RRN_HEADERS = ["근로자주민번호", "주민등록번호", "주민번호"];
const EMPLOYED = "고용";

/** 「상시근로자수 : 12명」처럼 사람 수만 적힌 곳. 표를 못 찾았을 때만 쓴다. */
const HEADCOUNT_RE = /(?:상시\s*)?근로자\s*수\s*[:：]?\s*(\d[\d,]{0,6})\s*명?/;
const MAX_HEADCOUNT = 100_000;

const NO_TABLE = "고용상태 칸이 있는 근로자 표를 찾지 못해 근로자 수를 세지 않았습니다.";
const TOO_LONG = "명부가 너무 길어 직원 수를 다 세지 못했어요 — 직원 수는 직접 적어 주세요";

type Counted = { ok: true; count: number } | { ok: false; reason: string };

const compact = (s: string) => s.normalize("NFC").replace(/\s/g, "");

/** 머리줄(고용상태 칸이 있는 줄)의 자리. 없으면 -1. */
function headerIndex(lines: string[]): number {
  return lines.findIndex((line) => splitTableRow(line).some((c) => compact(c) === STATUS_HEADER));
}

function columnOf(header: string[], names: string[]): number {
  return header.findIndex((c) => names.includes(c));
}

/** 줄 목록에서 머리줄 아래 표를 읽어 고용 중인 사람 수를 센다. */
function countCurrentEmployees(lines: string[]): Counted {
  const fail = (reason: string): Counted => ({ ok: false, reason });
  const start = headerIndex(lines);
  if (start < 0) return fail(NO_TABLE);

  const header = splitTableRow(lines[start]).map(compact);
  const statusAt = header.indexOf(STATUS_HEADER);
  const nameAt = columnOf(header, NAME_HEADERS);
  const rrnAt = columnOf(header, RRN_HEADERS);
  if (nameAt < 0 || rrnAt < 0) {
    return fail("같은 사람을 가려낼 칸(근로자 이름·주민번호)이 없어 근로자 수를 세지 않았습니다.");
  }

  // 다음 「## 구역」이 시작되면 표가 끝난 것이다. 빈 줄은 건너뛴다.
  const rows: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*##/.test(line)) break;
    if (line.replace(/[,|\s]/g, "") !== "") rows.push(line);
  }

  const keys = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const cells = splitTableRow(rows[i]);
    while (cells.length > header.length && cells[cells.length - 1].trim() === "") cells.pop();
    if (cells.length !== header.length) {
      return fail(
        i === rows.length - 1
          ? "마지막 줄의 칸 수가 머리줄과 달라 본문이 잘린 것으로 보여 근로자 수를 세지 않았습니다."
          : "표의 줄 모양이 머리줄과 맞지 않아 근로자 수를 세지 않았습니다.",
      );
    }
    if (cells[statusAt].trim() !== EMPLOYED) continue;
    const name = compact(cells[nameAt]);
    const rrn = cells[rrnAt].replace(/\D/g, "");
    if (!name && !rrn) return fail("고용 중인 줄에 근로자를 가릴 이름·주민번호가 없어 근로자 수를 세지 않았습니다.");
    keys.add(`${name}\u0000${rrn}`);
  }
  return { ok: true, count: keys.size };
}

function linesOf(raw: string): string[] {
  return raw.normalize("NFC").split(/\r\n|\r|\n/);
}

/**
 * 머리줄 아래 표의 근로자 이름 칸 글자들. 센 결과와 상관없이(표가 깨졌거나 잘렸어도) 모은다 —
 * 이 이름은 다른 서류 업종 글에서 지우는 데만 쓰고 결과에는 넣지 않는다.
 * 개수 상한을 두지 않는다 — 읽은 줄이 엑셀은 2,000줄·글은 20만 자로 이미 한정돼 있고, 상한이 있으면 밀려난 이름이 남는다.
 */
function rosterNames(lines: string[]): string[] {
  const start = headerIndex(lines);
  if (start < 0) return [];
  const nameAt = columnOf(splitTableRow(lines[start]).map(compact), NAME_HEADERS);
  if (nameAt < 0) return [];
  const seen = new Set<string>();
  for (const line of lines.slice(start + 1)) {
    if (/^\s*##/.test(line)) break;
    const name = splitTableRow(line)[nameAt]?.trim();
    if (name && compact(name).length >= 2) seen.add(name); // 한 글자 칸은 이름으로 보지 않는다(글 속 한 글자까지 지우게 된다)
  }
  return cleanAiPersonNames([...seen]);
}

/** 고용·산재 가입자 명부·신고서에서 현재 근로자 수를 뽑는다. 못 세면 빈 결과 + 안내. */
export function parseEmployment(body: DocumentBody): ParsedDocument {
  return parseEmploymentWithNames(body).parsed;
}

/** parseEmployment 와 같되, 명부에서 읽은 직원 이름도 함께 돌려준다(업종 글에서 지우는 데만 쓴다). */
export function parseEmploymentWithNames(body: DocumentBody): ParsedWithNames {
  // 엑셀은 시트마다 따로 본다(시트가 달라도 한 표가 둘로 합쳐지지 않게). 글 서류는 통째로 본다.
  const candidates: Array<{ lines: string[]; truncated: boolean }> = [];
  for (const sheet of body.sheets ?? []) candidates.push({ lines: linesOf(sheet.text), truncated: sheet.truncated === true });
  // 글 서류가 글자 상한으로 잘렸으면 뒤쪽 근로자가 빠진 채 세게 된다.
  if (body.text) candidates.push({ lines: linesOf(body.text), truncated: body.truncated === true });

  // 인원 셈이 첫 명부에서 끝나더라도 모든 명부 시트·글의 이름은 끝까지 모은다(뒤 시트의 이름도 업종 글에서 지워야 한다).
  const rosters = candidates.filter(({ lines }) => headerIndex(lines) >= 0);
  const names = uniquePersonNames(rosters.flatMap(({ lines }) => rosterNames(lines)));

  let firstFailure: string | undefined;
  for (const { lines, truncated } of rosters) {
    // 뒤가 잘린 명부는 센 수가 실제보다 적다 — 채우지 않고 직접 적게 안내한다.
    if (truncated) {
      firstFailure ??= TOO_LONG;
      continue;
    }
    const counted = countCurrentEmployees(lines);
    if (counted.ok) return { parsed: { fields: { employeeCount: counted.count } }, personNames: names };
    firstFailure ??= counted.reason;
  }

  // 표를 못 읽었을 때만 「근로자수 N명」 글을 본다. 표가 있는데 깨진 경우에는 지어내지 않는다.
  if (firstFailure === undefined) {
    const m = HEADCOUNT_RE.exec(bodyLines(body).join("\n"));
    const n = m ? Number(m[1].replace(/,/g, "")) : NaN;
    if (Number.isInteger(n) && n <= MAX_HEADCOUNT) return { parsed: { fields: { employeeCount: n } }, personNames: names };
  }
  return { parsed: { fields: {}, note: firstFailure ?? NO_TABLE }, personNames: names };
}
