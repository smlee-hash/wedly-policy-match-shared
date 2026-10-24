// HML(한글 XML 문서, `<HWPML>`) 본문 글자를 뽑는다.
// 2026-10-01 운영 실측: 해양수산부 첨부 198개가 `.hml` 이라 형식을 몰라 하나도 못 읽었다.
// 본문 글자는 `<BODY>` 안 `<CHAR>` 에만 있다(머리 `<HEAD>`·꼬리 `<TAIL>` 은 모양 정의·그림 바이트).
// 바깥 XML 파서 없이 한 번 훑는다 — 일부러 만든 나쁜 파일도 선형 시간에 끝나야 해서
// 위치 찾기는 indexOf·startsWith 로만 하고, 큰 글자에 되돌아가는 정규식은 쓰지 않는다.
// DOCTYPE 의 ENTITY 는 펼치지 않는다(바깥 파일 읽기 막기) — 다섯 이름과 숫자 표기만 푼다.
import iconv from "iconv-lite";

const NAMED_ENTITIES = new Map([
  ["lt", "<"],
  ["gt", ">"],
  ["amp", "&"],
  ["quot", '"'],
  ["apos", "'"],
]);
const ENTITY = /&(#[xX][0-9A-Fa-f]+|#[0-9]+|[A-Za-z]+);/g;
const MAX_CODE_POINT = 0x10ffff;
const HEAD_BYTES = 200;
const KOREAN_LEGACY_ENCODING = /^(?:euc-?kr|ks_c_5601|cp949|x-windows-949|uhc)/;
const XML_DECLARATION_ENCODING = /^\s*<\?xml[^>]*?encoding\s*=\s*["']([^"']+)/;

function decodeEntities(text: string): string {
  if (text.indexOf("&") < 0) return text;
  return text.replace(ENTITY, (whole, g: string) => {
    if (g.charCodeAt(0) === 35) {
      const hex = g.charCodeAt(1) === 120 || g.charCodeAt(1) === 88;
      const n = hex ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return n <= MAX_CODE_POINT ? String.fromCodePoint(n) : whole; // 범위 밖·못 읽는 수는 그대로
    }
    return NAMED_ENTITIES.get(g) ?? whole;
  });
}

function decodeBytes(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString("utf8");
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return iconv.decode(buf.subarray(2), "utf-16be");
  const head = buf.subarray(0, HEAD_BYTES).toString("latin1");
  const declared = XML_DECLARATION_ENCODING.exec(head)?.[1]?.toLowerCase() ?? "utf-8";
  if (KOREAN_LEGACY_ENCODING.test(declared)) return iconv.decode(buf, "cp949");
  return buf.toString("utf8");
}

function isNameStart(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95; // A-Z a-z _
}

function isNameChar(c: number): boolean {
  return isNameStart(c) || (c >= 48 && c <= 57) || c === 58 || c === 46 || c === 45; // 0-9 : . -
}

/** `<BODY …>` 와 `</BODY>` 사이. 못 찾으면 null. */
function bodyOf(s: string): string | null {
  if (!/<HWPML\b/i.test(s)) return null;
  const open = /<BODY\b/i.exec(s);
  if (!open) return null;
  const gt = s.indexOf(">", open.index + open[0].length);
  if (gt < 0) return null;
  const closeRe = /<\/BODY>/gi;
  closeRe.lastIndex = gt + 1;
  const close = closeRe.exec(s);
  if (!close) return null;
  return s.slice(gt + 1, close.index);
}

/** 줄 끝 공백·탭을 지운다 — 줄마다 끝에서부터 센다(정규식 `[ \t]+$` 는 공백이 긴 줄에서 제곱 시간이 된다). */
function trimLineEnds(text: string): string {
  const lines = text.split("\n");
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k];
    let end = line.length;
    while (end > 0 && (line.charCodeAt(end - 1) === 32 || line.charCodeAt(end - 1) === 9)) end--;
    if (end < line.length) lines[k] = line.slice(0, end);
  }
  return lines.join("\n");
}

/**
 * HML 본문 글자. `</P>` → 줄, `<TAB/>` → 탭, `<LINEBREAK/>` → 줄, `<FWSPACE/>`·`<HWSPACE/>`·`<NBSPACE/>` → 띄어쓰기.
 * 형식이 아니거나 본문이 없으면 빈 글자를 돌려준다. 던지지 않는다.
 */
export function extractHmlText(buf: Buffer): string {
  try {
    const body = bodyOf(decodeBytes(buf));
    if (body === null) return "";
    const out: string[] = [];
    let depth = 0; // <CHAR> 안에 있는 동안만 글자를 모은다
    let i = 0;
    const n = body.length;
    while (i < n) {
      const lt = body.indexOf("<", i);
      if (lt < 0) {
        if (depth) out.push(decodeEntities(body.slice(i)));
        break;
      }
      if (lt > i && depth) out.push(decodeEntities(body.slice(i, lt)));
      if (body.startsWith("<!--", lt)) {
        const end = body.indexOf("-->", lt + 4);
        if (end < 0) break;
        i = end + 3;
        continue;
      }
      if (body.startsWith("<![CDATA[", lt)) {
        const end = body.indexOf("]]>", lt + 9);
        if (end < 0) break;
        if (depth) out.push(body.slice(lt + 9, end));
        i = end + 3;
        continue;
      }
      const gt = body.indexOf(">", lt + 1);
      if (gt < 0) break;
      const inner = body.slice(lt + 1, gt);
      i = gt + 1;
      const close = inner.charCodeAt(0) === 47;
      const nameStart = close ? 1 : 0;
      if (!isNameStart(inner.charCodeAt(nameStart))) continue;
      let nameEnd = nameStart + 1;
      while (nameEnd < inner.length && isNameChar(inner.charCodeAt(nameEnd))) nameEnd++;
      const name = inner.slice(nameStart, nameEnd).toUpperCase();
      const selfClosing = inner.endsWith("/");
      if (name === "CHAR") {
        if (selfClosing) continue;
        depth = close ? Math.max(depth - 1, 0) : depth + 1;
        continue;
      }
      if (depth) {
        if (!close) {
          if (name === "TAB") out.push("\t");
          else if (name === "LINEBREAK") out.push("\n");
          else if (name === "FWSPACE" || name === "HWSPACE" || name === "NBSPACE") out.push(" ");
        }
        continue;
      }
      if (close && name === "P") out.push("\n");
    }
    const text = out.join("").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    return trimLineEnds(text).replace(/\n{3,}/g, "\n\n").trim();
  } catch {
    return "";
  }
}
