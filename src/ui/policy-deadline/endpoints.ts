/**
 * 정책별 고객사·연락 예정 화면이 **앱마다 다르게 받는 통로 주소** — `ui/policy/endpoints.ts` 와 같은 규칙이다.
 *
 * 이 폴더의 부품 안에는 「어느 앱인지」를 묻는 코드가 한 줄도 없다. 부를 주소는 전부 여기 모양으로 **받는다**:
 *   · `read`     — GET. 목록·묶음·연락 예정·업체·요약(`?view=list｜bucket｜contacts｜company｜summary`). 필수.
 *   · `progress` — POST. 「업무 현황에 추가」. 필수.
 *   · `export`   — GET `?view=export` 엑셀 줄. **없으면 「엑셀 내려받기」 단추를 그리지도, 부르지도 않는다.**
 *   · `dismiss`  — POST. 「해당 없음」 남기기·되돌리기. **없으면 「해당 없음」 단추를 그리지도, 부르지도 않는다.**
 *
 * ★쓰는 쪽 주의: `endpoints` 는 **모듈 상수 하나**로 넘겨라 — 그리는 자리에서 객체를 새로 만들면 화면이 매번 다시 읽는다.
 */
export type DeadlineEndpoints = {
  read: string;
  progress: string;
  export?: string;
  dismiss?: string;
};

/**
 * 두 앱의 통로 주소가 같다(`GET·POST /api/policy-track/deadline`) — 엑셀 줄은 앱이 `export` 를,
 * 「해당 없음」은 통로(`readDismissBody` → `setDeadlineDismiss`)를 만든 앱이 `dismiss: DEADLINE_DISMISS_ENDPOINT` 를 더해 켠다.
 */
export const DEADLINE_ENDPOINTS: DeadlineEndpoints = {
  read: "/api/policy-track/deadline",
  progress: "/api/policy-track/deadline/progress",
};

/** 「해당 없음」 통로 주소 — 기본 통로에 넣지 않는다(통로가 없는 앱에서 단추가 그려져 누를 때마다 저장 실패가 나지 않게). */
export const DEADLINE_DISMISS_ENDPOINT = "/api/policy-track/deadline/dismiss";

/** 「다시 맞추기」 통로 주소 — 상세창을 닫을 때 앱 화면이 부른다(`readRematchBody` → `requestDeadlineRematch`). 공용 화면 부품은 부르지 않는다. */
export const DEADLINE_REMATCH_ENDPOINT = "/api/policy-track/deadline/rematch";

/** 엑셀로 저장할 표 한 장 — 화면이 줄을 만들어 앱의 `features.saveSheet` 에 넘긴다. */
export type DeadlineSheet = {
  fileName: string;
  sheetName: string;
  headers: string[];
  body: (string | number)[][];
};

/**
 * 앱마다 있고 없는 기능 — 없으면 그 단추는 그리지도 않는다(`endpoints.export` 와 같은 규칙).
 *   · `saveSheet` — 표 한 장을 엑셀 파일로 저장한다(ERP 는 `downloadSheet`).
 *     「엑셀 내려받기」는 `endpoints.export` 와 이 함수가 **둘 다** 있어야 그려진다.
 */
export type DeadlineFeatures = {
  saveSheet?: (sheet: DeadlineSheet) => Promise<void>;
};
