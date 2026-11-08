import { config } from "dotenv";
import { betterAuth } from "better-auth";
import { authOptions } from "./src/lib/auth-options";

config({ path: ".env.local" });

export const auth = betterAuth(authOptions);
