// 엑셀(.xlsx, 잘못 이름 붙인 ZIP) 속을 XLSX.read 전에 실제로 풀며 상한을 지킨다.
// 헤더가 작다고 적어도 믿지 않고, 칸마다 inflateRawSync(maxOutputLength)로 확인한다.
// 중앙 디렉터리뿐 아니라 칸마다 로컬 파일 헤더(읽기 도구가 먼저 보는 크기)도 같은지·상한 안인지 본다.
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
