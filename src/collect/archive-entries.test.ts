import AdmZip from "adm-zip";
import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";
import { archiveEntryNameKind, listArchiveEntries, type ArchiveEntry } from "./archive-entries";
import { classifyZipDocument } from "./office-text";

/**
 * 공고 첨부로 온 zip 안의 항목 목록을 꺼낸다(2026-10-01 「첨부파일 글자 추출 누락」 4b번).
 *
 * 운영 실측: 「첨부를 다 읽지 못함」 공고 5,814건 중 618건에 zip 첨부가 있었다.
 * zip 은 열어 보지 않아서 그 안의 공고문·지침을 읽지 못했다.
 *
 * 알려진 zip 사정(일반 사실):
 *  · 윈도 탐색기로 만든 zip 은 이름을 UTF-8 표시(EFS) 없이 CP949 로 적는다. UTF-8 로만 풀면 이름이 깨진다.
 *  · 맥에서 만든 zip 에는 `__MACOSX/`·`._이름`·`.DS_Store` 같은 잡동사니가 섞인다.
 *  · 머리에 적힌 크기는 거짓일 수 있다. 풀기 전에 거르고, 푼 뒤에도 다시 잰다.
 *
 * 목록은 zip 에 적힌 순서 그대로다. zip 이 아니거나 목록을 못 읽거나 항목이 1,000개를 넘으면 null 이다. 절대 던지지 않는다.
 */

const EOCD = Buffer.from([0x50, 0x4b, 0x05, 0x06]);

type NameCodec = { efs: boolean; encode(s: string): Buffer; decode(b: Buffer | Uint8Array): string };

/** 윈도 탐색기처럼 이름을 CP949 로 적고 UTF-8 표시(EFS)는 끈다. */
const CP949: NameCodec = {
  efs: false,
  encode: (s) => iconv.encode(s, "cp949"),
  decode: (b) => iconv.decode(Buffer.from(b), "cp949"),
};

/** 이름은 UTF-8 로 적었는데 UTF-8 표시(EFS)는 안 켠 zip. */
const UTF8_NO_EFS: NameCodec = {
  efs: false,
  encode: (s) => Buffer.from(s, "utf8"),
  decode: (b) => Buffer.from(b).toString("utf8"),
};

/** 넣은 순서 그대로(이름순 정렬 없이) zip 을 만든다. codec 을 주면 이름을 그 방식으로 적는다. */
function zipInOrder(entries: Array<[string, string | Buffer]>, codec?: NameCodec): Buffer {
  const zip = new AdmZip(undefined, { noSort: true, ...(codec ? { decoder: codec } : {}) });
  for (const [name, v] of entries) zip.addFile(name, typeof v === "string" ? Buffer.from(v, "utf8") : v);
  return zip.toBuffer();
}

/** 압축하지 않고(STORED) 담은 항목 하나짜리 zip. */
function storedZip(name: string, body: Buffer): Buffer {
  const zip = new AdmZip(undefined, { noSort: true });
  zip.addFile(name, body);
  const [entry] = zip.getEntries();
  if (!entry) throw new Error("항목이 없다");
  entry.header.method = 0;
  return zip.toBuffer();
}

/** 첫 항목의 중앙 머리·지역 머리 위치. */
function firstHeaders(buf: Buffer): { cen: number; loc: number } {
  const eocd = buf.lastIndexOf(EOCD);
  const cen = buf.readUInt32LE(eocd + 16);
  return { cen, loc: buf.readUInt32LE(cen + 42) };
}

/** 첫 항목 머리를 고쳐 쓴다: 압축 방식·푼 크기·암호 표시·같은 길이의 원래 이름 바이트. */
function patchFirst(buf: Buffer, p: { method?: number; size?: number; encrypted?: boolean; rawName?: Buffer }): Buffer {
  const out = Buffer.from(buf);
  const { cen, loc } = firstHeaders(out);
  if (p.method !== undefined) {
    out.writeUInt16LE(p.method, cen + 10);
    out.writeUInt16LE(p.method, loc + 8);
  }
  if (p.size !== undefined) {
    out.writeUInt32LE(p.size, cen + 24);
    out.writeUInt32LE(p.size, loc + 22);
  }
  if (p.encrypted) {
    out.writeUInt16LE(out.readUInt16LE(cen + 8) | 1, cen + 8);
    out.writeUInt16LE(out.readUInt16LE(loc + 6) | 1, loc + 6);
  }
  if (p.rawName) {
    const len = out.readUInt16LE(cen + 28);
    if (len !== p.rawName.length) throw new Error(`이름 길이가 다르다: ${len} ≠ ${p.rawName.length}`);
    p.rawName.copy(out, cen + 46);
    p.rawName.copy(out, loc + 30);
  }
  return out;
}

/** 첫 항목의 압축된 데이터 가운데 몇 바이트를 뒤집는다. */
function corruptFirst(buf: Buffer): Buffer {
  const out = Buffer.from(buf);
  const { loc } = firstHeaders(out);
  const start = loc + 30 + out.readUInt16LE(loc + 26) + out.readUInt16LE(loc + 28);
  for (let i = start + 5; i < start + 15; i += 1) out[i] ^= 0xff;
  return out;
}

/** 항목이 꼭 하나인 zip 의 그 항목. */
function only(buf: Buffer): ArchiveEntry {
  const list = listArchiveEntries(buf) ?? [];
  const [entry, ...rest] = list;
  if (!entry || rest.length > 0) throw new Error(`항목 하나를 기대했는데 ${list.length}개`);
  return entry;
}

const empty = Buffer.alloc(0);

describe("listArchiveEntries — zip 안의 문서 항목 목록", () => {
  it("폴더·맥 잡동사니·윈도 썸네일·빈 파일은 빼고, zip 에 적힌 순서를 지킨다", () => {
    const buf = zipInOrder([
      ["서식/", empty],
      ["__MACOSX/._공고.pdf", "mac"],
      ["공고.pdf", "PDF"],
      [".DS_Store", "ds"],
      ["서식/Thumbs.db", "th"],
      ["서식/DESKTOP.INI", "ini"],
      ["서식/._신청서.hwp", "dot"],
      ["빈 파일.hwp", empty],
      ["서식/신청서.hwp", "HWP"],
    ]);

    const list = listArchiveEntries(buf);

    expect(list?.map((e) => e.path)).toEqual(["공고.pdf", "서식/신청서.hwp"]);
    expect(list?.map((e) => e.base)).toEqual(["공고.pdf", "신청서.hwp"]);
    expect(list?.map((e) => e.size)).toEqual([3, 3]);
  });

  it("이름순으로 다시 늘어놓지 않는다(순서는 받은 그대로)", () => {
    const buf = zipInOrder([
      ["하.hwp", "1"],
      ["가.pdf", "2"],
      ["나.docx", "3"],
    ]);

    expect(listArchiveEntries(buf)?.map((e) => e.path)).toEqual(["하.hwp", "가.pdf", "나.docx"]);
  });

  it("UTF-8 표시(EFS)가 있는 이름은 UTF-8 로 풀고, 맥식 풀어쓴 한글(NFD)은 모아쓴 한글(NFC)로 맞춘다", () => {
    const nfd = "공고문.pdf".normalize("NFD");
    const buf = zipInOrder([[`서식/${nfd}`, "PDF"]]);

    const entry = only(buf);

    expect(entry.path).toBe("서식/공고문.pdf");
    expect(entry.base).toBe("공고문.pdf");
  });

  it("UTF-8 표시 없이 CP949 로 적은 이름(윈도 탐색기 zip)을 바르게 푼다", () => {
    const name = "서식/붙임1. 신청서.hwp";
    const buf = zipInOrder([[name, "HWP"]], CP949);
    // 전제: 정말 CP949 바이트로 적혔고 EFS 가 꺼져 있으며, UTF-8 로는 풀리지 않는다.
    const [raw] = new AdmZip(buf).getEntries();
    if (!raw) throw new Error("항목이 없다");
    expect(Buffer.from(raw.rawEntryName)).toEqual(iconv.encode(name, "cp949"));
    expect(raw.header.flags & 0x800).toBe(0); // EFS(UTF-8 표시) 비트가 꺼져 있다
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(raw.rawEntryName)).toThrow();

    const entry = only(buf);

    expect(entry.path).toBe(name);
    expect(entry.base).toBe("붙임1. 신청서.hwp");
  });

  it("CP949 이름 둘이 UTF-8 로는 같은 깨진 글자가 되는 zip(공고.hwp·서식.hwp)도 연다", () => {
    const buf = zipInOrder(
      [
        ["공고.hwp", "A"],
        ["서식.hwp", "B"],
      ],
      CP949,
    );
    // 전제(2026-10-16 실측): adm-zip 기본(UTF-8)으로 읽으면 두 이름이 같아져 「같은 이름」 예외로 zip 전체가 안 열린다.
    expect(() => new AdmZip(buf).getEntries()).toThrow(/Duplicate entry name/);

    expect(listArchiveEntries(buf)?.map((e) => e.path)).toEqual(["공고.hwp", "서식.hwp"]);
    // 받은 zip 이 문서인지 가리는 쪽도 같은 zip 을 압축 묶음으로 본다(못 열어 null 이면 한글로 잘못 읽는다).
    expect(classifyZipDocument(buf)).toBe("archive");
  });

  it("항목이 1,000개를 넘는 zip 은 목록을 만들지 않고 null(1,000개까지는 연다)", () => {
    const names = (n: number) => Array.from({ length: n }, (_, i): [string, string] => [`붙임${i}.pdf`, "P"]);

    expect(listArchiveEntries(zipInOrder(names(1_000)))?.length).toBe(1_000);
    expect(listArchiveEntries(zipInOrder(names(1_001)))).toBeNull();
  });

  it("UTF-8 표시는 없지만 실제로 UTF-8 인 이름은 UTF-8 로 푼다", () => {
    const buf = zipInOrder([["공고문.hwp", "HWP"]], UTF8_NO_EFS);
    const [raw] = new AdmZip(buf).getEntries();
    if (!raw) throw new Error("항목이 없다");
    expect(raw.header.flags & 0x800).toBe(0); // EFS(UTF-8 표시) 비트가 꺼져 있다

    expect(only(buf).path).toBe("공고문.hwp");
  });

  it("이름의 제어 문자·역슬래시·앞쪽 `/`·`./` 를 정리한다", () => {
    const raw = Buffer.from("/./서식\\공\u0001고\u007f.pdf", "utf8");
    const buf = patchFirst(zipInOrder([["p".repeat(raw.length), "PDF"]]), { rawName: raw });

    const entry = only(buf);

    expect(entry.path).toBe("서식/공고.pdf");
    expect(entry.base).toBe("공고.pdf");
  });

  it("zip 이 아니면 null 이고 던지지 않는다", () => {
    expect(listArchiveEntries(Buffer.alloc(0))).toBeNull();
    expect(listArchiveEntries(Buffer.from("hello"))).toBeNull();
    expect(listArchiveEntries(Buffer.from("PK\u0003\u0004garbage-bytes-here", "latin1"))).toBeNull();
  });

  it("항목이 없는 zip 은 빈 목록이다", () => {
    expect(listArchiveEntries(new AdmZip().toBuffer())).toEqual([]);
  });
});

describe("ArchiveEntry.read — 크기 한도 안에서만 풀어 준다", () => {
  const text = "가나다라마바사".repeat(500);
  const body = Buffer.from(text, "utf8");

  it("압축(deflate)한 항목을 푼다", () => {
    const entry = only(zipInOrder([["본문.txt", text]]));

    expect(entry.method).toBe(8);
    expect(entry.encrypted).toBe(false);
    expect(entry.size).toBe(body.length);
    const got = entry.read(1_000_000);
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.buf.toString("utf8")).toBe(text);
  });

  it("압축하지 않은(STORED) 항목도 읽는다", () => {
    const entry = only(storedZip("본문.txt", body));

    expect(entry.method).toBe(0);
    const got = entry.read(1_000_000);
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.buf.equals(body)).toBe(true);
  });

  it("머리에 적힌 크기가 한도를 넘으면 풀지 않고 too_big", () => {
    const entry = only(zipInOrder([["큰 파일.pdf", Buffer.alloc(50_000, 0x41)]]));

    expect(entry.size).toBe(50_000);
    expect(entry.read(1_000)).toEqual({ ok: false, reason: "too_big" });
    const whole = entry.read(50_000);
    expect(whole.ok).toBe(true);
    if (whole.ok) expect(whole.buf.length).toBe(50_000);
  });

  it("크기를 작게 속인 압축 항목은 풀다 깨져 broken", () => {
    const entry = only(patchFirst(zipInOrder([["본문.txt", text]]), { size: 10 }));

    expect(entry.size).toBe(10);
    expect(entry.read(1_000)).toEqual({ ok: false, reason: "broken" });
  });

  it("크기를 작게 속인 STORED 항목은 푼 뒤 길이를 다시 재서 too_big", () => {
    const entry = only(patchFirst(storedZip("본문.txt", body), { size: 10 }));

    expect(entry.size).toBe(10);
    expect(entry.read(1_000)).toEqual({ ok: false, reason: "too_big" });
  });

  it("데이터가 깨진 항목은 broken", () => {
    const entry = only(corruptFirst(zipInOrder([["본문.txt", text]])));

    expect(entry.read(1_000_000)).toEqual({ ok: false, reason: "broken" });
  });

  it("암호가 걸린 항목은 encrypted 로 알리고 읽으면 broken", () => {
    const entry = only(patchFirst(zipInOrder([["본문.txt", text]]), { encrypted: true }));

    expect(entry.encrypted).toBe(true);
    expect(entry.read(1_000_000)).toEqual({ ok: false, reason: "broken" });
  });

  it("모르는 압축 방식(12)은 method 로 알리고 읽으면 broken", () => {
    const entry = only(patchFirst(zipInOrder([["본문.txt", text]]), { method: 12 }));

    expect(entry.method).toBe(12);
    expect(entry.read(1_000_000)).toEqual({ ok: false, reason: "broken" });
  });
});

describe("archiveEntryNameKind — 항목 이름 끝 확장자로 종류를 가린다", () => {
  const DOCUMENT = ["pdf", "hwp", "hwpx", "hml", "docx", "doc", "xlsx", "xls", "pptx", "ppt", "odt", "ods"];
  const IMAGE = ["jpg", "jpeg", "png", "gif", "bmp", "webp", "tif", "tiff"];
  const ARCHIVE = ["zip", "7z", "rar", "alz", "egg", "tar", "gz", "tgz"];

  it("문서·그림·압축 확장자를 가린다(대소문자 무시)", () => {
    for (const ext of DOCUMENT) expect(archiveEntryNameKind(`서식/붙임.${ext}`), ext).toBe("document");
    for (const ext of IMAGE) expect(archiveEntryNameKind(`포스터.${ext.toUpperCase()}`), ext).toBe("image");
    for (const ext of ARCHIVE) expect(archiveEntryNameKind(`묶음.${ext}`), ext).toBe("archive");
  });

  it("마지막 조각의 확장자만 보고, 모르는 것은 other", () => {
    expect(archiveEntryNameKind("공고.PDF")).toBe("document");
    expect(archiveEntryNameKind("a.tar.gz")).toBe("archive");
    expect(archiveEntryNameKind("서식.v2/신청서")).toBe("other");
    expect(archiveEntryNameKind("메모.txt")).toBe("other");
    expect(archiveEntryNameKind("README")).toBe("other");
  });
});
