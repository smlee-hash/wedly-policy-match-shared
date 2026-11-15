/**
 * 원문에서 **지워진 공고**라고 사이트가 직접 알려 줄 때 상세 조달(`detailFetch`)이 던지는 오류.
 *
 * 왜 따로 두나(NO.486, 2026-11-15 실측): 성남산업진흥원은 지운 공고를 열면 본문 칸 없이
 * `alert("게시된 공고문이 없거나 삭제되었습니다.")` 만 든 「오류」 화면을 준다. 예전엔 이것도 빈 글(`""`)이라
 * 「게시판 상세 채움 실패」로 남았고, 다시 열어도 늘 같은 화면이라 실패에서 못 나왔다.
 * 빈 글은 그대로 실패다(선택자가 낡았을 수 있다). **사이트가 삭제를 알려 준 경우만** 이 오류로 가른다 —
 * 상세 채움(`fillBoardDetail`)이 받아 공고를 마감한다.
 *
 * 반환 모양(`Promise<string>`)을 넓히지 않고 던지는 까닭: 여러 게시판의 시험이 반환값을 글자로 바로 쓴다.
 * `readBoardDetail` 밖으로는 나가지 않는다(그 안에서 `{ kind: "fail", gone: true }` 로 바꾼다).
 */
export class BoardDetailGoneError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "BoardDetailGoneError";
  }
}
