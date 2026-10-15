import { redirect } from "next/navigation";
import { Brand } from "@/components/Brand";
import { countStaff } from "@/lib/staff";
import { SetupForm } from "./SetupForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "First account · KhaataGaata", robots: { index: false } };

export default async function SetupPage() {
  // Setup exists exactly once. After that it is a closed door.
  if ((await countStaff()) > 0) redirect("/admin/login");

  return (
    <main className="page">
      <Brand small link />
      <div className="card">
        <div className="card-body">
          <div className="card-label">First run</div>
          <h1 className="card-title">Create your account</h1>
          <p className="card-desc">
            The shop has no staff accounts yet. Make yours, then add colleagues from the
            Staff page. You&apos;ll need the ADMIN_PASSWORD from your environment variables
            to prove you own this deployment.
          </p>
          <SetupForm />
        </div>
      </div>
    </main>
  );
}
