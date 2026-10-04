// 고용·산재보험 가입자 명부·신고서에서 「지금 일하는 사람 수」를 센다 — 순수 함수(저장·네트워크·AI 없음).
//  (ERP 의 policy-match/taxbot-document-facts 의 readCurrentEmployees 를 옮겼다. 시트·구역 이름이 달라도 머리줄로 찾게 넓혔다.)
//
// ★고용상태가 정확히 「고용」인 줄만 센다. 같은 사람(이름+주민번호)은 한 명으로 센다.
// ★이름·주민번호는 같은 사람을 가리는 데만 쓰고 결과에 넣지 않는다. 내보내는 칸은 employeeCount 하나뿐이다.
// ★표 모양이 믿기지 않으면(머리줄 칸 없음·줄 칸 수 어긋남=본문이 잘린 흔적) 세지 않고 이유만 알린다. 이유에는 사람 정보가 없다.

import { bodyLines, splitTableRow, type DocumentBody, type ParsedDocument } from "./parse-common";

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

/** 고용·산재 가입자 명부·신고서에서 현재 근로자 수를 뽑는다. 못 세면 빈 결과 + 안내. */
export function parseEmployment(body: DocumentBody): ParsedDocument {
  // 엑셀은 시트마다 따로 본다(시트가 달라도 한 표가 둘로 합쳐지지 않게). 글 서류는 통째로 본다.
  const candidates: Array<{ lines: string[]; truncated: boolean }> = [];
  for (const sheet of body.sheets ?? []) candidates.push({ lines: linesOf(sheet.text), truncated: sheet.truncated === true });
  if (body.text) candidates.push({ lines: linesOf(body.text), truncated: false });

  let firstFailure: string | undefined;
  for (const { lines, truncated } of candidates) {
    if (headerIndex(lines) < 0) continue;
    // 뒤가 잘린 명부는 센 수가 실제보다 적다 — 채우지 않고 직접 적게 안내한다.
    if (truncated) {
      firstFailure ??= TOO_LONG;
      continue;
    }
    const counted = countCurrentEmployees(lines);
    if (counted.ok) return { fields: { employeeCount: counted.count } };
    firstFailure ??= counted.reason;
  }

  // 표를 못 읽었을 때만 「근로자수 N명」 글을 본다. 표가 있는데 깨진 경우에는 지어내지 않는다.
  if (firstFailure === undefined) {
    const m = HEADCOUNT_RE.exec(bodyLines(body).join("\n"));
    const n = m ? Number(m[1].replace(/,/g, "")) : NaN;
    if (Number.isInteger(n) && n <= MAX_HEADCOUNT) return { fields: { employeeCount: n } };
  }
  return { fields: {}, note: firstFailure ?? NO_TABLE };
}
