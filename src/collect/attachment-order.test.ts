import { describe, expect, it } from "vitest";
import {
  attachmentNameRole,
  attachmentRequestKey,
  effectiveAttachmentKind,
  isSiteCommonAttachment,
  trimAttachmentName,
} from "./attachment-order";

/**
 * 첨부 읽기 순서(2026-10-01 「첨부파일 글자 추출 누락」 3번).
 *
 * 운영 실측: 한 공고의 첨부를 1개만 읽는데, 지금은 형식 순서(pdf·hwpx → hwp → 나머지)만 봐서
 * 신청서 양식·포스터 pdf 가 공고문 hwp 보다 먼저 읽혔다. 이름으로 역할을 가려 공고문부터 읽는다.
 *  · 역할 0 = 공고문 쪽(공고문·공고·공모·모집요강·요강·안내문·안내·시행계획·사업계획(서 아님)·추진계획(서 아님)·RFP·제안요청서·지침)
 *  · 역할 2 = 서식 쪽(서식·양식·신청서·계획서·제안서·작성요령·동의서·위임장·확약서·서약서·각서·서류·체크리스트·
 *    포스터·카드뉴스·홍보·리플렛·이미지·썸네일·배너·웹자보·매뉴얼·설문지) — 그림 파일은 이름과 상관없이 2
 *  · 역할 1 = 그 밖
 * 한 조각(「및」·쉼표·&·가운뎃점으로 나눔) 안에서는 **마지막** 역할 낱말이, 조각끼리는 **작은** 역할이 이긴다.
 * 괄호 밖 낱말을 먼저 보고, 괄호 밖에 없을 때만 괄호 안을 본다. 이름의 「+」 는 띄어쓰기로 본다.
 */

describe("trimAttachmentName — 이름 끝 크기·횟수 꼬리를 뗀다", () => {
  const cut: Array<[string, string]> = [
    ["공고문.hwp (68.5K)", "공고문.hwp"],
    ["모집공고.pdf[1.2MB]", "모집공고.pdf"],
    ["  공고문.hwpx  ", "공고문.hwpx"],
    ["붙임1. 신청서.hwp (2)", "붙임1. 신청서.hwp"],
    ["file.v2.pdf (1MB)", "file.v2.pdf"],
    ["공고.pdf(다운로드 12회)", "공고.pdf"],
  ];
  for (const [raw, want] of cut) {
    it(`${JSON.stringify(raw)} → ${JSON.stringify(want)}`, () => {
      expect(trimAttachmentName(raw)).toBe(want);
    });
  }

  const keep = ["공고문(최종).hwp", "입주신청서 (2) (2).hwpx", "공고", ""];
  for (const raw of keep) {
    it(`확장자 뒤 꼬리가 아니면 그대로 — ${JSON.stringify(raw)}`, () => {
      expect(trimAttachmentName(raw)).toBe(raw);
    });
  }
});

describe("attachmentNameRole — 이름으로 가린 역할(0 공고문 쪽 · 1 그 밖 · 2 서식 쪽)", () => {
  const role0 = [
    "2026-375_★2026년 기술닥터사업 공고문.hwp",
    "(모집공고문) 2026년 초거대 AI 기술 컨설팅 대상기업 모집 공고.hwp",
    "[모집공고] 2021년 사회적경제 상품 전시회 참가기관 모집 공고.hwp",
    "(붙임1) 통관·검역 지원 컨설팅 수요기업 모집공고.hwp",
    "붙임3._제안요청서.hwp",
    "붙임1._사업안내서.hwp",
    "김산업 전문기관 지정 신청 안내.hml",
    "2026년 사업계획.hwp",
    "2026 추진계획.pdf",
    "RFP_스마트공장 고도화.pdf",
    "rfp 요약.pdf",
    "공고문.hwp (68.5K)",
    "공고문 및 신청서.hwp",
    "신청서 작성 안내.hwp",
    "참고(공고문).pdf",
    "공고문(서식 포함).hwp",
    "A+B 공고.pdf",
  ];
  for (const name of role0) {
    it(`0 — ${name}`, () => {
      expect(attachmentNameRole(name)).toBe(0);
    });
  }

  const role2 = [
    "2026-375_★기술닥터사업 표준서식.hwpx",
    "붙임 1. 2026년 초거대 AI 기술 컨설팅 신청서.pdf",
    "[포스터] 2021 사회적경제 상품 전시회 참가기업 모집.pdf",
    "(양식) 전남센터 입주지원신청서 및 사업계획서.hwp",
    "2026 사업계획서.hwp",
    "동반성장몰.png",
    "홍보물.JPG",
    "공고문 신청서 양식.hwp",
    "공고+신청서 양식.hwp",
    "만족도 설문지.hwp",
    "2026 하나 파워 온 혁신기업 인턴십_운영매뉴얼.pdf",
    "입주신청서 (2) (2).hwpx",
    "서식 모음.zip (1.2MB)",
    // 그림 파일은 이름에 공고가 있어도 서식 쪽
    "공고문.png",
    "모집공고 포스터.jpg",
  ];
  for (const name of role2) {
    it(`2 — ${name}`, () => {
      expect(attachmentNameRole(name)).toBe(2);
    });
  }

  const role1 = [
    "[붙임2] 지역산업위기대응 이차보전 지원사업 FAQ.pdf",
    "pages.pdf",
    "붙임2._과업지시서.hwp",
    "제96회 아카데미 시상식 출품규정.pdf",
    // 「모집」 만으로는 공고문으로 보지 않는다
    "2026년 모집.hwp",
    "",
  ];
  for (const name of role1) {
    it(`1 — ${JSON.stringify(name)}`, () => {
      expect(attachmentNameRole(name)).toBe(1);
    });
  }
});

describe("effectiveAttachmentKind — 저장 형식이 etc 일 때만 이름(꼬리 뗀)·주소로 다시 가린다", () => {
  const B = "https://www.bizinfo.go.kr/cmm/fms/fileDown.do?file=";
  it("크기 꼬리 때문에 etc 로 굳은 한글 파일 → hwp", () => {
    expect(effectiveAttachmentKind({ name: "공고문.hwp (68.5K)", url: `${B}1`, kind: "etc" })).toBe("hwp");
  });
  it("크기 꼬리 때문에 etc 로 굳은 zip → zip", () => {
    expect(effectiveAttachmentKind({ name: "자료 묶음.zip (1.2MB)", url: `${B}2`, kind: "etc" })).toBe("zip");
  });
  it("저장 형식이 etc 가 아니면 그대로", () => {
    expect(effectiveAttachmentKind({ name: "공고문.hwp", url: `${B}3`, kind: "pdf" })).toBe("pdf");
  });
  it("이름에 형식이 없으면 주소로", () => {
    expect(effectiveAttachmentKind({ name: "file", url: "https://www.bizinfo.go.kr/files/a.hwpx", kind: "etc" })).toBe(
      "hwpx",
    );
  });
  it("어디에도 없으면 etc", () => {
    expect(effectiveAttachmentKind({ name: "사진", url: "https://www.bizinfo.go.kr/view", kind: "etc" })).toBe("etc");
  });
});

describe("isSiteCommonAttachment — 모든 글에 붙는 사이트 공통 파일", () => {
  const EV = "https://www.exportvoucher.com/common.FileDownload.do?file_id=";
  const yes = [
    "https://www.cba.ne.kr/ebook/2026/pages.pdf",
    "http://cba.ne.kr/ebook/a/b.pdf",
    `${EV}FILE_000000006726376`,
    `${EV}FILE_000000006769439`,
    `${EV}FILE_000000007042784`,
    `https://exportvoucher.com/common.FileDownload.do?file_id=FILE_000000007098686`,
    `http://www.exportvoucher.com/COMMON.FILEDOWNLOAD.DO?file_id=FILE_000000007125962`,
  ];
  for (const url of yes) {
    it(`공통 — ${url}`, () => {
      expect(isSiteCommonAttachment(url)).toBe(true);
    });
  }

  const no = [
    "https://www.cba.ne.kr/home/sub.php?menukey=140&mod=view&no=1",
    "https://www.cba.ne.kr/upload/ebook.pdf",
    `${EV}FILE_000000001234567`,
    "https://www.exportvoucher.com/other.do?file_id=FILE_000000006726376",
    "https://www.bizinfo.go.kr/ebook/2026/pages.pdf",
    "https://www.cba.ne.kr.evil.com/ebook/pages.pdf",
    "not a url",
    "",
  ];
  for (const url of no) {
    it(`공통 아님 — ${JSON.stringify(url)}`, () => {
      expect(isSiteCommonAttachment(url)).toBe(false);
    });
  }
});

describe("attachmentRequestKey — 같은 요청인지 가리는 열쇠", () => {
  it("모양: 방법(기본 GET) · 정규화 주소(https) · 본문을 줄바꿈으로 잇는다", () => {
    expect(attachmentRequestKey({ url: "http://WWW.Example.com/a?b=1" })).toBe("GET\nhttps://www.example.com/a?b=1\n");
    expect(attachmentRequestKey({ url: "https://www.example.com/d", method: "POST", body: "x=1" })).toBe(
      "POST\nhttps://www.example.com/d\nx=1",
    );
  });
  it("http/https·호스트 대소문자는 같은 열쇠", () => {
    const a = attachmentRequestKey({ url: "http://www.bizinfo.go.kr/f?a=1" });
    const b = attachmentRequestKey({ url: "https://WWW.BIZINFO.GO.KR/f?a=1" });
    expect(a).toBe(b);
  });
  it("GET 과 POST, 다른 POST 본문은 다른 열쇠", () => {
    const url = "https://www.bizinfo.go.kr/down.do";
    const get = attachmentRequestKey({ url });
    const post1 = attachmentRequestKey({ url, method: "POST", body: "a=1" });
    const post2 = attachmentRequestKey({ url, method: "POST", body: "a=2" });
    expect(new Set([get, post1, post2]).size).toBe(3);
  });
  it("주소로 못 읽는 글자는 앞뒤 공백만 뗀 날 글자로 — 같은 글자끼리는 같은 열쇠", () => {
    expect(attachmentRequestKey({ url: " not a url " })).toBe("GET\nnot a url\n");
    expect(attachmentRequestKey({ url: "not a url" })).toBe(attachmentRequestKey({ url: "  not a url" }));
  });
});
