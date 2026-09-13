// HWP 5.0 본문(BodyText) 문단 글자를 뽑는다.
// 레코드·컨트롤 짜임은 한컴 공개 파일형식 문서(한글문서파일형식 5.0 revision 1.3)와
// 한컴 기술 글(python-hwp-parsing)을 따른다. 글자만 뽑으며 신청 기한은 추론하지 않는다.
import { parse as parseCfb } from "cfb";
import { inflateRawSync } from "node:zlib";

const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_SECTIONS = 128;
const MAX_RECORDS = 200_000;
const MAX_DECODED_BYTES = 16 * 1024 * 1024;
const MAX_OUTPUT_UNITS = 100_000;
const FILE_HEADER_BYTES = 256;
const FILE_HEADER_SIGNATURE = "HWP Document File";
const HWP5_MAJOR = 5;
const FLAG_COMPRESSED = 1 << 0;
const FLAG_PROTECTED = (1 << 1) | (1 << 2) | (1 << 4) | (1 << 8) | (1 << 10) | (1 << 13); // 개인정보 보안 문서도 본문 추출 제외
const TAG_PARA_TEXT = 0x43;
const EXTENDED_SIZE = 0xfff;
const INLINE_CONTROL_UNITS = 8;
const OLE_SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;
const CFB_STREAM = 2;
const CFB_ROOT = 5;

type CfbEntry = {
  name: string;
  type?: number;
  size?: number;
  content?: Buffer | Uint8Array | number[];
};

type CfbFile = {
  FileIndex: CfbEntry[];
  FullPaths: string[];
};

type ParseState = {
  records: number;
  outputUnits: number;
};

/**
 * 보호되지 않은 HWP 5 본문 문단 글자.
 * 형식·보호·한도를 못 지키면 빈 글자를 돌려 호출 쪽이 미리보기로 넘어가게 한다.
 * 앞부분만 읽힌 본문을 성공으로 치지 않는다.
 */
export function extractHwpText(buf: Buffer): string {
  try {
    return extractHwpTextOrEmpty(buf);
  } catch {
    return "";
  }
}

function extractHwpTextOrEmpty(buf: Buffer): string {
  if (buf.length > MAX_INPUT_BYTES) return "";
  if (!hasOleSignature(buf)) return "";
  const cfb = parseCfbFile(buf);
  if (!cfb) return "";
  const streams = rootStreams(cfb);
  if (!streams) return "";

  const headerBuf = streams.get("FileHeader");
  if (!headerBuf || headerBuf.length !== FILE_HEADER_BYTES) return "";
  const header = headerBuf.subarray(0, FILE_HEADER_BYTES);
  if (!header.subarray(0, FILE_HEADER_SIGNATURE.length).equals(Buffer.from(FILE_HEADER_SIGNATURE, "ascii"))) return "";
  if (header.subarray(FILE_HEADER_SIGNATURE.length, 32).some(byte => byte !== 0)) return "";
  if (header[35] !== HWP5_MAJOR) return "";
  const flags = header.readUInt32LE(36);
  if ((flags & FLAG_PROTECTED) !== 0) return "";
  const compressed = (flags & FLAG_COMPRESSED) !== 0;

  const sections = collectSections(streams);
  if (!sections) return "";

  const paras: string[] = [];
  const state: ParseState = { records: 0, outputUnits: 0 };
  let decodedBytes = 0;
  for (const section of sections) {
    const remaining = MAX_DECODED_BYTES - decodedBytes;
    const raw = compressed ? inflateSection(section, remaining) : takeUncompressed(section, remaining);
    if (!raw) return "";
    decodedBytes += raw.length;
    if (!parseSection(raw, paras, state)) return "";
  }
  if (paras.length === 0) return "";
  return paras.join("\n").trim();
}

function hasOleSignature(buf: Buffer): boolean {
  if (buf.length < OLE_SIG.length) return false;
  for (let i = 0; i < OLE_SIG.length; i++) {
    if (buf[i] !== OLE_SIG[i]) return false;
  }
  return true;
}

function parseCfbFile(buf: Buffer): CfbFile | null {
  const parsed = parseCfb(Uint8Array.from(buf)) as {
    FileIndex?: CfbEntry[];
    FullPaths?: string[];
  };
  if (!parsed.FileIndex || !parsed.FullPaths) return null;
  if (parsed.FileIndex.length !== parsed.FullPaths.length) return null;
  return { FileIndex: parsed.FileIndex, FullPaths: parsed.FullPaths };
}

function rootStreams(cfb: CfbFile): Map<string, Buffer> | null {
  const rootName =
    cfb.FileIndex.find((entry) => entry.type === CFB_ROOT)?.name ?? cfb.FileIndex[0]?.name ?? "Root Entry";
  const streams = new Map<string, Buffer>();
  for (let i = 0; i < cfb.FileIndex.length; i++) {
    const entry = cfb.FileIndex[i];
    if (entry.type !== undefined && entry.type !== CFB_STREAM) continue;
    const bytes = streamBytes(entry);
    if (!bytes) continue;
    const path = normalizeCfbPath(cfb.FullPaths[i] ?? entry.name, rootName);
    if (!path) continue;
    if (streams.has(path)) return null;
    streams.set(path, bytes);
  }
  return streams;
}

function normalizeCfbPath(fullPath: string, rootName: string): string {
  const parts = fullPath.replace(/\\/g, "/").split("/").filter((part) => part !== "");
  if (parts[0] === rootName) parts.shift();
  return parts.join("/");
}

function streamBytes(entry: CfbEntry): Buffer | null {
  if (entry.content == null) return null;
  const buf = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content);
  if (typeof entry.size === "number" && entry.size >= 0 && entry.size < buf.length) {
    return buf.subarray(0, entry.size);
  }
  return buf;
}

function collectSections(streams: Map<string, Buffer>): Buffer[] | null {
  const byIndex = new Map<number, Buffer>();
  for (const [path, bytes] of streams) {
    const match = /^BodyText\/Section(\d+)$/.exec(path);
    if (!match) continue;
    const digits = match[1];
    if (digits.length > 1 && digits.startsWith("0")) return null;
    const index = Number(digits);
    if (!Number.isInteger(index) || index < 0) return null;
    if (byIndex.has(index)) return null;
    byIndex.set(index, bytes);
  }
  if (byIndex.size === 0 || byIndex.size > MAX_SECTIONS) return null;
  const indexes = [...byIndex.keys()].sort((a, b) => a - b);
  if (indexes[0] !== 0) return null;
  for (let i = 0; i < indexes.length; i++) {
    if (indexes[i] !== i) return null;
  }
  return indexes.map((index) => byIndex.get(index) as Buffer);
}

function takeUncompressed(section: Buffer, remaining: number): Buffer | null {
  if (section.length > remaining) return null;
  return section;
}

function inflateSection(compressed: Buffer, remaining: number): Buffer | null {
  if (remaining <= 0) return null;
  try {
    const out = inflateRawSync(compressed, { maxOutputLength: remaining });
    const raw = Buffer.isBuffer(out) ? out : Buffer.from(out);
    if (raw.length > remaining) return null;
    return raw;
  } catch {
    return null;
  }
}

function parseSection(section: Buffer, paras: string[], state: ParseState): boolean {
  let offset = 0;
  const n = section.length;
  while (offset < n) {
    if (n - offset < 4) return false;
    state.records += 1;
    if (state.records > MAX_RECORDS) return false;
    const header = section.readUInt32LE(offset);
    offset += 4;
    const tag = header & 0x3ff;
    let size = header >>> 20;
    if (size === EXTENDED_SIZE) {
      if (n - offset < 4) return false;
      size = section.readUInt32LE(offset);
      offset += 4;
    }
    if (size > n - offset) return false;
    const payload = section.subarray(offset, offset + size);
    offset += size;
    if (tag !== TAG_PARA_TEXT) continue;
    const remainingUnits = MAX_OUTPUT_UNITS - state.outputUnits - (paras.length > 0 ? 1 : 0);
    if (remainingUnits < 0) return false;
    const text = decodeParaText(payload, remainingUnits);
    if (text == null) return false;
    const extra = paras.length === 0 ? text.length : text.length + 1;
    if (state.outputUnits + extra > MAX_OUTPUT_UNITS) return false;
    state.outputUnits += extra;
    paras.push(text);
  }
  return true;
}

function decodeParaText(payload: Buffer, maxUnits: number): string | null {
  if (payload.length % 2 !== 0) return null;
  const unitCount = payload.length / 2;
  const out: string[] = [];
  for (let i = 0; i < unitCount; ) {
    const code = payload.readUInt16LE(i * 2);
    const emitsUnit = code >= 32 || code === 9 || code === 10 || code === 13 || code === 24 || code === 30 || code === 31;
    if (emitsUnit && out.length >= maxUnits) return null;
    if (code >= 1 && code <= 23 && code !== 10 && code !== 13) {
      if (i + INLINE_CONTROL_UNITS > unitCount || payload.readUInt16LE((i + INLINE_CONTROL_UNITS - 1) * 2) !== code) return null;
      if (code === 9) out.push("\t");
      i += INLINE_CONTROL_UNITS;
      continue;
    }
    if (code === 10 || code === 13) {
      out.push("\n");
      i += 1;
      continue;
    }
    if (code === 24) {
      out.push("-");
      i += 1;
      continue;
    }
    if (code === 30 || code === 31) {
      out.push(" ");
      i += 1;
      continue;
    }
    if (code < 32) {
      i += 1;
      continue;
    }
    out.push(String.fromCharCode(code));
    i += 1;
  }
  return out.join("");
}
