# 첨부 목록 다시 읽기 고정본

`attachment-list.test.ts`·`sources/detail-attachments.test.ts` 가 쓴다. 정책매칭 「첨부 목록 수집 누락」 요청(2026-10-01)에서
첨부가 있는데 목록이 비어 저장되던 게시판의 실제 상세 화면이다.

## 어디서 왔나

- `<게시판>-<번호>.html` 21개 게시판 × 1~8쪽: 로그인 없이 받은 실제 상세 화면. 20개 게시판은 2026-09-30~10-01 에 받았다.
  한국산업단지공단 `kicox-1~3`(`bbsSeq` 49427·49739·49867)은 2026-10-16 에 받았다.
- `ks-179361.html`·`ks-179356.html`: K-Startup 상세. 요청서의 합격 예시다(첨부 1건·3건).
- `ks-179302.html`: K-Startup 상세 중 첨부가 실제로 없는 공고. 본문에 「첨부파일 참조」라는 말만 있다.
- `ks-179340.html`: K-Startup 이 공고 대신 돌려준 빈 화면(제목 `#scrTitle` 없음, 약 19KB).
- `bizinfo-126577.html`: 기업마당 상세. 중소벤처24 `smes24-d280588404.json` 이 가리키는 원문이다.
- `bizinfo-126577-none.html`: **만든 파일.** 위 파일에서 첫 `div.attached_file_list` 안의 `li` 만 지웠다.
  첨부 상자는 있고 파일은 0건인 화면을 시험하려고 만들었다.
- `smes24-d*.json`: 중소벤처24 상세 API(`/home/api/v1/pbanc/<번호>?bizPbancTypeCd=BIZPBN`) 응답 원문.
- 첫 줄 `<!-- 주소 -->` 는 그 화면의 상세 주소다. 화면 원문에는 없고 우리가 붙였다.

## 줄인 방법

원문 9.8MB 를 2.7MB 로 줄였다. 첨부 목록과 관계없는 것만 뺐다.

- `<style>`·`<svg>`·`<link>`, `data:` 그림 값
- 첨부와 관계없는 `<script>`. 첨부 함수 이름(`putFileHtml`·`fn_egov`·`downFile`·`submitForm`·
  `sendBoardFileData`·`mb_options` 등)이 든 스크립트는 남겼다.
- 줄 앞 공백과 빈 줄
- 익명 세션 값(`_csrf`·`_token`·`csrf_test_name`·`jsessionid`·KITA 주소의 `JSESSIONID_KITA`·
  경북경제진흥원 `mb_nonce_value`·`wp_nonce_value`): 같은 길이의 0으로 바꿨다. `gepa-ajax.json` 본문도 같은 0이다.
  `mb_nonce_time`(올린 시각)과 `.Hyper`(서버 이름 꼬리)는 비밀이 아니라 그대로 뒀다.
  세션에 묶이지 않은 값은 2026-10-15 에 다시 받아 그대로임을 확인하고 남겼다 — 신용보증재단 `checksum`·
  KITA `fileDtlSeq`·산업통상부 `/attach/down/` 16진수(KITA 세션 값은 그날 다른 값이었다).
- 담당자 전자우편: 이 저장소는 공개라 `@` 앞부분을 같은 길이의 `x` 로 가렸다(`smes24-d*.json` 포함).
- `kicox-*`(원문 475KB → 174KB): 방문 분석 스크립트에 받은 PC 의 공인 주소와 분석 세션 번호가 들어 있다.
  첨부와 관계없는 스크립트라 위 규칙대로 지웠고, 남은 파일에 그 값과 주소 꼴 숫자가 없음을 검사했다.
- `kodma-1·2` 의 `file:/c:/Data/bbs/….hwp` 는 사이트 문서 보기 스크립트에 박힌 공용 값이다.
  모든 상세 화면에 같은 값이 있고 원격 main 의 `kodma-list*.html` 에도 있다. 비밀·개인 값이 아니라 남겼다.

줄이기 전후를 대조했다.

- 기대 첨부 목록(아래 `expected.json`)은 원문과 줄인 파일에서 바이트까지 같다.
- 지금의 공용 수확기(`harvestBoardAttachments`) 결과도 모든 파일에서 같다.
- 본문 글자는 공백과 가린 전자우편을 빼면 같다. 단 `bizok-1·2`·`gepa-1·2` 는 지운 스크립트·스타일의 글자만큼 짧아졌다.
- `kicox-*` 도 기대 목록·수확기 결과·본문 글자가 원문과 같다(2026-10-16 대조).

## expected.json

파일 이름(확장자 뺀 것) → 그 화면의 첨부 목록. 순서는 화면에 나온 차례다.

- 사이트마다 화면 원문을 보고 짠 별도 판정기로 뽑았다. 시험 대상 코드(`attachment-list.ts`·수집기 갈고리)와
  따로 만들었고, 그 코드를 부르지 않는다.
- 그림 파일은 뺐다(`innobiz-3` 의 유일한 첨부가 그림이라 0건, `kicox-2` 의 포스터 jpg 도 뺐다).
- 2026-10-01 에 83건 전부를 실제로 내려받아 봤다. 82건은 파일 첫 바이트가 pdf·hwp(OLE)·zip 서명이었다.
  `innobiz-7` 한 건은 사이트가 404 를 준다. 화면에 링크가 있으니 목록에는 그대로 둔다.
- `kicox-*` 5건은 2026-10-16 에 내려받아 봤다. hwp·zip·pdf 는 서명이 맞았다.
  `kicox-3` 의 두 파일은 이름이 `.hwpx` 지만 내용은 hwp(OLE)다. 형식(`kind`)은 이름대로 hwpx 로 두고,
  글자 추출은 첫 바이트로 진짜 형식을 가려 hwp 로 읽는다.
- `kidp-1` 의 두 번째 첨부는 POST 로만 받는다(`method`·`body`).
- 0건인 파일 중 `sjsinbo-1` 만 본문도 비어 있다. 나머지는 본문이 있고 첨부가 없다.

## gepa-ajax.json

경북경제진흥원 첨부는 두 단계다.

1. `admin-ajax.php` 에 POST 를 보낸다(`body` 칸, `Content-Type: application/x-www-form-urlencoded`).
   본문의 nonce 는 화면에서 읽은 값을 그대로 보낸다. 두 고정본 모두 같은 0으로 가려 시험에서도 맞는다.
2. 응답 `data.file_path` 로 내려받기 주소를 만든다. nonce 는 주소에 넣지 않는다.

`pid` 18551 의 응답은 실제로 받은 값이다. 나머지 셋은 같은 규칙(`<올린 날>/F<pid>_<파일 이름>` 을 base64)으로 만든 응답이다.
네 건 모두 그 응답으로 만든 주소에서 실제 파일이 받아졌다(2026-10-01).
