import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoginMethodToggle } from '@/components/ui/LoginMethodToggle';
import { Captcha } from '@/components/ui/Captcha';
import { LoginMethod } from '@/types/auth';
import { emailLoginSchema, phoneLoginSchema, EmailLoginFormData, PhoneLoginFormData } from '@/lib/validation';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { authService, isAuthResponse, isOtpChallenge } from '@/services/auth';

export const LoginForm = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loginMethod, setLoginMethod] = useState<LoginMethod>('email');
  const [showPassword, setShowPassword] = useState(false);
  const [captchaValue, setCaptchaValue] = useState('');
  const [isCaptchaValid, setIsCaptchaValid] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [otpChallengeId, setOtpChallengeId] = useState<string | null>(null);
  const [otpValue, setOtpValue] = useState('');
  const [otpHint, setOtpHint] = useState('your email');
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);

  const describeChannels = (channels?: string[]) => {
    const set = new Set(channels || []);
    const hasEmail = set.has('email');
    const hasSms = set.has('sms');
    if (hasEmail && hasSms) return 'your email and phone';
    if (hasSms) return 'your phone';
    return 'your email';
  };

  const emailForm = useForm<EmailLoginFormData>({
    resolver: zodResolver(emailLoginSchema),
    mode: 'onBlur',
  });

  const phoneForm = useForm<PhoneLoginFormData>({
    resolver: zodResolver(phoneLoginSchema),
    mode: 'onBlur',
  });

  const currentForm = loginMethod === 'email' ? emailForm : phoneForm;

  const handleSubmit = async (data: EmailLoginFormData | PhoneLoginFormData) => {
    if (!isCaptchaValid) {
      toast({
        title: "Captcha Required",
        description: "Please solve the captcha correctly",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    
    try {
      const loginData = loginMethod === 'email' 
        ? { email: (data as EmailLoginFormData).email, password: data.password, expectedUserType: 'citizen' as const }
        : { phone: (data as PhoneLoginFormData).phone, password: data.password, expectedUserType: 'citizen' as const };

      const response = await authService.login(loginData);
      
      if (response.success) {
        const result = response.data;

        if (isOtpChallenge(result) && result.requiresOtp) {
          setOtpChallengeId(result.challengeId);
          setOtpValue('');
          setOtpHint(describeChannels(result.channels));
          toast({
            title: "OTP Sent",
            description: `Enter the code sent to ${describeChannels(result.channels)} to finish signing in.`,
          });
          return;
        }

        if (isAuthResponse(result) && result.user.userType !== 'citizen') {
          toast({
            title: "Access Denied",
            description: "Official accounts must use Official Login.",
            variant: "destructive",
          });
          await authService.logout();
          return;
        }

        toast({
          title: "Login Successful!",
          description: "Welcome back! Redirecting to your dashboard...",
        });

        setTimeout(() => {
          navigate('/dashboard');
        }, 1000);
      } else {
        toast({
          title: "Login Failed",
          description: response.error || "Invalid credentials. Please try again.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Login Failed",
        description: "Unable to connect to server. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpChallengeId) return;
    const trimmed = otpValue.trim();
    if (!trimmed) {
      toast({
        title: "OTP Required",
        description: "Enter the verification code.",
        variant: "destructive",
      });
      return;
    }

    setIsVerifyingOtp(true);
    try {
      const response = await authService.verifyOtp(otpChallengeId, trimmed);
      if (response.success && response.data?.token) {
        if (response.data.user.userType !== 'citizen') {
          toast({
            title: "Access Denied",
            description: "Official accounts must use Official Login.",
            variant: "destructive",
          });
          setOtpChallengeId(null);
          setOtpValue('');
          await authService.logout();
          return;
        }
        toast({
          title: "Verification Successful",
          description: "Redirecting to your dashboard...",
        });
        setOtpChallengeId(null);
        setOtpValue('');
        setTimeout(() => {
          navigate('/dashboard');
        }, 700);
        return;
      }
      toast({
        title: "Verification Failed",
        description: response.error || "Invalid code. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto animate-fade-in">
      <div className="bg-card rounded-2xl shadow-card p-8 border border-border">
        {}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-heading font-bold text-foreground mb-2">
            Local Login
          </h1>
          <p className="text-muted-foreground">
            Report and track incidents in SafeLive
          </p>
        </div>

        {}
        <div className="mb-6">
          <Label className="text-sm font-medium text-muted-foreground mb-3 block">
            Login With
          </Label>
          <LoginMethodToggle
            selectedMethod={loginMethod}
            onSelectMethod={(method) => {
              setLoginMethod(method);
              emailForm.reset();
              phoneForm.reset();
            }}
          />
        </div>

        {}
        {otpChallengeId ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleVerifyOtp();
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
                onChange={(e) => setOtpValue(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                A one-time code was sent to {otpHint}.
              </p>
            </div>

            <Button
              type="submit"
              className="w-full gradient-primary hover:opacity-90 transition-opacity"
              size="lg"
              disabled={isVerifyingOtp}
            >
              {isVerifyingOtp ? (
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
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
          <form 
            onSubmit={currentForm.handleSubmit(handleSubmit)} 
            className="space-y-5"
          >
          {}
          {loginMethod === 'email' ? (
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="abc@gmail.com"
                autoComplete="email"
                {...emailForm.register('email')}
                className={cn(
                  emailForm.formState.errors.email && "border-destructive focus-visible:ring-destructive"
                )}
              />
              {emailForm.formState.errors.email && (
                <p className="text-sm text-destructive">
                  {emailForm.formState.errors.email.message}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <div className="flex items-stretch gap-2">
                <div className="flex h-10 min-w-[3.25rem] shrink-0 items-center justify-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground">
                  +91
                </div>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="9876543210"
                  autoComplete="tel"
                  {...phoneForm.register('phone')}
                  className={cn(
                    "h-10 flex-1",
                    phoneForm.formState.errors.phone && "border-destructive focus-visible:ring-destructive"
                  )}
                />
              </div>
              {phoneForm.formState.errors.phone && (
                <p className="text-sm text-destructive">
                  {phoneForm.formState.errors.phone.message}
                </p>
              )}
            </div>
          )}

          {}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link 
                to="/forgot-password" 
                className="text-sm text-primary hover:text-primary/80 transition-colors"
              >
                Forgot Password?
              </Link>
            </div>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                autoComplete="current-password"
                {...(loginMethod === 'email' ? emailForm.register('password') : phoneForm.register('password'))}
                className={cn(
                  "pr-10",
                  (loginMethod === 'email' ? emailForm.formState.errors.password : phoneForm.formState.errors.password) && "border-destructive focus-visible:ring-destructive"
                )}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {(loginMethod === 'email' ? emailForm.formState.errors.password : phoneForm.formState.errors.password) && (
              <p className="text-sm text-destructive">
                {(loginMethod === 'email' ? emailForm.formState.errors.password : phoneForm.formState.errors.password)?.message}
              </p>
            )}
          </div>

          {}
          <div className="space-y-2">
            <Label>Security Check</Label>
            <Captcha
              value={captchaValue}
              onChange={(val) => {
                setCaptchaValue(val);
                if (loginMethod === 'email') {
                  emailForm.setValue('captcha', val);
                } else {
                  phoneForm.setValue('captcha', val);
                }
              }}
              onValidChange={setIsCaptchaValid}
            />
          </div>

          {}
          <Button
            type="submit"
            className="w-full gradient-primary hover:opacity-90 transition-opacity"
            size="lg"
            disabled={isSubmitting || !isCaptchaValid}
          >
            {isSubmitting ? (
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                Signing in...
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <LogIn className="h-4 w-4" />
                Sign In
              </div>
            )}
          </Button>
          </form>
        )}

        {}
        <div className="mt-6 space-y-4">
          <div className="text-center">
            <p className="text-muted-foreground">
              Don't have an account?{' '}
              <Link 
                to="/register" 
                className="text-primary font-medium hover:text-primary/80 transition-colors"
              >
                Register Here
              </Link>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">OR</span>
            <div className="flex-1 h-px bg-border" />
          </div>
          <div className="text-center">
            <p className="text-muted-foreground text-sm mb-2">
              Are you an official?
            </p>
            <Link 
              to="/official/login" 
              className="inline-flex items-center justify-center px-4 py-2 rounded-lg border border-accent bg-accent/5 text-accent font-medium hover:bg-accent/10 transition-colors"
            >
              Official Admin Login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
