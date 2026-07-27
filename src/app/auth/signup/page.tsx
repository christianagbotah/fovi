'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, ArrowRight, Check, Eye, EyeOff, Loader2, User, Mail, Phone, Globe,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';

const STEPS = ['Account', 'Profile', 'Experience', 'Review'];

const EXPERIENCE_LEVELS = ['Beginner', 'Intermediate', 'Advanced', 'Professional'];
const ASSET_TYPES = ['Stocks', 'Crypto', 'Forex', 'Commodities', 'Options'];
const TRADING_CONCERNS = [
  'Risk management',
  'Market volatility',
  'Emotional trading',
  'Lack of strategy',
  'Overtrading',
  'Technical analysis complexity',
  'Position sizing',
  'Timing entries/exits',
];
const PORTFOLIO_RANGES = ['Under $10K', '$10K–$50K', '$50K–$100K', '$100K–$500K', 'Over $500K'];

const COUNTRIES = [
  'United States', 'United Kingdom', 'Canada', 'Australia', 'Germany', 'France',
  'Japan', 'South Korea', 'Singapore', 'Nigeria', 'South Africa', 'Kenya', 'Ghana',
  'India', 'Brazil', 'Mexico', 'UAE', 'Saudi Arabia', 'Switzerland', 'Netherlands',
  'Other',
];

interface FormData {
  email: string;
  password: string;
  confirmPassword: string;
  fullName: string;
  phone: string;
  country: string;
  experienceLevel: string;
  assetTypes: string[];
  concerns: string[];
  portfolioRange: string;
  referralSource: string;
  agreeTerms: boolean;
}

export default function SignUpPage() {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [form, setForm] = useState<FormData>({
    email: '',
    password: '',
    confirmPassword: '',
    fullName: '',
    phone: '',
    country: '',
    experienceLevel: '',
    assetTypes: [],
    concerns: [],
    portfolioRange: '',
    referralSource: '',
    agreeTerms: false,
  });

  function updateField<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key]) setFieldErrors((prev) => ({ ...prev, [key]: '' }));
  }

  function toggleArrayItem(key: 'assetTypes' | 'concerns', item: string) {
    setForm((prev) => ({
      ...prev,
      [key]: prev[key].includes(item)
        ? prev[key].filter((i) => i !== item)
        : [...prev[key], item],
    }));
  }

  function validateStep(s: number): boolean {
    const errors: Record<string, string> = {};

    if (s === 0) {
      if (!form.email.trim()) errors.email = 'Email is required';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errors.email = 'Enter a valid email';
      if (!form.password) errors.password = 'Password is required';
      else if (form.password.length < 8) errors.password = 'Min 8 characters';
      else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(form.password))
        errors.password = 'Needs uppercase, lowercase, and number';
      if (form.password !== form.confirmPassword) errors.confirmPassword = 'Passwords do not match';
    } else if (s === 1) {
      if (!form.fullName.trim()) errors.fullName = 'Full name is required';
      if (form.phone && !/^[+]?[\d\s()-]{7,20}$/.test(form.phone)) errors.phone = 'Enter a valid phone number';
    } else if (s === 2) {
      if (!form.experienceLevel) errors.experienceLevel = 'Select your experience level';
    } else if (s === 3) {
      if (!form.agreeTerms) errors.agreeTerms = 'You must agree to the terms';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function nextStep() {
    if (!validateStep(step)) return;
    setStep((s) => Math.min(s + 1, 3));
    setError('');
  }

  function prevStep() {
    setStep((s) => Math.max(s - 1, 0));
    setFieldErrors({});
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validateStep(3)) return;

    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Sign up failed');
        return;
      }
      window.location.href = '/auth/signin';
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const stepProgress = ((step + 1) / STEPS.length) * 100;

  return (
    <>
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6 group"
      >
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
        Back to home
      </Link>

      <Card>
        {/* Progress Bar */}
        <div className="h-0.5 bg-muted rounded-t-lg overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-500 ease-out"
            style={{ width: `${stepProgress}%` }}
          />
        </div>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between mb-2">
            {STEPS.map((label, i) => {
              const done = i < step;
              const active = i === step;
              const dotClass = done
                ? 'bg-emerald-500 text-white'
                : active
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground';
              return (
              <div key={label} className="flex items-center gap-1.5">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors ${dotClass}`}>
                  {done ? <Check className="w-3.5 h-3.5" /> : (i + 1)}
                </div>
                <span className={`text-[10px] font-medium hidden sm:inline ${active ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {label}
                </span>
              </div>
              );
            })}
          </div>
          <CardTitle className="text-xl">
            {step === 0 && 'Create your account'}
            {step === 1 && 'Tell us about yourself'}
            {step === 2 && 'Your trading profile'}
            {step === 3 && 'Review & confirm'}
          </CardTitle>
          <CardDescription>
            {step === 0 && 'Start your AI trading journey'}
            {step === 1 && 'Personal details for your account'}
            {step === 2 && 'Help us personalize your experience'}
            {step === 3 && 'Make sure everything looks right'}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive mb-4">
              {error}
            </div>
          )}

          {/* ====== STEP 0: Account ====== */}
          {step === 0 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Input id="email" type="email" placeholder="you@example.com" value={form.email}
                    onChange={(e) => updateField('email', e.target.value)} autoComplete="email"
                    className={`pl-10 ${fieldErrors.email ? 'border-destructive' : ''}`} />
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                </div>
                {fieldErrors.email && <p className="text-xs text-destructive">{fieldErrors.email}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input id="password" type={showPassword ? 'text' : 'password'} placeholder="Min 8 chars, uppercase + number"
                    value={form.password} onChange={(e) => updateField('password', e.target.value)} autoComplete="new-password"
                    className={`pr-10 ${fieldErrors.password ? 'border-destructive' : ''}`} />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" tabIndex={-1}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}>
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {fieldErrors.password && <p className="text-xs text-destructive">{fieldErrors.password}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input id="confirmPassword" type="password" placeholder="Re-enter your password"
                  value={form.confirmPassword} onChange={(e) => updateField('confirmPassword', e.target.value)}
                  autoComplete="new-password" className={fieldErrors.confirmPassword ? 'border-destructive' : ''} />
                {fieldErrors.confirmPassword && <p className="text-xs text-destructive">{fieldErrors.confirmPassword}</p>}
              </div>

              <Button className="w-full" onClick={nextStep}>
                Continue <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          )}

          {/* ====== STEP 1: Profile ====== */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fullName">Full Name</Label>
                <div className="relative">
                  <Input id="fullName" type="text" placeholder="John Doe" value={form.fullName}
                    onChange={(e) => updateField('fullName', e.target.value)} autoComplete="name"
                    className={`pl-10 ${fieldErrors.fullName ? 'border-destructive' : ''}`} />
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                </div>
                {fieldErrors.fullName && <p className="text-xs text-destructive">{fieldErrors.fullName}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <div className="relative">
                  <Input id="phone" type="tel" placeholder="+1 (555) 000-0000" value={form.phone}
                    onChange={(e) => updateField('phone', e.target.value)} autoComplete="tel"
                    className={`pl-10 ${fieldErrors.phone ? 'border-destructive' : ''}`} />
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                </div>
                {fieldErrors.phone && <p className="text-xs text-destructive">{fieldErrors.phone}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="country">Country</Label>
                <div className="relative">
                  <select id="country" value={form.country}
                    onChange={(e) => updateField('country', e.target.value)}
                    className="w-full h-10 pl-10 pr-3 rounded-md border border-input bg-background text-sm
                      outline-none focus:ring-2 focus:ring-primary/50 transition-shadow appearance-none cursor-pointer">
                    <option value="">Select your country</option>
                    {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                </div>
              </div>

              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={prevStep}>Back</Button>
                <Button className="flex-1" onClick={nextStep}>Continue <ArrowRight className="w-4 h-4 ml-2" /></Button>
              </div>
            </div>
          )}

          {/* ====== STEP 2: Trading Experience ====== */}
          {step === 2 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label>Trading Experience</Label>
                <div className="grid grid-cols-2 gap-2">
                  {EXPERIENCE_LEVELS.map((level) => (
                    <button key={level} type="button" onClick={() => updateField('experienceLevel', level)}
                      className={`p-3 rounded-lg text-sm font-medium border transition-colors cursor-pointer ${
                        form.experienceLevel === level
                          ? 'bg-primary/10 border-primary text-primary'
                          : 'border-border hover:bg-accent text-muted-foreground'
                      }`}>
                      {level}
                    </button>
                  ))}
                </div>
                {fieldErrors.experienceLevel && <p className="text-xs text-destructive">{fieldErrors.experienceLevel}</p>}
              </div>

              <div className="space-y-2">
                <Label>Assets You Trade <span className="text-muted-foreground font-normal">(select all that apply)</span></Label>
                <div className="flex flex-wrap gap-2">
                  {ASSET_TYPES.map((asset) => (
                    <button key={asset} type="button" onClick={() => toggleArrayItem('assetTypes', asset)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                        form.assetTypes.includes(asset)
                          ? 'bg-primary/10 border-primary text-primary'
                          : 'border-border hover:bg-accent text-muted-foreground'
                      }`}>
                      {asset}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Biggest Trading Concerns <span className="text-muted-foreground font-normal">(select all that apply)</span></Label>
                <div className="grid grid-cols-2 gap-2">
                  {TRADING_CONCERNS.map((concern) => (
                    <label key={concern} className="flex items-center gap-2 p-2 rounded-lg border border-border hover:bg-accent/50 transition-colors cursor-pointer">
                      <Checkbox checked={form.concerns.includes(concern)}
                        onCheckedChange={() => toggleArrayItem('concerns', concern)} />
                      <span className="text-xs font-medium">{concern}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Portfolio Size</Label>
                <div className="space-y-1.5">
                  {PORTFOLIO_RANGES.map((range) => (
                    <button key={range} type="button" onClick={() => updateField('portfolioRange', range)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium border transition-colors cursor-pointer ${
                        form.portfolioRange === range
                          ? 'bg-primary/10 border-primary text-primary'
                          : 'border-border hover:bg-accent text-muted-foreground'
                      }`}>
                      {range}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="referral">How did you hear about Fovi? <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input id="referral" type="text" placeholder="Twitter, friend, search..." value={form.referralSource}
                  onChange={(e) => updateField('referralSource', e.target.value)} />
              </div>

              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={prevStep}>Back</Button>
                <Button className="flex-1" onClick={nextStep}>Review <ArrowRight className="w-4 h-4 ml-2" /></Button>
              </div>
            </div>
          )}

          {/* ====== STEP 3: Review ====== */}
          {step === 3 && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-3 p-4 rounded-lg bg-muted/50 border border-border/50">
                <h4 className="text-sm font-semibold">Account</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-muted-foreground text-xs">Email</span><p className="font-medium">{form.email}</p></div>
                  <div><span className="text-muted-foreground text-xs">Password</span><p className="font-medium">••••••••</p></div>
                </div>
              </div>

              <div className="space-y-3 p-4 rounded-lg bg-muted/50 border border-border/50">
                <h4 className="text-sm font-semibold">Profile</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-muted-foreground text-xs">Name</span><p className="font-medium">{form.fullName || '—'}</p></div>
                  <div><span className="text-muted-foreground text-xs">Phone</span><p className="font-medium">{form.phone || '—'}</p></div>
                  <div><span className="text-muted-foreground text-xs">Country</span><p className="font-medium">{form.country || '—'}</p></div>
                </div>
              </div>

              <div className="space-y-3 p-4 rounded-lg bg-muted/50 border border-border/50">
                <h4 className="text-sm font-semibold">Trading Profile</h4>
                <div className="space-y-1.5 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs w-28">Experience</span>
                    <span className="font-medium">{form.experienceLevel || '—'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs w-28">Assets</span>
                    <div className="flex flex-wrap gap-1">
                      {form.assetTypes.length > 0
                        ? form.assetTypes.map((a) => <span key={a} className="px-2 py-0.5 bg-primary/10 text-primary rounded text-xs">{a}</span>)
                        : <span className="text-muted-foreground">—</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs w-28">Portfolio</span>
                    <span className="font-medium">{form.portfolioRange || '—'}</span>
                  </div>
                  {form.concerns.length > 0 && (
                    <div className="flex items-start gap-2">
                      <span className="text-muted-foreground text-xs w-28">Concerns</span>
                      <div className="flex flex-wrap gap-1">
                        {form.concerns.map((c) => <span key={c} className="px-2 py-0.5 bg-amber-500/10 text-amber-600 rounded text-xs">{c}</span>)}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Checkbox id="terms" checked={form.agreeTerms}
                  onCheckedChange={(checked) => updateField('agreeTerms', checked === true)} />
                <Label htmlFor="terms" className="text-sm font-normal leading-relaxed cursor-pointer">
                  I agree to the{' '}
                  <span className="font-medium text-foreground hover:underline cursor-pointer">Terms of Service</span>
                  {' '}and{' '}
                  <span className="font-medium text-foreground hover:underline cursor-pointer">Privacy Policy</span>
                </Label>
              </div>
              {fieldErrors.agreeTerms && <p className="text-xs text-destructive">{fieldErrors.agreeTerms}</p>}

              <div className="flex gap-3">
                <Button type="button" variant="outline" className="flex-1" onClick={prevStep}>Back</Button>
                <Button type="submit" className="flex-1" disabled={loading}>
                  {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating account...</> : 'Create Account'}
                </Button>
              </div>
            </form>
          )}

          {step < 3 && (
            <p className="text-center text-sm text-muted-foreground mt-6">
              Already have an account?{' '}
              <Link href="/auth/signin" className="font-medium text-foreground hover:underline">Sign In</Link>
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
