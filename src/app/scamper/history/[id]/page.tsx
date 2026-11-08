import { Suspense } from "react";
import { SessionReviewRoute } from "@/features/scamper/review";

/** The session id is read client-side with useParams, inside a Suspense boundary (Cache Components). */
export default function ScamperReviewPage() {
  return (
    <Suspense fallback={null}>
      <SessionReviewRoute />
    </Suspense>
  );
}
