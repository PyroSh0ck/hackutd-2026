import "server-only";

import { HttpError } from "@/server/http/errors";

type OwnedDelegate = {
  findFirst(args: { where: { id: string; ownerId: string }; select: { id: true } }): Promise<{ id: string } | null>;
};

/**
 * Ensures a referenced parent record exists AND belongs to `ownerId`. Otherwise throws a 400
 * VALIDATION_ERROR with a field error, so another user's ids are indistinguishable from unknown ids.
 */
export async function assertOwnedParent(
  delegate: OwnedDelegate,
  ownerId: string,
  id: string,
  field: string,
  message: string,
): Promise<void> {
  const parent = await delegate.findFirst({ where: { id, ownerId }, select: { id: true } });
  if (!parent) {
    throw new HttpError(400, "VALIDATION_ERROR", "Check the submitted fields.", { fieldErrors: { [field]: [message] } });
  }
}
