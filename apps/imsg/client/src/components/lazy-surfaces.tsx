import { useEffect, useState, type ComponentType, type JSX } from "react";
import { StyleSheet, View } from "react-native";

/**
 * Surfaces off the first-paint path load as their own web chunks. Until the chunk arrives the
 * surface renders an empty view that fills the pane, card or screen it would fill, so nothing
 * around it moves. A plain state update shows it, not Suspense: a lazy boundary inside an overlay
 * portal stayed on its fallback after another lazy surface had loaded.
 */
function deferred<P extends object>(load: () => Promise<ComponentType<P>>) {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;
  const preload = (): Promise<ComponentType<P>> =>
    (pending ??= load().then(
      (Component) => (loaded = Component),
      (error: unknown) => {
        pending = null;
        throw error;
      },
    ));
  function Deferred(props: P): JSX.Element {
    const [Component, setComponent] = useState(() => loaded);
    useEffect(() => {
      if (Component) return;
      let live = true;
      preload().then((next) => live && setComponent(() => next), () => undefined);
      return () => {
        live = false;
      };
    }, [Component]);
    return Component ? <Component {...props} /> : <View style={styles.fill} />;
  }
  return Object.assign(Deferred, { preload });
}

export const ChatInfoContent = deferred(() => import("@/components/chat-info-content").then((m) => m.ChatInfoContent));
export const CommandPalette = deferred(() => import("@/components/command-palette").then((m) => m.CommandPalette));
export const ContactsWorkspace = deferred(() => import("@/components/contacts-workspace").then((m) => m.ContactsWorkspace));
export const ForwardContent = deferred(() => import("@/components/forward-content").then((m) => m.ForwardContent));
export const NewChatContent = deferred(() => import("@/components/new-chat-content").then((m) => m.NewChatContent));
export const PersonContent = deferred(() => import("@/components/person-content").then((m) => m.PersonContent));
export const ScheduledContent = deferred(() => import("@/components/scheduled-content").then((m) => m.ScheduledContent));
export const SearchContent = deferred(() => import("@/components/search-content").then((m) => m.SearchContent));
/** A conversation opens right after the list paints, so its chunk starts loading at boot. */
export const ThreadView = deferred(() => import("@/components/thread-view").then((m) => m.ThreadView));
ThreadView.preload().catch(() => undefined);
export const SettingsContent = deferred(() => import("@/components/settings-content").then((m) => m.SettingsContent));
/** Dev and fixture only, so it is not preloaded. */
export const UiGallery = deferred(() => import("@/components/ui-gallery").then((m) => m.UiGallery));

const surfaces = [ChatInfoContent, CommandPalette, ContactsWorkspace, ForwardContent, NewChatContent, PersonContent, ScheduledContent, SearchContent, SettingsContent];

/** Fetches every surface chunk off the critical path, so a first open renders without the empty frame. */
export function preloadSurfaces(): void {
  for (const surface of surfaces) surface.preload().catch(() => undefined);
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
