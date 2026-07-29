import { BUILD_ID } from "../../../lib/build";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { buildId: BUILD_ID },
    {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate",
      },
    },
  );
}
