'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}>
      <ResetPasswordContent />
    </Suspense>
  );
}

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setFieldErrors({});

    const errors: Record<string, string> = {};
    if (!token) { errors.token = 'Invalid or missing reset token'; }
    if (newPassword.length < 8) { errors.newPassword = 'Password must be at least 8 characters'; }
    if (!/[A-Z]/.test(newPassword)) { errors.newPassword = 'Must include an uppercase letter'; }
    if (!/[0-9]/.test(newPassword)) { errors.newPassword = 'Must include a number'; }
    if (newPassword !== confirmPassword) { errors.confirmPassword = 'Passwords do not match'; }

    if (Object.keys(errors).length > 0) { setFieldErrors(errors); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to reset password'); return; }
      setSuccess(true);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <>
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6 group">
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" /> Back to home
        </Link>
        <Card>
          <CardContent className="flex flex-col items-center text-center py-8 px-6">
            <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-7 h-7 text-emerald-500" />
            </div>
            <h2 className="text-xl font-semibold mb-2">Password Reset</h2>
            <p className="text-sm text-muted-foreground max-w-sm">Your password has been successfully updated. You can now sign in with your new password.</p>
            <Link href="/auth/signin" className="w-full mt-6">
              <Button className="w-full">Sign In</Button>
            </Link>
          </CardContent>
        </Card>
      </>
    );
  }

  if (!token) {
    return (
      <>
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6 group">
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" /> Back to home
        </Link>
        <Card>
          <CardContent className="flex flex-col items-center text-center py-8 px-6">
            <h2 className="text-xl font-semibold mb-2">Invalid Link</h2>
            <p className="text-sm text-muted-foreground max-w-sm">This password reset link is invalid or has expired. Please request a new one.</p>
            <Link href="/auth/forgot-password" className="w-full mt-6">
              <Button variant="outline" className="w-full">Request New Link</Button>
            </Link>
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6 group">
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" /> Back to home
      </Link>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Reset Password</CardTitle>
          <CardDescription>Enter your new password below</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
            )}
            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password</Label>
              <div className="relative">
                <Input id="newPassword" type={showPassword ? 'text' : 'password'} placeholder="Minimum 8 characters"
                  value={newPassword} onChange={e => { setNewPassword(e.target.value); setFieldErrors(p => ({ ...p, newPassword: '' })); }}
                  className={`pr-10 ${fieldErrors.newPassword ? 'border-destructive' : ''}`} />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1} aria-label={showPassword ? 'Hide' : 'Show'}>
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {fieldErrors.newPassword && <p className="text-xs text-destructive">{fieldErrors.newPassword}</p>}
              <p className="text-[10px] text-muted-foreground">Must include uppercase letter and number</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input id="confirmPassword" type="password" placeholder="Re-enter your password"
                value={confirmPassword} onChange={e => { setConfirmPassword(e.target.value); setFieldErrors(p => ({ ...p, confirmPassword: '' })); }}
                className={fieldErrors.confirmPassword ? 'border-destructive' : ''} />
              {fieldErrors.confirmPassword && <p className="text-xs text-destructive">{fieldErrors.confirmPassword}</p>}
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Resetting...</> : 'Reset Password'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
