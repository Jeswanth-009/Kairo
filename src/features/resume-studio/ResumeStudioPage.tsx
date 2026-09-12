import { IconResume } from "../../components/icons";
import { EmptyState } from "../../components/ui/EmptyState";

export default function ResumeStudioPage() {
  return (
    <EmptyState
      icon={<IconResume width={24} height={24} />}
      title="Resume Studio"
      description="The three-column workspace — content, editor with evidence, live preview — activates once a job workspace has a resume plan to edit."
    />
  );
}
