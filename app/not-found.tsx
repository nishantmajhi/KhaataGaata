import Link from "next/link";
import { Brand, Footer } from "@/components/Brand";

export default function NotFound() {
  return (
    <main className="page">
      <Brand small link />
      <div className="card">
        <div className="empty">
          <div className="empty-title">Nothing on this page</div>
          <p className="empty-desc">
            The link may be mistyped, or the page has moved.
          </p>
          <Link href="/" className="btn">
            Go to the homepage
          </Link>
        </div>
      </div>
      <Footer />
    </main>
  );
}
