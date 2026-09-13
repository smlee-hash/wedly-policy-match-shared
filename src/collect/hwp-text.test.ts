import { deflateRawSync } from "node:zlib";
import { utils, write } from "cfb";
import { describe, expect, it } from "vitest";
import { fetchAttachmentTexts } from "./attachment-text";
import { extractHwpText } from "./hwp-text";

const ATT_URL = "https://www.bizinfo.go.kr/cmm/fms/fileDown.do?file=body.hwp";

function encodeRecord(tag: number, payload: Buffer, level = 0): Buffer {
  const size = payload.length;
  const tagLevel = (tag & 0x3ff) | ((level & 0x3ff) << 10);
  if (size < 0xfff) {
    const header = Buffer.alloc(4);
    header.writeUInt32LE(((size << 20) | tagLevel) >>> 0, 0);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(8);
  header.writeUInt32LE(((0xfff << 20) | tagLevel) >>> 0, 0);
  header.writeUInt32LE(size >>> 0, 4);
  return Buffer.concat([header, payload]);
}

function encodePara(text: string, level = 0): Buffer {
  return encodeRecord(0x43, Buffer.from(text, "utf16le"), level);
}

function u16le(codes: number[]): Buffer {
  const buf = Buffer.alloc(codes.length * 2);
  for (let i = 0; i < codes.length; i++) buf.writeUInt16LE(codes[i] >>> 0, i * 2);
  return buf;
}

function makeFileHeader(
  over: { major?: number; flags?: number; length?: number; signature?: string } = {},
): Buffer {
  const length = over.length ?? 256;
  const header = Buffer.alloc(length);
  header.write(over.signature ?? "HWP Document File", 0, "ascii");
  if (length > 35) header[35] = over.major ?? 5;
  if (length >= 40) header.writeUInt32LE((over.flags ?? 0) >>> 0, 36);
  return header;
}

function makeHwp(
  opts: {
    flags?: number;
    header?: Buffer;
    omitHeader?: boolean;
    preview?: string | Buffer;
    sections?: Array<[number | string, Buffer]>;
    extra?: Array<[string, Buffer]>;
  } = {},
): Buffer {
  const cfb = utils.cfb_new();
  const flags = opts.flags ?? 0;
  if (!opts.omitHeader) {
    utils.cfb_add(cfb, "FileHeader", opts.header ?? makeFileHeader({ flags }));
  }
  if (opts.preview !== undefined) {
    const prv = typeof opts.preview === "string" ? Buffer.from(opts.preview, "utf16le") : opts.preview;
    utils.cfb_add(cfb, "PrvText", prv);
  }
  const compressed = (flags & 1) !== 0;
  for (const [idx, data] of opts.sections ?? []) {
    const payload = compressed ? deflateRawSync(data) : data;
    utils.cfb_add(cfb, `BodyText/Section${idx}`, payload);
  }
  for (const [name, content] of opts.extra ?? []) utils.cfb_add(cfb, name, content);
  return Buffer.from(write(cfb, { type: "buffer" }));
}

function fillUnknownRecords(count: number): Buffer {
  const buf = Buffer.alloc(count * 4);
  const header = 0x42;
  for (let i = 0; i < count; i++) buf.writeUInt32LE(header, i * 4);
  return buf;
}

async function readHwpAttachment(bytes: Buffer) {
  return fetchAttachmentTexts([{ name: "모집공고.hwp", url: ATT_URL, kind: "hwp" }], {
    fetch: async () => new Response(Uint8Array.from(bytes)),
    extractHwpx: () => "",
  });
}

describe("extractHwpText — HWP5 본문", () => {
  it("압축하지 않은 본문 문단을 읽는다", () => {
    expect(extractHwpText(makeHwp({ sections: [[0, encodePara("신청기간 본문")]] }))).toBe("신청기간 본문");
  });

  it("압축된 본문 문단을 읽는다", () => {
    expect(
      extractHwpText(makeHwp({ flags: 1, sections: [[0, encodePara("압축된 신청기간")]] })),
    ).toBe("압축된 신청기간");
  });

  it("미리보기가 있어도 본문을 쓰고, 없어도 본문을 쓴다", () => {
    const sections: Array<[number, Buffer]> = [[0, encodePara("본문만있는문장")]];
    expect(extractHwpText(makeHwp({ sections, preview: "짧은미리보기" }))).toBe("본문만있는문장");
    expect(extractHwpText(makeHwp({ sections }))).toBe("본문만있는문장");
  });

  it("절 번호는 넣은 순이 아니라 숫자 순이고 0부터 빈 칸 없이 이어져야 한다", () => {
    const order = [2, 10, 0, 1, 5, 9, 3, 8, 4, 7, 6];
    const sections = order.map((i) => [i, encodePara(`SEC${i}`)] as [number, Buffer]);
    expect(extractHwpText(makeHwp({ sections }))).toBe(
      Array.from({ length: 11 }, (_, i) => `SEC${i}`).join("\n"),
    );
    expect(
      extractHwpText(
        makeHwp({
          sections: [0, 1, 2, 10].map((i) => [i, encodePara(`S${i}`)]),
        }),
      ),
    ).toBe("");
  });

  it("표 안 중첩 문단도 문서 순서로 남긴다", () => {
    const section = Buffer.concat([
      encodePara("앞", 0),
      encodeRecord(0x4b, Buffer.alloc(8), 1),
      encodePara("칸글자", 2),
      encodePara("뒤", 0),
    ]);
    expect(extractHwpText(makeHwp({ sections: [[0, section]] }))).toBe("앞\n칸글자\n뒤");
  });

  it("길이 0xFFF 는 추가 4바이트 길이를 쓰고 그 레코드는 건너뛴다", () => {
    const unknown = encodeRecord(0x50, Buffer.alloc(4095, 7));
    expect(
      extractHwpText(makeHwp({ sections: [[0, Buffer.concat([unknown, encodePara("뒤에")])]] })),
    ).toBe("뒤에");
    const long = "가".repeat(2048);
    expect(extractHwpText(makeHwp({ sections: [[0, encodePara(long)]] }))).toBe(long);
  });

  it("한글·서로게이트 짝을 그대로 둔다", () => {
    expect(extractHwpText(makeHwp({ sections: [[0, encodePara("한글😀한")]] }))).toBe("한글😀한");
  });

  it("인라인 컨트롤을 규격대로 풀고 컨트롤 바이트는 글자로 읽지 않는다", () => {
    const units = [0xac00];
    for (let code = 1; code <= 23; code++) {
      if (code === 10 || code === 13) units.push(code);
      else units.push(code, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, code); // 공식 규격: 끝 WCHAR도 같은 제어 코드
    }
    units.push(24, 30, 31, 0, 25, 26, 27, 28, 29, 0xac01);
    const text = extractHwpText(
      makeHwp({ sections: [[0, encodeRecord(0x43, u16le(units))]] }),
    );
    expect(text).toBe("가\t\n\n-  각");
    expect(text).not.toMatch(/[A-G]/);
  });

  it("깨진·잘린 레코드와 다른 OLE 는 본문을 포기한다", () => {
    expect(extractHwpText(Buffer.from("not ole"))).toBe("");
    const shortSig = Buffer.alloc(64);
    shortSig[0] = 0xd0;
    shortSig[1] = 0xcf;
    shortSig[2] = 0x11;
    shortSig[3] = 0xe0;
    expect(extractHwpText(shortSig)).toBe("");

    const other = utils.cfb_new();
    utils.cfb_add(other, "WordDocument", Buffer.from("hello"));
    expect(extractHwpText(Buffer.from(write(other, { type: "buffer" })))).toBe("");

    expect(extractHwpText(makeHwp({ omitHeader: true, sections: [[0, encodePara("본문")]] }))).toBe("");
    expect(
      extractHwpText(makeHwp({ header: makeFileHeader({ length: 100 }), sections: [[0, encodePara("본문")]] })),
    ).toBe("");
    expect(
      extractHwpText(
        makeHwp({ header: makeFileHeader({ signature: "NOT A HWP FILE!!!!" }), sections: [[0, encodePara("본문")]] }),
      ),
    ).toBe("");
    expect(
      extractHwpText(makeHwp({ header: makeFileHeader({ major: 4 }), sections: [[0, encodePara("본문")]] })),
    ).toBe("");
    expect(extractHwpText(makeHwp({ preview: "미리보기만" }))).toBe("");

    expect(
      extractHwpText(makeHwp({ sections: [[0, Buffer.concat([encodePara("앞"), Buffer.from([1, 2])])]] })),
    ).toBe("");
    expect(
      extractHwpText(
        makeHwp({
          sections: [[0, Buffer.concat([Buffer.from([0x43, 0, 0, 0xa0]), Buffer.alloc(4)])]],
        }),
      ),
    ).toBe("");
    expect(extractHwpText(makeHwp({ sections: [[0, encodeRecord(0x43, Buffer.from([0x00]))]] }))).toBe("");
    expect(
      extractHwpText(makeHwp({ sections: [[0, encodeRecord(0x43, u16le([1, 0, 0]))]] })),
    ).toBe("");
    const truncatedExt = Buffer.alloc(4);
    truncatedExt.writeUInt32LE(((0xfff << 20) | 0x43) >>> 0, 0);
    expect(extractHwpText(makeHwp({ sections: [[0, truncatedExt]] }))).toBe("");
  });

  it("암호·배포용·DRM·인증서 보호 플래그는 본문을 읽지 않는다", () => {
    for (const bit of [1, 2, 4, 8, 10, 13]) {
      expect(extractHwpText(makeHwp({ flags: 1 << bit, sections: [[0, encodePara("비밀")]] }))).toBe("");
    }
    expect(
      extractHwpText(makeHwp({ flags: 1 << 3, sections: [[0, encodePara("스크립트허용")]] })),
    ).toBe("스크립트허용");
  });

  it("BinData 같은 다른 줄기는 따라가지 않는다", () => {
    const text = extractHwpText(
      makeHwp({
        sections: [[0, encodePara("본문")]],
        extra: [["BinData/BIN0001", Buffer.from("http://evil.example/x")]],
      }),
    );
    expect(text).toBe("본문");
    expect(text).not.toContain("evil");
  });

  it("입력 10MiB 를 넘기면 본문을 포기한다", () => {
    expect(extractHwpText(Buffer.alloc(10 * 1024 * 1024 + 1))).toBe("");
  });

  it("절은 128개까지 읽고 129개면 포기한다", () => {
    const sections: Array<[number, Buffer]> = [];
    for (let i = 0; i < 128; i++) sections.push([i, encodePara(`S${i}`)]);
    expect(extractHwpText(makeHwp({ sections })).split("\n")).toHaveLength(128);
    sections.push([128, encodePara("S128")]);
    expect(extractHwpText(makeHwp({ sections }))).toBe("");
  });

  it("레코드 20만 개를 넘기면 본문을 포기한다", () => {
    const para = encodePara("끝");
    expect(
      extractHwpText(makeHwp({ sections: [[0, Buffer.concat([fillUnknownRecords(199_999), para])]] })),
    ).toBe("끝");
    expect(
      extractHwpText(makeHwp({ sections: [[0, Buffer.concat([fillUnknownRecords(200_000), para])]] })),
    ).toBe("");
  });

  it("출력 10만 UTF-16 단위를 넘기면 본문을 포기한다", () => {
    const ok = "가".repeat(100_000);
    expect(extractHwpText(makeHwp({ sections: [[0, encodePara(ok)]] }))).toBe(ok);
    expect(extractHwpText(makeHwp({ sections: [[0, encodePara(`${ok}나`)]] }))).toBe("");
    const half = "가".repeat(50_000);
    expect(extractHwpText(makeHwp({ sections: [[0, Buffer.concat([encodePara(half), encodePara(half)])]] }))).toBe(
      "",
    );
  });

  it(
    "풀었을 때 16MiB 를 넘기는 압축 본문은 포기한다",
    () => {
      const raw = Buffer.alloc(16 * 1024 * 1024 + 1, 97);
      expect(extractHwpText(makeHwp({ flags: 1, sections: [[0, raw]] }))).toBe("");
    },
    20_000,
  );
});

describe("HWP 첨부 파이프라인 — 본문 우선, 미리보기 폴백", () => {
  it("본문이 있으면 미리보기에 없는 문단을 첨부 입력으로 쓴다", async () => {
    const bytes = makeHwp({
      sections: [[0, encodePara("본문신청기간 2026-02-01")]],
      preview: "짧은미리보기",
    });
    const result = await readHwpAttachment(bytes);
    expect(result.text).toContain("본문신청기간 2026-02-01");
    expect(result.failedFiles).toEqual([]);
  });

  it("본문을 못 읽으면 기존 미리보기만 붙이고 성공 본문으로 바꾸지 않는다", async () => {
    const bytes = makeHwp({
      flags: 1 << 1,
      sections: [[0, encodePara("비밀본문")]],
      preview: "미리보기글자",
    });
    const result = await readHwpAttachment(bytes);
    expect(result.text).toContain("미리보기글자");
    expect(result.text).not.toContain("비밀본문");
    expect(result.failedFiles).toEqual([]);
    expect(result.readFiles).toEqual(["모집공고.hwp"]);
    expect(result.skippedFiles).toContain("모집공고.hwp");
    expect(result.text).toContain("[미확인 첨부: 모집공고.hwp]");
  });
});


describe("본문 추출의 헤더·제어문자·작업량 한계", () => {
  it("형식 서명의 뒤가 변했거나 길이가 다르면 읽지 않는다", () => {
    const highBit=makeFileHeader();highBit[0] |= 0x80;
    for (const header of [highBit,makeFileHeader({signature:"HWP Document FileX"}),makeFileHeader({length:257})]) {
      expect(extractHwpText(makeHwp({header,sections:[[0,encodePara("본문")]]}))).toBe("");
    }
  });
  it("확장 제어문자의 끝 표식이 다르면 일부 본문을 반환하지 않는다", () => {
    const payload=u16le([0xac00,2,0,0,0,0,0,0,3,0xac01]);
    expect(extractHwpText(makeHwp({sections:[[0,encodeRecord(0x43,payload)]]}))).toBe("");
  });
  it("출력 한도를 넘는 거대 문단은 나머지 백만 글자를 순회하지 않는다", () => {
    const bytes=makeHwp({sections:[[0,encodePara("가".repeat(1_000_000))]]});
    const read=Buffer.prototype.readUInt16LE;let reads=0;
    Buffer.prototype.readUInt16LE=function(offset=0){if(++reads>150_000)throw new Error("시험용 읽기 상한");return read.call(this,offset);};
    try {expect(extractHwpText(bytes)).toBe("");expect(reads).toBeLessThanOrEqual(150_000);}
    finally {Buffer.prototype.readUInt16LE=read;}
  });
});

describe("HWP 본문 — 잘린 줄기·남은 압축 바이트", () => {
  it("CFB가 선언한 Section 길이보다 실제 바이트가 짧으면 본문을 거절한다", () => {
    const bytes = makeHwp({ sections: [[0, encodePara("앞부분만")]] });
    const entry = bytes.indexOf(Buffer.from("Section0\0", "utf16le"));
    expect(entry).toBeGreaterThan(0);
    bytes.writeUInt32LE(1000, entry + 120);
    expect(extractHwpText(bytes)).toBe("");
  });

  it("마지막 필수 Section이 잘리면 앞 절 글자도 쓰지 않는다", () => {
    const bytes = makeHwp({
      sections: [
        [0, encodePara("앞절")],
        [1, encodePara("뒷절")],
      ],
    });
    const entry = bytes.indexOf(Buffer.from("Section1\0", "utf16le"));
    expect(entry).toBeGreaterThan(0);
    bytes.writeUInt32LE(1000, entry + 120);
    expect(extractHwpText(bytes)).toBe("");
  });

  it.each([Buffer.from([1, 2, 3, 4]), deflateRawSync(encodePara("둘째 압축"))])(
    "첫 DEFLATE 뒤에 소비하지 않은 바이트가 있으면 본문을 거절한다",
    (trailing) => {
      const section = Buffer.concat([deflateRawSync(encodePara("압축 앞부분")), trailing]);
      expect(
        extractHwpText(
          makeHwp({
            flags: 1,
            extra: [["BodyText/Section0", section]],
          }),
        ),
      ).toBe("");
    },
  );
});
