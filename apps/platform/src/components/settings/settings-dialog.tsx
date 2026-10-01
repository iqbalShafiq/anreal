import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  SettingsModal,
  type SettingsSection,
} from "#/components/settings/settings-modal";
import type { SessionUser } from "#/lib/auth-client";

type SettingsDialogContextValue = {
  openSettings: (
    section?: SettingsSection,
    trigger?: HTMLElement | null,
  ) => void;
};

const SettingsDialogContext = createContext<SettingsDialogContextValue | null>(
  null,
);

/**
 * Owns the single Settings modal instance for the whole workspace, so the
 * account menu and the composer's model menu open the same dialog on the
 * section they care about instead of each rendering their own.
 */
export function SettingsDialogProvider({
  user,
  children,
}: {
  user: SessionUser;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<SettingsSection>("account");
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const openSettings = useCallback(
    (next: SettingsSection = "account", trigger: HTMLElement | null = null) => {
      // Only the caller knows which element should regain focus on close.
      restoreFocusRef.current = trigger;
      setSection(next);
      setOpen(true);
    },
    [],
  );

  const closeSettings = useCallback(() => setOpen(false), []);

  // Stable value: consumers must see the same `openSettings` across renders so
  // a parent re-render cannot churn them.
  const value = useMemo(() => ({ openSettings }), [openSettings]);

  return (
    <SettingsDialogContext.Provider value={value}>
      {children}
      <SettingsModal
        open={open}
        user={user}
        section={section}
        onSectionChange={setSection}
        onClose={closeSettings}
        restoreFocusRef={restoreFocusRef}
      />
    </SettingsDialogContext.Provider>
  );
}

export function useSettingsDialog(): SettingsDialogContextValue {
  const context = useContext(SettingsDialogContext);
  if (!context) {
    throw new Error(
      "useSettingsDialog must be used within a SettingsDialogProvider",
    );
  }
  return context;
}

/**
 * Non-throwing variant for components that legitimately render on surfaces
 * without a Settings dialog (e.g. the public share page): returns `null`
 * instead of throwing so the caller can omit the entry point entirely.
 */
export function useSettingsDialogOptional(): SettingsDialogContextValue | null {
  return useContext(SettingsDialogContext);
}
