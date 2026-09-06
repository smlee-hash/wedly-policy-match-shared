/**
 * 목록이 **서버에서 잘라 보낸 제목**을 상세의 온전한 제목으로 승격한다.
 *
 * 왜 있나(2026-09-05 안양산업진흥원 실측): aca.or.kr 목록은 제목을 20자에서 자르고 `...` 를
 * 붙여 보낸다 — 50행 중 50행 전부. 앵커에 `title` 속성도 없어(gtp 가 쓴 탈출구) 목록만으로는
 * 온전한 제목을 얻을 길이 없다. 그대로 저장하면
 *  · `dedupKeyOf({title, agency})`(패키지 `engine/types.ts`)가 기업마당의 같은 공고와 갈려
 *    **영영 안 묶인다** — 뒤 글자가 통째로 없으니 기호 정규화로도 못 붙인다.
 *  · 갈래·한도(`classifyWedlyCategory`·`fundingFieldsOf`)가 제목 뒷부분을 못 본다
 *    (「… 유통망 입점 지원사업」의 뒤 절반이 사라진다).
 *
 * ★**접두어 관계일 때만** 승격한다. 상세 선택자가 틀려 페이지 제목·기관명 같은 엉뚱한 글자를
 *  집어 오는 날 그걸 그대로 제목으로 덮으면 그 공고가 통째로 다른 공고가 된다 — 잘린 제목보다
 *  훨씬 나쁘다. 그래서 「상세가 목록의 잘린 앞부분으로 **시작**하고, 더 길다」를 둘 다 만족할
 *  때만 값을 내고, 그 밖은 전부 null(= 건드리지 마라)이다.
 */

/** 목록 제목 끝의 말줄임. 사이트마다 `...`·`…`·`..` 로 갈린다. */
const ELLIPSIS = /(?:\.{2,}|…)+\s*$/;

/** 눈에 안 보이는 차이를 지운다 — 공백 종류·개수는 목록과 상세가 다를 수 있다(안양 실측: 상세는 두 칸). */
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * 제목이 아직 **잘린 상태**인가(말줄임으로 끝나고 앞부분이 남아 있다).
 *
 * 왜 필요한가(2026-09-05 독립 검사): 승격은 상세를 한 번 열어야 일어나는데, 그 전까지
 * 저장되는 제목은 **20자에서 잘린 앞부분**이다. 그 상태로 `dedupKeyOf(제목+기관)` 를 쓰면
 * 앞 20자가 같은 서로 **다른 공고들**(「2026년 안양시 유망기업 …」로 시작하는 여러 사업)이
 * 한 열쇠로 뭉쳐 결과 목록에서 한 줄로 접힌다. 그래서 잘린 동안에는 줄마다 유일한
 * 임시 열쇠를 쓰고, 승격되면 정상 열쇠로 돌아간다.
 */
export function isTruncatedTitle(title: string): boolean {
  const t = squash(title);
  if (!t || !ELLIPSIS.test(t)) return false;
  return t.replace(ELLIPSIS, "").trim().length > 0;
}

/**
 * 잘린 목록 제목을 상세의 온전한 제목으로 승격할 수 있으면 그 제목을, 아니면 null.
 *
 * 승격 조건(전부 만족):
 *  ㉠ 목록 제목이 말줄임으로 끝나고, 말줄임을 뗀 앞부분(stem)이 비어 있지 않다
 *  ㉡ 상세 제목이 stem 으로 **시작**한다(공백을 다 지우고 견준다)
 *  ㉢ 상세 제목이 stem 보다 **길거나 같다**(같으면 원래 제목이 20자 안에 다 들어갔는데
 *    출처가 말줄임을 붙인 경우다 — 안양 sbIdx=535, 2026-09-06 실측. 이때는 말줄임만
 *    뗀 상세 제목을 그대로 승격값으로 쓴다. **짧으면** 여전히 null(건드리지 않는다).)
 *
 * @param listTitle  목록에서 뽑은 제목(잘려 있을 수 있음)
 * @param detailTitle 상세에서 뽑은 제목(접두어 `[사업안내] - ` 등은 부르는 쪽에서 이미 뗀 상태)
 */
export function upgradeTruncatedTitle(listTitle: string, detailTitle: string): string | null {
  const list = squash(listTitle);
  const detail = squash(detailTitle);
  if (!list || !detail) return null;

  // ㉠ 말줄임이 없으면 목록 제목이 온전하다는 뜻 — 상세가 접두어만 다르더라도 건드리지 않는다.
  //    (그 판단까지 여기서 하면 「제목이 실제로 바뀐 공고」를 옛 제목으로 되돌리게 된다.)
  if (!ELLIPSIS.test(list)) return null;
  const stem = list.replace(ELLIPSIS, "").trim();
  if (!stem) return null;

  // ㉡·㉢ 공백을 다 지우고 견준다 — 목록은 한 칸, 상세는 두 칸인 자리가 있다(안양 실측).
  const bare = (s: string) => s.replace(/\s+/g, "");
  const stemBare = bare(stem);
  const detailBare = bare(detail);
  if (!stemBare) return null;
  if (!detailBare.startsWith(stemBare)) return null;
  // ★같으면(정규화 후 글자까지 동일) 승격한다 — 원래 제목이 20자 안에 다 들어갔는데 출처가
  //  그래도 말줄임을 붙인 경우다(안양 sbIdx=535). **짧으면**(이론상 위 startsWith 가 이미 걸러
  //  내지만, 의도를 코드로도 남긴다) 여전히 null.
  if (detailBare.length < stemBare.length) return null;

  return detail;
}
