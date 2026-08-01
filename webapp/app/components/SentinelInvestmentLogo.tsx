type Props = {
  compact?: boolean;
  subtitle?: string;
};

export default function SentinelInvestmentLogo({ compact = false, subtitle = "Institutional AI Investment OS" }: Props) {
  return (
    <div className={`sentinel-brand-lockup${compact ? " is-compact" : ""}`} aria-label="Sentinel Investment">
      <div className="sentinel-mark" aria-hidden="true">
        <svg viewBox="0 0 72 78" role="img">
          <defs>
            <linearGradient id="sentinelWing" x1="8" y1="8" x2="65" y2="72" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#f2f3ff" />
              <stop offset="0.28" stopColor="#9fc7ff" />
              <stop offset="0.58" stopColor="#6f7cff" />
              <stop offset="0.82" stopColor="#9a52ff" />
              <stop offset="1" stopColor="#31d9f3" />
            </linearGradient>
            <filter id="sentinelGlow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          <path d="M36 4 63 17 55 27 36 18 17 27 9 17 36 4Z" fill="url(#sentinelWing)" opacity=".96" filter="url(#sentinelGlow)" />
          <path d="M12 25 34 35 34 47 20 41 27 52 34 55 34 73 22 64 8 42 12 25Z" fill="url(#sentinelWing)" />
          <path d="M60 25 38 35 38 47 52 41 45 52 38 55 38 73 50 64 64 42 60 25Z" fill="url(#sentinelWing)" />
          <path d="M36 24 47 30 36 36 25 30 36 24Z" fill="#e9f1ff" opacity=".96" />
          <path d="M36 39 45 44 36 49 27 44 36 39Z" fill="#91a9ff" opacity=".95" />
        </svg>
      </div>
      <div className="sentinel-wordmark">
        <strong>SENTINEL</strong>
        <strong>INVESTMENT</strong>
        {!compact && <span>{subtitle}</span>}
      </div>
    </div>
  );
}
