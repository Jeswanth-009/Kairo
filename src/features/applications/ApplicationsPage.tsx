import { IconApplications } from "../../components/icons";
import { EmptyState } from "../../components/ui/EmptyState";

export default function ApplicationsPage() {
  return (
    <EmptyState
      icon={<IconApplications width={24} height={24} />}
      title="Track applications manually"
      description="Applications link a company and role to the exact resume version you submitted, with a status you update by hand. Automation is deliberately out of scope for v1."
    />
  );
}
