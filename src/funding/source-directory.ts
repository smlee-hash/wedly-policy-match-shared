import type { BoardCapRecord } from "./board/page-cap";

/**
 * 수집원 정본 명부 — 연결된 곳 + 아직 못 붙인 곳 전부.
 *
 * 왜 있나(사장님 2026-08-29): 「나중에 수집원 추가하는 거 빠지면 안 되니까」 — 후보가 문서에만
 * 있으면 잊힌다. 화면(/policy-match 현황판)이 이 명부를 그대로 그려 로드맵이 상시 보이게 한다.
 *
 * ★연결 여부는 여기 적지 않는다 — 실제 SOURCES(수집이 도는 목록)와 대조해 자동 판정한다.
 *   출처를 편입하면 화면이 저절로 「연결됨」이 되고, 명부에 그 id 를 안 적으면 시험이 막는다.
 * 근거 정본: docs/superpowers/specs/2026-08-25-policy-source-registry.md
 */
export type DirectoryStatus = "connected" | "waiting" | "candidate" | "blocked";

export interface SourceDirectoryEntry {
  /** 연결됐거나 코드가 준비된 출처의 수집 id. 조사 단계 후보는 없음. */
  id?: string;
  label: string;
  url: string;
  /** 미연결일 때의 상태(연결되면 자동으로 connected 로 덮인다). */
  status: Exclude<DirectoryStatus, "connected">;
  /** 막힌 사유·다음 행동. 연결된 곳은 빈 문자열 허용. */
  note: string;
}

export const SOURCE_DIRECTORY: SourceDirectoryEntry[] = [
  // ── 연결됨(28) — status 는 자리값일 뿐, resolveDirectory 가 connected 로 덮는다 ──
  { id: "bizinfo", label: "기업마당", url: "https://www.bizinfo.go.kr", status: "candidate", note: "" },
  { id: "work24", label: "고용24 제도", url: "https://www.work24.go.kr", status: "candidate", note: "" },
  { id: "bojo24", label: "보조금24", url: "https://www.gov.kr", status: "candidate", note: "" },
  { id: "kstartup", label: "K-Startup", url: "https://www.k-startup.go.kr", status: "candidate", note: "" },
  { id: "msit", label: "과기부 사업공고", url: "https://www.msit.go.kr", status: "candidate", note: "" },
  { id: "tp-busan", label: "부산테크노파크", url: "https://www.btp.or.kr", status: "candidate", note: "" },
  { id: "tp-chungnam", label: "충남테크노파크", url: "https://ctp.or.kr", status: "candidate", note: "" },
  { id: "ulsan", label: "울산 기업지원플랫폼", url: "https://platform.utp.or.kr", status: "candidate", note: "" },
  { id: "tp-daejeon", label: "대전테크노파크", url: "https://www.djtp.or.kr", status: "candidate", note: "" },
  { id: "jbba", label: "전북경제통상진흥원", url: "https://www.jbba.kr", status: "candidate", note: "" },
  { id: "djbea", label: "대전일자리경제진흥원", url: "https://www.djbea.or.kr", status: "candidate", note: "" },
  { id: "tp-gyeongbuk", label: "경북테크노파크", url: "https://www.gbtp.or.kr", status: "candidate", note: "" },
  { id: "tp-gyeongnam", label: "경남테크노파크", url: "https://www.gntp.or.kr", status: "candidate", note: "" },
  { id: "bizok", label: "인천 비즈OK", url: "https://bizok.incheon.go.kr", status: "candidate", note: "" },
  { id: "mss", label: "중소벤처기업부", url: "https://www.mss.go.kr", status: "candidate", note: "" },
  { id: "semas", label: "소상공인시장진흥공단", url: "https://www.semas.or.kr", status: "candidate", note: "" },
  { id: "exportvoucher", label: "수출바우처", url: "https://www.exportvoucher.com", status: "candidate", note: "" },
  { id: "riia-gn", label: "경남지역산업진흥원", url: "https://riia.or.kr", status: "candidate", note: "" },
  { id: "riia-jn", label: "전남지역산업진흥원", url: "https://jn.riia.or.kr", status: "candidate", note: "" },
  { id: "seoultp", label: "서울테크노파크", url: "https://www.seoultp.or.kr", status: "candidate", note: "" },
  { id: "gepa", label: "경상북도경제진흥원", url: "https://www.gepa.kr", status: "candidate", note: "" },
  { id: "khidi", label: "한국보건산업진흥원", url: "https://www.khidi.or.kr", status: "candidate", note: "" },
  { id: "gcgf", label: "경기신용보증재단", url: "https://www.gcgf.or.kr", status: "candidate", note: "" },
  { id: "smartfactory", label: "스마트공장 통합공고", url: "https://www.smart-factory.kr", status: "candidate", note: "" },
  { id: "gjtp", label: "광주테크노파크", url: "https://www.gjtp.or.kr", status: "candidate", note: "" },
  { id: "cba", label: "충북기업진흥원", url: "https://www.cba.ne.kr", status: "candidate", note: "" },
  { id: "dgtp", label: "대구테크노파크", url: "https://www.dgtp.or.kr", status: "candidate", note: "" },
  // 2026-09-01 연결. 겹침 0/9 · 81쪽 중 3쪽만 수집 · 접수일·마감일 제공.
  // note 는 **비워 둔다.** noteTextOf 가 note 가 있으면 그걸 돌려주고 「최근 회차 N건」을
  // 아예 안 보여준다 — 연결된 곳에 설명을 넣으면 그 수집원만 건수가 영구히 가려진다.
  // 그래서 연결된 28곳 전부 note 가 빈 문자열이다. 설명은 위 주석에만 남긴다.
  { id: "jica", label: "전주정보문화산업진흥원", url: "https://www.jica.or.kr", status: "candidate", note: "" },

  // ── 2026-09-02 연결 6곳 — 「조사 필요 8곳」을 실사이트로 열어 제목을 DB 9,565건과 대조한 결과 ──
  // 근거 정본: docs/superpowers/plans/2026-09-02-unlinked-overlap-and-connect.md
  // 겹침 15/15 중 신규 5 · 진행중 62건 · 17개 지역 센터가 한 목록에 다 나온다(center_searching 빈 값 = 전체).
  // 앞 기록 「스크립트 화면 — 실브라우저 조사 필요」는 틀렸다. business_list.json 이 본문까지 통째로 준다.
  { id: "ccei", label: "창조경제혁신센터(17곳 통합)", url: "https://ccei.creativekorea.or.kr", status: "candidate", note: "" },
  // 겹침 6건 중 신규 3 · 총 4,177건 · 최신글이 어제라 살아 있다. 예비사회적기업 지정 공모·판로·멘토링.
  { id: "sese", label: "한국사회적기업진흥원", url: "https://www.socialenterprise.or.kr", status: "candidate", note: "" },
  // 겹침 5건 중 신규 4 · 총 3,627건 · 목록이 접수기간(2026-08-31~2026-09-17)을 통째로 준다.
  { id: "snip", label: "성남산업진흥원", url: "https://www.snip.or.kr", status: "candidate", note: "" },
  // 겹침 9건 중 신규 5 · 총 567건 · 무기체계 부품국산화·국방벤처센터 협약기업처럼 여기 말고 없는 공고.
  { id: "krit", label: "국방기술진흥연구소", url: "https://www.krit.re.kr", status: "candidate", note: "" },
  // 겹침 12건 중 신규 12(전부) · 유관기관 공지 1,287건 — 남의 기관 공고를 모아 싣는 자리라 기관은 제목 대괄호에서 뽑는다.
  { id: "kbiz", label: "중소기업중앙회", url: "https://www.kbiz.or.kr", status: "candidate", note: "" },
  // 겹침 5건 중 신규 4 · 총 404건 · 사업타당성조사·기업 맞춤형 전문컨설팅 지원사업이 여기서만 나온다.
  { id: "koreaexim", label: "한국수출입은행", url: "https://www.koreaexim.go.kr", status: "candidate", note: "" },

  // ── 대기 — 코드·조사는 됐고 바깥 사정만 남음 ──
  { id: "tp-jeonbuk", label: "전북테크노파크", url: "https://www.jbtp.or.kr", status: "waiting",
    note: "국내 IP 로만 열림 — 국내 경유 서버(사장님 가입·결제) 생기면 자동 수집 전환. 코드·시험 완료, 52건 수동 적재됨" },
  { label: "사업주훈련 훈련과정 API", url: "https://www.work24.go.kr", status: "waiting", note: "키·검증 완료. 공고가 아니라 카탈로그 6.2만 건 — 별도 「훈련과정 찾기」 설계 후" },

  // ── 후보(겹침 대조 끝 — 연결만 남음) ──
  // 2026-09-01 겹침 대조: 각 사이트 최신 공고 10건이 우리 DB(기업마당·보조금24 포함)에 있는지 제목으로 대조.
  // 「겹침 N/10」이 낮을수록 그 기관 공고가 통합 수집원으로 안 들어온다는 뜻이라 직접 연결해야 한다.
  { id: "cwip", label: "창원산업진흥원", url: "https://www.cwip.or.kr", status: "candidate", note: "" },
  // 2026-09-01 연결. 겹침 0/10 이라 통합 수집원으로는 한 건도 안 들어오던 곳이다(실측 50건 수집).
  { id: "hsbiz", label: "화성산업진흥원", url: "https://www.hsbiz.or.kr", status: "candidate", note: "" },

  // ── 조사 필요 ──
  // ★2026-09-01 주소 정정. 아래 세 곳은 적혀 있던 주소가 틀려 그동안 조사 자체가 헛돌았다.
  // 적혀 있던 anyang.go.kr 은 안양시청 대표홈페이지였다(제목으로 확인). 후보 aca.or.kr 은 이름은
  // 풀리는데(27.101.104.171) 443·80 둘 다 연결 자체가 안 된다 — 전북TP 와 같은 국내 IP 전용으로 보인다.
  { label: "안양산업진흥원", url: "https://aca.or.kr", status: "waiting", note: "적힌 주소가 안양시청이라 정정. 새 주소는 이름은 풀리나 우리 쪽에서 연결 불가 — 국내 경유 필요(전북TP 와 같은 사정)" },
  // 2026-09-01 연결. 겹침 0/6. 목록은 스크립트가 아니라 ul.table li.tr 이다(주소 www.pipabiz.or.kr).
  { id: "pipa", label: "평택산업진흥원", url: "https://www.pipabiz.or.kr", status: "candidate", note: "" },
  { id: "bizbc", label: "부천산업진흥원", url: "https://www.bizbc.or.kr", status: "candidate", note: "" },
  { id: "geri", label: "구미전자정보기술원", url: "https://geri.re.kr", status: "candidate", note: "" },
  { id: "ypa", label: "용인시산업진흥원", url: "https://ybs.ypa.or.kr", status: "candidate", note: "" },
  { id: "gopa", label: "김포산업진흥원", url: "https://gopa.or.kr", status: "candidate", note: "" },
  { id: "cistep", label: "천안과학산업진흥원", url: "https://www.cistep.re.kr", status: "candidate", note: "" },
  { id: "dgsinbo", label: "대구신용보증재단", url: "https://www.dgsinbo.or.kr", status: "candidate", note: "" },
  { id: "paju", label: "파주시 기업지원 공고", url: "https://www.paju.go.kr", status: "candidate", note: "" },
  { id: "gmsbdc", label: "광명시 소상공인지원센터", url: "https://sbdc.gm.go.kr", status: "candidate", note: "" },
  { id: "nyj", label: "남양주시 기업지원 공고", url: "https://www.nyj.go.kr/www", status: "candidate", note: "" },
  { id: "bssinbo", label: "부산신용보증재단", url: "https://www.busansinbo.or.kr", status: "candidate", note: "" },
  { id: "gjsinbo", label: "광주신용보증재단", url: "https://www.gjsinbo.or.kr", status: "candidate", note: "" },
  { id: "djsinbo", label: "대전신용보증재단", url: "https://www.sinbo.or.kr", status: "candidate", note: "" },
  { id: "icsinbo", label: "인천신용보증재단", url: "https://www.icsinbo.or.kr", status: "candidate", note: "" },
  { id: "ulsinbo", label: "울산신용보증재단 자금공고", url: "https://www.ulsanshinbo.co.kr", status: "candidate", note: "" },
  { id: "gwsinbo", label: "강원신용보증재단 협약보증", url: "https://gwsinbo.or.kr", status: "candidate", note: "" },
  { id: "sjsinbo", label: "세종신용보증재단", url: "https://www.sjsinbo.or.kr", status: "candidate", note: "" },
  { id: "gnsinbo", label: "경남신용보증재단 소상공인지원", url: "https://dream.gnsinbo.or.kr", status: "candidate", note: "" },
  { id: "jbsinbo", label: "전북신용보증재단", url: "https://www.jbcredit.or.kr", status: "candidate", note: "" },
  { id: "cnsinbo", label: "충남신용보증재단", url: "https://www.cnsinbo.co.kr", status: "candidate", note: "" },
  { id: "cbsinbo", label: "충북신용보증재단", url: "https://www.cbsinbo.or.kr", status: "candidate", note: "" },
  { id: "jcgf", label: "제주신용보증재단", url: "https://jcgf.or.kr", status: "candidate", note: "" },
  { id: "seoulsinbo", label: "서울신용보증재단", url: "https://www.seoulshinbo.co.kr", status: "candidate", note: "" },
  { id: "kibo", label: "기술보증기금 공지", url: "https://www.kibo.or.kr", status: "candidate", note: "" },
  { id: "jnsinbo", label: "전남신용보증재단", url: "https://www.jnsinbo.or.kr", status: "candidate", note: "" },
  { id: "kosmes", label: "중소벤처기업진흥공단 공지", url: "https://www.kosmes.or.kr", status: "candidate", note: "" },
  { id: "dapa", label: "방위사업청 공지", url: "https://www.dapa.go.kr", status: "candidate", note: "" },
  { id: "gbsinbo", label: "경북신용보증재단", url: "https://gbsinbo.co.kr", status: "candidate", note: "" },
  { id: "jepa", label: "전남중소기업일자리경제진흥원", url: "https://www.jepa.kr", status: "candidate", note: "" },
  { id: "touraz", label: "한국관광공사 관광기업지원(touraz)", url: "https://touraz.kr", status: "candidate", note: "" },
  { id: "koreg", label: "신용보증재단중앙회 공지", url: "https://www.koreg.or.kr", status: "candidate", note: "" },
  { id: "kocca", label: "한국콘텐츠진흥원 지원사업공고", url: "https://www.kocca.kr", status: "candidate", note: "" },
  { id: "jba", label: "제주경제통상진흥원", url: "https://www.jba.or.kr", status: "candidate", note: "" },
  { id: "sjtp", label: "세종테크노파크", url: "https://sjtp.or.kr", status: "candidate", note: "" },
  { id: "cbtp", label: "충북테크노파크", url: "https://www.cbtp.or.kr", status: "candidate", note: "" },
  { id: "ptp", label: "포항테크노파크", url: "https://ptp.or.kr", status: "candidate", note: "" },
  { id: "bepa", label: "부산경제진흥원", url: "https://bepa.kr", status: "candidate", note: "" },
  { id: "sba", label: "서울경제진흥원(SBA)", url: "https://www.sba.seoul.kr", status: "candidate", note: "" },
  { id: "gtp", label: "경기테크노파크", url: "https://pms.gtp.or.kr", status: "candidate", note: "" },
  { id: "itp", label: "인천테크노파크", url: "https://itp.or.kr", status: "candidate", note: "" },
  { id: "jejutp", label: "제주테크노파크", url: "https://www.jejutp.or.kr", status: "candidate", note: "" },
  { id: "gbsa", label: "경기도경제과학진흥원", url: "https://www.gbsa.or.kr", status: "candidate", note: "" },
  { id: "ketep", label: "한국에너지기술평가원", url: "https://www.ketep.re.kr", status: "candidate", note: "" },
  { id: "kiat", label: "한국산업기술진흥원(KIAT)", url: "https://www.kiat.or.kr", status: "candidate", note: "" },
  { id: "smtech", label: "중소기업기술정보진흥원(SMTECH)", url: "https://www.smtech.go.kr", status: "candidate", note: "" },
  { id: "gwtp", label: "강원테크노파크", url: "https://www.gwtp.or.kr", status: "candidate", note: "" },
  { id: "ipet", label: "농림식품기술기획평가원", url: "https://www.ipet.re.kr", status: "candidate", note: "" },
  { id: "keiti", label: "한국환경산업기술원", url: "https://www.keiti.re.kr", status: "candidate", note: "" },
  { id: "kidp", label: "한국디자인진흥원", url: "https://www.kidp.or.kr", status: "candidate", note: "" },
  { id: "keit", label: "한국산업기술기획평가원(KEIT)", url: "https://itech.keit.re.kr", status: "candidate", note: "" },
  { id: "kotra", label: "KOTRA 사업공고", url: "https://www.kotra.or.kr", status: "candidate", note: "" },
  { id: "atkorea", label: "한국농수산식품유통공사(aT)", url: "https://www.at.or.kr", status: "candidate", note: "" },
  { id: "kita", label: "한국무역협회 지원사업", url: "https://www.kita.net", status: "candidate", note: "" },
  { id: "nipa", label: "정보통신산업진흥원(NIPA)", url: "https://www.nipa.kr", status: "candidate", note: "" },
  { id: "ansan", label: "안산시 기업지원 공고", url: "https://www.ansan.go.kr", status: "candidate", note: "" },
  { id: "motie", label: "산업통상부 공고", url: "https://www.motir.go.kr", status: "candidate", note: "" },
  { id: "kicox", label: "한국산업단지공단", url: "https://www.kicox.or.kr", status: "candidate", note: "" },
  { id: "smes24", label: "중소벤처24 사업공고", url: "https://portal.smes.go.kr", status: "candidate", note: "" },
  { id: "cbf", label: "춘천바이오산업진흥원", url: "https://www.cbf.or.kr", status: "candidate", note: "" },
  // ★2026-09-02 「조사 필요 8곳」 결론 완료. 아래는 **열어 보고 제목까지 대조한 뒤 「안 붙인다」고 정한** 곳이다.
  //   다시 조사하지 마라 — 근거는 계획서 2026-09-02-unlinked-overlap-and-connect.md 의 대조표에 있다.
  //   교훈: 「신규가 많다」와 「붙일 값어치가 있다」는 다르다. 아래 셋이 신규 건수 1·2·3등인데 내용이 지원사업이 아니었다.
  { label: "중소벤처기업유통원(구 중소기업유통센터)", url: "https://www.kodma.or.kr", status: "candidate",
    note: "기관 개칭으로 도메인 이전(sbdc.or.kr → kodma.or.kr) · 546건 · 표본 4건 겹침 100%(온라인판로·점프업·실증지원 전부 중기부·소진공으로 들어옴) — 안 붙임" },
  { label: "대한상공회의소", url: "https://www.korcham.net", status: "candidate",
    note: "열림 · 공지 1,938건이 거의 전부 상의 자체 용역 입찰이고, 목록 제목이 원문에서부터 25자에 잘려 나와 중복 대조 자체가 불가 — 안 붙임" },
  { label: "기초지자체 산하 미확인(8곳 묶음)", url: "https://www.snip.or.kr", status: "candidate",
    note: "성남은 연결함. 시흥(sida.kr)·고양(gipa.or.kr)은 열리지만 기업마당이 「[경기] …」로 이미 싣는다(겹침 3/5·4/5) · 안산·용인·김포·천안·광명·남양주·파주·청주·구미는 실주소 미확정 — 다음엔 시청 출자·출연기관 목록에서 딸 것" },
  { label: "지역 데이터포털·공공데이터포털", url: "https://www.data.go.kr", status: "candidate",
    note: "게시판이 아니라 오픈 API 카탈로그라 이 트랙으로는 못 붙인다 · 다만 「한국콘텐츠진흥원_지원사업공고」 오픈 API 가 여기 이미 열려 있다 — 아래 KOCCA 승인 대기를 이 길로 건너뛸 수 있는지 확인할 것" },

  // ── 자금 조달 지도: 상시 상품 수집원 7곳(2026-09-03 연결, Task 14) ──
  // 접수기간이 없는 돈(은행 사업자대출·정책자금·보증·서민금융·투자)이라 저장 표가 다르다
  // (PolicyAnnouncement 가 아니라 FinanceProduct). 그래서 현황판의 건수도 상품 표에서 세어 합친다
  // (`src/app/api/policy-match/sources/route.ts`).
  // 어댑터가 `products/registry.ts` 의 PRODUCT_SOURCES 에 등록돼 회차 목록(SOURCES)에 실리므로
  // 아래 7곳은 이미 **자동으로 「연결됨」**이다 — note 는 비워 둔다(다른 연결된 28곳과 같은 규칙,
  // note 가 있으면 noteTextOf 가 「최근 회차 N건」을 안 보여준다).
  // ★id 전부 접두어 `product-` — 공고 수집원(게시판·API) 이름과 절대 안 겹치게(계획서 리뷰 대장
  //  #1 치명: 중진공은 공지 게시판이 이미 `kosmes` 라 상품 쪽이 예전엔 `kosmes-fund` 였는데,
  //  접두어로 통일하며 `product-kosmes` 로 개정). 같은 이름이 둘이면 한쪽이 매 회차 통째로
  //  건너뛰어진다 — `sync.test.ts` 의 이름 중복 시험이 지킨다.
  { id: "product-kinfa", label: "서민금융진흥원 서민금융상품", url: "https://www.kinfa.or.kr", status: "candidate", note: "" },
  { id: "product-sbiz", label: "소진공 정책자금 대출조건", url: "https://ols.semas.or.kr", status: "candidate", note: "" },
  { id: "product-finlife-soho", label: "금감원 금융상품한눈에 개인사업자대출", url: "https://finlife.fss.or.kr", status: "candidate", note: "" },
  { id: "product-kbank", label: "케이뱅크 사장님대출", url: "https://www.kbanknow.com", status: "candidate", note: "" },
  { id: "product-kosmes", label: "중진공 정책자금(상시 대출한도)", url: "https://www.kosmes.or.kr", status: "candidate", note: "" },
  { id: "product-hope-return", label: "희망리턴패키지(폐업·재기 지원)", url: "https://www.sbiz.or.kr/nhrp", status: "candidate", note: "" },
  { id: "product-tips", label: "TIPS 민간투자주도형 기술창업", url: "https://www.jointips.or.kr", status: "candidate", note: "" },
  // ★손 등록 명부(엔젤투자매칭펀드·모태펀드·신보/기보/지역신보 보증 창구, `products/sources/manual.ts`)는
  //  이 명부에 **줄을 만들지 않는다.** 절대 실패하지 않는 상수 출처가 회차(SOURCES)에 하나라도
  //  끼면 「전부 실패 되감기」 안전장치가 항상 "성공 1건 이상"으로 보여 영구히 무력화되므로
  //  PRODUCT_SOURCES 에도 안 싣는다(계획서 리뷰 대장 #4 중요) — 지도 조립(funding-map-build.ts,
  //  Task 16)이 MANUAL_PRODUCTS 를 상수로 직접 합친다. 이 화면(현황판)엔 "연결/후보/대기" 개념이
  //  회차 소속 여부로만 판정되는데 manual 은 회차 소속이 아예 아니므로, 줄을 만들면 영원히
  //  "미연결 후보"처럼 보여 오해를 준다 — 사연은 여기 주석으로만 남긴다.

  // ── 차단·성격상 곤란 ──
];

export type ResolvedDirectoryEntry = Omit<SourceDirectoryEntry, "status"> & {
  status: DirectoryStatus;
  /** true=상한, false=상한 아님, null=모름(장부 조회 실패). */
  hitCap: boolean | null;
  lastPageNew: number;
  capAt: string | null;
};

export type ResolveDirectoryOpts = {
  /** 최신 회차 보고의 ranAt. 장부 at 이 이보다 오래되면 경고를 켜지 않는다. */
  ranAt?: string | null;
  /** 장부 조회 실패 — 모든 행 hitCap 은 모름(null). */
  capsUnknown?: boolean;
};

function visibleHitCap(
  cap: BoardCapRecord | undefined,
  opts: ResolveDirectoryOpts,
): boolean | null {
  if (opts.capsUnknown) return null;
  if (!cap || cap.hitCap !== true) return false;
  if (!opts.ranAt) return true;
  const capMs = Date.parse(cap.at);
  const ranMs = Date.parse(opts.ranAt);
  if (!Number.isFinite(capMs) || !Number.isFinite(ranMs)) return null;
  if (capMs < ranMs) return false;
  return true;
}

/** SOURCES(실제 수집 목록)의 이름들과 대조해 연결 여부를 덮어쓴 명부를 준다. */
export function resolveDirectory(
  connectedIds: string[],
  caps: ReadonlyMap<string, BoardCapRecord> = new Map(),
  opts: ResolveDirectoryOpts = {},
): ResolvedDirectoryEntry[] {
  // ※ 교차(&)로 쓰면 명부의 좁은 status 와 교차돼 "connected" 가 타입에서 사라진다(빌드 실측) — Omit 으로 덮는다.
  const connected = new Set(connectedIds);
  return SOURCE_DIRECTORY.map((s) => {
    const cap = s.id ? caps.get(s.id) : undefined;
    return {
      ...s,
      status: s.id && connected.has(s.id) ? ("connected" as const) : s.status,
      // 상한은 note 가 아니라 이 칸 — note 에 넣으면 noteTextOf 가 회차 건수를 가린다.
      hitCap: visibleHitCap(cap, opts),
      lastPageNew: cap?.lastPageNew ?? 0,
      capAt: cap?.at ?? null,
    };
  });
}
