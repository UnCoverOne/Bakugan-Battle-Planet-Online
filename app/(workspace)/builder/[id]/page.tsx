import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DeckBuilderScreen } from "../../../../components/routes/DeckRoutes";
import { getSessionUser } from "../../../../lib/account-server";

export const metadata: Metadata = { title: "Deck Builder", description: "Build and validate a complete Battle Planet deck." };

export default async function BuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const decodedId = decodeURIComponent(id);
  if (decodedId.startsWith("admin-")) {
    const requestHeaders = new Headers(await headers());
    const user = await getSessionUser(new Request("https://administrator.local/builder", { headers: requestHeaders }));
    if (!user?.roles.includes("administrator")) redirect("/");
  }
  const returnTo = typeof query.returnTo === "string" ? query.returnTo : undefined;
  return <DeckBuilderScreen id={decodedId} returnTo={returnTo} />;
}
