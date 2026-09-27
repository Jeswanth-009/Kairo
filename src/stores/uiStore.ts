import { create } from "zustand";
import type { EntityKey } from "../features/vault/vaultConfig";

/** Vault tab identifiers, including the standalone skills tab. */
export type VaultTabKey = EntityKey | "skills";

/**
 * Cross-page UI intents. The command palette raises these; the page that can
 * fulfill them (currently the Vault) consumes and clears them on mount.
 */
interface UiStore {
  /** Open the Vault inspector for this record once the Vault has loaded. */
  vaultFocus: { key: VaultTabKey; id: number } | null;
  focusVaultRecord: (key: VaultTabKey, id: number) => void;
  clearVaultFocus: () => void;
  /** Ask the Vault page to open its import dialog. */
  vaultAction: { type: "import" } | null;
  requestVaultAction: (action: { type: "import" }) => void;
  clearVaultAction: () => void;
}

export const useUiStore = create<UiStore>()((set) => ({
  vaultFocus: null,
  focusVaultRecord: (key, id) => set({ vaultFocus: { key, id } }),
  clearVaultFocus: () => set({ vaultFocus: null }),
  vaultAction: null,
  requestVaultAction: (action) => set({ vaultAction: action }),
  clearVaultAction: () => set({ vaultAction: null }),
}));
