import { useEffect, useState, type ComponentProps, type ComponentType, type JSX } from "react";
import { StyleSheet, View } from "react-native";

import type { RowPan as RowPanComponent } from "@/components/row-pan";

/**
 * Surfaces off the first-paint path load as their own web chunks. Until the chunk arrives the
 * surface renders an empty view that fills the pane, card or screen it would fill, so nothing
 * around it moves. A plain state update shows it, not Suspense: a lazy boundary inside an overlay
 * portal stayed on its fallback after another lazy surface had loaded.
 */
function deferred<P extends object>(
  load: () => Promise<ComponentType<P>>,
  Fallback: (props: P) => JSX.Element = () => <View style={styles.fill} />,
) {
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
    return Component ? <Component {...props} /> : <Fallback {...props} />;
  }
  return Object.assign(Deferred, { preload });
}

export const AgentPane = deferred(() => import("@/components/agent/agent-pane").then((m) => m.AgentPane));
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
export const ThreadBeside = deferred(() => import("@/components/thread-view").then((m) => m.ThreadBeside));
export const SettingsContent = deferred(() => import("@/components/settings-content").then((m) => m.SettingsContent));
/** Until the gesture chunk lands a phone row renders still, so the list never waits on swiping. */
export const RowPan = deferred(
  () => import("@/components/row-pan").then((m) => m.RowPan),
  ({ children }: ComponentProps<typeof RowPanComponent>) => <>{children}</>,
);
/**
 * Off the first-visit path: the tray shows only on a long-press or right-click and the release banners only
 * when a new build is out. The tray's chunk loads at boot, like the thread's, so it is in before the first press.
 */
export const TapbackTray = deferred(() => import("@/components/tapback-tray").then((m) => m.TapbackTray), () => <></>);
TapbackTray.preload().catch(() => undefined);
/** Mounted closed under every list; it loads at boot so the first open never waits. */
export const ConversationFiltersPanel = deferred(
  () => import("@/components/conversation-filters-panel").then((m) => m.ConversationFiltersPanel),
  () => <></>,
);
ConversationFiltersPanel.preload().catch(() => undefined);
export const KeyboardHelp = deferred(() => import("@/components/keyboard-help").then((m) => m.KeyboardHelp), () => <></>);
export const ReleaseUpdateBanners = deferred(
  () => import("@/components/release-update-banners").then((m) => m.ReleaseUpdateBanners),
  () => <></>,
);
/** Dev and fixture only, so it is not preloaded. */
export const UiGallery = deferred(() => import("@/components/ui-gallery").then((m) => m.UiGallery));

const surfaces = [AgentPane, ChatInfoContent, CommandPalette, ContactsWorkspace, ForwardContent, NewChatContent, PersonContent, ScheduledContent, SearchContent, SettingsContent, RowPan, ReleaseUpdateBanners, KeyboardHelp];

/** Fetches every surface chunk off the critical path, so a first open renders without the empty frame. */
export function preloadSurfaces(): void {
  for (const surface of surfaces) surface.preload().catch(() => undefined);
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
