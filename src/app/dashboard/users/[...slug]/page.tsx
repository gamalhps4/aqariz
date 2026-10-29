import { redirect } from "next/navigation";

interface LegacyUsersCatchAllProps {
  params: {
    slug?: string[];
  };
}

export default function LegacyUsersCatchAllRedirect({
  params,
}: LegacyUsersCatchAllProps) {
  const slugPath = params.slug?.join("/");
  const destination = slugPath
    ? `/dashboard/admin/users/${slugPath}`
    : "/dashboard/admin/users";

  redirect(destination);
}
