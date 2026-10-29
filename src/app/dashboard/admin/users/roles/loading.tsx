import { ListPageSkeleton } from "@/components/ui/skeleton-layouts";

export default function UserRolesLoading() {
  return (
    <ListPageSkeleton showStats={false} showFilters={false} itemCount={6} />
  );
}
