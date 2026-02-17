export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-2">
      {/* Left: Logo & decoration */}
      <div className="relative order-2 md:order-1 flex items-center justify-center overflow-hidden bg-linear-to-br from-emerald-50 to-white dark:from-emerald-900/20 dark:to-zinc-950">
        {/* Decorative bars */}
        <div className="absolute left-8 top-10 hidden md:flex flex-col gap-3" aria-hidden>
          <span className="h-16 w-1 rounded bg-emerald-500/80" />
          <span className="h-10 w-1 rounded bg-emerald-500/60" />
          <span className="h-24 w-1 rounded bg-emerald-500/90" />
          <span className="h-12 w-1 rounded bg-emerald-500/70" />
          <span className="h-8 w-1 rounded bg-emerald-500/50" />
        </div>

        {/* Centered logo + title */}
        <div className="text-center px-8">
          <LogoMark />
          <h1 className="mt-6 text-2xl font-bold tracking-tight text-zinc-800 dark:text-zinc-100">Emerald Finance Tracker</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Track, plan, and stay in control.</p>
        </div>

        {/* Subtle radial glow */}
        <div className="pointer-events-none absolute inset-0 opacity-40 mix-blend-soft-light mask-[radial-gradient(60%_60%_at_50%_50%,black,transparent)]">
          <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-emerald-300/40 blur-3xl" />
          <div className="absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-emerald-400/30 blur-3xl" />
        </div>
      </div>

      {/* Right: Auth section (children) */}
      <div className="order-1 md:order-2 flex items-center justify-center px-6 py-12 md:px-12">
        <div className="w-full max-w-md">
          {children}
        </div>
      </div>
    </div>
  );
}

function LogoMark() {
  return (
    <div className="relative inline-flex h-32 w-32 items-center justify-center rounded-2xl border border-black/5 dark:border-white/10 bg-white dark:bg-zinc-900 shadow-sm">
      <svg viewBox="0 0 100 100" className="h-16 w-16" aria-hidden>
        <defs>
          <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#10B981" />
            <stop offset="100%" stopColor="#34D399" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="46" fill="none" stroke="url(#g)" strokeWidth="6" />
        <path d="M28 58c10 8 22 8 32 0M32 38l12 12 24-24" fill="none" stroke="url(#g)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="absolute -bottom-6 text-xs font-semibold text-zinc-600 dark:text-zinc-300">Emerald</span>
    </div>
  );
}
