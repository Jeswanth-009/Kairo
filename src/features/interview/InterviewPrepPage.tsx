import { IconInterview } from "../../components/icons";
import { EmptyState } from "../../components/ui/EmptyState";

export default function InterviewPrepPage() {
  return (
    <EmptyState
      icon={<IconInterview width={24} height={24} />}
      title="Prepare from real context"
      description="Interview questions are generated from the exact job description, the submitted resume version and your evidence — with gaps you should be ready to address."
    />
  );
}
