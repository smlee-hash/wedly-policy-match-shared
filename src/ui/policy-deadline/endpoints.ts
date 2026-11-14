/**
 * 정책별 고객사·연락 예정 화면이 **앱마다 다르게 받는 통로 주소** — `ui/policy/endpoints.ts` 와 같은 규칙이다.
 *
 * 이 폴더의 부품 안에는 「어느 앱인지」를 묻는 코드가 한 줄도 없다. 부를 주소는 전부 여기 모양으로 **받는다**:
 *   · `read`     — GET. 목록·묶음·연락 예정·업체·요약(`?view=list｜bucket｜contacts｜company｜summary`). 필수.
 *   · `progress` — POST. 「업무 현황에 추가」. 필수.
 *   · `export`   — GET `?view=export` 엑셀 줄. **없으면 「엑셀 내려받기」 단추를 그리지도, 부르지도 않는다.**
 *
 * ★쓰는 쪽 주의: `endpoints` 는 **모듈 상수 하나**로 넘겨라 — 그리는 자리에서 객체를 새로 만들면 화면이 매번 다시 읽는다.
 */
export type DeadlineEndpoints = {
  read: string;
  progress: string;
  export?: string;
};

/** 두 앱의 통로 주소가 같다(`GET·POST /api/policy-track/deadline`) — 엑셀 줄은 앱이 `export` 를 더해 켠다. */
export const DEADLINE_ENDPOINTS: DeadlineEndpoints = {
  read: "/api/policy-track/deadline",
  progress: "/api/policy-track/deadline/progress",
};

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
