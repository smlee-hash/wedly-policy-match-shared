import { describe, expect, it } from "vitest";
import { isProvenCwipEnd } from "./cwip-page-end";
import { isProvenEmptyBoardPage } from "./page-end";
import { cwipConfig } from "./sources/cwip";

const empty = (page: number) => `<div class="btn_ov01 ib"><span class="ov_txt">전체 312개 사업 </span><span class="ov_num"> [ 현재 Page <strong>${page}/13</strong> ]</span></div>
<div class="list_ul_type" id="list_type"><div class="card_wrap card_list_head"><div class="card_box"><div class="card_link_a">사업공고명</div><div class="card_date">신청기간</div></div></div></div>
<div class="page_num"><nav class="pg_wrap"><span class="pg"><a href="./application_list.php?page=1" class="pg_page pg_start">처음</a><a href="./application_list.php?page=13" class="pg_page">13<span>페이지</span></a></span></nav></div>`;

describe("창원 마지막 쪽의 실제 위치 표시", () => {
  it("실측 14/13과 15/13의 머리줄만 남은 목록을 각각 증명한다", () => {
    expect(isProvenCwipEnd(empty(14), cwipConfig, 14)).toBe(true);
    expect(isProvenCwipEnd(empty(15), cwipConfig, 15)).toBe(true);
    expect(isProvenEmptyBoardPage(empty(14), cwipConfig, 14)).toBe(true);
    expect(isProvenEmptyBoardPage('<form action="/login"><input type="password"></form>' + empty(14), cwipConfig, 14)).toBe(false);
  });
  it("현재 쪽, 총건수, 마지막 링크가 어긋나면 끝이 아니다", () => {
    expect(isProvenCwipEnd(empty(14), cwipConfig, 15)).toBe(false);
    expect(isProvenCwipEnd(empty(13), cwipConfig, 13)).toBe(false);
    expect(isProvenCwipEnd(empty(14).replace("312개", "3000개"), cwipConfig, 14)).toBe(false);
    expect(isProvenCwipEnd(empty(14).replace("page=13", "page=12"), cwipConfig, 14)).toBe(false);
    expect(isProvenCwipEnd(empty(14).replace("page=1\"", "page=15\""), cwipConfig, 14)).toBe(false);
    expect(isProvenCwipEnd(empty(14).replace('class="page_num"', 'class="footer"'), cwipConfig, 14)).toBe(false);
    expect(isProvenCwipEnd(empty(14), { ...cwipConfig, id: "gtp" }, 14)).toBe(false);
  });
  it("머리줄 외의 행·숨은 링크·알 수 없는 내용은 빈 목록으로 버리지 않는다", () => {
    for (const row of ['<div class="card_wrap">마감</div>', '<a href="/view">공고</a>', '<span hidden></span>', '불러오는 중']) {
      expect(isProvenCwipEnd(empty(14).replace('<div class="card_wrap card_list_head">', row + '<div class="card_wrap card_list_head">'), cwipConfig, 14)).toBe(false);
    }
  });
  it("위치 표시나 목록 껍데기가 없거나 페이지가 잘못되면 보류한다", () => {
    expect(isProvenCwipEnd(empty(14).replace('id="list_type"', 'id="other"'), cwipConfig, 14)).toBe(false);
    expect(isProvenCwipEnd(empty(14).replace('<strong>14/13</strong>', ''), cwipConfig, 14)).toBe(false);
    for (const page of [undefined, 0, -1, 14.5, NaN, Infinity]) expect(isProvenCwipEnd(empty(14), cwipConfig, page)).toBe(false);
  });
});
