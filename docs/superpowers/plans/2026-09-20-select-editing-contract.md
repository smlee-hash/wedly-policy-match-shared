# Preserve native select editing contracts

Design owner: Astra. User approved the ERP shared CustomSelect preview on 2026-09-20.
Nine native ERP controls require per-option disabled state, autofocus, blur cancellation or click/keyboard callbacks. Extend the existing shared component compatibly; do not duplicate it in ERP.

## Owned implementation

- `src/ui/CustomSelect.tsx`
- `src/ui/selectKeyboard.ts`

Main owns tests and this plan. No other edits, shell, browser, agents, commits or dependency changes. File tools only.

## Design

- Add `disabled?: boolean` to CustomSelectOption and LabeledOption.
- Extend nextIndex and initialHighlight with optional fourth `isDisabled: (index: number) => boolean` argument. Preserve all old three-argument behavior. Bound navigation by the option count; all disabled returns -1. Initial selected disabled falls back to first enabled. Typeahead skips options whose disabled flag is true. CustomMultiSelect remains compatible.
- CustomSelect uses these helpers for opening, arrows, Home, End and typeahead. Guard selection at the actual option index against both control and option disabled, including changes while a menu is open. Disabled items remain visible, expose aria-disabled=true, use existing muted color/cursor classes and cannot be clicked, highlighted or selected by Enter/Space/typeahead.
- Add optional autoFocus, title, onClick, onKeyDown, onBlur with actual HTMLButtonElement React event types. Forward autoFocus to the trigger. Explicit title overrides selected label; absent title preserves the existing fallback.
- Compose caller click/key callbacks before internal behavior; honor defaultPrevented. stopPropagation alone does not suppress normal selection behavior. Preserve current keyboard and portal behavior.
- Retain focus on the trigger when pressing inside its listbox: prevent the pointer/mouse focus transfer before an option click can make a caller onBlur unmount the editor. Clicking an enabled option must still select. A genuine outside focus change closes the menu and invokes caller onBlur exactly once. Tab and Escape retain their existing behavior; callers may cancel editing on Escape. Do not fake a native select ChangeEvent.
- Keep Radix portal pointerEvents:auto, nonpassive wheel handling, grouping, default classes and existing consumers unchanged. New disabled visuals only apply to options explicitly marked disabled.

## Acceptance

Main first runs selectDisabled.test.ts and customSelect-editing-render.test.tsx to prove the missing behavior. After implementation run these plus all select keyboard/group/render/wheel tests. Actual browser verification must cover disabled pointer/keyboard/typeahead, all-disabled list, autofocus, option click with blur-cancelling parent, outside/Tab/Escape cancellation, grouped menu and a disabled control. Main owns package installation, consumer migrations, independent review and publishing.
