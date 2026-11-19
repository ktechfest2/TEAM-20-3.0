import type { Metadata } from "next";
import { ReviewQueue } from "./review-queue";

export const metadata: Metadata = { title: "Evidence to review" };

export default function ReviewPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-6 pb-16">
      <ReviewQueue />
    </div>
  );
}
