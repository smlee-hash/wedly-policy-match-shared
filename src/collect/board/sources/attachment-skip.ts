/**
 * 첨부 목록에서 **그림 파일은 담지 않는다**(2026-09-06 독립 리뷰 「사소」).
 *
 * 왜: 첨부 정독기(`fetchAttachmentTexts`)가 읽을 수 있는 것은 pdf·hwp·hwpx 뿐이다.
 * 그림은 내려받아도 글자가 0이라 「읽지 못한 첨부」로 적히는데, 그 한 건이 개수 상한
 * (`maxFiles` 1~2)을 차지하면 **정작 자격조건이 든 공고문(hwp)을 못 읽는다.**
 * 실물 예: 여성기업센터 nttId=1042 는 첨부 2개 중 하나가 `도보조금 지원사업_JPG.jpg` 다.
 *
 * ★공용 수확기(`harvestBoardAttachments`)는 손대지 않는다 — 30여 게시판의 저장된 목록이
 *  한꺼번에 달라지므로, 이 회차에 새로 붙이는 세 곳(POST 첨부)에서만 쓴다.
 */
const IMAGE_EXT = /\.(?:jpe?g|png|gif|bmp|webp|svg|tiff?)(?:$|[?#])/i;

/** 이름이나 주소가 그림 확장자로 끝나면 담지 않는다. */
export function isImageAttachment(name: string, url = ""): boolean {
  return IMAGE_EXT.test((name ?? "").trim()) || IMAGE_EXT.test((url ?? "").trim());
}
