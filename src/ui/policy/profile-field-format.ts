// 사업자 정보 칸의 글자 다듬기 — 화면(ProfileForm)과 시험이 같은 함수를 쓴다. 저장·통신은 없다.

/** 사업자번호 — 숫자만 받아 000-00-00000 으로 하이픈을 넣는다. 10자리가 넘으면 자른다. */
export function maskBizno(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 10);
  if (d.length > 5) return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
  if (d.length > 3) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return d;
}

/** 숫자만 받아 세 자리마다 쉼표를 넣는다. 앞의 0은 뗀다(0 하나만 있으면 남긴다). */
export function formatCount(v: string): string {
  const d = v.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return d.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 만원 단위 숫자를 사람이 읽는 말로 — 124500 → 「12억 4,500만원」, 50000 → 「5억원」, 3000 → 「3,000만원」. */
export function manwonToKorean(manwon: number): string {
  const eok = Math.floor(manwon / 10_000);
  const rest = manwon % 10_000;
  const comma = (n: number) => formatCount(String(n));
  if (eok === 0) return `${comma(manwon)}만원`;
  return rest ? `${comma(eok)}억 ${comma(rest)}만원` : `${comma(eok)}억원`;
}
