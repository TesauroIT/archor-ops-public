import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/server/activity";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: {},
        password: {},
      },
      authorize: async (credentials) => {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
          try {
            await logActivity({
              type: "AUTH",
              title: "Login fallido",
              message: `Intento de acceso fallido para ${email}.`,
              triggeredBy: email,
              status: "FAILED",
            });
          } catch {
            // noop: no bloquear el login por el registro de actividad
          }
          return null;
        }

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
          try {
            await logActivity({
              type: "AUTH",
              title: "Login fallido",
              message: `Credenciales inválidas para ${email}.`,
              triggeredBy: email,
              status: "FAILED",
            });
          } catch {
            // noop: no bloquear el login por el registro de actividad
          }
          return null;
        }

        try {
          await logActivity({
            type: "AUTH",
            title: "Login exitoso",
            message: `El usuario ${email} inició sesión.`,
            triggeredBy: email,
          });
        } catch {
          // noop: no bloquear el login por el registro de actividad
        }

        return { id: user.id, email: user.email, role: user.role };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: string }).role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        (session.user as { role?: string }).role = token.role as string | undefined;
      }
      return session;
    },
  },
});
