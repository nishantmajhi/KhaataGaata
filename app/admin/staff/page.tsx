import Link from "next/link";
import { Brand } from "@/components/Brand";
import { formatStamp } from "@/components/Timeline";
import { listStaff } from "@/lib/staff";
import { currentStaff } from "../session";
import { AddStaffForm, ToggleStaffButton, ChangePasswordForm } from "./StaffForms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Staff · KhaataGaata", robots: { index: false } };

export default async function StaffPage() {
  const [staff, me] = await Promise.all([listStaff(), currentStaff()]);
  const activeCount = staff.filter((s) => s.is_active).length;

  return (
    <main className="page page-wide">
      <div className="ledger-head">
        <Brand small link />
        <Link href="/admin" className="back-link">
          ← Back to ledger
        </Link>
      </div>

      <div className="card card-lg">
        <div className="card-header">
          <div className="card-label">Who can open the ledger</div>
          <h1 className="card-title">Staff</h1>
          <p className="card-desc">
            Everyone gets their own login, so the history on each order names the person
            who changed it. Deactivate an account when someone leaves — it keeps their name
            on past entries.
          </p>
        </div>

        <div className="table-scroll">
          <table className="ledger">
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Last signed in</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id}>
                  <td>
                    <span className="ledger-name">{s.display_name}</span>
                    {s.id === me?.staffId ? <span className="ledger-phone">You</span> : null}
                  </td>
                  <td className="num">{s.username}</td>
                  <td className="num">
                    {s.last_login_at ? formatStamp(s.last_login_at) : "Never"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {s.is_active ? (
                      <ToggleStaffButton
                        staffId={s.id}
                        activate={false}
                        label="Deactivate"
                        disabled={s.id === me?.staffId || activeCount <= 1}
                      />
                    ) : (
                      <ToggleStaffButton staffId={s.id} activate label="Reactivate" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card-body" style={{ borderTop: "1px solid var(--rule)" }}>
          <div className="label" style={{ marginBottom: "1rem" }}>
            Add someone
          </div>
          <AddStaffForm />
        </div>

        <div className="card-body" style={{ borderTop: "1px solid var(--rule)" }}>
          <div className="label" style={{ marginBottom: "1rem" }}>
            Change your own password
          </div>
          <ChangePasswordForm />
        </div>
      </div>
    </main>
  );
}
