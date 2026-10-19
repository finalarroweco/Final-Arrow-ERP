"use client";
export function PrintButton({ label }: { label: string }) {
  return <button className="no-print" onClick={() => window.print()}>{label}</button>;
}
