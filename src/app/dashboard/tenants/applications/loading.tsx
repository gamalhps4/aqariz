import { ListPageSkeleton } from "@/components/ui/skeleton-layouts";

export default function TenantApplicationsLoading() {
  return <ListPageSkeleton showStats={true} showFilters={true} itemCount={6} />;
}
