import Link from "next/link";

export function Brand({ small = false, link = false }: { small?: boolean; link?: boolean }) {
  const inner = (
    <div className="brand">
      {!small && (
        <svg className="brand-icon" viewBox="0 0 48 48" fill="none" aria-hidden="true">
          <rect
            x="9"
            y="6"
            width="30"
            height="36"
            rx="2"
            stroke="var(--accent)"
            strokeWidth="1.5"
          />
          <path d="M16 6v36" stroke="var(--rule)" strokeWidth="1.5" />
          <path
            d="M22 16h11M22 23h11M22 30h7"
            stroke="var(--rule)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      )}
      <div className={small ? "brand-name sm" : "brand-name"}>
        Khaata<em>र&nbsp;</em>Gaata
      </div>
      <div className={small ? "brand-sub xs" : "brand-sub"}>Fine notebooks with cover</div>
    </div>
  );

  if (!link) return inner;
  return (
    <Link href="/" className="brand-link">
      {inner}
    </Link>
  );
}

export function Footer() {
  return (
    <div className="footer">
      <a href="#">Shop</a> &nbsp;·&nbsp; <a href="#">About</a> &nbsp;·&nbsp;{" "}
      <a href="#">Contact</a>
      <br />© {new Date().getFullYear()} KhaataGaata — Made with care.
    </div>
  );
}
