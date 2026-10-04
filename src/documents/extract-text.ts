// 올린 파일 하나에서 글자(엑셀은 표)를 꺼낸다 — 서류 읽기의 첫 걸음.
//
// ★순수 계산이라 네트워크·파일시스템을 쓰지 않는다(PDF 만 비동기). 서버 전용이라 화면(src/ui)은 부르지 않는다.
// ★이 함수는 **예외를 밖으로 던지지 않는다** — 파일 하나가 깨져도 나머지는 계속 읽어야 한다.
//   읽을 수 없으면 `unsupported` + 사람이 읽을 안내를 돌려준다.
// ★꺼낸 글자는 **그대로** 돌려준다. 요약·다듬기·맞춤법 수정을 하지 않는다.
//
// 워드(.docx)·한글 새 형식(.hwpx)·파워포인트(.pptx)는 모두 zip 이고 속 XML 에 글자가 들어 있다.
// 그래서 태그 이름만 바꿔 같은 코드로 읽는다. (ERP 의 documents/extract-text · consulting/file-text 를 옮겼다.)

import { inflateRawSync } from "node:zlib";
import AdmZip from "adm-zip";
import { getDocumentProxy } from "unpdf";
import * as XLSX from "xlsx";
import { isZipBuffer, preflightSpreadsheetZip } from "./spreadsheet-zip-guard";
import { DOCUMENT_UPLOAD_LIMITS } from "./types";

/** 엑셀 시트 하나. 칸 이름으로 값을 바로 찾을 수 있고, 글 전체도 함께 들고 있다. */
export interface SheetData {
  name: string;
  /** 칸 이름(「B2」) → 글자. 빈 칸은 넣지 않는다. 날짜 서식 칸은 YYYY-MM-DD 로 바꿔 둔다. */
  cells: Record<string, string>;
  /** `## 시트이름` 다음 줄부터 쉼표 표(CSV)로 펼친 글 — 종류 가르기·글자 찾기용. */
  text: string;
  /** 행(2,000)·열(60)·글자 상한을 넘어 뒤가 잘렸다. 잘린 표로는 사람 수 같은 「전체 세기」를 하지 않는다. */
  truncated?: true;
}

export type ExtractedDocument =
  /** truncated: 글자 상한(20만 자)으로 뒤가 잘렸다. 잘린 글로는 사람 수 같은 「전체 세기」를 하지 않는다. */
  | { kind: "text"; text: string; truncated?: true }
  /** 사진, 또는 글자가 없는 스캔 PDF. 글자로는 못 읽는다 */
  | { kind: "image" }
  | { kind: "spreadsheet"; sheets: SheetData[] }
  | { kind: "unsupported"; reason: string };

const MAX_UNZIPPED_BYTES = 20 * 1024 * 1024;
/** PDF 에서 꺼낸 글자가 이보다 적으면 「글자가 없는 스캔본」으로 본다. */
const MIN_EXTRACTED_CHARS = 100;
/** 한 파일에서 쓰는 글자 수 상한 — 서류 한 장에 이보다 많은 글은 필요 없다. 넘으면 앞부분만 쓴다. */
const TEXT_LIMIT = 200_000;
const MAX_SHEET_ROWS = 2000;
const MAX_SHEET_COLS = 60;
/** PDF 는 이 쪽수까지만 읽는다. 서류 한 벌은 이보다 짧고, 긴 PDF 는 글자 뽑기만으로 서버가 오래 묶인다. */
const MAX_PDF_PAGES = 30;
const TOO_MANY_PAGES_MESSAGE = "30쪽이 넘는 PDF는 필요한 쪽만 따로 저장해 올려 주세요.";

const HWP_MESSAGE = "옛 한글 파일(.hwp)은 읽을 수 없습니다. 한글에서 PDF로 저장해 올려 주세요.";
const UNSUPPORTED_MESSAGE = "이 종류의 파일은 읽을 수 없습니다. PDF·엑셀·워드·한글(.hwpx)·글 파일로 올려 주세요.";
const MISMATCH_MESSAGE = "파일 이름의 확장자와 실제 파일 모양이 달라 읽지 않았습니다. 원본 파일을 다시 올려 주세요.";
const EMPTY_MESSAGE = "비어 있는 파일입니다.";
const BAD_PDF_MESSAGE = "PDF를 열지 못했습니다. 파일이 깨졌거나 암호가 걸려 있는지 확인해 주세요.";
const BAD_EXCEL_MESSAGE = "엑셀 파일을 열지 못했습니다. 파일이 깨졌는지 확인해 주세요.";

const ACCEPTED_EXTS: ReadonlySet<string> = new Set(DOCUMENT_UPLOAD_LIMITS.acceptExtensions.map((e) => e.slice(1)));

function unsupported(reason: string): ExtractedDocument {
  return { kind: "unsupported", reason };
}

function limited(text: string): string {
  return text.length > TEXT_LIMIT ? text.slice(0, TEXT_LIMIT) : text;
}

function extensionOf(fileName: string): string {
  const name = fileName.trim();
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/* ───────── 확장자와 파일 머리 바이트 대조 ───────── */

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  if (bytes.length < sig.length) return false;
  return sig.every((b, i) => bytes[i] === b);
}

const ZIP_SIG = [0x50, 0x4b, 0x03, 0x04]; // PK.. — 워드·한글새형식·파워포인트·엑셀(xlsx)은 모두 zip 이다
const PDF_SIG = [0x25, 0x50, 0x44, 0x46]; // %PDF
const CFB_SIG = [0xd0, 0xcf, 0x11, 0xe0]; // 옛 엑셀(.xls)·옛 한글이 쓰는 통. 암호 건 xlsx 도 이 모양이다
const JPEG_SIG = [0xff, 0xd8, 0xff];
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function ascii(bytes: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...bytes.subarray(from, to));
}

/** PDF 는 머리 앞에 군더더기가 붙은 파일이 있어 처음 1KB 안에서 찾는다. */
function hasPdfHeader(bytes: Uint8Array): boolean {
  return ascii(bytes, 0, 1024).includes("%PDF-");
}

const UTF16LE_BOM = [0xff, 0xfe];
const UTF16BE_BOM = [0xfe, 0xff];

/** 글 파일인데 다른 종류의 머리를 달았거나 속에 널 바이트가 섞이면 글 파일이 아니다(UTF-16 은 널이 정상). */
function looksLikePlainText(bytes: Uint8Array): boolean {
  if (startsWith(bytes, PDF_SIG) || startsWith(bytes, ZIP_SIG) || startsWith(bytes, CFB_SIG)) return false;
  if (startsWith(bytes, JPEG_SIG) || startsWith(bytes, PNG_SIG)) return false;
  if (startsWith(bytes, UTF16LE_BOM) || startsWith(bytes, UTF16BE_BOM)) return true;
  return !bytes.subarray(0, 1024).includes(0);
}

function headMatches(ext: string, bytes: Uint8Array): boolean {
  switch (ext) {
    case "pdf":
      return hasPdfHeader(bytes);
    case "docx":
    case "hwpx":
    case "pptx":
    case "xlsx":
      return startsWith(bytes, ZIP_SIG);
    // 이름만 .xls 이고 실제로는 xlsx(zip)인 파일이 흔하다 — 둘 다 받는다.
    case "xls":
      return startsWith(bytes, CFB_SIG) || startsWith(bytes, ZIP_SIG);
    case "jpg":
    case "jpeg":
      return startsWith(bytes, JPEG_SIG);
    case "png":
      return startsWith(bytes, PNG_SIG);
    case "webp":
      return bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP";
    case "txt":
    case "csv":
      return looksLikePlainText(bytes);
    default:
      return false;
  }
}

/* ───────── 워드·한글·파워포인트 XML → 글자 ───────── */

/** 숫자로 적힌 글자(&#54620;)를 실제 글자로. 값이 글자 범위를 벗어나면 원문 그대로 둔다. */
function codePointOr(original: string, code: number): string {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return original;
  try {
    return String.fromCodePoint(code);
  } catch {
    return original;
  }
}

/** XML 기호를 원래 글자로 되돌린다(&amp; → &). */
function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (all, h: string) => codePointOr(all, parseInt(h, 16)))
    .replace(/&#(\d+);/g, (all, d: string) => codePointOr(all, Number(d)))
    // &amp; 는 맨 마지막에 푼다 — 먼저 풀면 "&amp;lt;"(글자 그대로의 &lt;)가 <로 잘못 바뀐다.
    .replace(/&amp;/g, "&");
}

/**
 * `<이름 …> … </이름>` 덩어리를 통째로 지운다. 앞에서부터 한 번만 훑어 느려지지 않는다.
 * 워드는 글상자를 **같은 내용 두 벌**(`mc:Choice`·`mc:Fallback`)로 적는다 — 둘 다 읽으면 글이 두 번 들어간다.
 */
function removeBlocks(xml: string, name: string): string {
  const open = `<${name}`;
  const close = `</${name}>`;
  let out = "";
  let from = 0;
  for (;;) {
    const start = xml.indexOf(open, from);
    if (start < 0) break;
    const end = xml.indexOf(close, start);
    if (end < 0) break;
    out += xml.slice(from, start);
    from = end + close.length;
  }
  return out + xml.slice(from);
}

/**
 * 문서 XML 에서 글자만 뽑는다. 앞에서부터 **한 번에 훑으며** 「글자 덩어리 · 문단 끝 · 줄바꿈 · 탭」만 주워 담는다.
 *
 * ★문단을 통째로 떼어 그 안을 보는 방식은 쓰지 않는다 — 글상자처럼 문단 안에 문단이 겹치면 바깥 문단의
 *   뒷글자를 놓친다. 한 번에 훑으면 겹쳐도 줄 나눔만 흐트러질 뿐 글자는 잃지 않는다.
 * ★글자 태그 안에 남은 다른 태그(형광펜 표시 등)는 벗겨 낸다.
 * ★글자 태그는 여는 쪽만 정규식으로 찾고 닫는 쪽은 앞에서부터 한 번만 찾는다 — 한 정규식으로 묶으면
 *   닫는 태그가 없는 파일에서 같은 자리를 되짚어 글자 수의 제곱으로 느려진다.
 *
 * @param paraTag 문단 태그 이름(워드 `w:p`, 한글새형식 `hp:p`, 파워포인트 `a:p`)
 * @param textTag 글자 태그 이름(`w:t`·`hp:t`·`a:t`)
 * @param marks   줄바꿈·탭으로 볼 빈 태그 이름
 * @param table   표 행·칸 태그 — 있으면 행=한 줄, 칸=탭으로 옮긴다
 */
function xmlToText(
  xml: string,
  paraTag: string,
  textTag: string,
  marks: { br: string; tab: string },
  table?: { row: string; cell: string },
): string {
  const tokenRe = new RegExp(
    [
      `<${paraTag}(?:\\s[^>]*)?\\/>`, // 속이 빈 문단
      `<\\/${paraTag}>`, // 문단 끝
      ...(table
        ? [`<${table.row}(?:\\s[^>]*)?>`, `<\\/${table.row}>`, `<${table.cell}(?:\\s[^>]*)?>`, `<\\/${table.cell}>`]
        : []),
      `<${marks.br}(?:\\s[^>]*)?\\/?>`, // 줄바꿈
      `<${marks.tab}(?:\\s[^>]*)?\\/?>`, // 탭
      `<${textTag}(?:\\s[^>]*)?>`, // 글자 시작
    ].join("|"),
    "g",
  );
  const isEmptyPara = new RegExp(`^<${paraTag}(?:\\s[^>]*)?\\/>$`);
  const isBr = new RegExp(`^<${marks.br}\\b`);
  const isTab = new RegExp(`^<${marks.tab}\\b`);
  // 글자 태그 안에 들어 있는 줄바꿈·탭 — 태그를 벗기기 전에 먼저 글자로 바꿔야 살아남는다.
  const innerBr = new RegExp(`<${marks.br}(?:\\s[^>]*)?\\/?>`, "g");
  const innerTab = new RegExp(`<${marks.tab}(?:\\s[^>]*)?\\/?>`, "g");
  const closeText = `</${textTag}>`;
  const isRowOpen = table ? new RegExp(`^<${table.row}\\b`) : null;
  const isCellOpen = table ? new RegExp(`^<${table.cell}\\b`) : null;

  // 표는 칸마다 문단이 하나씩 있어 그대로 두면 행·열이 사라진다. 행·칸을 **겹겹이 쌓아** 추적한다 —
  // 표 안에 표가 든 문서에서 안쪽 표를 만나는 순간 바깥 행에 모아 둔 칸이 버려지는 일을 막는다.
  const cellStack: number[] = [];
  const rowStack: string[][] = [];

  const paras: string[] = [];
  let line = "";
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(xml)) !== null) {
    const token = m[0];

    if (table && isRowOpen && isCellOpen) {
      if (isRowOpen.test(token)) {
        if (line !== "") { paras.push(line); line = ""; }
        rowStack.push([]);
        continue;
      }
      if (token === `</${table.row}>`) {
        const row = rowStack.pop();
        // 안쪽 표의 행은 글줄로 남겨 둔다 — 바깥 칸이 그것까지 함께 거둬 간다.
        if (row) paras.push(row.join("\t"));
        continue;
      }
      if (isCellOpen.test(token)) {
        cellStack.push(paras.length);
        continue;
      }
      if (token === `</${table.cell}>`) {
        if (line !== "") { paras.push(line); line = ""; }
        // 짝이 안 맞는 태그(깨진 파일)면 글을 버리지 말고 그대로 둔다.
        const start = cellStack.pop();
        if (start === undefined) continue;
        const cell = paras.splice(start).join(" ").trim();
        const row = rowStack[rowStack.length - 1];
        if (row) row.push(cell);
        else paras.push(cell);
        continue;
      }
    }

    if (isEmptyPara.test(token) || token === `</${paraTag}>`) {
      paras.push(line);
      line = "";
      continue;
    }
    if (isBr.test(token)) {
      line += "\n";
      continue;
    }
    if (isTab.test(token)) {
      line += "\t";
      continue;
    }

    // 남은 것은 글자 시작 태그 — 닫는 태그를 한 번에 찾는다. 없으면 거기서 멈춘다.
    const from = m.index + token.length;
    const end = xml.indexOf(closeText, from);
    if (end < 0) break;
    // 원문의 `<` 는 `&lt;` 로 들어 있어 태그를 벗길 때 함께 지워지지 않는다.
    const inner = xml
      .slice(from, end)
      .replace(innerBr, "\n")
      .replace(innerTab, "\t")
      .replace(/<[^>]*>/g, "");
    line += unescapeXml(inner);
    tokenRe.lastIndex = end + closeText.length;
  }
  // 마지막 문단 끝 뒤에 남은 글자도 버리지 않는다(겹친 문단에서 생긴다).
  if (line !== "") paras.push(line);

  return paras.join("\n").replace(/\r\n?/g, "\n").trimEnd();
}

/**
 * zip 안 한 칸을 **상한을 지키며** 푼다. 상한을 넘으면 null.
 * zip 이 스스로 적어 둔 「풀면 이만큼」은 거짓일 수 있다(zip 폭탄) — 신고값만 믿지 않고 푸는 동안에도 상한을 건다.
 */
function readEntryText(entry: AdmZip.IZipEntry): string | null {
  if (entry.header.size > MAX_UNZIPPED_BYTES) return null;
  try {
    const raw = entry.getCompressedData();
    // 압축하지 않고 그대로 담은 칸(method 0)은 그 크기가 곧 푼 크기다.
    if (entry.header.method === 0) {
      return raw.length > MAX_UNZIPPED_BYTES ? null : raw.toString("utf-8");
    }
    return inflateRawSync(raw, { maxOutputLength: MAX_UNZIPPED_BYTES }).toString("utf-8");
  } catch {
    return null;
  }
}

function docxXmlToText(xml: string): string {
  return xmlToText(removeBlocks(xml, "mc:Fallback"), "w:p", "w:t", { br: "w:br", tab: "w:tab" }, {
    row: "w:tr",
    cell: "w:tc",
  });
}

/** 한글 본문 XML → 글자. 각주·미주는 본문 한가운데 끼어들지 않게 떼어 내 뒤에 모아 둔다. */
function hwpxXmlToText(xml: string): string {
  const marks = { br: "hp:lineBreak", tab: "hp:tab" };
  const table = { row: "hp:tr", cell: "hp:tc" };
  const notes: string[] = [];
  let body = "";
  let from = 0;
  // 각주·미주 덩어리를 앞에서부터 한 번만 훑어 떼어 낸다. 닫는 태그를 못 찾은 이름은 뒤에도 없으니
  // 다시 찾지 않는다 — 닫히지 않은 태그가 수만 개여도 제곱으로 느려지지 않는다.
  const noMoreClose = new Set<string>();
  const openRe = /<hp:(footNote|endNote)\b/g;
  for (;;) {
    openRe.lastIndex = from;
    const m = openRe.exec(xml);
    if (!m) break;
    const name = m[1];
    const close = `</hp:${name}>`;
    const end = noMoreClose.has(name) ? -1 : xml.indexOf(close, m.index);
    if (end < 0) {
      noMoreClose.add(name);
      // 닫는 태그가 없으면 그 시작 태그만 지우고 계속 간다.
      const gt = xml.indexOf(">", m.index);
      body += xml.slice(from, m.index);
      from = gt < 0 ? xml.length : gt + 1;
      continue;
    }
    body += xml.slice(from, m.index);
    const t = xmlToText(xml.slice(m.index, end + close.length), "hp:p", "hp:t", marks);
    if (t.trim()) notes.push(t.trim());
    from = end + close.length;
  }
  body += xml.slice(from);
  // 표는 워드처럼 칸 사이 탭·행 사이 줄바꿈으로 넘긴다 — 「매출액 | 금액」이 한 줄로 이어져야 읽힌다.
  const main = xmlToText(body, "hp:p", "hp:t", marks, table);
  return notes.length > 0 ? `${main}\n\n[각주]\n${notes.join("\n")}` : main;
}

function pptxXmlToText(xml: string): string {
  return xmlToText(xml, "a:p", "a:t", { br: "a:br", tab: "a:tab" }, { row: "a:tr", cell: "a:tc" });
}

/** 워드(.docx)에서 글자를 꺼낸다. 못 꺼내면 빈 글자. */
function extractDocx(buf: Buffer): string {
  try {
    const entry = new AdmZip(buf).getEntry("word/document.xml");
    if (!entry) return "";
    const xml = readEntryText(entry);
    return xml === null ? "" : docxXmlToText(xml);
  } catch {
    return ""; // 깨진 파일·zip 아님
  }
}

/** `Contents/section12.xml` 에서 12 를 꺼낸다 — 이름 순서로 세우면 10번이 2번보다 앞에 온다. */
function numberIn(name: string, re: RegExp): number {
  const m = re.exec(name);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

/** 한글 새 형식(.hwpx)에서 글자를 꺼낸다. 못 꺼내면 빈 글자. */
function extractHwpx(buf: Buffer): string {
  const sections: string[] = [];
  try {
    const entries = new AdmZip(buf)
      .getEntries()
      .filter((e) => !e.isDirectory && /^Contents\/section\d+\.xml$/i.test(e.entryName))
      .sort((a, b) => numberIn(a.entryName, /section(\d+)\.xml$/i) - numberIn(b.entryName, /section(\d+)\.xml$/i));
    let used = 0;
    for (const e of entries) {
      const xml = readEntryText(e);
      if (xml === null) return "";
      used += xml.length;
      if (used > MAX_UNZIPPED_BYTES) return "";
      sections.push(xml);
    }
  } catch {
    return "";
  }
  return sections.map((xml) => hwpxXmlToText(xml)).filter((t) => t !== "").join("\n");
}

/** 슬라이드 한 장에 딸린 발표자 노트 칸 이름 — 번호로 짝짓지 않고 파일이 스스로 적어 둔 짝을 읽는다. */
function notesEntryNameFor(zip: AdmZip, slideEntryName: string): string | null {
  const base = slideEntryName.slice(slideEntryName.lastIndexOf("/") + 1);
  const rels = zip.getEntry(`ppt/slides/_rels/${base}.rels`);
  if (!rels) return null;
  const xml = readEntryText(rels);
  if (xml === null) return null;
  const m = /Target="[^"]*?notesSlides\/(notesSlide\d+\.xml)"/i.exec(xml);
  return m ? `ppt/notesSlides/${m[1]}` : null;
}

/** 파워포인트(.pptx)에서 글자를 꺼낸다(발표자 노트 포함). 못 꺼내면 빈 글자. */
function extractPptx(buf: Buffer): string {
  const pages: string[] = [];
  try {
    const zip = new AdmZip(buf);
    const slideNo = (name: string) => numberIn(name, /slide(\d+)\.xml$/i);
    const slides = zip
      .getEntries()
      .filter((e) => !e.isDirectory && /^ppt\/slides\/slide\d+\.xml$/i.test(e.entryName))
      .sort((a, b) => slideNo(a.entryName) - slideNo(b.entryName));
    let used = 0;
    for (const e of slides) {
      const xml = readEntryText(e);
      if (xml === null) return "";
      used += xml.length;
      if (used > MAX_UNZIPPED_BYTES) return "";

      const body = pptxXmlToText(xml).trim();

      let note = "";
      const notesName = notesEntryNameFor(zip, e.entryName);
      if (notesName) {
        const notesEntry = zip.getEntry(notesName);
        const notesXml = notesEntry ? readEntryText(notesEntry) : null;
        if (notesXml !== null) {
          used += notesXml.length;
          if (used > MAX_UNZIPPED_BYTES) return "";
          note = pptxXmlToText(notesXml).trim();
        }
      }

      if (!body && !note) continue;
      const piece = [`## ${slideNo(e.entryName)}쪽`];
      if (body) piece.push(body);
      if (note) piece.push(`[발표자 노트]\n${note}`);
      pages.push(piece.join("\n"));
    }
  } catch {
    return "";
  }
  return pages.join("\n\n");
}

/* ───────── 글 파일·PDF ───────── */

/**
 * 글 파일(.txt/.csv)을 읽는다. 한글 파일은 UTF-8·CP949(옛 윈도우)·UTF-16 이 섞여 있어 머리 표시로 가른다.
 * UTF-8 은 자기검증적이라 CP949 바이트열은 거의 항상 「잘못된 UTF-8」로 걸려 폴백이 정확히 발동한다.
 */
function extractPlain(bytes: Uint8Array): string {
  let text: string;
  if (startsWith(bytes, UTF16LE_BOM)) {
    text = new TextDecoder("utf-16le").decode(bytes.subarray(2));
  } else if (startsWith(bytes, UTF16BE_BOM)) {
    text = new TextDecoder("utf-16be").decode(bytes.subarray(2));
  } else if (startsWith(bytes, [0xef, 0xbb, 0xbf])) {
    text = new TextDecoder("utf-8").decode(bytes.subarray(3));
  } else {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      text = new TextDecoder("euc-kr").decode(bytes);
    }
  }
  // 글 맨 앞의 보이지 않는 표시(BOM, 0xFEFF)는 뗀다.
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return body.replace(/\r\n?/g, "\n").trimEnd();
}

/** 꺼낸 글자가 너무 적으면 「글자가 없는 스캔본」으로 본다. 공백을 뺀 실제 글자로 센다. */
export function looksScanned(text: string): boolean {
  return text.replace(/\s+/g, "").length < MIN_EXTRACTED_CHARS;
}

/** 글자를 뽑기 전에 쪽수부터 본다 — 30쪽을 넘으면 읽지 않는다. */
export function exceedsPdfPageLimit(pageCount: number): boolean {
  return pageCount > MAX_PDF_PAGES;
}

async function readPdf(buf: Buffer): Promise<ExtractedDocument> {
  try {
    // unpdf(pdf.js)는 받은 버퍼를 작업 스레드로 넘겨 원본을 비운다 — 같은 바이트를 다시 읽을 수 있게 복사본을 넘긴다.
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    if (exceedsPdfPageLimit(pdf.numPages)) return unsupported(TOO_MANY_PAGES_MESSAGE);
    // 한 쪽씩 차례로 읽는다(전 쪽 동시 읽기 금지). 글자가 상한을 넘으면 거기서 멈춘다.
    const pages: string[] = [];
    let used = 0;
    let n = 1;
    for (; n <= pdf.numPages && used <= TEXT_LIMIT; n++) {
      const content = await (await pdf.getPage(n)).getTextContent();
      const page = content.items
        .map((item) => (item as { str?: string; hasEOL?: boolean }))
        .filter((item) => item.str != null)
        .map((item) => `${item.str}${item.hasEOL ? "\n" : ""}`)
        .join("");
      pages.push(page);
      used += page.length;
    }
    const text = pages
      .join("\n")
      .replace(/\r\n?/g, "\n")
      .trim();
    // 글자가 없는 쪽만 이어진 스캔본은 사진처럼 AI 가 읽어야 한다.
    if (looksScanned(text)) return { kind: "image" };
    return textResult(text, n <= pdf.numPages); // 글자 상한에 걸려 남은 쪽을 읽지 않았으면 잘린 글이다
  } catch {
    return unsupported(BAD_PDF_MESSAGE);
  }
}

/* ───────── 엑셀 ───────── */

/** 날짜 서식인가 — 따옴표·대괄호 속 글자를 뺀 서식에 연(y)·일(d) 글자가 있으면 날짜다(시간만 있는 서식은 아니다). */
function isDateFormat(format: string): boolean {
  const bare = format.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "");
  return /[yd]/i.test(bare);
}

/**
 * 엑셀 날짜 번호를 YYYY-MM-DD 로. 이상한 값이면 null.
 * 기본은 1900 체계(25569 = 1970-01-01). 통합 문서가 1904 체계(맥 엑셀 옛 파일)면 같은 번호가 1462일 뒤 날짜다.
 */
function serialToDate(serial: number, date1904 = false): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return null;
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return new Date(epoch + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
}

function cellText(cell: XLSX.CellObject | undefined, date1904 = false): string {
  if (!cell || cell.v === undefined || cell.v === null) return "";
  if (cell.t === "n" && typeof cell.v === "number") {
    if (cell.z && isDateFormat(String(cell.z))) {
      const date = serialToDate(cell.v, date1904);
      if (date) return date;
    }
    return String(cell.v);
  }
  if (cell.t === "d" && cell.v instanceof Date) return cell.v.toISOString().slice(0, 10);
  if (cell.t === "e") return ""; // 수식 오류 칸
  if (cell.t === "b") return cell.v ? "TRUE" : "FALSE";
  return String(cell.v).trim();
}

const CELL_ADDRESS = /^[A-Z]{1,3}[0-9]{1,7}$/;

/**
 * 시트 범위(`!ref`)를 행·열 상한으로 잘라 다시 넣는다. 파일이 범위를 「A1:ZZZZ100」처럼 터무니없이 적어 두면
 * 쉼표 표로 바꿀 때 빈 칸까지 전부 훑어 서버가 묶인다 — 변환은 잘린 범위로만 한다.
 * 원래 범위가 상한을 넘었으면 true.
 */
function clampSheetRange(ws: XLSX.WorkSheet): boolean {
  const ref = ws["!ref"];
  if (!ref) return false;
  let range: XLSX.Range;
  try {
    range = XLSX.utils.decode_range(ref);
  } catch {
    delete ws["!ref"]; // 읽을 수 없는 범위는 믿지 않는다 — 칸 이름 쪽(cells)만 쓴다
    return false;
  }
  const over = range.e.r >= MAX_SHEET_ROWS || range.e.c >= MAX_SHEET_COLS;
  if (over) {
    range.e.r = Math.min(range.e.r, MAX_SHEET_ROWS - 1);
    range.e.c = Math.min(range.e.c, MAX_SHEET_COLS - 1);
    ws["!ref"] = XLSX.utils.encode_range(range);
  }
  return over;
}

function sheetOf(name: string, ws: XLSX.WorkSheet, date1904: boolean): SheetData {
  const cells: Record<string, string> = {};
  for (const addr of Object.keys(ws)) {
    // 칸 이름처럼 생긴 것만 본다 — 엑셀 속 이름은 파일이 정하므로 믿지 않는다.
    if (!CELL_ADDRESS.test(addr)) continue;
    const { r, c } = XLSX.utils.decode_cell(addr);
    if (r >= MAX_SHEET_ROWS || c >= MAX_SHEET_COLS) continue;
    const text = cellText(ws[addr] as XLSX.CellObject, date1904);
    if (text) cells[addr] = text;
  }
  const rangeCut = clampSheetRange(ws);
  const csv = XLSX.utils.sheet_to_csv(ws).trimEnd();
  const full = `## ${name}\n${csv}`;
  const text = limited(full);
  const sheet: SheetData = { name, cells, text };
  if (rangeCut || text.length < full.length) sheet.truncated = true;
  return sheet;
}

/** `<row r="12" …>` 의 줄 번호(큰따옴표·작은따옴표 모두, 등호 앞뒤 공백 허용). 태그 하나 안에서만 찾는 짧은 식이다. */
const ROW_NUMBER = /\sr\s*=\s*(?:"(\d{1,9})"|'(\d{1,9})')/;
/** 태그 이름이 끝나는 글자 */
const TAG_NAME_END = new Set([" ", "\t", "\n", "\r", ">", "/", "<"]);

/** `<` 자리에서 태그 이름(닫는 태그의 `/` 는 뺀다)과 이름 끝 자리를 읽는다. 이름 앞 접두사(`x:`)는 떼고 본 이름도 함께. */
function tagNameAt(xml: string, open: number): { local: string; closing: boolean; end: number } {
  let start = open + 1;
  const closing = xml[start] === "/";
  if (closing) start++;
  let end = start;
  while (end < xml.length && !TAG_NAME_END.has(xml[end])) end++;
  const name = xml.slice(start, end);
  return { local: name.slice(name.lastIndexOf(":") + 1), closing, end };
}

/**
 * 한 줄의 몸통(`from`~`to`)에 값이 든 칸이 있는가 — 숫자·글자 값(`<v>`)이나 바로 적은 글자(`<is>`)가 있으면 참.
 * 서식만 있는 칸(`<c r="A1"/>`)·속이 빈 `<v/>` 에는 없다. 값 태그의 접두사(`<x:v>`)는 줄 태그와 달라도 된다.
 */
function hasValueTag(xml: string, from: number, to: number): boolean {
  let at = from;
  for (;;) {
    const open = xml.indexOf("<", at);
    if (open < 0 || open >= to) return false;
    const tag = tagNameAt(xml, open);
    if (!tag.closing && (tag.local === "v" || tag.local === "is") && xml[tag.end] !== "/") return true;
    at = open + 1;
  }
}

/** 줄을 닫는 태그(`</row>`·`</x:row>`)의 자리. 접두사는 가리지 않는다. 없으면 -1. */
function rowCloseFrom(xml: string, from: number): number {
  let at = from;
  for (;;) {
    const open = xml.indexOf("</", at);
    if (open < 0) return -1;
    if (tagNameAt(xml, open).local === "row") return open;
    at = open + 2;
  }
}

/**
 * 시트 XML 에서 **값이 있는 칸을 가진 마지막 줄 번호**. 없으면 0.
 * 읽기 도구에 행 상한(sheetRows)을 주면 상한 뒤 줄은 읽지 않아 범위가 줄어든다 — 그 뒤에 값이 있었는지는
 * 읽기 전에 원본 XML 에서 따로 알아야 한다. 앞에서 한 번만 훑는다(역추적 정규식·되돌아가기 없음).
 * 줄 태그에 이름 접두사(`<x:row …>`)가 붙어도, 속성이 작은따옴표·등호 공백(`r = '3000'`)이어도 읽는다.
 * 줄 태그·닫는 태그·값 태그의 접두사는 서로 달라도 된다.
 */
export function lastValuedRowOf(xml: string): number {
  let last = 0;
  let current = 0;
  let from = 0;
  for (;;) {
    const open = xml.indexOf("<", from);
    if (open < 0) break;
    const { local, closing } = tagNameAt(xml, open);
    // 「<rowBreaks」·「</row>」처럼 줄을 여는 태그가 아닌 것은 건너뛴다.
    if (closing || local !== "row") {
      from = open + 1;
      continue;
    }
    const tagEnd = xml.indexOf(">", open);
    if (tagEnd < 0) break;
    const tag = xml.slice(open, tagEnd + 1);
    const num = ROW_NUMBER.exec(tag);
    current = num ? Number(num[1] ?? num[2]) : current + 1; // 번호가 없는 줄은 앞 줄 다음 번호
    from = tagEnd + 1;
    if (tag.endsWith("/>")) continue; // 칸이 없는 줄
    const close = rowCloseFrom(xml, from);
    const end = close < 0 ? xml.length : close;
    if (current > last && hasValueTag(xml, from, end)) last = current;
    from = end;
  }
  return last;
}

/** 속성 값 하나(`name="…"`·`name='…'`·`name = "…"`, 등호 앞뒤 공백 허용). 없으면 null. */
function attrOf(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag);
  return m ? unescapeXml(m[1] ?? m[2]) : null;
}

/** 시트 태그의 연결표 번호(`r:id`). 접두사가 `r` 이 아닌 파일(`rel:id`)도 읽는다. */
function relIdOf(tag: string): string | null {
  const direct = attrOf(tag, "r:id");
  if (direct !== null) return direct;
  const m = /\s[A-Za-z_][\w.-]*:id\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(tag);
  return m ? unescapeXml(m[1] ?? m[2]) : null;
}

/** `<` 로 연 태그의 끝(`>`) 자리. 따옴표 안의 `>` 는 건너뛴다. 없으면 -1. */
function tagEndFrom(xml: string, open: number): number {
  let quote = "";
  for (let i = open + 1; i < xml.length; i++) {
    const c = xml[i];
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ">") {
      return i;
    }
  }
  return -1;
}

/**
 * 이름이 `tagName` 인 여는 태그들(`<sheet …>`)을 앞에서부터 모은다. 이름 앞 접두사(`<s:sheet …>`)는 가리지 않는다.
 * `<sheets>` 처럼 이름만 비슷한 태그나 닫는 태그는 담지 않는다.
 */
function tagsOf(xml: string, tagName: string): string[] {
  const tags: string[] = [];
  let from = 0;
  for (;;) {
    const open = xml.indexOf("<", from);
    if (open < 0) break;
    const { local, closing } = tagNameAt(xml, open);
    if (closing || local !== tagName) {
      from = open + 1;
      continue;
    }
    const end = tagEndFrom(xml, open);
    if (end < 0) break;
    tags.push(xml.slice(open, end + 1));
    from = end + 1;
  }
  return tags;
}

/**
 * 시트 하나가 행 상한을 넘어 뒤가 잘렸는가. 원본에서 구한 마지막 값 줄(lastRow)이 있으면 그것을 따른다.
 * 못 구했으면(undefined) 상한을 넘었는지 모르는 것이니 잘린 쪽으로 둔다 — 단 읽기 도구가 「원래 범위가 읽은 범위보다 크다」
 * (`!fullref`)를 알리지 않아 상한보다 작다는 게 읽은 결과로 확실하면 예외.
 */
export function isSheetTruncated(lastRow: number | undefined, hasFullRef: boolean): boolean {
  if (lastRow === undefined) return hasFullRef;
  return lastRow < 0 || lastRow > MAX_SHEET_ROWS;
}

/**
 * 시트 이름 → 값이 있는 마지막 줄 번호. 시트 이름과 시트 파일은 통합 문서 목록(`xl/workbook.xml`)과
 * 연결표(`xl/_rels/workbook.xml.rels`)로 잇는다. 시트 XML 이 풀림 상한(20MB)을 넘어 못 풀면 -1 —
 * 줄 수를 확인할 수 없을 만큼 큰 시트라 잘린 것으로 본다. zip 이 아닌 옛 엑셀·모양이 다른 파일은 빈 표(기존 방식).
 */
export function lastValuedRows(buf: Buffer): Map<string, number> {
  const out = new Map<string, number>();
  if (!isZipBuffer(buf)) return out;
  try {
    const zip = new AdmZip(buf);
    const bookEntry = zip.getEntry("xl/workbook.xml");
    const relsEntry = zip.getEntry("xl/_rels/workbook.xml.rels");
    const book = bookEntry ? readEntryText(bookEntry) : null;
    const rels = relsEntry ? readEntryText(relsEntry) : null;
    if (book === null || rels === null) return out;
    const targets = new Map<string, string>();
    for (const tag of tagsOf(rels, "Relationship")) {
      const id = attrOf(tag, "Id");
      const target = attrOf(tag, "Target");
      if (id && target) targets.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
    }
    for (const tag of tagsOf(book, "sheet")) {
      const name = attrOf(tag, "name");
      const rid = relIdOf(tag);
      const path = rid ? targets.get(rid) : undefined;
      const entry = path ? zip.getEntry(path) : null;
      if (name === null || !entry) continue;
      const xml = readEntryText(entry);
      out.set(name, xml === null ? -1 : lastValuedRowOf(xml));
    }
  } catch {
    // 못 읽으면 기존 방식(읽은 범위)으로만 잘림을 가린다.
  }
  return out;
}

function readSpreadsheet(buf: Buffer): ExtractedDocument {
  // zip 속은 XLSX.read 전에 칸마다 풀림 상한을 실제로 확인한다(압축 폭탄).
  if (isZipBuffer(buf)) {
    const preflight = preflightSpreadsheetZip(buf);
    if (!preflight.ok) return unsupported(preflight.reason);
  }
  try {
    // 한 줄 더 읽어(+1) 상한을 넘는 줄이 있었는지 알아본다 — 딱 상한까지만 읽으면 잘렸는지 알 수 없다.
    const wb = XLSX.read(buf, { type: "buffer", cellNF: true, sheetRows: MAX_SHEET_ROWS + 1 });
    const flag: unknown = wb.Workbook?.WBProps?.date1904;
    const date1904 = flag === true || flag === 1 || flag === "1" || flag === "true";
    // 행 상한으로 읽으면 상한 뒤 줄은 범위에서 사라진다 — 값이 있는 마지막 줄을 원본에서 따로 보아 잘림을 표시한다.
    const lastRows = lastValuedRows(buf);
    const sheets: SheetData[] = [];
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      if (!ws) continue;
      const sheet = sheetOf(name, ws, date1904);
      // 읽기 도구가 원래 범위가 더 크다고 알린 시트(!fullref)인데 마지막 값 줄을 못 구했으면 잘린 것으로 둔다.
      if (isSheetTruncated(lastRows.get(name), "!fullref" in ws)) sheet.truncated = true;
      sheets.push(sheet);
    }
    return { kind: "spreadsheet", sheets };
  } catch {
    return unsupported(BAD_EXCEL_MESSAGE);
  }
}

/* ───────── 들어가는 곳 ───────── */

/** 글 결과 — 글자 상한(20만 자)으로 잘랐거나(`alreadyCut` = 읽기 도중 멈춤) 앞부분만 읽었으면 truncated 를 붙인다. */
function textResult(text: string, alreadyCut = false): ExtractedDocument {
  const cut = alreadyCut || text.length > TEXT_LIMIT;
  return { kind: "text", text: limited(text), ...(cut ? { truncated: true as const } : {}) };
}

/** 파일 이름(확장자 판별용)과 바이트로 글자·표를 꺼낸다. 예외를 던지지 않는다. */
export async function extractDocumentText(fileName: string, bytes: Uint8Array): Promise<ExtractedDocument> {
  try {
    const ext = extensionOf(fileName);
    if (ext === "hwp") return unsupported(HWP_MESSAGE);
    if (!ACCEPTED_EXTS.has(ext)) return unsupported(UNSUPPORTED_MESSAGE);
    if (bytes.length === 0) return unsupported(EMPTY_MESSAGE);
    if (!headMatches(ext, bytes)) return unsupported(MISMATCH_MESSAGE);

    const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    switch (ext) {
      case "jpg":
      case "jpeg":
      case "png":
      case "webp":
        return { kind: "image" };
      case "pdf":
        return await readPdf(buf);
      case "docx":
        return textResult(extractDocx(buf));
      case "hwpx":
        return textResult(extractHwpx(buf));
      case "pptx":
        return textResult(extractPptx(buf));
      case "txt":
      case "csv":
        return textResult(extractPlain(bytes));
      case "xlsx":
      case "xls":
        return readSpreadsheet(buf);
      default:
        return unsupported(UNSUPPORTED_MESSAGE);
    }
  } catch {
    return unsupported(UNSUPPORTED_MESSAGE);
  }
}
