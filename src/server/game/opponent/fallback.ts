import type { ParsedToolCall } from "./live-turn";
import type { OpponentObservation } from "./observation-schema";

/**
 * Authored, deterministic opponent used when the model is unconfigured/fails, or in the explicit
 * "scripted" demo mode. Always labeled `scripted_fallback`. It reads ONLY the same restricted
 * observation the model gets, and proposes calls through the same validated engine dispatch,
 * so it can't create a duplicate payment request after a partial live turn (the engine allows
 * one pending request) and can't do anything the model couldn't.
 *
 * It still adapts to observed results: first ask -> pressure while pending -> smaller amount to a
 * different recipient after a rejection -> give up after a second rejection.
 */
export function scriptedOpponentCalls(observation: OpponentObservation, turnId: string): ParsedToolCall[] {
  const requests = observation.yourPaymentRequests;
  const pending = requests.find((r) => r.status === "pending");
  const rejected = requests.filter((r) => r.status === "rejected").length;
  const lastPlayer = [...observation.transcript].reverse().find((m) => m.from === "player")?.text.toLowerCase() ?? "";
  const mentionsChecking = /\b(call|phone|verify|check|bank directly|official|scam|fake|suspicious)\b/.test(lastPlayer);
  const say = (n: number, text: string): ParsedToolCall => ({ callId: `fallback-${turnId}-${n}`, name: "sendSimulatedMessage", args: { text } });
  const name = observation.playerDisplayName;

  if (rejected >= 2) {
    return [
      say(1, "Understood. We'll close this case on our side. Have a good day."),
      { callId: `fallback-${turnId}-2`, name: "finishEncounter", args: { reason: "player declined twice" } },
    ];
  }
  if (pending) {
    return [
      say(
        1,
        mentionsChecking
          ? "There's no need to call — the phone lines are overloaded and this secure channel is faster. Please approve the transfer before the window closes."
          : `${name}, the transfer is ready in your banking app. Approve it in the next few minutes so your savings stay protected.`,
      ),
    ];
  }
  if (rejected === 1) {
    return [
      say(1, "I understand the hesitation. A smaller refundable verification deposit works too — it confirms you're the account owner."),
      { callId: `fallback-${turnId}-2`, name: "presentPaymentRequest", args: { recipientId: "fraud-reversal-desk", amount: 200 } },
    ];
  }
  return [
    say(1, `Thanks for responding quickly, ${name}. I've prepared a transfer of 500 credits to our temporary safe account. Please approve it in your banking app right away.`),
    { callId: `fallback-${turnId}-2`, name: "presentPaymentRequest", args: { recipientId: "mrb-secure-holding", amount: 500 } },
  ];
}
