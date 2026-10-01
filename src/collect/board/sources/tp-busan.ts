import type { BoardConfig } from "../types";

/**
 * 첨부 `downloadRun.do?qcode=…` 를 받기 직전에 불러야 하는 `download.json` 주소(그 밖의 주소는 null).
 * qcode 는 base64("Board,<번호>,Y") 이고, 저장 주소에는 '=' 가 날것 또는 `%3D` 로 들어 있다.
 * `URLSearchParams` 를 쓰지 않는다 — base64 의 '+' 가 공백으로 바뀐다. 날 값을 꺼내 직접 푼다.
 * 풀어 낸 첫 조각(prg_code)이 영문·숫자·밑줄이 아니면 남의 값을 주소에 끼워 넣지 않도록 null 이다.
 */
export function tpBusanPrecall(attachmentUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(attachmentUrl);
  } catch {
    return null;
  }
  if (u.hostname !== "www.btp.or.kr" || !/downloadRun\.do$/i.test(u.pathname)) return null;
  const raw = /[?&]qcode=([^&#]*)/.exec(u.search)?.[1];
  if (!raw) return null;
  let q = raw;
  try {
    q = decodeURIComponent(raw);
  } catch {
    /* 부호화가 깨졌으면 날 값 그대로 */
  }
  let decoded: string;
  try {
    decoded = atob(q);
  } catch {
    return null;
  }
  const prg = decoded.split(",")[0];
  if (!/^[A-Za-z0-9_]+$/.test(prg)) return null;
  return `https://www.btp.or.kr/kor/ajx_json/UploadMgr/download.json?qcode=${encodeURIComponent(q)}&prg_code=${encodeURIComponent(prg)}`;
}

export const tpBusan: BoardConfig = {
  id: "tp-busan",
  label: "부산테크노파크",
  agency: "부산테크노파크",
  region: "부산",
  baseUrl: "https://www.btp.or.kr/kor/CMS/Board/Board.do",
  charset: "utf-8",
  list: {
    url: (p) => `https://www.btp.or.kr/kor/CMS/Board/Board.do?mCode=MN013&page=${p}`,
    maxPages: 10,
    rowSelector: "table.bdListTbl tbody tr",
    fields: {
      title: { selector: "td.subject a .subjectWr" },
      detailUrl: { selector: "td.subject a", attr: "href" },
      date: { selector: "td.period" },
    },
  },
  detailContentSelector: "div.board-biz-view",
  // 2026-10-01 실측: downloadRun.do 는 직전에 download.json 을 불러야 JSESSIONID 를 주고 그 쿠키로만 파일을 준다(데우기는 필요 없다).
  attachmentSession: { referer: "detail", precall: tpBusanPrecall },
  expectMinRows: 5,
};
