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
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
