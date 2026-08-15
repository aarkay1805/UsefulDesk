/**
 * Product-wide focus treatment for modal layers. Dialog and Sheet compose
 * different Base UI primitives, but their page-obscuring backdrop must never
 * drift. Popovers, selects, and menus deliberately do not consume this token.
 */
const MODAL_BACKDROP_CLASS =
  'fixed inset-0 isolate z-50 bg-background/40 backdrop-blur-sm';

/**
 * Base UI intentionally omits a child Dialog's backdrop. It exposes the
 * nested state on the parent popup instead, so blur that parent surface while
 * the child owns focus. This keeps nested dialogs visually consistent with
 * top-level modal layers without inventing another blocking overlay.
 */
const MODAL_PARENT_WITH_CHILD_CLASS = 'data-[nested-dialog-open]:blur-sm';

export { MODAL_BACKDROP_CLASS, MODAL_PARENT_WITH_CHILD_CLASS };
