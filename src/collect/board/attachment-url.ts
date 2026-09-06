// 첨부 주소의 **글자 인코딩**을 게시판에 맞춘다. euc-kr 게시판 전용 — utf-8 은 손대지 않는다.
import iconv from "iconv-lite";
import type { BoardConfig } from "./types";

/** 날 비ASCII 글자 덩어리. 주소에서 퍼센트 인코딩이 필요한 건 이것뿐이다. */
const NON_ASCII_RUN = /[^\x00-\x7F]+/g;
/** 이어 붙은 퍼센트열(`%EB%B6%99…`). 이미 인코딩된 이름을 되짚어 볼 때 쓴다. */
const PERCENT_RUN = /(?:%[0-9A-Fa-f]{2})+/g;
/** 한글(음절·자모)·한자. 「UTF-8 로 읽힌 것이 진짜 한글인가」를 가르는 잣대. */
const HANGUL_OR_HANJA = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3\u4E00-\u9FFF]/;

/**
 * 왜 필요한가(2026-09-06 curl 실측 — 충북테크노파크 `no=307`):
 *
 * 상세 HTML(euc-kr)의 첨부 링크는 파일 이름을 **날 한글 그대로** 들고 있다:
 *   `href="/index.php?...&file=붙임1. 2026년 과학기술분야 … 공고문.pdf"`
 * 이 글자를 `new URL()`(= `absolutize`)에 넣으면 표준대로 **UTF-8**로 퍼센트 인코딩되어
 *   `…&file=%EB%B6%99%EC%9E%841.%202026%EB%85%84…`
 * 이 저장된다. 그런데 서버는 **euc-kr 바이트만** 받는다:
 *   · UTF-8 주소  → 200 `text/html` 452바이트(「요청하신 파일이 존재하지 않습니다」)
 *   · euc-kr 주소 → 200 `content-disposition: attachment` + PDF 799,373바이트(`%PDF-1.6`)
 * 200 + HTML 이라 뒷단계는 실패인 줄도 모르고 「읽지 못한 첨부」로 적고 7일 도장을 찍는다 —
 * 운영 실측으로 첨부 있는 열린 공고 10건 중 9건이 그렇게 남아 있었다.
 *
 * 그래서 **절대화하기 전에**, href 안의 날 비ASCII 글자만 euc-kr 퍼센트 인코딩으로 바꾼다.
 * 바꾼 뒤에는 순수 ASCII + `%XX` 라 `new URL()` 이 다시 건드리지 않는다(퍼센트열은 그대로 통과).
 *
 * ★이미 퍼센트 인코딩된 href 도 본다 — 단 **UTF-8 로 읽었을 때 한글/한자가 나올 때만** 다시
 *  인코딩한다(독립 리뷰 5번). euc-kr 바이트는 대개 올바른 UTF-8 이 아니라 그 자리에서 걸러지고,
 *  우연히 올바른 UTF-8 이 되는 euc-kr 두 바이트(`%C7%D0` → U+01D0)는 한글이 아니라 손대지 않는다.
 */
export function encodeAttachmentHref(href: string, charset: BoardConfig["charset"]): string {
  if (charset !== "euc-kr" || !href) return href;
  let broken = false;
  const enc = (text: string): string => {
    const done = percentEncodeEucKr(text);
    if (done === null) {
      broken = true;
      return text;
    }
    return done;
  };
  const out = href
    .replace(NON_ASCII_RUN, enc)
    // ★사이트가 링크를 **미리 UTF-8 로 퍼센트 인코딩**해 내보내는 날도 있다(2026-09-06 독립 리뷰 5번).
    //  그 주소는 충북TP 서버에서 452바이트 「파일 없음」이라, 날 한글일 때와 똑같이 다시 인코딩해야 한다.
    .replace(PERCENT_RUN, (run) => {
      const decoded = decodeUtf8Percent(run);
      return decoded === null ? run : enc(decoded);
    });
  // 한 글자라도 euc-kr 로 담을 수 없으면 **통째로 예전 그대로** 둔다 — 반쪽만 바꾼 주소는
  // 지금(UTF-8 전부)보다 나을 것이 없고, 뒷단계가 못 읽은 이유를 헷갈리게 만든다.
  return broken ? href : out;
}

/**
 * 퍼센트열이 **UTF-8 한글/한자**로 읽히면 그 글자를, 아니면 `null`(손대지 않는다).
 *
 * 한글·한자를 요구하는 이유: euc-kr 두 바이트가 우연히 올바른 UTF-8 이 되는 자리가 있다
 * (`%C7%D0` → U+01D0). 그때 나오는 글자는 라틴 확장이지 한글이 아니다 — euc-kr 로 적힌
 * 한글 이름이 통째로 「UTF-8 로도 옳고 게다가 한글」로 읽히는 경우는 사실상 없다.
 * (완전히 0 이라고 증명한 것은 아니라 한계를 적어 둔다.)
 */
function decodeUtf8Percent(run: string): string | null {
  const bytes = new Uint8Array((run.match(/%[0-9A-Fa-f]{2}/g) ?? []).map((h) => parseInt(h.slice(1), 16)));
  if (bytes.length === 0) return null;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // 올바른 UTF-8 이 아니다 = 이미 euc-kr(또는 다른 인코딩) 바이트다. 그대로 둔다.
    return null;
  }
  return HANGUL_OR_HANJA.test(text) ? text : null;
}

/**
 * 글자들을 euc-kr 바이트의 퍼센트 표기로. euc-kr 이 담을 수 없는 글자가 하나라도 있으면 `null`.
 *
 * 한 글자씩 인코딩하는 이유: iconv 는 못 담는 글자를 조용히 `?`(0x3F) 한 바이트로 바꾼다.
 * 통째로 인코딩하면 그 `?` 가 어느 글자였는지 알 수 없어 「망가진 이름」을 그대로 저장하게 된다.
 * euc-kr(cp949)은 글자마다 독립이라(모드 전환이 없다) 한 글자씩 인코딩해도 결과가 같다.
 */
function percentEncodeEucKr(text: string): string | null {
  let out = "";
  for (const ch of text) {
    const buf = iconv.encode(ch, "euc-kr");
    if (ch !== "?" && buf.length === 1 && buf[0] === 0x3f) return null;
    for (const b of buf) out += `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}
