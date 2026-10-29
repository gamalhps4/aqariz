import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function SignInLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();

  if (session?.user) {
    if (session.user.role === "super_admin") {
      redirect("/admin");
    }

    if (!session.user.organizationId) {
      redirect("/auth/onboarding");
    }

    redirect("/dashboard");
  }

  return children;
}
