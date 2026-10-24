// zip 첨부를 열지 않아 안의 공고문·지침을 못 읽었다(2026-10-01 운영 표본: 「첨부를 다 읽지 못함」 5,814건 중 618건).
// 윈도 zip 의 CP949 이름 둘이 UTF-8 로 같아지면 adm-zip 이 전체를 거부한다(2026-10-16 실측) — latin1 로 받아 직접 푼다.
// 디스크에 풀지 않는다. 메모리에서만 읽고, 경로는 표시용이다.
import AdmZip from "adm-zip";
import iconv from "iconv-lite";

export type ArchiveEntryRead = { ok: true; buf: Buffer } | { ok: false; reason: "too_big" | "broken" };
export type ArchiveEntry = {
  /** 정리한 zip 안 경로(구분은 `/`). */
  path: string;
  /** path 의 마지막 조각. */
  base: string;
  /** 머리에 적힌 푼 크기 — 거짓일 수 있다. */
  size: number;
  /** 압축 방식(0 저장·8 deflate). */
  method: number;
  encrypted: boolean;
  read(maxBytes: number): ArchiveEntryRead;
};
export type ArchiveEntryNameKind = "document" | "image" | "archive" | "other";
export const MAX_ARCHIVE_ENTRIES = 1_000;

type RawNameDecoder = { efs: boolean; encode(s: string): Buffer; decode(b: Buffer | Uint8Array): string };
/** @types/adm-zip 의 InitOptions 에는 decoder 가 없다(adm-zip 0.6 은 받는다) — 타입을 붙인 변수로 넘긴다. */
export const RAW_NAME_ZIP_OPTIONS: Partial<AdmZip.InitOptions> & { decoder: RawNameDecoder } = {
  decoder: {
    efs: false,
    encode: (s) => Buffer.from(s, "latin1"),
    decode: (b) => Buffer.from(b).toString("latin1"),
  },
};

/** 제어 문자·경로 앞머리를 걷고 맥식 풀어쓴 한글을 모아 쓴다. */
function cleanEntryPath(name: string): string {
  let clean = "";
  for (let i = 0; i < name.length; i += 1) {
    const code = name.charCodeAt(i);
    if (code > 0x1f && code !== 0x7f) clean += name[i];
  }
  clean = clean.replace(/\\/g, "/");
  for (;;) {
    if (clean.startsWith("/")) clean = clean.slice(1);
    else if (clean.startsWith("./")) clean = clean.slice(2);
    else break;
  }
  return clean.normalize("NFC");
}

/** 목록은 받은 차례 그대로. 못 열거나 항목이 너무 많으면 null, 남는 항목이 없으면 빈 목록이다. */
export function listArchiveEntries(buf: Buffer): ArchiveEntry[] | null {
  try {
    if (buf.length === 0) return null;
    const zip = new AdmZip(buf, RAW_NAME_ZIP_OPTIONS);
    if (zip.getEntryCount() > MAX_ARCHIVE_ENTRIES) return null;
    const out: ArchiveEntry[] = [];
    for (const entry of zip.getEntries()) {
      const raw = entry.rawEntryName;
      let decoded: string;
      if ((entry.header.flags & 0x800) !== 0) decoded = raw.toString("utf8");
      else {
        try {
          decoded = new TextDecoder("utf-8", { fatal: true }).decode(raw);
        } catch {
          decoded = iconv.decode(raw, "cp949");
        }
      }
      const path = cleanEntryPath(decoded);
      const base = path.slice(path.lastIndexOf("/") + 1);
      const lower = base.toLowerCase();
      if (
        entry.isDirectory || path.endsWith("/") || !base || entry.header.size === 0 ||
        path.split("/").includes("__MACOSX") || base.startsWith("._") ||
        lower === ".ds_store" || lower === "thumbs.db" || lower === "desktop.ini"
      ) continue;
      const size = entry.header.size;
      out.push({
        path,
        base,
        size,
        method: entry.header.method,
        encrypted: (entry.header.flags & 0x1) !== 0,
        read(maxBytes): ArchiveEntryRead {
          if (size > maxBytes) return { ok: false, reason: "too_big" };
          try {
            const data = entry.getData();
            if (data.length > maxBytes) return { ok: false, reason: "too_big" };
            return { ok: true, buf: data };
          } catch {
            return { ok: false, reason: "broken" };
          }
        },
      });
    }
    return out;
  } catch {
    return null;
  }
}

const DOCUMENT_EXTENSIONS = new Set(["pdf", "hwp", "hwpx", "hml", "docx", "doc", "xlsx", "xls", "pptx", "ppt", "odt", "ods"]);
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "bmp", "webp", "tif", "tiff"]);
const ARCHIVE_EXTENSIONS = new Set(["zip", "7z", "rar", "alz", "egg", "tar", "gz", "tgz"]);

/** 마지막 경로 조각의 확장자만 본다. */
export function archiveEntryNameKind(name: string): ArchiveEntryNameKind {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot < 0) return "other";
  const ext = base.slice(dot + 1).toLowerCase();
  if (DOCUMENT_EXTENSIONS.has(ext)) return "document";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (ARCHIVE_EXTENSIONS.has(ext)) return "archive";
  return "other";
}
