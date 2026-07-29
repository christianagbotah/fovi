export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-background p-4 sm:p-6">
      <div className="w-full max-w-md">
        {/* Logo & Branding */}
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <img src="/logo.svg" alt="Fovi" className="w-10 h-10 rounded-xl" />
          <span className="text-xl font-bold tracking-tight">
            Fovi <span className="text-muted-foreground font-normal">AI</span>
          </span>
        </div>

        {/* Page Content */}
        {children}

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground mt-6">
          &copy; {new Date().getFullYear()} Fovi AI. All rights reserved.
        </p>
      </div>
    </main>
  );
}
