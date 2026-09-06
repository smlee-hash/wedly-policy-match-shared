// 게시판 명부(순서 = 회차에서 도는 순서). prisma·알림·자가수리를 부르지 않는 순수 목록이라
// 첨부 내려받기처럼 DB 없이 도는 쪽에서도 순환 없이 가져다 쓴다.
import type { BoardConfig } from "./types";
import { tpBusan } from "./sources/tp-busan";
import { tpChungnam } from "./sources/tp-chungnam";
import { ulsan } from "./sources/ulsan";
import { tpDaejeon } from "./sources/tp-daejeon";
import { tpJeonbuk } from "./sources/tp-jeonbuk";
import { jbbaConfig } from "./sources/jbba";
import { djbeaConfig } from "./sources/djbea";
import { tpGyeongbukConfig } from "./sources/tp-gyeongbuk";
import { tpGyeongnamConfig } from "./sources/tp-gyeongnam";
import { bizokConfig } from "./sources/bizok";
import { mssConfig } from "./sources/mss";
import { semasConfig } from "./sources/semas";
import { exportvoucherConfig } from "./sources/exportvoucher";
import { riiaGnConfig, riiaJnConfig } from "./sources/riia";
import { seoultpConfig } from "./sources/seoultp";
import { gepaConfig } from "./sources/gepa";
import { khidiConfig } from "./sources/khidi";
import { gcgfConfig } from "./sources/gcgf";
import { smartfactoryConfig } from "./sources/smartfactory";
import { gjtpConfig } from "./sources/gjtp";
import { cbaConfig } from "./sources/cba";
import { dgtpConfig } from "./sources/dgtp";
import { hsbizConfig } from "./sources/hsbiz";
import { cwipConfig } from "./sources/cwip";
import { bizbcConfig } from "./sources/bizbc";
import { jicaConfig } from "./sources/jica";
import { pipaConfig } from "./sources/pipa";
// 2026-09-02 연결 6곳 — 「조사 필요 8곳」 겹침 대조에서 신규가 확인된 곳만
// (근거: docs/superpowers/plans/2026-09-02-unlinked-overlap-and-connect.md)
import { cceiConfig } from "./sources/ccei";
import { seseConfig } from "./sources/sese";
import { snipConfig } from "./sources/snip";
import { kritConfig } from "./sources/krit";
import { kbizConfig } from "./sources/kbiz";
import { koreaeximConfig } from "./sources/koreaexim";

import { geriConfig } from "./sources/geri";
import { ypaConfig } from "./sources/ypa";
import { gopaConfig } from "./sources/gopa";
import { cistepConfig } from "./sources/cistep";
import { dgsinboConfig } from "./sources/dgsinbo";
import { pajuConfig } from "./sources/paju";
import { gmsbdcConfig } from "./sources/gmsbdc";
import { nyjConfig } from "./sources/nyj";
import { bssinboConfig } from "./sources/bssinbo";
import { gjsinboConfig } from "./sources/gjsinbo";
import { djsinboConfig } from "./sources/djsinbo";
import { icsinboConfig } from "./sources/icsinbo";
import { ulsinboConfig } from "./sources/ulsinbo";
import { gwsinboConfig } from "./sources/gwsinbo";
import { sjsinboConfig } from "./sources/sjsinbo";
import { gnsinboConfig } from "./sources/gnsinbo";
import { jbsinboConfig } from "./sources/jbsinbo";
import { cnsinboConfig } from "./sources/cnsinbo";
import { cbsinboConfig } from "./sources/cbsinbo";
import { jcgfConfig } from "./sources/jcgf";
import { seoulsinboConfig } from "./sources/seoulsinbo";
import { kiboConfig } from "./sources/kibo";
import { jnsinboConfig } from "./sources/jnsinbo";
import { kosmesConfig } from "./sources/kosmes";
import { dapaConfig } from "./sources/dapa";
import { gbsinboConfig } from "./sources/gbsinbo";
import { jepaConfig } from "./sources/jepa";
import { tourazConfig } from "./sources/touraz";
import { koregConfig } from "./sources/koreg";
import { koccaConfig } from "./sources/kocca";
import { jbaConfig } from "./sources/jba";
import { sjtpConfig } from "./sources/sjtp";
import { cbtpConfig } from "./sources/cbtp";
import { ptpConfig } from "./sources/ptp";
import { bepaConfig } from "./sources/bepa";
import { sbaConfig } from "./sources/sba";
import { gtpConfig } from "./sources/gtp";
import { itpConfig } from "./sources/itp";
import { jejutpConfig } from "./sources/jejutp";
import { gbsaConfig } from "./sources/gbsa";
import { ketepConfig } from "./sources/ketep";
import { kiatConfig } from "./sources/kiat";
import { smtechConfig } from "./sources/smtech";
import { gwtpConfig } from "./sources/gwtp";
import { ipetConfig } from "./sources/ipet";
import { keitiConfig } from "./sources/keiti";
import { kidpConfig } from "./sources/kidp";
import { keitConfig } from "./sources/keit";
import { kotraConfig } from "./sources/kotra";
import { atkoreaConfig } from "./sources/atkorea";
import { kitaConfig } from "./sources/kita";
import { nipaConfig } from "./sources/nipa";
import { ansanConfig } from "./sources/ansan";
import { motieConfig } from "./sources/motie";
import { kicoxConfig } from "./sources/kicox";
import { smes24Config } from "./sources/smes24";
import { cbfConfig } from "./sources/cbf";
import { sidaConfig } from "./sources/sida";
import { gipaConfig } from "./sources/gipa";
import { kodmaConfig } from "./sources/kodma";
// 2026-09-05 연결 — 국내 경유 전용(aca.or.kr 은 국내 IP 만 허용). 기업지원사업 8분류 286건.
import { acaConfig } from "./sources/aca";
// ── P2 w1 ──
import { kiriaConfig } from "./sources/kiria";
import { knrecConfig } from "./sources/knrec";
import { kimstConfig } from "./sources/kimst";
import { wfiConfig } from "./sources/wfi";
// ── P2 w2 ── 2026-09-06 연결 3곳 (첨부 POST 내려받기 · 계획서 2026-09-06-policy-lab-p2-wave.md)
import { hrdkConfig } from "./sources/hrdk";
import { koficConfig } from "./sources/kofic";
import { wbizConfig } from "./sources/wbiz";
// ── P2 w3 ── 2026-09-06 연결 5곳(거르개 중심 · 계획서 2026-09-06-policy-lab-p2-wave.md)
import { irisConfig } from "./sources/iris";
import { keadConfig } from "./sources/kead";
import { moelConfig } from "./sources/moel";
import { kfmeConfig } from "./sources/kfme";
import { kwbizConfig } from "./sources/kwbiz";
// ── P2 w4 ── 2026-09-06 연결. robots 표식: 이노비즈 `Disallow: /`(전 경로) ·
// 김해의생명 `/bbs/`(게시판 전체) · 포항소재 `/inc`(첨부 통로만) — 안양과 같은 관례로 진행.
// 메인비즈는 `Allow: /` 로 걸림돌 없음.
import { mainbizConfig } from "./sources/mainbiz";
import { innobizConfig } from "./sources/innobiz";
import { gbiaConfig } from "./sources/gbia";
import { pomiaConfig } from "./sources/pomia";
// ── P2 w5 ── 2026-09-06 연결 — 기초자치단체 계열 5곳(의정부·익산·순천·하남·수원).
import { uescConfig } from "./sources/uesc";
import { ikseConfig } from "./sources/ikse";
import { suncheonConfig } from "./sources/suncheon";
import { hanamConfig } from "./sources/hanam";
import { sscfConfig } from "./sources/sscf";
// ── P2 w6 ──
import { hespaConfig } from "./sources/hespa";
import { jbioConfig } from "./sources/jbio";
export const BOARD_SOURCES: BoardConfig[] = [
  tpBusan,
  // 2026-09-02 실측: semas·mss·dgtp·gepa 30쪽, tp-chungnam 20쪽. 값은 각 sources/*.ts
  tpChungnam,
  ulsan,
  tpDaejeon,
  // 전북TP 는 국내 IP 로만 열린다 — POLICY_BOARD_PROXY_URL 이 없으면 boardSyncSources 가 걸러낸다.
  tpJeonbuk,
  jbbaConfig,
  djbeaConfig,
  tpGyeongbukConfig,
  tpGyeongnamConfig,
  bizokConfig,
  mssConfig,
  semasConfig,
  exportvoucherConfig,
  riiaGnConfig,
  riiaJnConfig,
  seoultpConfig,
  gepaConfig,
  khidiConfig,
  gcgfConfig,
  smartfactoryConfig,
  gjtpConfig,
  cbaConfig,
  hsbizConfig,
  cwipConfig,
  bizbcConfig,
  jicaConfig,
  pipaConfig,
  dgtpConfig,
  cceiConfig,
  seseConfig,
  snipConfig,
  kritConfig,
  kbizConfig,
  koreaeximConfig,
  geriConfig,
  ypaConfig,
  gopaConfig,
  cistepConfig,
  dgsinboConfig,
  pajuConfig,
  gmsbdcConfig,
  nyjConfig,
  bssinboConfig,
  gjsinboConfig,
  djsinboConfig,
  icsinboConfig,
  ulsinboConfig,
  gwsinboConfig,
  sjsinboConfig,
  gnsinboConfig,
  jbsinboConfig,
  cnsinboConfig,
  cbsinboConfig,
  jcgfConfig,
  seoulsinboConfig,
  kiboConfig,
  jnsinboConfig,
  kosmesConfig,
  dapaConfig,
  gbsinboConfig,
  jepaConfig,
  tourazConfig,
  koregConfig,
  koccaConfig,
  jbaConfig,
  sjtpConfig,
  cbtpConfig,
  ptpConfig,
  bepaConfig,
  sbaConfig,
  gtpConfig,
  itpConfig,
  jejutpConfig,
  gbsaConfig,
  ketepConfig,
  kiatConfig,
  smtechConfig,
  gwtpConfig,
  ipetConfig,
  keitiConfig,
  kidpConfig,
  keitConfig,
  kotraConfig,
  atkoreaConfig,
  kitaConfig,
  nipaConfig,
  ansanConfig,
  motieConfig,
  kicoxConfig,
  smes24Config,
  cbfConfig,
  sidaConfig,
  gipaConfig,
  kodmaConfig,
  acaConfig,
  // ── P2 w1 ──
  kiriaConfig,
  knrecConfig,
  kimstConfig,
  wfiConfig,
  // ── P2 w2 ──
  hrdkConfig,
  koficConfig,
  wbizConfig,
  // ── P2 w3 ──
  irisConfig,
  keadConfig,
  moelConfig,
  kfmeConfig,
  kwbizConfig,
  // ── P2 w4 ──
  mainbizConfig,
  innobizConfig,
  gbiaConfig,
  pomiaConfig,
  // ── P2 w5 ──
  uescConfig,
  ikseConfig,
  suncheonConfig,
  hanamConfig,
  sscfConfig,
  // ── P2 w6 ──
  hespaConfig,
  jbioConfig,
];

/**
 * 국내 IP 로만 열리는 게시판 id(전북TP·대전신보·서울신보·세종TP).
 *
 * 여기 두는 이유: 첨부를 받는 길이 **둘**이다 — 수집 틱(`sync.fillBodiesFromAttachments`)과
 * 구조화 앞단(`structurize.ensureAttachmentText`). 한쪽에만 두면 다른 쪽이 조용히 경유를 안 탄다.
 * 이 파일은 prisma·알림을 안 부르는 순수 목록이라 어느 쪽에서 불러도 순환이 안 생긴다.
 */
export function proxyOnlySourceIds(): string[] {
  return [...new Set(BOARD_SOURCES.filter((c) => c.requiresProxy).map((c) => c.id))];
}

/**
 * 저장된 줄의 `source` 로 그 게시판 설정을 찾는다(없으면 undefined — 기업마당 등 게시판이 아닌 출처).
 * 첨부 세션 옵션을 두 갈래(수집 틱·구조화 앞단)가 같이 읽어야 해서 여기 둔다 — 이 파일은
 * prisma·알림을 안 부르는 순수 목록이라 어느 쪽에서 불러도 순환이 안 생긴다(`proxyOnlySourceIds` 와 같은 이유).
 */
export function boardConfigById(source: string): BoardConfig | undefined {
  return BOARD_SOURCES.find((c) => c.id === source);
}
