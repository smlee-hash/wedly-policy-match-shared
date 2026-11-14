/**
 * 한국 날짜 — UTC 시각에 9시간을 더해 UTC 칸을 읽는다(ERP `alimtalk/schedule.ts` 의 kstParts·kstDateKey 와 같은 계산).
 * 마감일·오늘 날짜를 어느 서버 시간대에서도 같게 만들려고 시간대 라이브러리 대신 이 계산을 쓴다.
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** KST 달력의 연/월/일 추출 */
export function kstParts(d: Date): { y: number; m: number; day: number } {
  const kst = new Date(d.getTime() + KST_OFFSET_MS);
  return { y: kst.getUTCFullYear(), m: kst.getUTCMonth() + 1, day: kst.getUTCDate() };
}

/** KST 날짜 키 "YYYY-MM-DD" */
export function kstDateKey(d: Date): string {
  const { y, m, day } = kstParts(d);
  return `${y}-${pad2(m)}-${pad2(day)}`;
}
