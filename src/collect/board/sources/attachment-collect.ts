import { attachmentKindOf } from "../../../engine/types";
import type { PolicyAttachmentRequest } from "../types";
import { isImageAttachment } from "./attachment-skip";

/**
 * 게시판별 첨부 갈고리(`detailAttachments`·`detailAttachmentsAsync`)가 **함께 쓰는** 이름 정리·목록 도우미.
 *
 * 왜 따로 두나(2026-10-01 「첨부 목록 수집 누락」): 공용 수확기(`harvestBoardAttachments`)가 첨부를 못 잡던
 * 21개 게시판에 갈고리를 새로 붙인다. 이름 정리·그림 빼기·중복 제거 규칙이 갈고리마다 조금씩 다르면
 * 같은 파일이 게시판마다 다른 이름으로 저장된다. 그래서 규칙을 한곳에 둔다.
 *
 * ★공용 수확기는 손대지 않는다 — 30여 게시판의 저장된 목록이 한꺼번에 달라진다.
 *  그래서 수확기의 정리 규칙(`detail-fill.ts`)과 여기 규칙은 따로 산다.
 */

/**
 * 이름 끝의 파일 크기 표기. 실측 서식: `(304.2KB)` · `[47.9 KB]` · `(192.0K)` · `[148992 byte]` ·
 * `(파일크기: 9 MB )` · `(1,234,567 bytes)`. 공용 수확기 것과 달리 천 단위 쉼표가 여러 번 와도 지우고,
 * 이름표의 쌍점은 전각(`：`)도 받는다.
 * **이름 끝에서만** 지운다 — 이름 가운데 든 괄호(「… 4K 영상 제작(4K) 지원사업.hwp」)는 남긴다.
 */
const SIZE_TAIL = /\s*[([]\s*(?:파일\s*크기\s*[:：]\s*)?\d+(?:[.,]\d+)*\s*(?:[KMG]?B|[KMG]|bytes?)\s*[)\]]\s*$/i;
/** 이름 끝에 붙은 단추 글자. */
const ACTION_TAIL = /\s*(내려받기|다운로드|바로보기)\s*$/;

/**
 * 화면 글자를 첨부 이름으로 정리한다. 줄바꿈·연속 공백·`&nbsp;` 를 공백 하나로 접고,
 * 끝의 크기 표기·단추 글자를 지운다(「이름.pdf (12KB) 다운로드」처럼 둘이 겹쳐도 지운다).
 *
 * ★HTML 표기(`&amp;` 등)는 풀지 않는다. 해석기의 `.text`·`getAttribute()` 값은 이미 풀려 있다.
 *  원문을 정규식으로 읽은 값이면 부르는 쪽이 먼저 푼다(`html.ts` 의 `decodeHtmlEntities`).
 */
export function cleanAttachmentName(raw: string): string {
  let t = raw.replace(/ /g, " ").replace(/\s+/g, " ").trim();
  // 크기·단추 글자가 서로 앞뒤로 겹친 이름이 있어 몇 번 되풀이한다.
  for (let i = 0; i < 3; i++) t = t.replace(SIZE_TAIL, "").replace(ACTION_TAIL, "").trim();
  return t;
}

/**
 * 화면 차례대로 첨부를 모으는 그릇. `add` 는 이름·주소가 비었거나 그림이면 담지 않고,
 * 같은 방법·주소·본문은 한 번만 담는다. 형식(`kind`)은 이름 → 주소 차례로 정한다.
 *
 * @param name `cleanAttachmentName` 을 거친 이름
 * @param url 절대 주소
 * @param post POST 로만 받는 첨부면 그 본문(미리 인코딩한 form 문자열)
 */
export function attachmentCollector(): {
  list: PolicyAttachmentRequest[];
  add: (name: string, url: string, post?: { body: string }) => void;
} {
  const list: PolicyAttachmentRequest[] = [];
  const seen = new Set<string>();
  const add = (name: string, url: string, post?: { body: string }) => {
    if (!name || !url || isImageAttachment(name, url)) return;
    const key = `${post ? "POST" : "GET"} ${url} ${post?.body ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    const kind = attachmentKindOf(name, url);
    list.push(post ? { name, url, kind, method: "POST", body: post.body } : { name, url, kind });
  };
  return { list, add };
}
