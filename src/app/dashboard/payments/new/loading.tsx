import { FormSkeleton } from "@/components/ui/skeleton-layouts";

export default function NewPaymentLoading() {
  return <FormSkeleton showHeader={true} fieldCount={8} showSidebar={false} />;
}
