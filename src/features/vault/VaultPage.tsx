import { IconVault } from "../../components/icons";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";

export default function VaultPage() {
  return (
    <EmptyState
      icon={<IconVault width={24} height={24} />}
      title="Start your Career Vault"
      description="Add your first project or import an existing resume. Every record you store here becomes verified evidence that the rest of Kairo builds on."
    >
      <Button disabled title="Arrives in Phase 1 · Career Vault">
        Add project
      </Button>
      <Button variant="secondary" disabled title="Arrives in Phase 3 · Imports">
        Import resume
      </Button>
    </EmptyState>
  );
}
