/**
 * 상시 상품 수집원 명부 — 어댑터(sources/*.ts)를 여기에 등록하면 12시간 회차가 알아서 돌린다.
 *
 * 계획서 2026-09-03 Task 14 로 7개 어댑터가 등록됐다(서민금융진흥원·소진공·금감원 개인사업자대출·
 * 케이뱅크·중진공·희망리턴패키지·TIPS).
 *
 * ★새 어댑터를 등록할 때 확인할 것 두 가지
 *  ① id 가 **공고 수집원 이름과 겹치면 안 된다** — 회차 장부는 단계 이름으로 「끝냈다」를 적는다.
 *    같은 이름이 둘이면 한쪽만 돌고 다른 쪽은 매 회차 통째로 건너뛰어진다. 그래서 상품 출처
 *    id·`FinanceProduct.source` 는 전부 접두어 `product-` 를 쓴다(계획서 리뷰 대장 #1 치명 —
 *    중진공은 공고 게시판이 이미 `kosmes` 라 상품 쪽은 `product-kosmes`). `sync.test.ts` 의
 *    이름 중복 시험이 잡는다.
 *  ② `source-directory.ts` 에 같은 id 로 한 줄을 적어야 현황판에 보인다(이 폴더 시험이 잡는다).
 *
 * ★`manual`(`sources/manual.ts`) 은 여기 안 싣는다 — 절대 실패하지 않는 상수 출처가 회차에
 *   하나라도 끼면 「전부 실패 되감기」 안전장치가 항상 "성공 1건 이상"으로 보여 영구히
 *   무력화된다(계획서 리뷰 대장 #4 중요). 지도 조립(`funding-map-build.ts`, Task 16)이
 *   `MANUAL_PRODUCTS` 를 상수로 직접 합친다 — 수집원 명부(`source-directory.ts`)에도 그래서
 *   이 항목만의 줄이 없다.
 */
import { prisma } from "@/lib/prisma";
import { noteFailureAndMaybeAlert, noteSuccess } from "../board/alert";
import { sendPolicyBoardAlert } from "../board/alert-slack";
import type { ProductSyncSource } from "@/lib/services/policy-match/sync";
import type { ProductSource } from "./types";
import { kinfaSource } from "./sources/kinfa";
import { sbizSource } from "./sources/sbiz";
import { finlifeSohoSource } from "./sources/finlife-soho";
import { kbankSource } from "./sources/kbank";
import { kosmesSource } from "./sources/kosmes";
import { hopeReturnSource } from "./sources/hope-return";
import { tipsSource } from "./sources/tips";
// ── P2 w6 ──
import { kakaobankSohoSource } from "./sources/kakaobank-soho";

export const PRODUCT_SOURCES: ProductSource[] = [
  kinfaSource,
  sbizSource,
  finlifeSohoSource,
  kbankSource,
  kosmesSource,
  hopeReturnSource,
  tipsSource,
  // ── P2 w6 ──
  kakaobankSohoSource,
];

/**
 * `board/registry.ts` 의 `alertStore` 와 같은 계약(`{ get(): Promise<number>; set(n): Promise<void> }`,
 * JsonCache 한 줄로 연속 실패 횟수를 센다)이되 열쇠 이름공간을 분리한 것 — 상품 출처 id 는 이미
 * `product-` 접두어로 게시판과 안 겹치지만, 실패 카운트 장부까지 굳이 같은 열쇠를 쓸 이유가 없다.
 */
function productAlertStore(id: string): { get: () => Promise<number>; set: (n: number) => Promise<void> } {
  const key = `product-alert:${id}`;
  return {
    get: async () => {
      try {
        const cached = await prisma.jsonCache.findUnique({ where: { key } });
        const v = cached?.value;
        return typeof v === "number" && Number.isFinite(v) ? v : 0;
      } catch {
        return 0;
      }
    },
    set: async (n: number) => {
      await prisma.jsonCache.upsert({
        where: { key },
        create: { key, value: n },
        update: { value: n },
      });
    },
  };
}

/**
 * 회차(`SOURCES`)에 끼워 넣을 모양으로 감싼다.
 * `clockOnly` — 수동 동기화 버튼으로는 안 돌린다. 상시 상품은 하루에 바뀌는 값이 거의 없는데
 * 원천 한 곳이 수백 건이라, 사람이 버튼을 누를 때마다 남의 서버를 긁을 이유가 없다.
 *
 * 성공/실패를 게시판 수집(`board/registry.ts`)과 같은 방식으로 `noteSuccess`/`noteFailureAndMaybeAlert`
 * 로 감싼다(계획서 리뷰 대장 #16 보통 — 상품 출처 연속 실패는 그동안 슬랙 알림이 없었다).
 * 실패는 알린 뒤에도 **그대로 다시 던진다** — `sync.ts` 의 루프가 이 오류로 `perSource.error` 를
 * 채우는 절차는 그대로 살아 있어야 한다(여기서 삼키면 회차 보고에서 실패가 사라진다).
 */
export function productSyncSources(
  sources: readonly ProductSource[] = PRODUCT_SOURCES,
): ProductSyncSource[] {
  return sources.map((s) => ({
    kind: "product" as const,
    name: s.id,
    clockOnly: true as const,
    fetchAll: async () => {
      try {
        const list = await s.fetchAll();
        try {
          await noteSuccess(s.id, { store: productAlertStore(s.id) });
        } catch {
          /* 리셋 실패는 이번 수집 성공을 막지 않는다 */
        }
        return list;
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        try {
          await noteFailureAndMaybeAlert(s.id, reason, {
            send: sendPolicyBoardAlert,
            store: productAlertStore(s.id),
          });
        } catch {
          /* 알림 실패는 원래 오류를 가리지 않는다 */
        }
        throw e;
      }
    },
  }));
}
