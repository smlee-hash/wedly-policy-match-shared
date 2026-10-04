// 엑셀(.xlsx, 잘못 이름 붙인 ZIP) 속을 XLSX.read 전에 실제로 풀며 상한을 지킨다.
// 헤더가 작다고 적어도 믿지 않고, 칸마다 inflateRawSync(maxOutputLength)로 확인한다.
// 중앙 디렉터리뿐 아니라 칸마다 로컬 파일 헤더(읽기 도구가 먼저 보는 크기)도 같은지·상한 안인지 본다.
// 업로드 상한 안의 엑셀은 ZIP64 가 필요 없으므로, ZIP64 표시(크기·위치 칸 가득 참·확장 필드 0x0001·ZIP64 끝 레코드)가 있으면 거절한다.
// (ERP consulting/spreadsheet-zip-guard.ts 를 그대로 옮겼다.)

import { crc32, inflateRawSync } from "node:zlib";
import AdmZip from "adm-zip";

export const SPREADSHEET_ZIP_MAX_PARTS = 1000;
export const SPREADSHEET_ZIP_MAX_TOTAL_BYTES = 40 * 1024 * 1024;

export type SpreadsheetZipLimits = {
  maxParts: number;
  maxTotalBytes: number;
  maxEntryBytes: number;
};

export const SPREADSHEET_ZIP_DEFAULT_LIMITS: SpreadsheetZipLimits = {
  maxParts: SPREADSHEET_ZIP_MAX_PARTS,
  maxTotalBytes: SPREADSHEET_ZIP_MAX_TOTAL_BYTES,
  maxEntryBytes: SPREADSHEET_ZIP_MAX_TOTAL_BYTES,
};

export type SpreadsheetZipPreflight =
  | { ok: true }
  | { ok: false; reason: string };

const TOO_LARGE = "엑셀 파일이 너무 큽니다. 필요한 부분만 남겨 다시 올려 주세요.";
const INVALID = "엑셀 파일이 올바르지 않습니다. 다른 파일로 다시 올려 주세요.";

export function isZipBuffer(buf: Buffer): boolean {
  return Buffer.isBuffer(buf) && buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b;
}

function tooLarge(): SpreadsheetZipPreflight {
  return { ok: false, reason: TOO_LARGE };
}

function invalid(): SpreadsheetZipPreflight {
  return { ok: false, reason: INVALID };
}

function isBufferTooLarge(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: unknown }).code === "ERR_BUFFER_TOO_LARGE",
  );
}

const LOCAL_HEADER_SIZE = 30;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
/** 일반 목적 비트 3 — 크기·검사값을 칸 뒤 데이터 기술자에 적었다(로컬 헤더에는 0). */
const FLAG_DATA_DESCRIPTOR = 0x8;

/**
 * 칸의 **로컬 파일 헤더**를 중앙 디렉터리와 맞춰 본다. 엑셀 읽기 도구는 중앙 값이 아니라 로컬 헤더의
 * 비압축 크기(+22)로 먼저 버퍼를 잡으므로, 거기에 큰 값이 적혀 있으면 읽기 전에 막아야 한다.
 * 서명이 틀리거나 이름 길이·크기가 중앙과 다르면 거짓말하는 파일이다. 상한을 넘은 값은 「너무 큼」으로 막는다.
 * 데이터 기술자 표시가 있고 로컬 크기가 0 이면 중앙 값을 쓴다(상한은 앞에서 이미 검사했다).
 */
function checkLocalHeader(buf: Buffer, entry: AdmZip.IZipEntry, maxEntry: number): SpreadsheetZipPreflight | null {
  const at = Number(entry.header.offset);
  if (!Number.isInteger(at) || at < 0 || at + LOCAL_HEADER_SIZE > buf.length) return invalid();
  if (buf.readUInt32LE(at) !== LOCAL_HEADER_SIGNATURE) return invalid();

  const flags = buf.readUInt16LE(at + 6);
  const localCompressed = buf.readUInt32LE(at + 18);
  const localSize = buf.readUInt32LE(at + 22);
  const localNameLength = buf.readUInt16LE(at + 26);
  if (localSize > maxEntry || localCompressed > maxEntry) return tooLarge();
  if (localNameLength !== Number(entry.header.fileNameLength)) return invalid();

  const deferred = (flags & FLAG_DATA_DESCRIPTOR) !== 0 && localCompressed === 0 && localSize === 0;
  if (!deferred) {
    if (localSize !== Number(entry.header.size)) return invalid();
    if (localCompressed !== Number(entry.header.compressedSize)) return invalid();
  }
  return null;
}

/* ───────── ZIP64 거절 ───────── */

// 업로드 상한(20MB) 안의 엑셀은 ZIP64 가 필요 없다. ZIP64 표시가 하나라도 있으면 크기·위치를 믿을 수 없으니 읽지 않는다.
// (중앙 디렉터리와 로컬 헤더 어느 쪽이든. 확장 필드는 길이 안에서만 걷고, 넘치면 깨진 파일로 거절한다.)

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIZE = 22;
const ZIP64_LOCATOR_SIZE = 20;
const CENTRAL_HEADER_SIZE = 46;
const MAX_EOCD_SEARCH = EOCD_SIZE + 0xffff;
const ZIP64_EXTRA_ID = 0x0001;
const U16_FULL = 0xffff;
const U32_FULL = 0xffffffff;

/** 확장 필드(`start`~`end`)를 걸으며 ZIP64 표시(ID 0x0001)가 있는지 본다. 길이가 범위를 넘으면 "broken". */
function scanExtra(buf: Buffer, start: number, end: number): "zip64" | "broken" | "none" {
  if (start < 0 || end < start || end > buf.length) return "broken";
  let at = start;
  while (at < end) {
    if (at + 4 > end) return "broken";
    const id = buf.readUInt16LE(at);
    const size = buf.readUInt16LE(at + 2);
    if (at + 4 + size > end) return "broken";
    if (id === ZIP64_EXTRA_ID) return "zip64";
    at += 4 + size;
  }
  return "none";
}

/** 끝 레코드(EOCD)의 자리. 파일 끝에서 거꾸로 찾는다. 없으면 -1. */
function findEndRecord(buf: Buffer): number {
  const lowest = Math.max(0, buf.length - MAX_EOCD_SEARCH);
  for (let at = buf.length - EOCD_SIZE; at >= lowest; at--) {
    if (buf.readUInt32LE(at) === EOCD_SIGNATURE) return at;
  }
  return -1;
}

/**
 * ZIP64 표시가 하나라도 있거나 구조가 맞지 않으면 거절 결과를, 아니면 null.
 *  - 끝 레코드: 항목 수 0xFFFF·디렉터리 크기/위치 0xFFFFFFFF, ZIP64 끝 레코드·위치 표시 서명
 *  - 중앙 디렉터리 항목과 그 로컬 헤더: 크기·위치 칸 0xFFFFFFFF, 확장 필드 ID 0x0001
 */
function rejectZip64(buf: Buffer): SpreadsheetZipPreflight | null {
  const eocd = findEndRecord(buf);
  if (eocd < 0) return invalid();

  const entriesOnDisk = buf.readUInt16LE(eocd + 8);
  const entriesTotal = buf.readUInt16LE(eocd + 10);
  const centralSize = buf.readUInt32LE(eocd + 12);
  const centralOffset = buf.readUInt32LE(eocd + 16);
  if (entriesOnDisk === U16_FULL || entriesTotal === U16_FULL) return tooLarge();
  if (centralSize === U32_FULL || centralOffset === U32_FULL) return tooLarge();
  // ZIP64 끝 레코드는 위치 표시 바로 앞, 위치 표시는 끝 레코드 바로 앞에 놓인다.
  if (eocd >= ZIP64_LOCATOR_SIZE && buf.readUInt32LE(eocd - ZIP64_LOCATOR_SIZE) === ZIP64_LOCATOR_SIGNATURE) return tooLarge();

  const centralEnd = centralOffset + centralSize;
  if (centralEnd > eocd) return invalid();
  // 중앙 디렉터리 끝과 끝 레코드 사이에는 보통 아무것도 없다. 거기에 ZIP64 서명이 있으면 거절한다.
  for (const signature of [ZIP64_EOCD_SIGNATURE, ZIP64_LOCATOR_SIGNATURE]) {
    const mark = Buffer.alloc(4);
    mark.writeUInt32LE(signature);
    const found = buf.indexOf(mark, centralEnd);
    if (found >= 0 && found < eocd) return tooLarge();
  }

  // 읽기 도구는 디렉터리 크기가 아니라 끝 레코드의 항목 수만큼 걷는다 — 크기를 0·짧게 적어 검사를 건너뛰지 못하게
  // 실제로 걸은 항목 수가 끝 레코드의 항목 수와 같아야 한다.
  if (entriesOnDisk !== entriesTotal) return invalid();
  let walked = 0;
  let at = centralOffset;
  while (at < centralEnd) {
    if (at + CENTRAL_HEADER_SIZE > centralEnd || buf.readUInt32LE(at) !== CENTRAL_SIGNATURE) return invalid();
    const compressed = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    const diskStart = buf.readUInt16LE(at + 34);
    const localAt = buf.readUInt32LE(at + 42);
    const next = at + CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength;
    if (next > centralEnd) return invalid();
    if (compressed === U32_FULL || size === U32_FULL || localAt === U32_FULL || diskStart === U16_FULL) return tooLarge();
    const extraAt = at + CENTRAL_HEADER_SIZE + nameLength;
    const central = scanExtra(buf, extraAt, extraAt + extraLength);
    if (central === "broken") return invalid();
    if (central === "zip64") return tooLarge();

    // 이 항목의 로컬 헤더도 같은 눈으로 본다(읽기 도구는 로컬 헤더를 먼저 본다).
    if (localAt + LOCAL_HEADER_SIZE > buf.length || buf.readUInt32LE(localAt) !== LOCAL_HEADER_SIGNATURE) return invalid();
    const localCompressed = buf.readUInt32LE(localAt + 18);
    const localSize = buf.readUInt32LE(localAt + 22);
    if (localCompressed === U32_FULL || localSize === U32_FULL) return tooLarge();
    const localExtraAt = localAt + LOCAL_HEADER_SIZE + buf.readUInt16LE(localAt + 26);
    const local = scanExtra(buf, localExtraAt, localExtraAt + buf.readUInt16LE(localAt + 28));
    if (local === "broken") return invalid();
    if (local === "zip64") return tooLarge();
    at = next;
    walked++;
  }
  if (walked !== entriesTotal) return invalid();
  return null;
}

function inflatePart(compressed: Buffer, method: number, maxOutput: number): Buffer | null {
  if (maxOutput <= 0) return null;
  if (method === 0) {
    if (compressed.length > maxOutput) return null;
    return compressed;
  }
  if (method !== 8) return null;
  try {
    return inflateRawSync(compressed, { maxOutputLength: maxOutput });
  } catch (error) {
    if (isBufferTooLarge(error)) return null;
    throw error;
  }
}

export function preflightSpreadsheetZip(
  buf: Buffer,
  limits: SpreadsheetZipLimits = SPREADSHEET_ZIP_DEFAULT_LIMITS,
): SpreadsheetZipPreflight {
  if (!isZipBuffer(buf)) return invalid();
  const maxParts = Math.max(0, Math.floor(limits.maxParts));
  const maxTotal = Math.max(0, Math.floor(limits.maxTotalBytes));
  const maxEntry = Math.max(0, Math.floor(limits.maxEntryBytes));
  if (maxParts < 1 || maxTotal < 1 || maxEntry < 1) return tooLarge();

  // ZIP64 표시가 있으면 adm-zip 이 큰 값으로 바꿔 읽기 전에 막는다(중앙·로컬 모두).
  const zip64 = rejectZip64(buf);
  if (zip64) return zip64;

  let archive: AdmZip;
  try {
    archive = new AdmZip(buf);
  } catch {
    return invalid();
  }

  let entries: AdmZip.IZipEntry[];
  try {
    entries = archive.getEntries();
  } catch {
    return invalid();
  }
  if (!Array.isArray(entries) || entries.length > maxParts) return tooLarge();

  let actualTotal = 0;
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    // 암호가 걸린 칸은 풀 수 없다.
    if ((entry.header.flags & 0x1) !== 0) return invalid();

    const declared = Number(entry.header.size);
    if (!Number.isFinite(declared) || declared < 0 || declared > maxEntry) return tooLarge();
    const declaredCompressed = Number(entry.header.compressedSize);
    if (Number.isFinite(declaredCompressed) && declaredCompressed > maxEntry) return tooLarge();
    // 중앙 디렉터리만 믿지 않는다 — 읽기 도구가 보는 로컬 헤더도 같은지, 상한 안인지 본다.
    const local = checkLocalHeader(buf, entry, maxEntry);
    if (local) return local;

    let compressed: Buffer;
    try {
      compressed = Buffer.from(entry.getCompressedData());
    } catch {
      return invalid();
    }

    const remaining = Math.min(maxEntry, maxTotal - actualTotal);
    let data: Buffer;
    try {
      const inflated = inflatePart(compressed, Number(entry.header.method), remaining);
      if (!inflated) return tooLarge();
      data = inflated;
    } catch {
      return invalid();
    }

    // 적어 둔 크기·검사값이 실제와 다르면 거짓말하는 파일이다.
    if (data.length !== declared) return invalid();
    if ((crc32(data) >>> 0) !== (Number(entry.header.crc) >>> 0)) return invalid();
    actualTotal += data.length;
    if (actualTotal > maxTotal) return tooLarge();
  }
  return { ok: true };
}
