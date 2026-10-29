import { FormSkeleton } from "@/components/ui/skeleton-layouts";

export default function UserEditLoading() {
  return <FormSkeleton showHeader={true} fieldCount={8} showSidebar={false} />;
}
