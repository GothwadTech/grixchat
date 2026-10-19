/**
 * Callback ref that focuses its element once, when it mounts.
 *
 * Use only for the one field a user has just opened (a dialog, bottom sheet, lock
 * screen or search bar). Focus there is the expected behaviour. Do not use it on
 * page load or for anything the user did not open. Replaces the `autoFocus` prop,
 * which the a11y lint rule flags because it is easy to misuse.
 */
export function focusOnMount(el: HTMLElement | null): void {
  if (el) el.focus();
}
