"use client";

import Link from "next/link";
import { SystemState } from "../../components/application/SystemState";
import { ActionButton } from "../../components/design-system/primitives";

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SystemState
      tone="error"
      eyebrow={error.digest ? `Error ${error.digest}` : "Route error"}
      title="This page could not load"
      message={
        error.message ||
        "An unexpected route error interrupted this screen. Device-local work saved before the error remains available."
      }
      actions={
        <>
          <ActionButton onClick={reset}>Try again</ActionButton>
          <Link href="/dashboard">Return home</Link>
        </>
      }
    />
  );
}
