import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, Lock, CheckCircle2 } from 'lucide-react';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { resetPasswordSchema, ResetPasswordData } from '@/lib/validation';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { authService } from '@/services/auth';

const ResetPassword = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const form = useForm<ResetPasswordData>({
    resolver: zodResolver(resetPasswordSchema),
    mode: 'onBlur'
  });

  const onSubmit = async (data: ResetPasswordData) => {
    if (!token) {
      toast({
        title: 'Invalid Link',
        description: 'Reset token is missing',
        variant: 'destructive'
      });
      return;
    }
    setSubmitting(true);
    try {
      const response = await authService.resetPassword(token, data.password);
      if (response.success) {
        setDone(true);
      } else {
        toast({
          title: 'Reset Failed',
          description: response.error || 'Unable to reset password',
          variant: 'destructive'
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      <div className="w-full max-w-md mx-auto animate-fade-in">
        <div className="bg-card rounded-2xl shadow-card p-8 border border-border">
          {!done && (
            <>
              <div className="text-center mb-8">
                <h1 className="text-2xl font-heading font-bold text-foreground mb-2">Reset Password</h1>
                <p className="text-muted-foreground">Set a new secure password for your account</p>
              </div>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="password">New Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      {...form.register('password')}
                      className={cn(
                        'pr-10',
                        form.formState.errors.password && 'border-destructive focus-visible:ring-destructive'
                      )}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {form.formState.errors.password && (
                    <p className="text-sm text-destructive">{form.formState.errors.password.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm Password</Label>
                  <div className="relative">
                    <Input
                      id="confirmPassword"
                      type={showConfirm ? 'text' : 'password'}
                      autoComplete="new-password"
                      {...form.register('confirmPassword')}
                      className={cn(
                        'pr-10',
                        form.formState.errors.confirmPassword && 'border-destructive focus-visible:ring-destructive'
                      )}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {form.formState.errors.confirmPassword && (
                    <p className="text-sm text-destructive">{form.formState.errors.confirmPassword.message}</p>
                  )}
                </div>
                <Button type="submit" className="w-full gradient-primary hover:opacity-90" disabled={submitting}>
                  {submitting ? (
                    <span className="flex items-center gap-2">
                      <span className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                      Updating...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Lock className="h-4 w-4" />
                      Update Password
                    </span>
                  )}
                </Button>
              </form>
            </>
          )}
          {done && (
            <div className="text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-success/10 flex items-center justify-center mx-auto">
                <CheckCircle2 className="h-8 w-8 text-success" />
              </div>
              <h2 className="text-xl font-heading font-bold text-foreground">Password Updated</h2>
              <p className="text-muted-foreground">Your password has been reset successfully.</p>
              <Button
                className="w-full"
                onClick={() => navigate('/login')}
              >
                Go to Login
              </Button>
              <Link to="/login" className="block text-sm text-primary hover:text-primary/80">
                Sign in now
              </Link>
            </div>
          )}
        </div>
      </div>
    </AuthLayout>
  );
};

export default ResetPassword;
