import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Captcha } from '@/components/ui/Captcha';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { authService, isAuthResponse, isOtpChallenge } from '@/services/auth';

const OFFICIAL_LOGIN_ROLES = [
  { value: 'department', label: 'Department Login' },
  { value: 'supervisor', label: 'Supervisor Login' },
  { value: 'field_inspector', label: 'Field Inspector Login' },
  { value: 'worker', label: 'Worker Login' },
] as const;

type OfficialLoginRole = (typeof OFFICIAL_LOGIN_ROLES)[number]['value'];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[6-9]\d{9}$/;

interface OfficialLoginData {
  identifier: string;
  password: string;
  captcha: string;
}

export const OfficialLoginFormComponent = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const [captchaValue, setCaptchaValue] = useState('');
  const [isCaptchaValid, setIsCaptchaValid] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [otpChallengeId, setOtpChallengeId] = useState<string | null>(null);
  const [otpValue, setOtpValue] = useState('');
  const [otpHint, setOtpHint] = useState('your email');
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [selectedOfficialRole, setSelectedOfficialRole] = useState<OfficialLoginRole>('department');

  const form = useForm<OfficialLoginData>({
    mode: 'onBlur',
  });

  const describeChannels = (channels?: string[]) => {
    const set = new Set(channels || []);
    const hasEmail = set.has('email');
    const hasSms = set.has('sms');
    if (hasEmail && hasSms) return 'your email and phone';
    if (hasSms) return 'your phone';
    return 'your email';
  };

  const handleRedirect = (fullName?: string, fallbackContact?: string) => {
    const displayName = fullName?.trim() || fallbackContact?.trim() || 'Official';
    toast({
      title: 'Login Successful',
      description: `Welcome back, ${displayName}`,
    });
    setTimeout(() => navigate('/official/dashboard'), 500);
  };

  const handleSubmit = async (data: OfficialLoginData) => {
    if (!isCaptchaValid) {
      toast({
        title: 'Captcha Required',
        description: 'Please solve the captcha correctly.',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const identifier = data.identifier.trim();
      const workerPhoneLogin = selectedOfficialRole === 'worker' && PHONE_PATTERN.test(identifier);

      const response = await authService.login({
        ...(workerPhoneLogin ? { phone: identifier } : { email: identifier }),
        password: data.password,
        expectedUserType: 'official',
        expectedOfficialRole: selectedOfficialRole,
      });

      const result = response.data;
      if (response.success && isOtpChallenge(result) && result.requiresOtp) {
        setOtpChallengeId(result.challengeId);
        setOtpValue('');
        setOtpHint(describeChannels(result.channels));
        toast({
          title: 'OTP Sent',
          description: `Enter the code sent to ${describeChannels(result.channels)}.`,
        });
        return;
      }

      if (response.success && isAuthResponse(result) && result.user.userType === 'official') {
        handleRedirect(result.user.fullName || result.user.name, result.user.email || result.user.phone);
      } else if (response.success) {
        toast({
          title: 'Access Denied',
          description: 'This portal is for official accounts only.',
          variant: 'destructive',
        });
        await authService.logout();
      } else {
        toast({
          title: 'Login Failed',
          description: response.error || 'Invalid credentials',
          variant: 'destructive',
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpChallengeId) return;
    const trimmed = otpValue.trim();
    if (!trimmed) {
      toast({
        title: 'OTP Required',
        description: 'Enter the verification code.',
        variant: 'destructive',
      });
      return;
    }

    setIsVerifyingOtp(true);
    try {
      const response = await authService.verifyOtp(otpChallengeId, trimmed);
      if (response.success && response.data?.user?.userType === 'official') {
        handleRedirect(response.data.user.fullName || response.data.user.name, response.data.user.email || response.data.user.phone);
        setOtpChallengeId(null);
        setOtpValue('');
        return;
      }

      if (response.success) {
        toast({
          title: 'Access Denied',
          description: 'Official account required.',
          variant: 'destructive',
        });
        await authService.logout();
        return;
      }

      toast({
        title: 'Verification Failed',
        description: response.error || 'Invalid code. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  const isWorkerLogin = selectedOfficialRole === 'worker';
  const identifierLabel = isWorkerLogin ? 'Official Email or Phone' : 'Official Email';
  const identifierPlaceholder = isWorkerLogin ? 'official@safelive.in or 9876543210' : 'official@safelive.in';

  return (
    <div className="w-full max-w-md mx-auto animate-fade-in">
      <div className="bg-card rounded-2xl shadow-card p-8 border border-border">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-heading font-bold text-foreground mb-2">Official Login</h1>
          <p className="text-muted-foreground">Department, supervisor, field inspector, and worker access</p>
        </div>

        {!otpChallengeId && (
          <div className="space-y-2 mb-6">
            <Label>Official Role</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {OFFICIAL_LOGIN_ROLES.map((role) => (
                <button
                  key={role.value}
                  type="button"
                  className={cn(
                    'h-10 rounded-md border text-sm font-medium transition-colors',
                    selectedOfficialRole === role.value
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-input hover:bg-muted'
                  )}
                  onClick={() => setSelectedOfficialRole(role.value)}
                >
                  {role.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {otpChallengeId ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleVerifyOtp();
            }}
            className="space-y-5"
          >
            <div className="space-y-2">
              <Label htmlFor="otp">Verification Code</Label>
              <Input
                id="otp"
                inputMode="numeric"
                placeholder="Enter 6-digit code"
                value={otpValue}
                onChange={(event) => setOtpValue(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">A one-time code was sent to {otpHint}.</p>
            </div>

            <Button
              type="submit"
              className="w-full gradient-accent hover:opacity-90 transition-opacity"
              size="lg"
              disabled={isVerifyingOtp}
            >
              {isVerifyingOtp ? (
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 border-2 border-accent-foreground/30 border-t-accent-foreground rounded-full animate-spin" />
                  Verifying...
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <LogIn className="h-4 w-4" />
                  Verify & Continue
                </div>
              )}
            </Button>

            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => {
                setOtpChallengeId(null);
                setOtpValue('');
              }}
              disabled={isVerifyingOtp}
            >
              Back to Login
            </Button>
          </form>
        ) : (
          <form onSubmit={form.handleSubmit((data) => void handleSubmit(data))} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="identifier">{identifierLabel}</Label>
              <Input
                id="identifier"
                type={isWorkerLogin ? 'text' : 'email'}
                placeholder={identifierPlaceholder}
                autoComplete={isWorkerLogin ? 'username' : 'email'}
                {...form.register('identifier', {
                  required: isWorkerLogin ? 'Email or phone is required' : 'Email is required',
                  validate: (value) => {
                    const trimmed = value.trim();
                    if (isWorkerLogin) {
                      return EMAIL_PATTERN.test(trimmed) || PHONE_PATTERN.test(trimmed) || 'Enter a valid email or 10-digit phone number';
                    }
                    return EMAIL_PATTERN.test(trimmed) || 'Invalid email address';
                  },
                })}
                className={cn(form.formState.errors.identifier && 'border-destructive focus-visible:ring-destructive')}
              />
              {form.formState.errors.identifier && (
                <p className="text-sm text-destructive">{form.formState.errors.identifier.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link to="/forgot-password" className="text-sm text-primary hover:text-primary/80 transition-colors">
                  Forgot Password?
                </Link>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  {...form.register('password', {
                    required: 'Password is required',
                    minLength: { value: 6, message: 'Password must be at least 6 characters' },
                  })}
                  className={cn('pr-10', form.formState.errors.password && 'border-destructive focus-visible:ring-destructive')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {form.formState.errors.password && (
                <p className="text-sm text-destructive">{form.formState.errors.password.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Security Check</Label>
              <Captcha
                value={captchaValue}
                onChange={(value) => {
                  setCaptchaValue(value);
                  form.setValue('captcha', value);
                }}
                onValidChange={setIsCaptchaValid}
              />
            </div>

            <Button
              type="submit"
              className="w-full gradient-accent hover:opacity-90 transition-opacity"
              size="lg"
              disabled={isSubmitting || !isCaptchaValid}
            >
              {isSubmitting ? (
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 border-2 border-accent-foreground/30 border-t-accent-foreground rounded-full animate-spin" />
                  Signing in...
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <LogIn className="h-4 w-4" />
                  Sign In as {OFFICIAL_LOGIN_ROLES.find((item) => item.value === selectedOfficialRole)?.label || 'Official'}
                </div>
              )}
            </Button>
          </form>
        )}

        <div className="mt-6 space-y-4">
          <div className="text-center">
            <p className="text-muted-foreground">
              Need a new account?{' '}
              <Link to="/register?type=official&role=worker" className="text-primary font-medium hover:text-primary/80 transition-colors">
                Register
              </Link>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Supervisor and field inspector accounts are created by department users.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">OR</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          <div className="text-center">
            <p className="text-muted-foreground text-sm">
              Local user?{' '}
              <Link to="/login" className="text-primary font-medium hover:text-primary/80 transition-colors">
                Login here
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
