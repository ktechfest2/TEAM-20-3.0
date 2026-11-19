import {
  Ban,
  CircleCheck,
  Clock,
  Copy,
  FileQuestion,
  FlaskConical,
  Flag,
  Keyboard,
  ScanText,
  ShieldCheck,
  ShieldQuestion,
  UserCheck,
  XCircle,
} from "lucide-react";
import type { EvidenceStatus, ReviewDecision } from "@/lib/contracts";
import type { RevisionOrigin } from "@/lib/contracts/trace";
import { Stamp } from "@/components/stamp";
import { plural } from "@/components/client/format";

export function EvidenceStatusStamp({ status }: { status: EvidenceStatus }) {
  switch (status) {
    case "RECEIVED":
      return <Stamp label="Received by server" icon={CircleCheck} tone="done" />;
    case "PENDING_REVIEW":
      return <Stamp label="Waiting for review" icon={Clock} tone="local" />;
    case "ACCEPTED":
      return <Stamp label="Accepted by reviewer" icon={UserCheck} tone="progress" />;
    case "REJECTED":
      return <Stamp label="Not accepted by reviewer" icon={XCircle} tone="outline" />;
  }
}

export function OriginStamp({ origin, small = false }: { origin: RevisionOrigin; small?: boolean }) {
  switch (origin) {
    case "HUMAN_CORRECTION":
      return <Stamp small={small} label="Checked and confirmed by a person" icon={UserCheck} tone="progress" />;
    case "MANUAL":
      return <Stamp small={small} label="Typed in, not confirmed yet" icon={Keyboard} tone="outline" />;
    case "DEMO_FIXTURE":
      return <Stamp small={small} label="Demo figures — not read from this photo" icon={FlaskConical} tone="demo" />;
    case "REAL_VISION":
      return <Stamp small={small} label="Read automatically, not confirmed yet" icon={ScanText} tone="outline" />;
  }
}

export function DecisionStamp({ decision }: { decision: ReviewDecision }) {
  switch (decision) {
    case "ACCEPTED":
      return <Stamp label="Accepted" icon={CircleCheck} tone="progress" />;
    case "REJECTED":
      return <Stamp label="Not accepted" icon={Ban} tone="outline" />;
    case "FLAGGED":
      return <Stamp label="Flagged for another look" icon={Flag} tone="attention" />;
  }
}

export function IntegrityStamp({ matched }: { matched: boolean }) {
  return matched ? (
    <Stamp label="Source integrity confirmed" icon={ShieldCheck} tone="done" />
  ) : (
    <Stamp label="Not confirmed" icon={ShieldQuestion} tone="outline" />
  );
}

export function DuplicateStamp({ count }: { count: number }) {
  return count > 0 ? (
    <Stamp label={`Exact copy of ${count} other ${plural(count, "submission")}`} icon={Copy} tone="attention" />
  ) : (
    <Stamp label="No exact copy found" icon={FileQuestion} tone="outline" />
  );
}
