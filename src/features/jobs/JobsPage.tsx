import { IconJobs } from "../../components/icons";
import { EmptyState } from "../../components/ui/EmptyState";

export default function JobsPage() {
  return (
    <EmptyState
      icon={<IconJobs width={24} height={24} />}
      title="Paste a job description to start a workspace."
      description="The original text is stored unchanged, then turned into an editable requirement model you can correct before anything is matched."
    />
  );
}
