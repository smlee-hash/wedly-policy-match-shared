/**
 * 서류 읽기 시험이 함께 쓰는 **가상** 표본 만들기.
 *
 * ★실제 회사 정보는 하나도 없다 — 상호 「가상테크」·사업자번호 123-81-67890·대표자 「김가상」·
 *  주민번호 800101-1234567 은 전부 지어낸 값이다. 주민번호·대표자·도로명이 결과에 새지 않는지 재는 시험이
 *  이 값들을 그대로 찾는다.
 * ★파일은 시험 안에서 만든다(엑셀은 xlsx, 워드·한글·파워포인트는 zip, PDF 는 pdf-lib).
 */
import AdmZip from "adm-zip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import * as XLSX from "xlsx";

export const FAKE = {
  company: "가상테크",
  bizno: "123-81-67890",
  biznoPersonal: "123-45-67890",
  rep: "김가상",
  rrn: "800101-1234567",
  corpRegNo: "110111-1234567",
  street: "동탄대로 123",
  building: "가상빌딩",
} as const;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function zipOf(entries: Record<string, string>): Buffer {
  const zip = new AdmZip();
  for (const [name, text] of Object.entries(entries)) zip.addFile(name, Buffer.from(text, "utf-8"));
  return zip.toBuffer();
}

/** 워드 파일. 글자는 문단, 배열은 표의 한 행(칸마다 문단 하나). */
export function docxOf(blocks: Array<string | string[]>): Buffer {
  const body = blocks
    .map((b) =>
      typeof b === "string"
        ? `<w:p><w:r><w:t xml:space="preserve">${esc(b)}</w:t></w:r></w:p>`
        : `<w:tbl><w:tr>${b.map((c) => `<w:tc><w:p><w:r><w:t>${esc(c)}</w:t></w:r></w:p></w:tc>`).join("")}</w:tr></w:tbl>`,
    )
    .join("");
  return zipOf({
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  });
}

/** 한글 새 형식(.hwpx) 파일. */
export function hwpxOf(paragraphs: string[]): Buffer {
  const body = paragraphs.map((p) => `<hp:p><hp:run><hp:t>${esc(p)}</hp:t></hp:run></hp:p>`).join("");
  return zipOf({
    "Contents/section0.xml": `<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">${body}</hs:sec>`,
  });
}

/** 파워포인트 파일. 슬라이드마다 글자 문단 목록. */
export function pptxOf(slides: string[][]): Buffer {
  const entries: Record<string, string> = {};
  slides.forEach((paragraphs, i) => {
    const body = paragraphs.map((p) => `<a:p><a:r><a:t>${esc(p)}</a:t></a:r></a:p>`).join("");
    entries[`ppt/slides/slide${i + 1}.xml`] =
      `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody>${body}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  });
  return zipOf(entries);
}

export function txtOf(text: string): Buffer {
  return Buffer.from(text, "utf-8");
}

/** 엑셀 칸 하나: 글자·숫자, 또는 날짜 서식을 입힌 숫자(serial = 엑셀 날짜 번호, 41456 = 2013-07-01). */
export type SampleCell = string | number | { serial: number; format: string };

/** 시트마다 「칸 이름 → 값」으로 엑셀을 만든다. bookType "biff8" 이면 옛 .xls. */
export function xlsxOf(sheets: Record<string, Record<string, SampleCell>>, bookType: "xlsx" | "biff8" = "xlsx"): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, cells] of Object.entries(sheets)) {
    const ws: XLSX.WorkSheet = {};
    for (const [addr, v] of Object.entries(cells)) {
      ws[addr] =
        typeof v === "string" ? { t: "s", v } : typeof v === "number" ? { t: "n", v } : { t: "n", v: v.serial, z: v.format };
    }
    ws["!ref"] = "A1:H40";
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType }) as Buffer);
}

/** 줄·칸 표(첫 줄이 머리줄)로 엑셀을 만든다. */
export function xlsxTableOf(sheetName: string, rows: Array<Array<string | number>>): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer);
}

/** 글자(영문만 — 표준 글꼴이 한글을 못 그린다)가 든 PDF. */
export async function pdfOf(lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  lines.forEach((line, i) => page.drawText(line, { x: 24, y: 760 - i * 16, size: 10, font }));
  return Buffer.from(await doc.save());
}

/** 글자가 하나도 없는 PDF — 스캔본처럼 보인다. */
export async function blankPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([400, 200]);
  return Buffer.from(await doc.save());
}

/** 파일 머리 바이트만 흉내 낸 가짜 파일(확장자 위장 시험용). */
export const HEAD = {
  pdf: Buffer.from("%PDF-1.7\n%fake body\n"),
  zip: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]),
  cfb: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]),
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
  webp: Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBPVP8 ")]),
} as const;

/* ───────── 가상 서류 글(텍스트 PDF 에서 나온 모양) ───────── */

/** 법인 사업자등록증. 대표자·주민(법인등록)번호·도로명이 들어 있다 — 결과에 새면 안 된다. */
export const BIZ_REGISTRATION_CORP_TEXT = [
  "사업자등록증",
  "( 법인사업자 )",
  `등록번호 : ${FAKE.bizno}`,
  `법인명(단체명) : ㈜${FAKE.company}`,
  `대 표 자 : ${FAKE.rep}`,
  `개 업 연 월 일 : 2018 년 03 월 12 일     법인등록번호 : ${FAKE.corpRegNo}`,
  `사업장 소재지 : 경기도 화성시 ${FAKE.street}, ${FAKE.building} 5층`,
  `본 점 소 재 지 : 경기도 화성시 ${FAKE.street}, ${FAKE.building} 5층`,
  "사 업 의 종 류 : 업태 제조업 종목 전자부품",
  "                 업태 도소매업 종목 전자상거래",
  "발 급 사 유 : 신규",
].join("\n");

/** 개인 사업자등록증명. 주민등록번호가 들어 있다 — 결과에 새면 안 된다. */
export const BIZ_REGISTRATION_PERSONAL_TEXT = [
  "사 업 자 등 록 증 명",
  "( 일반과세자 )",
  `등 록 번 호 : ${FAKE.biznoPersonal}`,
  `상 호(법인명) : ${FAKE.company}`,
  `성 명(대표자) : ${FAKE.rep}`,
  "개 업 연 월 일 : 2020 년 07 월 01 일",
  `사 업 장 소 재 지 : 서울특별시 강남구 테헤란로 1, ${FAKE.building} 10층`,
  "사 업 의 종 류 : 업태 서비스업 종목 소프트웨어 개발",
  `주민(법인)등록번호 : ${FAKE.rrn}`,
  "위 와 같 이 증 명 합 니 다 .",
].join("\n");

/** 표준재무제표증명 — 단위가 천원. */
export const FINANCIAL_STATEMENT_TEXT = [
  "표준재무제표증명(법인)",
  "사업연도 2025.01.01 ~ 2025.12.31",
  `사업자등록번호 ${FAKE.bizno}   상호 ㈜${FAKE.company}`,
  "표준손익계산서",
  "(단위: 천원)",
  "과목                 당기             전기",
  "Ⅰ.매출액           1,234,567        987,654",
  "Ⅱ.매출원가          800,000          700,000",
  "Ⅲ.매출총이익        434,567          287,654",
].join("\n");

/** 부가가치세 확정신고서(일반과세자) — 단위 표기가 없으면 원. */
export const VAT_RETURN_TEXT = [
  "부가가치세 확정신고서(일반과세자)",
  "과세기간 2025년 제2기 (2025년 7월 1일 ~ 2025년 12월 31일)",
  `사업자등록번호 ${FAKE.bizno}`,
  `상호 ㈜${FAKE.company}`,
  "과세표준 및 매출세액",
  "구분                       금액           세율   세액",
  "세금계산서 발급분          400,000,000    10/100  40,000,000",
  "신용카드·현금영수증 발행분  50,000,000    10/100   5,000,000",
  "과세표준 합계              450,000,000",
].join("\n");

/** 부가가치세 과세표준증명 — 단위 백만원. */
export const TAX_BASE_CERT_TEXT = [
  "부가가치세 과세표준증명",
  `납세자 상호 ${FAKE.company}   사업자등록번호 ${FAKE.bizno}`,
  "과세기간 2024년 1월 1일 ~ 2024년 12월 31일",
  "(단위 : 백만원)",
  "과세표준 합계 512",
].join("\n");

/** 고용·산재 가입자 명부 표(엑셀 시트 「고용현황」). 근로자 이름·주민번호는 전부 가상. */
export const EMPLOYMENT_ROWS: Array<Array<string | number>> = [
  ["근로자 이름", "근로자 주민번호", "고용상태", "취득일"],
  ["가상직원일", "900101-1111111", "고용", "2022-01-03"],
  ["가상직원이", "910202-2222222", "고용", "2023-02-01"],
  ["가상직원삼", "920303-1333333", "고용", "2024-03-04"],
  ["가상직원사", "930404-2444444", "상실", "2021-04-05"],
  ["가상직원일", "900101-1111111", "고용", "2022-01-03"],
];

/** 기업상태표(엑셀) — 정본 셀 위치(company-status fields.ts excelCell)대로 값을 넣은 가상 표본. */
export function companyStatusSheet(over: Record<string, SampleCell> = {}): Record<string, SampleCell> {
  return {
    A1: "기업상태표",
    A2: "업체명 (법인은 ㈜)",
    B2: `㈜${FAKE.company}`,
    E2: "개업년월일",
    F2: "2018-03-12",
    A3: "사업자등록증 주업종",
    B3: "제조업 / 전자부품",
    E3: "① 신용등급 (NICE 기준)",
    A4: "사업장 소재지",
    B4: `경기도 화성시 ${FAKE.street}, ${FAKE.building} 5층`,
    A5: "당해년도 매출 (현재까지)",
    C5: "3천만원",
    A6: "전년도(-1년) 매출",
    C6: "1억 2천",
    A7: "전년도(-2년) 매출",
    C7: "9,000만원",
    A8: "전년도(-3년) 매출",
    C8: "5천만원",
    A10: "4대보험 인원수",
    C10: "7명",
    E26: "등록 2건, 출원 1건",
    D26: "특허 출원이나 등록여부 (있다면 각각 몇 건)",
    D29: "연구소/기업인증 보유여부 (벤처인증/ISO/기타인증)",
    E29: "벤처, 이노비즈, ISO 9001",
    A30: "대표자 개인 신용대출액 (총 건수/잔액)",
    A32: "정책자금 기대출 (기관명/잔액)",
    C32: "신보 5천만원",
    F30: "국세 체납여부 (특히 부가세)",
    G30: "N",
    F31: "4대보험료 체납여부",
    G31: "N",
    ...over,
  };
}
