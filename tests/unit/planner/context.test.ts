import { describe, expect, it } from "vitest";
import { message, snapshot } from "../actor/fixtures";
import { derivePlanningContext } from "@/server/planner/context";

describe("planner context from committed dialogue", () => {
  it("recognizes a proof limit with a curly apostrophe in a committed sender reply", () => {
    const s = snapshot();
    s.messages = [message(1, "This message alone can’t prove who I am.", "assistant"), message(2, "Prove it")];
    expect(derivePlanningContext(s, 12).doubtBoundaryGiven).toBe(true);
  });

  it("treats a short no after an invitation as a conversation decline", () => {
    const s = snapshot();
    s.messages = [message(1, "Do you have a minute to go through it?", "assistant"), message(2, "No.")];
    expect(derivePlanningContext(s, 12).conversationDeclined).toBe(true);
  });
});
