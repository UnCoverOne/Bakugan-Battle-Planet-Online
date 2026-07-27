import { SystemState } from "../../components/application/SystemState";

export default function WorkspaceLoading() {
  return (
    <SystemState
      tone="loading"
      eyebrow="Loading"
      title="Preparing this workspace"
      message="Restoring route data and reserving card, toolbar, and panel geometry so the page remains stable while it loads."
    />
  );
}
