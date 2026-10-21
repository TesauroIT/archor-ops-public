"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useI18n } from "@/lib/i18n/context";

export interface UserSummary {
  id: string;
  email: string;
  role: string;
  createdAt: string;
}

export function UsersManager({
  users,
  currentEmail,
}: {
  users: UserSummary[];
  currentEmail: string;
}) {
  const router = useRouter();
  const { locale, dict, f } = useI18n();
  const t = dict.usersManager;
  const [isPending, startTransition] = useTransition();
  const [createOpen, setCreateOpen] = useState(false);
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [userToDelete, setUserToDelete] = useState<UserSummary | null>(null);

  async function readError(res: Response, fallback: string) {
    const data = await res.json().catch(() => null);
    return typeof data?.error === "string" ? data.error : fallback;
  }

  async function createUser(formData: FormData) {
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: formData.get("email"),
        password: formData.get("password"),
      }),
    });
    if (!res.ok) {
      toast.error(await readError(res, t.errCreate));
      return;
    }
    toast.success(t.created);
    setCreateOpen(false);
    startTransition(() => router.refresh());
  }

  async function resetPassword(userId: string, formData: FormData) {
    const res = await fetch(`/api/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: formData.get("password") }),
    });
    if (!res.ok) {
      toast.error(await readError(res, t.errPassword));
      return;
    }
    toast.success(t.passwordUpdated);
    setResetUserId(null);
  }

  async function confirmDeleteUser() {
    const user = userToDelete;
    if (!user) return;
    setDeletingId(user.id);
    try {
      const res = await fetch(`/api/users/${user.id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error(await readError(res, t.errDelete));
        return;
      }
      toast.success(t.deleted);
      setUserToDelete(null);
      startTransition(() => router.refresh());
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>{t.title}</CardTitle>
            <CardDescription>{t.description}</CardDescription>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger render={<Button>{t.newUser}</Button>} />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t.newUser}</DialogTitle>
                <DialogDescription>{t.newUserDesc}</DialogDescription>
              </DialogHeader>
              <form action={createUser} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="new-user-email">{t.emailLabel}</Label>
                  <Input
                    id="new-user-email"
                    name="email"
                    type="email"
                    required
                    placeholder={t.emailPlaceholder}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-user-password">{t.passwordLabel}</Label>
                  <Input
                    id="new-user-password"
                    name="password"
                    type="password"
                    required
                    minLength={8}
                    placeholder={t.passwordPlaceholder}
                  />
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={isPending}>
                    {dict.common.create}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.emailLabel}</TableHead>
              <TableHead>{t.colRole}</TableHead>
              <TableHead>{t.colCreated}</TableHead>
              <TableHead className="text-right">{t.colActions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  {user.email}
                  {user.email === currentEmail && (
                    <Badge variant="outline" className="ml-2 text-[11px]">
                      {t.you}
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{user.role}</Badge>
                </TableCell>
                <TableCell>{new Date(user.createdAt).toLocaleDateString(locale)}</TableCell>
                <TableCell className="space-x-1 text-right">
                  <Dialog
                    open={resetUserId === user.id}
                    onOpenChange={(open) => setResetUserId(open ? user.id : null)}
                  >
                    <DialogTrigger
                      render={
                        <Button variant="ghost" size="sm">
                          {t.changePassword}
                        </Button>
                      }
                    />
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{f(t.changePasswordTitle, { email: user.email })}</DialogTitle>
                      </DialogHeader>
                      <form action={(fd) => resetPassword(user.id, fd)} className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor={`pw-${user.id}`}>{t.newPasswordLabel}</Label>
                          <Input
                            id={`pw-${user.id}`}
                            name="password"
                            type="password"
                            required
                            minLength={8}
                            placeholder={t.passwordPlaceholder}
                          />
                        </div>
                        <DialogFooter>
                          <Button type="submit" disabled={isPending}>
                            {dict.common.save}
                          </Button>
                        </DialogFooter>
                      </form>
                    </DialogContent>
                  </Dialog>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled={user.email === currentEmail || deletingId === user.id}
                    onClick={() => setUserToDelete(user)}
                  >
                    {dict.common.delete}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {users.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                  {t.noUsers}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={!!userToDelete} onOpenChange={(open) => !open && setUserToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dict.common.delete}</DialogTitle>
            <DialogDescription>
              {userToDelete ? f(t.confirmDelete, { email: userToDelete.email }) : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUserToDelete(null)}>
              {dict.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmDeleteUser()}
              disabled={!!deletingId}
            >
              {dict.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
