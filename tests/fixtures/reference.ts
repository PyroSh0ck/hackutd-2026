/**
 * TEST-ONLY deterministic reservations (backend-completion brief §3/§8). Never used for production
 * randomness or auto-seeding. These are proposed expectations requiring human review.
 */
export const DETERMINISTIC_TEST_RESERVATIONS = {
  ownerA: "fixture-owner-a",
  ownerB: "fixture-owner-b",
  practiceCode: "482619",
  caseReference: "CD-314159",
  challengeA: "fixture-challenge-a",
  challengeB: "fixture-challenge-b",
  timestamp: "2026-11-08T04:00:00.000Z",
} as const;

/** A random source that reproduces practiceCode 482619 then case reference 314159 from reserve(). */
export function fixedReservationRandom(): () => number {
  const values = [0.482619, 0.314159];
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}
