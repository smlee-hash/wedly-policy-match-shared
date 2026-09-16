/**
 * 자치 시·군·구 → 표준 시도 사전. fail 은 확신 있을 때만 낸다.
 *
 * 넣지 않는 이름:
 *  - 전국에 같은 이름이 둘 이상인 동명이구: 중구·동구·서구·남구·북구·강서구·고성군
 *  - 시도 별칭과 겹치는 광주시(경기) — 「광주」는 광주광역시 별칭
 *  - 비자치구(수원시 장안구, 창원시 진해구 등)
 *
 * 2026 행정구역: 군위군=대구. 강원·전북은 표준형 「강원」·「전북」.
 * match-engine 의 REGION_ALIASES 를 import 하면 순환이 되므로 별칭 목록은 여기 둔다.
 */

/** match-engine REGION_ALIASES 의 표준형·별칭. 어간이 이와 같으면 어간 조회를 하지 않는다. */
const SIDO_ALIAS_WORDS = new Set([
  "서울", "서울특별시", "서울시",
  "부산", "부산광역시",
  "대구", "대구광역시",
  "인천", "인천광역시",
  "광주", "광주광역시", "전남광주",
  "대전", "대전광역시",
  "울산", "울산광역시",
  "세종", "세종특별자치시",
  "경기", "경기도",
  "강원", "강원도", "강원특별자치도",
  "충북", "충청북도",
  "충남", "충청남도",
  "전북", "전라북도", "전북특별자치도",
  "전남", "전라남도",
  "경북", "경상북도",
  "경남", "경상남도",
  "제주", "제주도", "제주특별자치도",
]);

/** 시도별 자치 시·군·구. 제외 규칙 적용 후: 서울 23 · 부산 10 · 대구 4 · 인천 7 · 광주 1 · 대전 2 · 울산 1 · 경기 30 · 강원 17 · 충북 11 · 충남 15 · 전북 14 · 전남 22 · 경북 22 · 경남 17 · 제주 2. */
const BY_SIDO: Array<readonly [string, readonly string[]]> = [
  ["서울", [
    "종로구", "용산구", "성동구", "광진구", "동대문구", "중랑구", "성북구", "강북구",
    "도봉구", "노원구", "은평구", "서대문구", "마포구", "양천구", "구로구", "금천구",
    "영등포구", "동작구", "관악구", "서초구", "강남구", "송파구", "강동구",
  ]],
  ["부산", [
    "영도구", "부산진구", "동래구", "해운대구", "사하구", "금정구", "연제구", "수영구",
    "사상구", "기장군",
  ]],
  ["대구", ["수성구", "달서구", "달성군", "군위군"]],
  ["인천", ["미추홀구", "연수구", "남동구", "부평구", "계양구", "강화군", "옹진군"]],
  ["광주", ["광산구"]],
  ["대전", ["유성구", "대덕구"]],
  ["울산", ["울주군"]],
  ["경기", [
    "수원시", "성남시", "의정부시", "안양시", "부천시", "광명시", "평택시", "동두천시",
    "안산시", "고양시", "과천시", "구리시", "남양주시", "오산시", "시흥시", "군포시",
    "의왕시", "하남시", "용인시", "파주시", "이천시", "안성시", "김포시", "화성시",
    "양주시", "포천시", "여주시", "연천군", "가평군", "양평군",
  ]],
  ["강원", [
    "춘천시", "원주시", "강릉시", "동해시", "태백시", "속초시", "삼척시",
    "홍천군", "횡성군", "영월군", "평창군", "정선군", "철원군", "화천군", "양구군",
    "인제군", "양양군",
  ]],
  ["충북", [
    "청주시", "충주시", "제천시", "보은군", "옥천군", "영동군", "증평군", "진천군",
    "괴산군", "음성군", "단양군",
  ]],
  ["충남", [
    "천안시", "공주시", "보령시", "아산시", "서산시", "논산시", "계룡시", "당진시",
    "금산군", "부여군", "서천군", "청양군", "홍성군", "예산군", "태안군",
  ]],
  ["전북", [
    "전주시", "군산시", "익산시", "정읍시", "남원시", "김제시",
    "완주군", "진안군", "무주군", "장수군", "임실군", "순창군", "고창군", "부안군",
  ]],
  ["전남", [
    "목포시", "여수시", "순천시", "나주시", "광양시",
    "담양군", "곡성군", "구례군", "고흥군", "보성군", "화순군", "장흥군", "강진군",
    "해남군", "영암군", "무안군", "함평군", "영광군", "장성군", "완도군", "진도군", "신안군",
  ]],
  ["경북", [
    "포항시", "경주시", "김천시", "안동시", "구미시", "영주시", "영천시", "상주시",
    "문경시", "경산시", "의성군", "청송군", "영양군", "영덕군", "청도군", "고령군",
    "성주군", "칠곡군", "예천군", "봉화군", "울진군", "울릉군",
  ]],
  ["경남", [
    "창원시", "진주시", "통영시", "사천시", "김해시", "밀양시", "거제시", "양산시",
    "의령군", "함안군", "창녕군", "남해군", "하동군", "산청군", "함양군", "거창군", "합천군",
  ]],
  ["제주", ["제주시", "서귀포시"]],
];

export const SIGUNGU_TO_SIDO: Record<string, string> = Object.fromEntries(
  BY_SIDO.flatMap(([sido, names]) => names.map((n): [string, string] => [n, sido])),
);

/** 접미사(시/군/구)를 뗀 어간 → 유일한 사전 이름. 2글자 미만·별칭 충돌·동명이면 빼 둔다. */
const STEM_TO_NAME: Record<string, string> = (() => {
  const hits = new Map<string, string[]>();
  for (const name of Object.keys(SIGUNGU_TO_SIDO)) {
    if (!/[시군구]$/.test(name)) continue;
    const stem = name.slice(0, -1);
    if (stem.length < 2 || SIDO_ALIAS_WORDS.has(stem)) continue;
    const list = hits.get(stem);
    if (list) list.push(name);
    else hits.set(stem, [name]);
  }
  const out: Record<string, string> = {};
  for (const [stem, names] of hits) {
    if (names.length === 1) out[stem] = names[0];
  }
  return out;
})();

export function sigunguSido(value: string): { name: string; sido: string } | null {
  const t = (value ?? "").replace(/\s/g, "");
  if (!t) return null;
  const exact = SIGUNGU_TO_SIDO[t];
  if (exact) return { name: t, sido: exact };
  const fromStem = STEM_TO_NAME[t];
  if (!fromStem) return null;
  return { name: fromStem, sido: SIGUNGU_TO_SIDO[fromStem] };
}

/** 한글 음절·영문·숫자는 이름 경계가 아니다. 공백·괄호·구두점은 경계다. */
function isBoundaryChar(ch: string | undefined): boolean {
  if (ch == null || ch === "") return true;
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return false;
  if ((code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)) return false;
  return true;
}

export function sigunguInTitle(title: string): Array<{ name: string; sido: string }> {
  const text = title ?? "";
  if (!text) return [];
  const found: Array<{ name: string; sido: string; index: number }> = [];
  const seen = new Set<string>();
  for (const name of Object.keys(SIGUNGU_TO_SIDO)) {
    let from = 0;
    while (from <= text.length - name.length) {
      const i = text.indexOf(name, from);
      if (i < 0) break;
      if (isBoundaryChar(text[i - 1]) && isBoundaryChar(text[i + name.length])) {
        if (!seen.has(name)) {
          seen.add(name);
          found.push({ name, sido: SIGUNGU_TO_SIDO[name], index: i });
        }
        break;
      }
      from = i + 1;
    }
  }
  found.sort((a, b) => a.index - b.index);
  return found.map(({ name, sido }) => ({ name, sido }));
}
