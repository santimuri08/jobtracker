// frontend/src/types/next-auth.d.ts
import { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session {
    backendToken?: string
    user: {
      id: string
    } & DefaultSession["user"]
  }
}