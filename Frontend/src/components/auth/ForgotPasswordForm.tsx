import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router-dom';
import { ArrowLeft, Mail, Phone, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoginMethodToggle } from '@/components/ui/LoginMethodToggle';
import { LoginMethod } from '@/types/auth';
import { 
  forgotPasswordEmailSchema, 
  forgotPasswordPhoneSchema,
  ForgotPasswordEmailData,
  ForgotPasswordPhoneData 
} from '@/lib/validation';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { authService } from '@/services/auth';

export const ForgotPasswordForm = () => {
  const { toast } = useToast();
  const [method, setMethod] = useState<LoginMethod>('email');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const emailForm = useForm<ForgotPasswordEmailData>({
    resolver: zodResolver(forgotPasswordEmailSchema),
    mode: 'onBlur',
  });

  const phoneForm = useForm<ForgotPasswordPhoneData>({
    resolver: zodResolver(forgotPasswordPhoneSchema),
    mode: 'onBlur',
  });

  const currentForm = method === 'email' ? emailForm : phoneForm;

  const handleSubmit = async (data: ForgotPasswordEmailData | ForgotPasswordPhoneData) => {
    setIsSubmitting(true);
    
    try {
      const payload =
        method === 'email'
          ? { email: (data as ForgotPasswordEmailData).email }
          : { phone: (data as ForgotPasswordPhoneData).phone };

      const response = await authService.forgotPassword(payload);
      if (response.success) {
        const message = response.data?.message || (method === 'email' 
          ? "Check your email for the password reset link" 
          : "If this phone is linked to an account, reset instructions were sent");
        setSuccessMessage(message);
        setIsSubmitted(true);
        toast({
          title: "Reset Link Sent!",
          description: message,
        });
      } else {
        toast({
          title: "Error",
          description: response.error || "Something went wrong. Please try again.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Something went wrong. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSubmitted) {
    return (
      <div className="w-full max-w-md mx-auto animate-fade-in">
        <div className="bg-card rounded-2xl shadow-card p-8 border border-border text-center">
          <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mx-auto mb-6">
            {method === 'email' ? (
              <Mail className="h-8 w-8 text-success" />
            ) : (
              <Phone className="h-8 w-8 text-success" />
            )}
          </div>
          
          <h2 className="text-xl font-heading font-bold text-foreground mb-2">
            Check Your Inbox
          </h2>
          <p className="text-muted-foreground mb-6">
            {successMessage || "If the account exists, reset instructions were sent."}
          </p>
          
          <div className="space-y-3">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setIsSubmitted(false);
                currentForm.reset();
              }}
            >
              Try Different {method === 'email' ? 'Email' : 'Phone'}
            </Button>
            
            <Link to="/login">
              <Button variant="ghost" className="w-full">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Login
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md mx-auto animate-fade-in">
      <div className="bg-card rounded-2xl shadow-card p-8 border border-border">
        {}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-heading font-bold text-foreground mb-2">
            Forgot Password?
          </h1>
          <p className="text-muted-foreground">
            No worries, we'll help you reset it
          </p>
        </div>

        <div className="mb-6">
          <Label className="text-sm font-medium text-muted-foreground mb-3 block">
            Reset Password Using
          </Label>
          <LoginMethodToggle
            selectedMethod={method}
            onSelectMethod={(m) => {
              setMethod(m);
              emailForm.reset();
              phoneForm.reset();
            }}
          />
        </div>

        <form 
          onSubmit={currentForm.handleSubmit(handleSubmit)} 
          className="space-y-5"
        >
          {method === 'email' ? (
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

          <Button
            type="submit"
            className="w-full gradient-primary hover:opacity-90 transition-opacity"
            size="lg"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                Sending...
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Send className="h-4 w-4" />
                Send Reset {method === 'email' ? 'Link' : 'OTP'}
              </div>
            )}
          </Button>
        </form>

        <div className="mt-6">
          <Link to="/login">
            <Button variant="ghost" className="w-full">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Login
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
};
