import { signIn } from "@/lib/auth";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getServerI18n } from "@/lib/i18n/server";

async function authenticate(formData: FormData) {
  "use server";
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect("/login?error=1");
    }
    throw error;
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const { dict } = await getServerI18n();

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <div className="relative w-full max-w-sm">
        <Link
          href="/"
          className="absolute -top-8 left-0 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-4" />
          {dict.help.backToHome}
        </Link>
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Archon Ops</CardTitle>
            <CardDescription>{dict.login.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={authenticate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">{dict.login.email}</Label>
                <Input id="email" name="email" type="email" placeholder="admin@local" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">{dict.login.password}</Label>
                <Input id="password" name="password" type="password" required />
              </div>
              {error && <p className="text-sm text-destructive">{dict.login.error}</p>}
              <Button type="submit" className="w-full">
                {dict.login.submit}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
