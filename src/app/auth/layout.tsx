import { Zap } from 'lucide-react';

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
          <div className="relative flex items-center justify-center w-10 h-10">
            <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-primary to-primary/60 opacity-20" />
            <Zap className="w-6 h-6 text-primary relative z-10" />
          </div>
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
