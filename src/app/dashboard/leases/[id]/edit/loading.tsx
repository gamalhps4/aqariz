import { FormSkeleton } from "@/components/ui/skeleton-layouts";

export default function LeaseEditLoading() {
  return <FormSkeleton showHeader={true} fieldCount={10} showSidebar={true} />;
}
