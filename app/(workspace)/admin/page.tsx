import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AdminRewardRouter } from "../../../components/routes/AdminRewardRouter";
import { getSessionUser } from "../../../lib/account-server";

export const metadata: Metadata = { title: "Administrator" };
export const dynamic = "force-dynamic";

export default async function AdministratorPage() {
  const requestHeaders = new Headers(await headers());
  const user = await getSessionUser(new Request("https://administrator.local/admin", { headers: requestHeaders }));
  if (!user?.roles.includes("administrator")) redirect("/");
  return <AdminRewardRouter />;
}
