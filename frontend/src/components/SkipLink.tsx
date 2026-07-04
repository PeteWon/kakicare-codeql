/**
 * Skip-to-main-content link for keyboard and screen-reader users.
 *
 * Visually hidden until focused, then revealed as the very first focusable
 * element on the page so keyboard users can jump straight past the navbar to
 * the page content. Each layout renders this as its first child and gives its
 * <main> element id="main-content" for the anchor to target.
 */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only rounded-xl bg-primary-600 px-4 py-2 text-sm font-medium text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:outline-none focus:ring-2 focus:ring-primary-300"
    >
      Skip to main content
    </a>
  );
}
