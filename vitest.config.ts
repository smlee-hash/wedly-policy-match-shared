import { defineConfig } from "vitest/config";

/**
 * 시험 실행 설정 — **ERP `vitest.config.ts` 와 같은 방식**(2026-09-04 실측).
 *
 * ★왜 `jsdom` 이 아니라 `node` 인가:
 *  이 보관함이 가져오는 화면 시험(`funding-map-render`·`funding-drawer-render`)은
 *  ERP 에서 `react-dom/server` 의 `renderToStaticMarkup` 으로 **그려서 잰다** —
 *  브라우저 흉내(jsdom)가 필요 없다. 시험 파일 머리주석에도 「이 저장소엔
 *  jsdom·@testing-library/react 가 없다(2026-09-03 실측)」라고 적혀 있고,
 *  실제로 ERP `node_modules` 에 jsdom·@testing-library/react·@vitejs/plugin-react 가
 *  **하나도 없다**(2026-09-04 실측). 그래서 환경을 옮기지 않고 ERP 와 똑같이 둔다 —
 *  환경을 바꾸면 옮겨온 시험이 ERP 에서와 다르게 돌 위험만 생긴다.
 *
 * ★`.tsx` 변환은 vitest 내장 esbuild 가 `tsconfig.json` 의 `jsx: "react-jsx"` 를 보고 한다
 *  (ERP 도 플러그인 없이 `funding-map-render.test.tsx` 를 그대로 돌린다 — 같은 방식).
 *
 * ★`scripts/**` 가 include 에 함께 있는 이유(2026-09-08 리뷰 R1):
 *  자동 반영 봇(`scripts/propagate/*`)의 시험은 **`src/` 에 두면 안 된다.**
 *  `package.json` 의 `files` 가 `["src","certs","README.md"]` 라 `src/**` 는 앱 3곳의
 *  `node_modules/@wedly/policy-match-shared/` 안으로 그대로 들어가고, ERP `vitest.shared.config.ts`·
 *  일루아/랩 `vitest.shared-pkg.config.ts` 가 그 폴더의 `src/**\/*.test.ts` 를 **배포 관문에서 돌린다.**
 *  앱 쪽에는 `scripts/propagate/*.sh` 가 없으므로 봇 시험이 거기서 죽고 **3앱 배포가 막힌다.**
 *  그래서 봇 시험은 `scripts/propagate/__tests__/` 에 두고(포장에서 빠진다) 여기서만 돌린다.
 *  포장 목록에 다시 새지 않는지는 `scripts/propagate/__tests__/pack-excludes.test.ts` 가 실제 `npm pack` 으로 잰다.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.ts"],
  },
});
