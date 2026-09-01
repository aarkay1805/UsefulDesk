# Task 3 report — approved native UI masters

## Status

Completed and committed in `fcc6ae3 feat: add native inbox ui masters`.

## Implementation

Added thin UsefulDesk-native master wrappers over HeroUI Native:

- `SearchField` is controlled, composes HeroUI SearchField group/search icon/input/clear button, exposes the required accessible labels, and keeps a 48dp minimum touch target.
- `FilterChipGroup<T>` is one horizontal scroll strip. Each controlled Chip announces its optional count, exposes selected state, and selects `primary`/`tertiary` variants as required.
- `UserAvatar` accepts only an HTTPS image source, always composes a fallback, and uses the first name initial with the supplied person name as the accessibility label.
- `LoadingState`, `EmptyState`, `ErrorState`, and discriminated `AsyncState` use HeroUI Spinner/Alert; recoverable errors render the existing UsefulDesk Button for Retry.
- All masters are exported through `apps/mobile/src/ui/index.ts`.

## Files

- `apps/mobile/src/ui/search-field.tsx`
- `apps/mobile/src/ui/search-field.test.tsx`
- `apps/mobile/src/ui/filter-chip-group.tsx`
- `apps/mobile/src/ui/filter-chip-group.test.tsx`
- `apps/mobile/src/ui/user-avatar.tsx`
- `apps/mobile/src/ui/user-avatar.test.tsx`
- `apps/mobile/src/ui/async-state.tsx`
- `apps/mobile/src/ui/async-state.test.tsx`
- `apps/mobile/src/ui/index.ts`

## TDD evidence

RED command:

```bash
npm run mobile:test -- --runTestsByPath src/ui/search-field.test.tsx src/ui/filter-chip-group.test.tsx src/ui/user-avatar.test.tsx src/ui/async-state.test.tsx
```

Result: failed as expected because the new modules did not yet exist. Jest reported `Cannot find module './search-field'`, `./filter-chip-group`, `./user-avatar`, and `./async-state` from their corresponding tests.

GREEN commands:

```bash
npm run mobile:test -- --runTestsByPath src/ui/search-field.test.tsx src/ui/filter-chip-group.test.tsx src/ui/user-avatar.test.tsx src/ui/async-state.test.tsx
npm run mobile:typecheck
git diff --check
```

Results: all four focused test suites passed (4 tests total), mobile TypeScript completed with `tsc --noEmit`, and the diff check passed.

## Self-review

Verified controlled search clearing; selectable counted filters; safe image-source handling plus honest avatar fallback; alert/retry semantics; loading announcement; HeroUI-only primitive use inside `src/ui`; no public class override props; and 48dp minimum targets for search clear, chips, and retry.

The Impeccable craft floor was applied. This native task intentionally skipped the web-only Impeccable detector.

## Concerns

None. The report was created after the implementation because its requested path was absent during the original task execution.

## Review fix round 1

### Fixes

- Passed `isDisabled={disabled}` to `HeroSearchField.ClearButton`, ensuring a disabled controlled search cannot clear its value.
- Added `min-w-12` to each filter Chip alongside its existing `min-h-12`, preserving a minimum 48dp hit target for short labels such as **All**.

### Regression coverage

- `search-field.test.tsx` now verifies the clear action receives disabled state and does not call `onValueChange` when the field is disabled.
- `filter-chip-group.test.tsx` now verifies a short-label filter includes the `min-w-12` sizing contract.

### Verification

```bash
npm run mobile:test -- --runTestsByPath src/ui/search-field.test.tsx src/ui/filter-chip-group.test.tsx
```

Result: PASS — 2 suites, 4 tests passed.

```bash
npm run mobile:typecheck
git diff --check
```

Result: PASS — `tsc --noEmit` completed successfully and the diff check reported no whitespace errors.

### Fix-round self-review

Confirmed only the two review findings were changed: HeroUI receives the disabled clear-button state, and every filter-chip press target has both 48dp minimum height and width. The native task continues to skip the web-only Impeccable detector.
