// 받은 zip·OLE 파일이 어떤 문서인지 가리고, ODT·ODS(오픈 문서) 본문 글자를 뽑는다.
// zip 이면 모두 hwpx 추출기에 넣어 워드·엑셀·파워포인트·ODT 를 못 읽었다(2026-10-01 운영 표본: 새 형식이 섞인 공고 1,108건).
// 받은 바이트만 보고 가린다(이름·저장 형식은 믿지 않는다). 셋 다 던지지 않는다.
// `./attachment-text` 를 부르지 않는다(순환).
// ODT 는 바깥 XML 파서 없이 한 번 훑는다 — 일부러 만든 나쁜 파일도 선형 시간에 끝나야 해서
// 위치 찾기는 indexOf·startsWith 로만 하고, 큰 글자에 되돌아가는 정규식은 쓰지 않는다.
import AdmZip from "adm-zip";
import { parse as parseCfb } from "cfb";
import { inflateRawSync } from "node:zlib";

export type ZipDocumentKind = "hwpx" | "docx" | "xlsx" | "pptx" | "odt" | "archive";
export type OleDocumentKind = "hwp" | "xls" | "doc" | "ppt";

const HWPX_SECTION = /^contents\/section\d+\.xml$/;
const PPTX_SLIDE = /^ppt\/slides\/slide\d+\.xml$/;

/**
 * zip 속 항목 **이름만** 보고 문서 종류를 가린다(내용은 풀지 않는다). 차례가 곧 우선순위다.
 * hwpx → docx → xlsx → pptx → odt(ODS 포함) → 그 밖은 압축 묶음(archive). 비었거나 zip 으로 못 열면 null.
 */
export function classifyZipDocument(buf: Buffer): ZipDocumentKind | null {
  try {
    if (buf.length === 0) return null;
    const entries = new AdmZip(buf).getEntries();
    let hwpx = false;
    let docx = false;
    let xlsx = false;
    let pptx = false;
    let odt = false;
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const name = entry.entryName.toLowerCase();
      if (HWPX_SECTION.test(name)) hwpx = true;
      else if (name === "word/document.xml") docx = true;
      else if (name === "xl/workbook.xml") xlsx = true;
      else if (name === "ppt/presentation.xml" || PPTX_SLIDE.test(name)) pptx = true;
      else if (name === "content.xml") odt = true;
    }
    if (hwpx) return "hwpx";
    if (docx) return "docx";
    if (xlsx) return "xlsx";
    if (pptx) return "pptx";
    if (odt) return "odt";
    return "archive";
  } catch {
    return null;
  }
}

const OLE_SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const CFB_STREAM = 2;
const CFB_ROOT = 5;

type CfbEntry = { name: string; type?: number };

/**
 * OLE 파일의 **최상위 줄기 이름**으로 문서 종류를 가린다(하위 저장소 안 줄기는 보지 않는다).
 * FileHeader → hwp, Workbook·Book → xls, WordDocument → doc, PowerPoint Document → ppt. 그 밖·깨짐은 null.
 */
export function classifyOleDocument(buf: Buffer): OleDocumentKind | null {
  try {
    if (buf.length < OLE_SIG.length) return null;
    for (let i = 0; i < OLE_SIG.length; i++) {
      if (buf[i] !== OLE_SIG[i]) return null;
    }
    const parsed = parseCfb(Uint8Array.from(buf)) as { FileIndex?: CfbEntry[]; FullPaths?: string[] };
    const index = parsed.FileIndex;
    const paths = parsed.FullPaths;
    if (!index || !paths) return null;
    const rootName = index.find((entry) => entry.type === CFB_ROOT)?.name ?? index[0]?.name ?? "Root Entry";
    const names = new Set<string>();
    for (let i = 0; i < index.length; i++) {
      const entry = index[i];
      if (entry.type !== undefined && entry.type !== CFB_STREAM) continue;
      const parts = (paths[i] ?? entry.name).replace(/\\/g, "/").split("/").filter((part) => part !== "");
      if (parts[0] === rootName) parts.shift();
      if (parts.length === 1) names.add(parts[0]);
    }
    if (names.has("FileHeader")) return "hwp";
    if (names.has("Workbook") || names.has("Book")) return "xls";
    if (names.has("WordDocument")) return "doc";
    if (names.has("PowerPoint Document")) return "ppt";
    return null;
  } catch {
    return null;
  }
}

/** content.xml 한 칸의 풀린 크기 상한 — `documents/extract-text` 의 readEntryText 와 같다. */
const MAX_CONTENT_BYTES = 20 * 1024 * 1024;
const MAX_SPACES = 100;

const NAMED_ENTITIES = new Map([
  ["lt", "<"],
  ["gt", ">"],
  ["amp", "&"],
  ["quot", '"'],
  ["apos", "'"],
]);
const ENTITY = /&(#[xX][0-9A-Fa-f]+|#[0-9]+|[A-Za-z]+);/g;
const MAX_CODE_POINT = 0x10ffff;

function decodeEntities(text: string): string {
  if (text.indexOf("&") < 0) return text;
  return text.replace(ENTITY, (whole, g: string) => {
    if (g.charCodeAt(0) === 35) {
      const hex = g.charCodeAt(1) === 120 || g.charCodeAt(1) === 88;
      const n = hex ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return n <= MAX_CODE_POINT ? String.fromCodePoint(n) : whole; // 범위 밖·못 읽는 수는 그대로
    }
    return NAMED_ENTITIES.get(g) ?? whole;
  });
}

function isNameStart(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95; // A-Z a-z _
}

function isNameChar(c: number): boolean {
  return isNameStart(c) || (c >= 48 && c <= 57) || c === 58 || c === 46 || c === 45; // 0-9 : . -
}

function isXmlSpace(c: number): boolean {
  return c === 32 || c === 9 || c === 13 || c === 10;
}

/** 공백·탭·줄바꿈 뭉치를 한 칸으로 줄인다(정규식 없이 한 번 훑는다). */
function collapseSpaces(text: string): string {
  let out = "";
  let from = 0;
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (!isXmlSpace(text.charCodeAt(i))) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < n && isXmlSpace(text.charCodeAt(j))) j++;
    out += text.slice(from, i) + " ";
    from = j;
    i = j;
  }
  return from === 0 ? text : out + text.slice(from);
}

/** zip 맨 위 `content.xml` 의 글자(UTF-8). 없거나 20MB 를 넘으면 빈 글자. */
function readContentXml(buf: Buffer): string {
  const zip = new AdmZip(buf);
  const entry = zip.getEntries().find((e) => !e.isDirectory && e.entryName.toLowerCase() === "content.xml");
  if (!entry) return "";
  if (entry.header.size > MAX_CONTENT_BYTES) return "";
  try {
    const raw = entry.getCompressedData();
    // 압축하지 않고 그대로 담은 칸(method 0)은 그 크기가 곧 푼 크기다.
    if (entry.header.method === 0) return raw.length > MAX_CONTENT_BYTES ? "" : raw.toString("utf8");
    return inflateRawSync(raw, { maxOutputLength: MAX_CONTENT_BYTES }).toString("utf8");
  } catch {
    return "";
  }
}

/** `<office:body …>` 와 `</office:body>` 사이. 못 찾거나 스스로 닫힌 body 면 null. */
function bodyOf(xml: string): string | null {
  const key = "<office:body";
  let from = 0;
  let open = -1;
  for (;;) {
    const at = xml.indexOf(key, from);
    if (at < 0) return null;
    const after = at + key.length;
    const c = xml.charCodeAt(after);
    if (c === 62 || c === 47 || isXmlSpace(c)) {
      open = at;
      break;
    }
    from = after;
  }
  const gt = xml.indexOf(">", open + key.length);
  if (gt < 0) return null;
  if (xml.charCodeAt(gt - 1) === 47) return null;
  const close = xml.indexOf("</office:body>", gt + 1);
  if (close < 0) return null;
  return xml.slice(gt + 1, close);
}

/** 줄 끝 공백·탭을 지운다 — 줄마다 끝에서부터 센다(정규식 `[ \t]+$` 는 공백이 긴 줄에서 제곱 시간이 된다). */
function trimLineEnds(text: string): string {
  const lines = text.split("\n");
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k];
    let end = line.length;
    while (end > 0 && (line.charCodeAt(end - 1) === 32 || line.charCodeAt(end - 1) === 9)) end--;
    if (end < line.length) lines[k] = line.slice(0, end);
  }
  return lines.join("\n");
}

/** `text:s` 의 `text:c` 칸 수(작은·큰따옴표). 없으면 1, 숫자가 아니거나 1 미만이면 1, 100 을 넘으면 100. */
function spaceCountOf(inner: string, nameEnd: number): number {
  const at = inner.indexOf("text:c=", nameEnd);
  if (at < 0) return 1;
  const quote = inner.charCodeAt(at + 7);
  if (quote !== 34 && quote !== 39) return 1;
  const end = inner.indexOf(String.fromCharCode(quote), at + 8);
  if (end < 0) return 1;
  const n = parseInt(inner.slice(at + 8, end), 10);
  if (!(n >= 1)) return 1;
  return n > MAX_SPACES ? MAX_SPACES : n;
}

/**
 * ODT·ODS 본문 글자. `office:body` 안 `text:p`·`text:h` 문단 글자만 모으고 문단마다 줄을 바꾼다.
 * `text:tab` → 탭, `text:line-break` → 줄, `text:s` → `text:c` 칸 띄어쓰기. 메모(`office:annotation`)·
 * 바뀐 내용 기록(`text:tracked-changes`)은 건너뛴다. ODT 가 아니거나 본문이 없으면 빈 글자. 던지지 않는다.
 */
export function extractOdtText(buf: Buffer): string {
  try {
    const body = bodyOf(readContentXml(buf));
    if (body === null) return "";
    const out: string[] = [];
    let depth = 0; // text:p·text:h 안에 있는 동안만 글자를 모은다
    let i = 0;
    const n = body.length;
    while (i < n) {
      const lt = body.indexOf("<", i);
      if (lt < 0) {
        if (depth) out.push(decodeEntities(collapseSpaces(body.slice(i))));
        break;
      }
      if (lt > i && depth) out.push(decodeEntities(collapseSpaces(body.slice(i, lt))));
      if (body.startsWith("<!--", lt)) {
        const end = body.indexOf("-->", lt + 4);
        if (end < 0) break;
        i = end + 3;
        continue;
      }
      if (body.startsWith("<![CDATA[", lt)) {
        const end = body.indexOf("]]>", lt + 9);
        if (end < 0) break;
        if (depth) out.push(body.slice(lt + 9, end));
        i = end + 3;
        continue;
      }
      const gt = body.indexOf(">", lt + 1);
      if (gt < 0) break;
      const inner = body.slice(lt + 1, gt);
      i = gt + 1;
      const close = inner.charCodeAt(0) === 47;
      const nameStart = close ? 1 : 0;
      if (!isNameStart(inner.charCodeAt(nameStart))) continue;
      let nameEnd = nameStart + 1;
      while (nameEnd < inner.length && isNameChar(inner.charCodeAt(nameEnd))) nameEnd++;
      const name = inner.slice(nameStart, nameEnd);
      const selfClosing = inner.endsWith("/");
      if (name === "text:p" || name === "text:h") {
        if (selfClosing) {
          out.push("\n");
        } else if (close) {
          depth = Math.max(depth - 1, 0);
          out.push("\n");
        } else {
          depth += 1;
        }
        continue;
      }
      if (close) continue;
      if (name === "office:annotation" || name === "text:tracked-changes") {
        if (selfClosing) continue;
        const end = body.indexOf(`</${name}>`, i);
        if (end < 0) break;
        i = end + name.length + 3;
        continue;
      }
      if (!depth) continue;
      if (name === "text:tab") out.push("\t");
      else if (name === "text:line-break") out.push("\n");
      else if (name === "text:s") out.push(" ".repeat(spaceCountOf(inner, nameEnd)));
    }
    const text = out.join("").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    return trimLineEnds(text).replace(/\n{3,}/g, "\n\n").trim();
  } catch {
    return "";
  }
}
