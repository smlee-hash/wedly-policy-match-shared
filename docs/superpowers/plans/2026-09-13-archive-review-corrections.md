# Archive boundary review corrections

Keep the approved archive continuation and GTP date recovery design. Fix the five independently reproduced review findings without changing normal source parsers, engine, registry, source IDs, or ERP cursor revision.

1. A recognized GTP closed policy row with fewer than six cells must fail the whole archive page, even beside valid rows. Do not silently skip the malformed row. Keep non-policy title filters and safe official detail URLs.
2. The labelled application-period cell must contain an actual range expression connecting its two calendar dates. Do not invent a tilde between unrelated dates. Keep the existing exact label, unique adjacent cell, valid calendar/order/past checks; permit the actual source's times and whitespace around its range delimiter.
3. Validate every required JSON pagination relationship and all three observed Smartfactory copies. Root live measurements on pages 1, 7 and 11 confirm KOSMES scopeRow=startRowNum-1; endRowNum=startRowNum+rowCount; startPage advances from1 to11 at page11, in pageCount-sized blocks. For Smartfactory pageBasic advances from1 to11 at page11 in blockPage-sized blocks; the proven-end response endNumber equals totalCount. All integers, source identity, requested page, empty arrays, error checks and existing total/page relationships remain required. Missing nested model/modelMap data is not proven end.
4. A login/access-denied/challenge response must remain incomplete even if it retains an empty list-shaped container. Detect explicit authentication/error evidence, such as password login forms or access-denied title/headings, rather than rejecting ordinary search forms or incidental footer words. Preserve the ten real source response cases.
5. Freeze the GTP test clock so a fixed future period does not become a past period in later calendar years. Do not change production time behavior.

Owned files: gtp-archive.ts/test, page-end.ts/test, and a targeted page-window.test regression if useful. Root supplied five failing regression tests. No new source/end cases, schema, UI, store, policy installation, network/model calls, or deployment work by the implementation worker. Preserve previous authors and verified unrelated changes.

Completion: focused tests including malformed mixed-page retention, source range grammar, contradictory/missing JSON metadata, login versus search form, and stable clock; full shared tests/typecheck; fresh qualified independent review of corrections; exact consumer pins/builds/deploy checks and operational verification by root.
