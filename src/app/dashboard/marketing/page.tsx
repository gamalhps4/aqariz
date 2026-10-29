import { redirect } from "next/navigation";

/** The Marketing section opens on its first screen, the listings. */
export default function MarketingIndexPage() {
  redirect("/dashboard/marketing/listings");
}
