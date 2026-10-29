import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableHeader, TableRow, TableHead } from "@/components/ui/table";

export default function AllUnitsLoading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="flex items-center space-x-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>

      <Card className="gap-3">
        <CardHeader>
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-lg" />
              <div>
                <Skeleton className="h-5 w-40 mb-2" />
                <Skeleton className="h-4 w-64" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-8 w-20" />
            </div>
          </div>

          <div className="flex flex-col lg:flex-row lg:items-center gap-4 p-4 rounded-lg border border-gray-200/60 dark:border-gray-700/60">
            <div className="flex-1 min-w-0">
              <Skeleton className="h-10 w-full" />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Skeleton className="h-10 w-35" />
              <Skeleton className="h-10 w-30" />
              <Skeleton className="h-10 w-30" />
              <Skeleton className="h-10 w-35" />
              <Skeleton className="h-10 w-40" />
              <Skeleton className="h-10 w-24" />
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <Card key={i} className="overflow-hidden py-0 gap-0">
                <Skeleton className="h-48 w-full" />
                <CardContent className="p-4 space-y-3">
                  <div className="space-y-2">
                    <Skeleton className="h-6 w-3/4" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-4" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1">
                      <Skeleton className="h-4 w-4" />
                      <Skeleton className="h-4 w-6" />
                    </div>
                    <div className="flex items-center gap-1">
                      <Skeleton className="h-4 w-4" />
                      <Skeleton className="h-4 w-6" />
                    </div>
                    <div className="flex items-center gap-1">
                      <Skeleton className="h-4 w-4" />
                      <Skeleton className="h-4 w-20" />
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-6 w-24" />
                      <Skeleton className="h-4 w-10" />
                    </div>
                    <Skeleton className="h-8 w-8" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden hidden">
            <Table>
              <TableHeader className="bg-gray-50/50 dark:bg-gray-800/50">
                <TableRow className="border-b border-gray-200 dark:border-gray-700">
                  {Array.from({ length: 7 }).map((_, i) => (
                    <TableHead key={i} className="py-3 px-4">
                      <Skeleton className="h-4 w-24" />
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between px-2">
        <Skeleton className="h-4 w-64" />
        <div className="flex items-center space-x-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-8 w-20" />
        </div>
      </div>
    </div>
  );
}
