import { ReferenceDirectoryResponseSchema } from "@/contracts/reference";
import { playerRoute } from "@/server/http/route";
import { publicDirectory } from "@/server/reference/catalog";

/** Client-safe fictional directory and practice profile. Never includes scenario kinds or results. */
export const GET = playerRoute("/api/observer/reference-directory", "Could not load the directory.", async () => {
  return {
  status: 200,
  body: ReferenceDirectoryResponseSchema.parse(publicDirectory()),
};
});
