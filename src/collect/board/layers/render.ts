/** ④ headless 브라우저 렌더 — 1차 미구현 자리. 실제 필요 게시판이 나오면 여기 구현.
 * 조용한 빈 배열은 검증 관문이 급락으로 오해하므로, 미구현은 명시적으로 throw 한다. */
export async function renderAndFetch(_listUrl: string): Promise<string> {
  throw new Error("headless 렌더 미지원 — render:true 게시판은 아직 셋업 필요");
}
