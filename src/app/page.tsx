import Link from "next/link";

export default function Home() {
  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-12">
      <h1 className="text-2xl">Keep the photo. Trace the record.</h1>
      <p className="mt-3 text-lg">
        Photograph a polling-unit result sheet. PollTrace saves the original on your phone, even with no network,
        then sends it unchanged for people to check and compare.
      </p>
      <div className="mt-6 grid gap-3">
        <Link href="/capture" className="btn btn-primary w-full no-underline">
          Capture a result
        </Link>
        <Link href="/units" className="btn btn-secondary w-full no-underline">
          Find a polling unit
        </Link>
      </div>
      <section aria-labelledby="limits" className="mt-10 border-t border-rule pt-6">
        <h2 id="limits" className="text-xl">
          What PollTrace does not do
        </h2>
        <ul className="mt-3 grid list-disc gap-2 pl-5">
          <li>It is not INEC and does not replace official results or collation.</li>
          <li>A matching fingerprint shows a file arrived unchanged, not that the result is true.</li>
          <li>A difference between two records is a question to check, not proof of wrongdoing.</li>
        </ul>
      </section>
      <footer className="mt-10 flex flex-wrap gap-x-6 border-t border-rule pt-4">
        <Link href="/demo" className="inline-flex min-h-11 items-center text-sm text-ink-muted">
          Guided demo
        </Link>
        <Link href="/reviewer" className="inline-flex min-h-11 items-center text-sm text-ink-muted">
          Reviewer sign-in
        </Link>
      </footer>
    </div>
  );
}
