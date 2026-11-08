import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { defineConfig } from "prisma/config";

const testEnv = parse(readFileSync(".env.test.local", "utf8"));

if (!testEnv.DATABASE_URL_UNPOOLED) {
  throw new Error(
    "DATABASE_URL_UNPOOLED is missing from .env.test.local",
  );
}

export default defineConfig({
  // Folder: schema.prisma plus generated models in prisma/models/*.prisma
  schema: "prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: testEnv.DATABASE_URL_UNPOOLED,
  },
});
