import { FormSkeleton } from "@/components/ui/skeleton-layouts";

export default function PropertyEditLoading() {
  return <FormSkeleton showHeader={true} fieldCount={12} showSidebar={true} />;
}
