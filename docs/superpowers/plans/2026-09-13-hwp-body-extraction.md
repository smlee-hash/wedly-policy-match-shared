# Read HWP5 body paragraphs for policy attachments

Supervisor/designer: actual Astra. Goal: recover text beyond the ~1000-character PrvText stream. Root actual official unencrypted RIIA-JN2016 HWP is248832bytes; preview1007characters, BodyText Section0 diagnostic14512characters includes application periods absent from preview. This phase is a backend parser improvement; current archive-pagination release proceeds independently.

Ownership: new src/collect/hwp-text.ts/test.ts, existing src/collect/attachment-text.ts, root src/collect/hwp-text-integration.test.ts (retain assertions). Do not modify fetch guards, host rules, app queues/stores, source dates, UI, package dependencies or normal collection. Root reviews/merges/builds/deploys; worker no shell/network/modelAPI/commit/install/deploy.

Design: export extractHwpText(buf: Buffer): string in new module. Existing cfb library parses OLE. Require full OLE signature, valid256-byte FileHeader signature HWP Document File, majorversion5 (byte35), flags at36. Reject encrypted/distribution/DRM/certificate-protected body types (bits1,2,4,8,10,13: includes personal-information protected documents per official header table); no decryption or external embedded data. Read only exact root BodyText/Section0... streams, unique numeric contiguous indexes sorted numerically. Require at least one section; no partial body on malformed/truncated/unsupported structure. Preserve existing extractHwpPreview API unchanged. In attachment-text extractByKind for hwp prefer extractHwpText(buf), otherwise existing extractHwpPreview(buf); it remains partial preview fallback, never label it a full successful body. Existing fetch truncation labels, character caps, filecount/ranking, URL/proxy and timing controls unchanged. Adjust stale comments about all HWP being preview-only; keep PDF/HWPX priority for compatibility.

Binary format from primary sources below: compressed BodyText uses raw DEFLATE only when flagbit0; 32-bit LE record header tag10bits/level10bits/length12bits, size0xfff uses extra32-bit length; paragraph text tag0x43. Decode even UTF16LE payloads and retain document order including nested table-cell paragraph records. Skip unknown well-bounded records, but reject truncated headers, truncated/odd text, malformed inline controls or record overruns. HWP controlcodes1..23 except10,13 occupy8UTF16units: skip wholecontrolpayload (code9 emits tab). 10,13 emitnewline;24hyphen;30,31space;reservedcharcodes removed. Do not decode binary controlpayload as text. Preserve Unicode pairs; downstream existing stripUnstorableChars still applies. Join paragraphs with newlines.

Resource limits: input<=10MiB, atmost128sections, atmost200000records acrossdocument, total decoded sectionbytes<=16MiB, output<=100000UTF16units; enforce before allocation/append. inflateRawSync maxOutputLength uses remaining documentbudget. If anyboundexceeded returnempty for body (caller may reusepreview). No partial body claimed as complete. Do not add decompression dependencies. CFB parsing and input max use existing package; do not parse embedded bin data/macros or follow URLs. Actual encryptedprotection flags tested.

Regression plan: root integrationtest firstfails on current preview-onlypath. Cover compressed/uncompressed, preview absent/present, multiple Section0/1/2/10 numericordering+contiguity, table/nested paragraph text, extendedsizes, Unicode, allinlinecontrols, malformed/truncated/OLEotherfile, encrypted/DRM/distributionflags, decompression expansion and totalbudget, sections/records bounds. Integration must preserve existing preview-only fixturefallback, PDF/HWPX/sniff/host/networkcaps tests. Root evaluates existing official RIIA attachment result and current full suite, typecheck and qualified independent review before deployment. No real personal/sourcebinary fixtures committed.

Primary format references read byroot:
- https://tech.hancom.com/python-hwp-parsing-1/
- https://tech.hancom.com/python-hwp-parsing-2/
- https://cdn.hancom.com/link/docs/%ED%95%9C%EA%B8%80%EB%AC%B8%EC%84%9C%ED%8C%8C%EC%9D%BC%ED%98%95%EC%8B%9D_5.0_revision1.3.pdf (FileHeader, BodyText, recordlayout/controltable)
Include source comment acknowledging Hancom public file-format documentation. Implementation extracts source text only; it does not infer deadlines from multiple application phases. Older nonempty saved previewtexts are a separate remediation question and not overwritten by this parser patch.

Root integration corrections: unsigned malformed-test header; correct closing control code fixture, reject mismatched closing markers; exact256-byte header plus full zero-padded signature; stop paragraph decoding before output budget allocation; personal-information protection flag13. Regression failures recorded before changes. Native run timed out after emitting3files; preserve artifact but do not credit native completion.

## Independent review corrections (2026-09-13)

Root reproduced review-9593ada9858a4d0e8e739bd5c44ea00f in four failing tests.
- Preserve preview fallback but carry incomplete provenance in existing skippedFiles and persisted [미확인 첨부: name] marker; cached text must retain incomplete state. Full BodyText success unchanged; caps and PDF/HWPX behavior unchanged.
- Reject malformed required FileHeader/BodyText stream lengths when declared size exceeds available bytes; do not silently omit a malformed final section and accept preceding text.
- Bounded inflate must consume the entire compressed section. Reject trailing garbage or a second deflate stream. Keep maxOutputLength and all existing budgets.
Owned corrections: hwp-text.ts/test, attachment-text.ts/test, hwp-text-integration.test.ts. Existing regression expectations only change for intended fallback provenance. No network/DB/date/status/UI/dependency changes.

### Root current-byte integration findings
Actual official RIIA-JN Section0 is 41823 bytes: DEFLATE consumes41815, followed by 8 bytes71b50aef497a0200. Trailer CRC324010456433 equals Nodecrc32 of162377decodedbytes; trailer size162377 matches exactly. Support only this verified GZIP-style CRC32+ISIZE footer or exact bareDEFLATE; reject any other unused input, badCRC/size/extra bytes/second stream. Primary format reference: RFC1952; actual original file evidence in private task records. Nodecrc32 is available on all observedNode22 runtimes (official added20.15/22.2).
Root five cap-boundary cases reproduced loss of the newly appended incomplete marker. Put existing [미확인 첨부] marker before preview content inside existing bounded appendReadBlock; truncation marker also remains recognized by cached-text consumers. Restore strict sample fixture expectation rather than conditional assertions.

## 두 번째 독립 리뷰: 자동 저장에서 미리보기 재시도 보존

review-d5c04aae3f4347999d1e317ff82fd6cb는 미리보기의 표시 자체는 남지만 ERP 자동 본문 채움이 이를 완성된 본문으로 저장해 재시도를 막는 경로를 확인했다. 실제 보호 HWP와 진짜 추출기를 연결한 ERP 시험에서 저장 수가 1이 되어 재현했다. 총괄의 통합 보정으로 `AttachmentTextResult.previewOnlyFiles`를 선택 속성으로 전달하고 ERP는 `includeHwpPreview: false`로 미리보기 글자를 제외한다. 다른 첨부에서 읽은 본문이 없을 때만 본문·조건을 쓰지 않고 기존 7일 시도 표식으로 재시도한다. 정상 PDF/HWPX/HWP 형제 첨부가 있으면 그 본문과 미확인 표식을 저장한다. 미리보기 글자는 직접 읽기 경로에 보존하고 정상 전체 본문·기존 글자 수 제한·일반 PDF/HWPX·소유권·재시도 간격은 유지한다. ERP에는 실제 CFB → 추출 → 자동 채움 → 다음 재시도 시험을 추가한다. 기존 비어 있지 않은 저장 본문을 덮어쓰는 보정은 하지 않는다.

배포는 공용 변경을 검증된 기능 브랜치로 먼저 올리고, ERP의 소비자 보정과 그 공용 SHA 고정을 하나의 커밋으로 묶는다. 그 다음 공용 main을 진행시켜 나머지 앱의 자동 버전 반영을 수행한다. 새 공용 버전만 먼저 ERP에 들어가는 창을 만들지 않는다.

혼합 첨부 회귀는 review-f4d9e4f2f9034b408fde09372a6dbea6에서 지적됐다. 실제 PDF와 보호 HWP를 함께 반환한 시험이 저장 수 0으로 실패했다. `includeHwpPreview: false`에서 미리보기만 제외하고 정상 형제 첨부는 그대로 읽는 방식으로 통합 보정했다. 글자 상한에 걸려도 미확인 표식은 기존 잘림 표식과 같은 경로로 남긴다. 전부 미리보기인 공고의 재시도 시험도 함께 유지한다.
