"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeleton";

export default function SettingsPage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to profile settings by default
    router.replace("/dashboard/settings/profile");
  }, [router]);

  // The redirect is instant, but a skeleton of the destination reads better
  // than a spinner flashing over an empty page.
  return <SettingsPageSkeleton />;
}
