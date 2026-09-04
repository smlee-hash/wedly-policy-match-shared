/**
 * `src/build/` — 지도 조립 층(설계서 §2). 파일은 `funding-map-build.ts` 하나뿐이다.
 *
 * 이 층이 앞의 두 층(`engine/`·`funding/`)과 다른 점은 딱 하나다: **자료를 읽어야 한다.**
 * 그래서 읽기만 인자로 뺐다(`FundingMapLoaders`, 설계서 §2-a) — 계산·판정은 두 앱이 같고
 * 어디서 읽는지만 달라서다. 이 층에도 Prisma·통로·인증은 한 줄도 없다.
 *
 * ERP 는 기존 `open-announcements.ts`(60초 캐시)를 그대로 loader 로 넘기고, 일루아는 같은
 * select 를 하는 얇은 loader 를 낸다. 상품 쪽 select 는 패키지가 `PRODUCT_SELECT` 로 계속
 * 내보내므로 두 앱이 그대로 가져다 쓰면 칸이 어긋날 자리가 없다.
 *
 * ※ 앱이 부르는 낱개 주소는 `package.json` 의 `exports` 지도에 `./build` 로 이미 있고,
 *   그 주소는 이 파일이 아니라 `./src/build/funding-map-build.ts` 를 곧바로 가리킨다.
 *   이 파일은 뿌리(`src/index.ts`)가 층을 한 줄로 모을 때(`export * from "./build";`)용이다.
 *
 * 2026-09-04 실측: 이 층이 내보내는 이름 7개(`AnnouncementRow`·`FinanceProductRow`·
 * `FundingMapLoaders`·`BuildFundingMapOptions`·`PRODUCT_SELECT`·`FundingMapResult`·
 * `buildFundingMap`)는 `engine/`·`funding/` 어느 이름과도 겹치지 않는다.
 */

export * from "./funding-map-build";
