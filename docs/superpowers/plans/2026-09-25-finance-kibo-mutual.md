# 자금 조달 지도 — 금융상품 2차: 기술보증기금·신협·새마을금고 (2026-09-25)

설계자: Opus 총괄(세션 fda9e647). 사장님 「전부 다 이어서 진행」(2026-09-25). 1차 설계서 `2026-09-24-finance-guarantee-sources.md` 의 **공통 규칙 1~10을 그대로 따른다**(값 원문 그대로·못 읽으면 빈 값·순수 파서/네트워크 분리·node-html-parser 만·반쪽 응답 throw). 대상 조건은 `guarantee-target.ts` `guaranteeTargetRules`(대상 글 없으면 「읽지 못함」 확인 항목 — 절대 맞음이 나오지 않게), 한도 숫자는 `guarantee-limit.ts` `firstLimitWon`.

| id | 기관 | 주소 | 고정본(2026-09-25 01시 KST GET) |
|---|---|---|---|
| `product-kibo` | 기술보증기금 | 목록 `https://www.kibo.or.kr/main/work/work01030101.do`, 상세 `…/main/work/work0106NN.do` 등 | `kibo-list.html`, `kibo-detail-010901.html`, `kibo-detail-010601.html` |
| `product-cu` | 신협중앙회 | 목록 `https://www.cu.co.kr/cu/ad/fnncGoods/selectFnncGoodsLonList.do?mi=100244`, 상세 `…/selectFnncGoodsLonInfo.do?fnncGoodsSn=N` | `cu-list.html`, `cu-detail-{95,76,70}.html` |
| `product-kfcc` | 새마을금고중앙회 | `https://www.kfcc.co.kr/html/goods/popup/goods0217.html` | `kfcc-goods0217.html` |

robots.txt: kibo 는 Googlebot 대상 `/main/board/` 등만 금지(상품 쪽 허용), cu·kfcc 는 robots 없음(307). 요청은 한 번에 하나씩.

## §E 기술보증기금 (`product-kibo`)
- 목록: `kibo-list.html` 안 `a[href]` 중 경로가 정확히 `/main/work/work01(05|06|07|08|09)\d{2}\.do` 인 것(숫자 6자리 — `work01050103` 같은 8자리 안내 쪽은 제외), 경로로 중복 제거, 이름은 그 a 글자(엔티티 풀고 공백 정리, 빈 글자 링크는 같은 경로의 다른 a 에서). 고정본 기준 21개(재기 3·창업 8·기업 4·R&D·IP·녹색 3·일자리·4차 3).
- 상세: 각 쪽 GET. 이름은 `h2.sec-title`, 대상 글은 `div#cms-content` 글자 전체(공백 한 칸, 자르지 않음). 본문을 못 읽으면 keepExisting.
- institution "기술보증기금", institutionType/productType/fundingGroup "guarantee", region 없음, channel "기술보증기금 영업점·디지털지점", 한도·금리·기간 빈 값/null(서술형이라 숫자로 옮기지 않는다), deadlineText "상시".
- 최소 15건 미만이면 throw.

## §F 신협 (`product-cu`)
- 목록: `cu-list.html` 의 `fn_selectFnncGoods('N')` 상품 중 **이름이 사업자 대상인 것만**: 제목에 「사업자|자영업|소상공인|개인사업」 포함. 고정본 기준 3개(95 소상공인지원대출금·76 자영업자스피드대출금·70 VAN사업자대출금). 목록 a 의 title 속성이 상품 이름.
- 상세: `…?fnncGoodsSn=N`. ★주석(`<!-- … -->`) 안에 옛 설명 블록이 있다 — 주석은 읽지 않는다(node-html-parser 기본 parse 는 주석을 버린다: 그대로 쓰되 시험으로 확인). 살아 있는 `ul.info_list` 의 `li > strong`(칸 이름)과 뒤따르는 `ul.list_stT1` 글자(값).
- 칸 대응: 대출대상→targetText, 대출한도→limitText(+firstLimitWon), 대출기간→termText, 대출금리→rateText(rateMin 은 extractRate — 「기준금리+가산금리」처럼 숫자가 없으면 null), 상환방법→feeText 아님(쓰지 않음).
- ★「신협별로 조건이 다르다」: humanCheck 에 대상 글 항목과 함께 **「실제 취급 여부·조건은 신협 조합마다 다름 — 가까운 조합에 확인」** 한 항목을 항상 더한다.
- institution "신협", institutionType "bank", productType: 상품유형 칸이 「신용」이면 "credit" 아니면 "", fundingGroup "bank", channel "가까운 신협 조합", region 없음. 최소 2건.

## §G 새마을금고 (`product-kfcc`)
- 한 쪽 GET(`goods0217.html`). 이름은 `h1.tit_popup` 글자에서 끝의 「상세설명」 제거(「사장님드림UP대출」). `h3.con_title02`(칸 이름) 뒤따르는 `p.con_title03` 들(값, 여러 개면 공백으로 이어 붙임).
- 칸 대응: 신청대상→targetText, 대출한도→limit, 대출기간→termText, 대출금리→rateText.
- humanCheck 에 「실제 조건은 새마을금고마다 다름 — 가까운 금고에 확인」 항목을 항상 더한다.
- institution "새마을금고", institutionType "bank", productType "credit", fundingGroup "bank", channel "가까운 새마을금고", region 없음. 이름·대상이 안 잡히면 throw(1건짜리 원천이라 반쪽 판단이 곧 전부).

## §H 등록
- registry.ts PRODUCT_SOURCES 끝에 「// ── 2026-09-25 금융 2차 ──」 kiboSource·cuSource·kfccSource, registry.test.ts 14개.
- source-directory.ts product-gcgf 줄 뒤 세 줄(label: 「기술보증기금 보증상품」「신협 사업자대출」「새마을금고 사업자대출」, status candidate, note 「상시 상품 어댑터」).
- FundingDrawer.tsx PRODUCT_SOURCE_LABEL: 기술보증기금·신협·새마을금고.
- ERP 시험 출처 목록은 총괄이 핀 올릴 때.

## 완료 기준
1. 어댑터 3개·시험 3개, vitest·tsc 0.
2. kibo 고정본 목록 21개·8자리 안내 쪽 없음, 010901 대상 글에 「상시근로자」 포함; cu 3개(이름 정확), 주석 속 옛 문구(「1인당 7천만원 이내」 — 옛 블록)가 아니라 살아 있는 값(「최대 1인당 7천만원」) 사용, 모두 조합 안내 확인 항목; kfcc 1개 「사장님드림UP대출」 한도 60,000,000.
3. 대상 글 못 읽으면 「읽지 못함」 확인 항목 + keepExisting(세 곳 모두 시험).
