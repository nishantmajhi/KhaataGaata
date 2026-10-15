import { Brand, Footer } from "@/components/Brand";
import { TrackForm } from "./TrackForm";

export default function HomePage() {
  return (
    <main className="page">
      <Brand />

      <div className="card">
        <div className="card-body">
          <div className="card-label">Order tracking</div>
          <h1 className="card-title">Where&apos;s my notebook?</h1>
          <p className="card-desc">
            Enter the order ID from your confirmation message.
          </p>
          <TrackForm />
        </div>
      </div>

      <Footer />
    </main>
  );
}
