import { redirect } from "next/navigation";
import { Brand } from "@/components/Brand";
import { countStaff } from "@/lib/staff";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Staff sign in · KhaataGaata", robots: { index: false } };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // A shop with no accounts yet has nothing to sign in to; send them to setup.
  if ((await countStaff()) === 0) redirect("/admin/setup");

  const { next } = await searchParams;

  return (
    <main className="page">
      <Brand small link />
      <div className="card">
        <div className="card-body">
          <div className="card-label">Staff only</div>
          <h1 className="card-title">Open the ledger</h1>
          <p className="card-desc">Sign in to record orders and move them along.</p>
          <LoginForm next={next ?? "/admin"} />
        </div>
      </div>
    </main>
  );
}
