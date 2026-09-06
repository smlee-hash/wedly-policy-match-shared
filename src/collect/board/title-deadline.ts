// 제목 속 마감 표기 → 종료일. 게시판마다 표기가 달라 한 벌로 모은다
// (독립 검사 4차: 형식별 정규식이 흩어져 있어 마감 지난 27건이 모집중에 남았다).
// 월·일 교대열은 긴 대안 먼저(함정3) + 뒤 숫자 금지.

const M = "(1[0-2]|0?[1-9])";
const D = "(3[01]|[12]\\d|0?[1-9])";
// 돈·비율 단위가 뒤에 붙으면 날짜가 아니다 — 「3.5억원까지」를 3월 5일로 읽던 사고(독립 검사 5차).
const MONEY_UNIT = "(?!\\s*(?:억|천만|백만|만|원|%|퍼센트|배|명|개|건|년|주|시간|kg|㎡))";

// 「~26.8.28」 — 두 자리 연도가 명시된 점 형식.
const Y_MD = new RegExp(`~\\s*(\\d{2})\\s*\\.\\s*${M}\\s*\\.\\s*${D}(?!\\d)${MONEY_UNIT}`);
// 「~3.27」「~8/24」「~8월 28일」 — 연도 없는 형식(구분자 점·빗금·월).
const MD = new RegExp(`~\\s*${M}\\s*[./월]\\s*${D}(?!\\d)${MONEY_UNIT}`);
// 「6월 23일(화) 18시까지」 — 물결 없이 「까지」가 앵커. 사이 글자를 12자로 제한해
// 「9월 30일부터 신청, 10월 15일까지」에서 앞 날짜를 잘못 잡지 않게 한다.
const KKAJI = new RegExp(`${M}\\s*[./월]\\s*${D}\\s*일?${MONEY_UNIT}[^~]{0,12}까지`);

const pad2 = (n: string) => n.padStart(2, "0");

/** 마감 월이 등록 월보다 앞이면 이듬해(연말 걸침). 등록일이 없으면 "" — 연도를 지어내지 않는다. */
function withInferredYear(monthStr: string, dayStr: string, regYmd: string): string {
  if (!/^\d{4}-\d{2}/.test(regYmd)) return "";
  const regYear = Number(regYmd.slice(0, 4));
  const regMonth = Number(regYmd.slice(5, 7));
  const year = Number(monthStr) < regMonth ? regYear + 1 : regYear;
  return `${year}-${pad2(monthStr)}-${pad2(dayStr)}`;
}

/**
 * 제목에서 신청 마감일(YYYY-MM-DD)을 뽑는다. 없으면 "".
 * regYmd(등록일)는 연도 없는 형식의 연도 추론에 쓴다.
 * 뽑은 날짜가 등록일보다 앞서면 버린다 — 잘못 읽은 값으로 살아 있는 공고를 즉시 닫지 않기 위해(독립 검사 5차).
 */
export function deadlineFromTitle(title: string, regYmd: string): string {
  const y = title.match(Y_MD);
  const raw = y
    ? `20${y[1]}-${pad2(y[2])}-${pad2(y[3])}`
    : (() => {
        const md = title.match(MD);
        if (md) return withInferredYear(md[1], md[2], regYmd);
        const k = title.match(KKAJI);
        return k ? withInferredYear(k[1], k[2], regYmd) : "";
      })();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(regYmd) && raw < regYmd) return "";
  return raw;
}
