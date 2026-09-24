# 자금 조달 지도 — 보증 상품 출처 3곳 추가 (2026-09-24)

설계자: Opus 총괄(세션 fda9e647). 사장님 요청 「금융상품 연결」(2026-09-24)의 1차분.

## 목표
상시 상품 수집기(`src/collect/products/sources/`)에 보증 상품 원천 3곳을 붙인다.
기존 어댑터(`kinfa.ts`·`kosmes.ts`)와 같은 모양·같은 방어선(`fetchProductText`)을 쓴다.

| id | 기관 | 목록 주소 | 고정본 |
|---|---|---|---|
| `product-ksure` | 한국무역보험공사 | `https://www.ksure.or.kr/rh-kr/index.do` | `__fixtures__/ksure-index.html`, `__fixtures__/ksure-detail-i165.html` |
| `product-seoulshinbo` | 서울신용보증재단 | `https://www.seoulshinbo.co.kr/wbase/contents.do?mng_cd=<탭>` 6탭 | `__fixtures__/seoulshinbo-BUSI{2346,4617,4763,5337,5388,5389}.html` |
| `product-gcgf` | 경기신용보증재단 | `https://www.gcgf.or.kr/gcgf/cm/conts/contsView.do?mi=1051&contsId=1022` | `__fixtures__/gcgf-products-1051.html` |

고정본은 2026-09-24 13:00 KST 실사이트 GET 원본이다(robots.txt 허용 확인: ksure 전체 허용, 서울신보 `User-agent: *` 는 `/apple/` 만 금지, 경기신보 Googlebot 대상 `/cms`·`/system` 만 금지).
**빼는 곳:** 신보중앙회 「해드림」(koreg) — robots.txt 가 `/*/gu/gurt/` 를 금지. 신용보증기금(kodit)·지역농협 — 상품 단위 자료 없음.

## 공통 규칙 (세 어댑터 모두)
1. 값은 원문 그대로. 못 읽으면 빈 값/null — 지어내지 않는다(kinfa.ts 머리 주석과 같은 원칙).
2. `fundingGroup: "guarantee"`, `institutionType: "guarantee"`, `productType: "guarantee"`, `deadlineText: "상시"`.
3. **정확도 원칙:** 대상 글(지원대상/대상기업)은 기계 조건으로 풀지 않는다. 대상 글 전체를 `targetText` 에 두고, `targetRules.humanCheck = [대상 글.slice(0, 80)]` 로 넣어 판정이 「확인 필요」가 되게 한다(대상 글이 비면 humanCheck 없음). 지역만 기계 조건: 서울신보 `region: ["서울"]`, 경기신보 `region: ["경기"]`, 무역보험 지역 없음.
4. 한도: 서울신보·경기신보는 `guarantee-limit.ts` `firstLimitWon`(글에 처음 나오는 금액 = 대표 한도)을 `limitMaxWon` 으로(금액 원문은 `limitText` 에 그대로). 공용 `extractAmount` 는 가장 큰 금액을 골라 「3천만원(기보증 포함 5천만원)」을 5천만원으로 적었다(2026-09-24 실사이트 대조). 금리: `extractRate(금리 원문)` 의 `rateMin` 만(`rateMax: null`). 보증료는 `feeText`, 기간은 `termText`, 신청방법·대출은행은 `channel`.
5. `sourceId`: 상품 이름에서 공백·괄호를 지운 값(kinfa.ts `idPart` 와 같은 규칙).
6. 같은 이름이 두 번 나오면 첫 것만(경기신보 고정본은 menu00·menu02 가 같은 상품).
7. `raw` 에는 파싱에 쓴 원문 칸(라벨→값 사전)과 원천 주소만.
8. 반쪽 응답 막기: 파싱 결과가 최소 개수 미만이면 던진다 — ksure 5, 서울신보 6, 경기신보 5.
9. 순수 파서(`parseXxx(html...)`)와 네트워크 함수(`fetchXxxAll`)를 나눈다. 시험은 `vi.mock("../fetch")` 로 고정본만 쓴다.
10. HTML 파싱은 이미 의존하는 `node-html-parser` 만 쓴다. 새 라이브러리 금지.

## §A 한국무역보험공사 (`product-ksure`)
- 목록: index.html 의 「사업안내」 메뉴에서 **「신용보증」 묶음의 하위 링크만** 상품으로 삼는다(고정본 기준 5개: 수출신용보증(선적전)·(다이렉트-선적전)·(선적후)·(매입)·(포괄매입)). 단기성·중장기성·환변동·수입보험은 수출 손실을 메우는 보험이지 돈을 구하는 상품이 아니라 뺀다(자금 조달 지도 대상 아님 — 설계 결정).
  링크는 `/rh-kr/cntnts/i-NNN/dir.do` — 상세 주소는 `https://www.ksure.or.kr` + 그 경로.
- 상세: 각 상품 `dir.do` 를 GET(302 를 따라 `i-(NNN+1)/web.do` 제도개요 본문). 본문 글자에서 제목 「제도개요」 뒤 ~ 「본 안내는 무역보험」 앞까지를 `targetText`(공백 한 칸으로, 최대 600자). 상세를 못 받은 상품은 `keepExisting: true` 로 목록 값만 낸다(types.ts 주석).
- 상세 요청은 **한 번에 하나씩 순서대로**(동시 요청 금지).
- institution "한국무역보험공사", channel "K-SURE 영업점·K-SURE ON", 한도·금리 원문 없음 → 빈 값/null.

## §B 서울신용보증재단 (`product-seoulshinbo`)
- 탭 6개(`BUSI2346`·`BUSI4617`·`BUSI4763`·`BUSI5337`·`BUSI5388`·`BUSI5389`)를 순서대로 GET.
- **PC 표만 읽는다:** `div.info_table_box.for_web` 안의 `table`. 모바일 블록(`toggle_wrap for_mob`)은 PC 표와 금액이 다른 옛 글이 있어 읽지 않는다(고정본 BUSI5337: PC 5천만원, 모바일 3천만원).
- 표 모양: `thead th[scope=col]` 첫 칸 「구분」 뒤가 **상품 이름들(열)**, `tbody tr` 첫 `td` 가 칸 이름(대상기업·보증조건·보증한도·보증기간·보증비율·보증료·보증상대처·대출금리), 나머지 `td` 가 열별 값. `colspan="2"` 인 칸은 모든 상품 열에 같은 값.
- 칸 대응: 대상기업(+보증조건 있으면 뒤에 이어 붙임)→targetText/humanCheck, 보증한도→limit, 보증기간→termText, 보증료→feeText, 대출금리→rate, 보증상대처→channel(없으면 "서울신용보증재단 지점·모바일 앱").
- 고정본 기준 상품 9개(BUSI2346 표 2·4617 1·4763 2·5337 한 표에 열 2·5388 1·5389 1). detailUrl 은 그 탭 주소.

## §C 경기신용보증재단 (`product-gcgf`)
- 한 쪽 GET. `div.menuBox` 마다 `h3.tit1` 이 상품 이름, 그 안 첫 표의 `tr > th` 가 칸 이름, 같은 줄 `td` 가 값.
- 칸 대응: 지원대상→targetText/humanCheck, 지원한도→limit, 대출기간→termText, 보증료율→feeText, 대출금리 또는 융자금리→rate, 신청방법+대출은행→channel(「신청: … / 은행: …」).
- 지원대상 칸 안에 들어 있는 부속 표 글(「…정보를 포함한 표입니다」 같은 caption)은 targetText 에서 지운다(caption 요소 제외).
- 표가 없는 menuBox 는 상품으로 내지 않는다 — 고정본 menu05 「경기도 소상공인지원자금」은 다른 쪽(mi=1079)으로 가는 단추뿐이다(그 쪽 연결은 후속).
- 표는 menuBox 의 **첫 표의 바깥 tbody 직계 tr** 만 읽는다(지원대상 칸 안의 부속 표·뒤따르는 세부 요건 표는 줄로 읽지 않는다).
- 이름 중복 제거 뒤 고정본 기준 상품 7개. detailUrl 은 목록 주소 + `#menuNN`.

## §D 등록 (마지막 묶음)
- `registry.ts` `PRODUCT_SOURCES` 에 세 어댑터 추가, `registry.test.ts` 목록 갱신(11개).
- `src/funding/source-directory.ts` 카카오뱅크 줄 뒤에 세 줄 추가(status "candidate", note "상시 상품 어댑터").
- `src/ui/FundingDrawer.tsx` `PRODUCT_SOURCE_LABEL` 에 세 이름표(한국무역보험공사·서울신용보증재단·경기신용보증재단).
- ERP 쪽 시험(`source-directory.test.ts`·`sync.test.ts`)의 출처 목록은 ERP 핀 올릴 때 총괄이 고친다.

## 완료 기준
1. 세 어댑터와 시험 파일 존재, `npx vitest run src/collect/products` 전부 통과, `npx tsc --noEmit` 0.
2. 시험이 고정본으로 확인: ksure 5건·이름 5개 정확, 보험 상품 0건, 상세 targetText 에 「연대보증」 포함; 서울신보 9건, 창업자금 특별보증 limitText 에 「5천만원」 포함·「3천만」 없음, 전 상품 region ["서울"]; 경기신보 7건·이름 중복 없음·「경기도 소상공인지원자금」 없음, 기후위기 특별보증 feeText 「연 0.8%」, 전 상품 region ["경기"].
3. 최소 개수 미만이면 fetchXxxAll 이 던진다(시험 있음). ksure 상세 한 건 실패 시 그 상품만 keepExisting(시험 있음).
4. 모든 상품 humanCheck 1개 이상(대상 글이 있는 경우) — 대상 글만으로 「맞음」이 나오지 않는다.
