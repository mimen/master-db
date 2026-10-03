/** Pops when there is history; a reload or deep link has none, so it goes home. */
export function goBackOrHome(nav: { canGoBack(): boolean; back(): void; replace(href: "/"): void }): void {
  if (nav.canGoBack()) nav.back();
  else nav.replace("/");
}
