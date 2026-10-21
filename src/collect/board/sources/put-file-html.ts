import { decodeHtmlEntities } from "../html";
import type { PolicyAttachmentRequest } from "../types";
import { attachmentCollector, cleanAttachmentName } from "./attachment-collect";

/**
 * 대구신보·경북신보(같은 솔루션)의 첨부 — 상세 화면에 `<a>` 가 없고 `putFileHtml("<fileId>","<번호>","<이름>", …)`
 * 스크립트 호출에만 있다(2026-10-16 고정본 실측: 공용 수확기 0건). 내려받기는 `/file/readFile.tc?fileId=…&fileNo=…`.
 *
 * @param base 끝에 `/` 가 없는 사이트 주소(`https://www.dgsinbo.or.kr`)
 */
export function putFileHtmlAttachments(pageHtml: string, base: string): PolicyAttachmentRequest[] {
  const c = attachmentCollector();
  // g 정규식은 lastIndex 를 들고 다니므로 부를 때마다 새로 만든다.
  const re = /putFileHtml\(\s*"([^"]+)"\s*,\s*"(\d+)"\s*,\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pageHtml))) {
    c.add(
      cleanAttachmentName(decodeHtmlEntities(m[3])),
      `${base}/file/readFile.tc?fileId=${encodeURIComponent(m[1])}&fileNo=${m[2]}`,
    );
  }
  return c.list;
}
