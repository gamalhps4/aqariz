import "./src/lib/env/load-dotenv";
import { defineConfig } from "prisma/config";

// Prisma 7: the CLI (migrate/db) gets its database connection from
// `datasource.url` here, not from the schema. (PrismaConfig has no `adapter`
// field — a leftover adapter callback from a preview shape was removed.) The
// runtime client builds its own adapter in src/lib/db/prisma.ts from the same
// DATABASE_URL.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
  migrations: {
    path: "prisma/migrations",
  },
});
