import type { Metadata } from "next";
import { Queue } from "./queue";

export const metadata: Metadata = { title: "Your submissions" };

export default function SubmissionsPage() {
  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-6 pb-12">
      <h1 className="text-xl md:text-2xl">Your submissions</h1>
      <Queue />
    </div>
  );
}
