import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { ReviewerSignIn } from "./sign-in";

export const metadata: Metadata = { title: "Reviewer sign-in" };

/** Reads the server flag at request time and passes only a boolean, never the passcode. */
async function WithServerFlags() {
  await connection();
  const passcodeRequired = Boolean(process.env.POLLTRACE_DEMO_REVIEWER_PASSCODE?.trim());
  return <ReviewerSignIn passcodeRequired={passcodeRequired} />;
}

export default function ReviewerPage() {
  return (
    <div className="mx-auto w-full max-w-lg px-4 pt-6 pb-12">
      <Suspense fallback={<p className="text-ink-muted">Loading…</p>}>
        <WithServerFlags />
      </Suspense>
    </div>
  );
}
