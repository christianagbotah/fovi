'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[ErrorBoundary]', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-sm w-full text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
          <AlertTriangle className="h-6 w-6 text-red-500" />
        </div>
        <h2 className="text-lg font-semibold">Something went wrong</h2>
        <p className="text-sm text-muted-foreground">
          {error.message || 'An unexpected error occurred. Please try again.'}
        </p>
        <Button onClick={reset} className="gap-2 cursor-pointer">
          <RotateCw className="h-4 w-4" /> Try Again
        </Button>
      </div>
    </div>
  );
}
