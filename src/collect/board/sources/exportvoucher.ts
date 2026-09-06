// 2026-09-03 상한 올림: 감시 장치 실측 상한 밖 23건(사장님 누락 0 지시)
import { parseHtml } from "../html";
import type { BoardConfig, BoardRow } from "../types";

const GO_DETAIL = /goDetail\(\s*(\d+)\s*\)/;
const NOTICE_KEEP = /모집|공고/;
// 수행기관·전문기관 모집은 바우처 수혜기업용이 아니다(적대 리뷰 — 상시 고정글 혼입).
const NOTICE_DROP = /수행기관|전문기관/;
const YMD = /20\d{2}-\d{2}-\d{2}/;

/** 수출바우처 공지 — 모집·공고 제목만 남기고 goDetail 인자로 GET 상세 주소를 조립한다. */
export function parseExportvoucherList(html: string, cfg: BoardConfig): BoardRow[] {
  const root = parseHtml(html);
  const out: BoardRow[] = [];
  for (const tr of root.querySelectorAll("tr")) {
    const a = tr.querySelector('a[onclick*="goDetail("]');
    if (!a) continue;
    const title = a.text.trim();
    if (!title || !NOTICE_KEEP.test(title) || NOTICE_DROP.test(title)) continue;
    const onclick = a.getAttribute("onclick") ?? "";
    const idm = onclick.match(GO_DETAIL);
    if (!idm) continue;
    // 목록엔 등록일뿐이다. 등록일을 단독으로 넣으면 마감일로 오인되고, 비우면 날짜 검증 관문에서
    // 출처가 전멸한다(적대 리뷰 치명) — 「등록일 ~」 개시형으로 넣어 시작일로만 읽히게 한다.
    const reg = (tr.text.match(YMD) ?? [""])[0];
    out.push({
      title,
      detailUrl: `https://www.exportvoucher.com/portal/board/boardView?bbs_id=1&ntt_id=${idm[1]}`,
      dateText: reg ? `${reg} ~` : "",
      category: "",
      agency: cfg.agency,
    });
  }
  return out;
}

export const exportvoucherConfig: BoardConfig = {
  id: "exportvoucher",
  // 게시판에 중기부·산업통상부 사업이 섞여 있어 부처를 못 박지 않는다(적대 리뷰).
  label: "수출바우처",
  agency: "수출바우처",
  region: "",
  baseUrl: "https://www.exportvoucher.com/",
  charset: "utf-8",
  list: {
    // ★2026-09-01 정정. 앞선 기록은 「쪽넘김이 POST 전용, GET 변형 4종 전부 무효」였는데
    //   목록 화면의 폼을 직접 열어 보니 `method="get"` 이고 변수 이름이 **pageNo** 다
    //   (`goPage()` 가 pageNo 를 채워 그 폼을 보낸다). 그 이름을 안 넣어 봤던 것이다.
    //   실측: 1~4쪽에 고유 글 43건, 그중 담길 공고 12건 — 1쪽만 볼 때는 3건이었다.
    url: (p) => `https://www.exportvoucher.com/portal/board/boardList?bbs_id=1&pageNo=${p}`,
    maxPages: 15,
    rowSelector: "tr",
    fields: {
      title: { selector: 'a[onclick*="goDetail("]' },
      detailUrl: { selector: 'a[onclick*="goDetail("]', attr: "onclick", regex: "goDetail\\(\\s*(\\d+)\\s*\\)" },
      date: {},
    },
  },
  customParse: (html) => parseExportvoucherList(html, exportvoucherConfig),
  // w3-ev-detail.html 실측: 본문은 div.bbsCon (제목·등록일은 div.bbsInfo, 바깥은 article#contents).
  detailContentSelector: "div.bbsCon",
  // ★정정(적대 리뷰 ③). 앞서 「한 쪽에 2건만 남으면 검증이 걸려 뒷쪽을 포기한다」고 적고 1로 내렸는데
  //   **사실이 아니었다** — 뒤 페이지 검증(`collectLaterPages`)은 expectMinRows 를 아예 안 넘긴다.
  //   이 값은 1쪽 관문에만 쓰이고, `1` 은 `validate.ts` 에서 0·미지정과 동작이 같아 서식 변경 감지를
  //   꺼 버린 것과 같았다. 1쪽 실측 3건이라 하나 아래인 2로 둔다.
  expectMinRows: 2,
};
