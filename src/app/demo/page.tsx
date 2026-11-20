import type { Metadata } from "next";
import { DemoGuide } from "@/components/demo/demo-guide";

export const metadata: Metadata = { title: "Guided demo" };

export default function DemoPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-16">
      <DemoGuide />
    </div>
  );
}
