"use client";

import Link from "next/link";
import { SystemState } from "../../components/application/SystemState";
import { ActionButton } from "../../components/design-system/primitives";

export default function WorkspaceNotFound() {
  return (
    <SystemState
      tone="notFound"
      eyebrow="Route not found"
      title="This destination is unavailable"
      message="The requested deck, card, replay, or workspace route may have moved, become private, or been removed."
      actions={
        <>
          <ActionButton onClick={() => history.back()}>Go back</ActionButton>
          <Link href="/dashboard">Return home</Link>
        </>
      }
    />
  );
}
