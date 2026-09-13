# 첨부 글자 수와 잘림 출처의 정확한 표시

정책 자료 수집의 HWP 본문 개선 후속 보정이다. 현재 v5 입력은 공용 4427시험·ERP111시험이 통과했지만 독립 리뷰8842/341d에서 두 실제 PDF+보호HWP 경계 결함이 재현됐다. (1) PDF 실제 본문149자+머리글166자였는데 HWP 미확인 표식 추가로211자가 되어 ERP 최소본문200자를 잘못 통과했다. (2) PDF단독11980자에는 EXCLUSION_TAIL이 남았지만 HWP표식을 뒤에 넣자 PDF가 EXCLUSION_에서 잘렸고 skippedFiles에는 HWP만 실렸다.

## 소유권과 완료 기준

작업자는 `src/collect/attachment-text.ts`, 그 시험, 필요하면 새 순수 `src/collect/attachment-render.ts`와 시험, `src/collect/hwp-text-integration.test.ts`만 변경한다. HWP 파서 hwp-text.ts, 다른 출처, 네트워크/허용 호스트/파일·시간 상한, ERP, node_modules, 계획은 수정하지 않는다. 설치·네트워크·모델/API·Git 쓰기·배포는 금지한다. 총괄이 최종 통합·실제 시험·독립 리뷰·적용한다. 먼저 실패 시험을 만든다.

AttachmentTextResult에 선택 속성 `bodyTextChars?: number`를 추가한다. ERP가 쓰는 includeHwpPreview:false 결과에서는 반드시 반환한다. 이 값은 최종 반환 문자열에 실제 남긴 정상 첨부 본문의 UTF-16 글자 수다. 첨부 이름·머리글·경고·실패·잘림·미확인 표식·HWP 미리보기는 절대로 포함하지 않는다. 상한으로 사라진 본문도 세지 않는다. 본문 안에 표식처럼 보이는 글자가 있더라도 실제 원문이면 본문으로 센다. 완성 문자열에 정규식을 대는 추측 방식은 쓰지 않는다.

미확인 HWP 표식 때문에 앞서 읽은 PDF가 잘리면 그 PDF도 skippedFiles와 저장 문자열의 `[첨부 잘림: 실제이름]`에 기록한다. HWP 미확인 표시도 남아야 한다. 더 이상 뒤의 첨부 이름 하나로 앞 파일의 손실을 대표하지 않는다. 될 수 있으면 정상 본문을 보존하되 글자 상한을 넘지 않는다. 필수 표식 자체가 상한에 안 들어가는 비정상 길이 등은 본문을 완성으로 반환하지 않고 안전하게 실패/미확인으로 남긴다.

글자 조각의 출처와 종류를 보관한 뒤 마지막에 표식 공간을 확보하고 제한하는 방법이나 동등하게 정확한 방법을 사용한다. 모든 잘린 파일을 찾는 배분은 유계여야 한다. 결과의 실제 본문 조각으로 bodyTextChars를 계산한다. 기본 호출의 미리보기 보존, includeHwpPreview:false의 미리보기 제외, readFiles/failedFiles/previewOnlyFiles/proxyFailed 의미, 입력 순위, HTTP/SSRF/최대바이트/중단/오류 처리, Unicode 정리는 유지한다. 기존 정상 호출의 공개 결과에 불필요한 필드를 늘리지 않도록 bodyTextChars는 includeHwpPreview:false에서만 추가해도 된다.

총괄은 ERP 최소본문 기준에 `(res.bodyTextChars ?? body.length)`를 연결한다. 이 선택 속성은 이전 꾸러미/기존 주입 시험과 호환하지만 실제 새 자동 저장 경로는 생산자가 계산한 bodyTextChars를 쓴다. 새 공용 SHA와 ERP 소비자 변경은 한 번의 배포에 묶는다.

## 시험

실제 합성 PDF와 보호 CFB HWP로 짧은149자/미확인표식 합211자 상황, 정상충분PDF+미리보기HWP 보존, 상한직전11980자PDF의 EXCLUSION_TAIL 손실 시 해당 PDF명 잘림 표시를 검사한다. bodyTextChars는 표식·이름·미리보기 제외 및 실제 남은 본문과 일치해야 한다. 두 정상 첨부 중 앞 파일이 잘리는 경우, 미리보기 기본 모드, 표식처럼 보이는 원문, Unicode 경계, 아주 작은 상한/긴 이름, 다수 파일의 유계 처리도 검사한다. 단독 미리보기의 기존 재시도와 정상 충분 본문 동작을 유지한다. 관련 기존 시험과 타입 검사를 통과한다. 실제 실행하지 못한 시험을 성공으로 쓰지 않는다.
