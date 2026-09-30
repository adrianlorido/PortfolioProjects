import { FlaskConical } from "lucide-react";

export function SampleBanner({ asOf }: { asOf: string }) {
  return (
    <div role="status" className="border-b border-warning-border bg-warning-bg px-4 py-2 text-center text-xs font-semibold tracking-wide text-warning-text">
      <FlaskConical className="mr-1.5 inline size-3.5 -translate-y-px" aria-hidden />
      SAMPLE DATA — NOT REAL FINANCIAL INFORMATION
      <span className="ml-2 font-normal tracking-normal opacity-80">Fictional accounts · data as of {asOf}</span>
    </div>
  );
}
