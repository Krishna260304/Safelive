import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, UserPlus, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { LoginTypeSelector } from '@/components/ui/LoginTypeSelector';
import { UserType } from '@/types/auth';
import { registrationSchema, RegistrationFormData } from '@/lib/validation';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { authService } from '@/services/auth';

const OFFICIAL_ROLE_OPTIONS = [
  { value: 'department', label: 'Department' },
  { value: 'worker', label: 'Worker' },
] as const;

const WORKER_SPECIALIZATIONS = [
  'Road Maintenance Worker',
  'Electrician',
  'Plumber',
  'Drainage Worker',
  'Sanitation Worker',
  'Water Supply Technician',
  'Technician',
  'Emergency Response Worker',
  'Security Officer',
  'Complaint Manager',
  'Operations Manager',
  'General Worker',
  'Other',
] as const;

export const RegisterForm = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const typeParam = searchParams.get('type');
  const roleParam = searchParams.get('role');
  const requestedUserType: UserType =
    typeParam === 'official'
      ? 'official'
      : 'local';
  const requestedOfficialRole: RegistrationFormData['officialRole'] | undefined =
    roleParam === 'department' || roleParam === 'worker' ? roleParam : undefined;

  const [userType, setUserType] = useState<UserType>(requestedUserType);

  const form = useForm<RegistrationFormData>({
    resolver: zodResolver(registrationSchema),
    mode: 'onBlur',
    defaultValues: {
      userType: requestedUserType,
      officialRole: requestedUserType === 'official' ? requestedOfficialRole : undefined,
    },
  });

  const { setValue } = form;

  useEffect(() => {
    setUserType(requestedUserType);
    setValue('userType', requestedUserType);

    if (requestedUserType !== 'official') {
      setValue('officialRole', undefined);
      setValue('workerSpecialization', undefined);
      return;
    }
    setValue('officialRole', requestedOfficialRole, { shouldValidate: true });
    if (requestedOfficialRole !== 'worker') {
      setValue('workerSpecialization', undefined);
    }
  }, [requestedUserType, requestedOfficialRole, setValue]);

  const password = form.watch('password', '');
  const selectedOfficialRole = form.watch('officialRole');

  const passwordRequirements = [
    { label: 'At least 8 characters', met: password.length >= 8 },
    { label: 'One uppercase letter', met: /[A-Z]/.test(password) },
    { label: 'One lowercase letter', met: /[a-z]/.test(password) },
    { label: 'One number', met: /[0-9]/.test(password) },
    { label: 'One special character', met: /[^A-Za-z0-9]/.test(password) },
  ];

  const handleSubmit = async (data: RegistrationFormData) => {
    setIsSubmitting(true);

    let backendUserType: 'citizen' | 'official';
    if (data.userType === 'local') {
      backendUserType = 'citizen';
    } else {
      backendUserType = 'official';
    }

    try {
      const response = await authService.register({
        name: data.fullName,
        email: data.email?.trim() || undefined,
        phone: data.phone,
        password: data.password,
        userType: backendUserType,
        address: data.address,
        pincode: data.pincode,
        officialRole: data.userType === 'official' ? data.officialRole : undefined,
        workerSpecialization:
          data.userType === 'official' && data.officialRole === 'worker'
            ? data.workerSpecialization
            : undefined,
      });

      if (response.success) {
        toast({
          title: 'Registration Successful!',
          description: 'Your account has been created successfully.',
        });

        setTimeout(() => {
          const nextUserType = response.data?.user.userType;
          if (nextUserType === 'official') {
            navigate('/official/dashboard');
            return;
          }
          navigate('/dashboard');
        }, 1000);
      } else {
        toast({
          title: 'Registration Failed',
          description: response.error || 'An error occurred. Please try again.',
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Registration Failed',
        description: 'Unable to connect to server. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-lg mx-auto animate-fade-in">
      <div className="bg-card rounded-2xl shadow-card p-8 border border-border">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-heading font-bold text-foreground mb-2">
            Create Account
          </h1>
          <p className="text-muted-foreground">
            Join SafeLive to report and track incidents
          </p>
        </div>

        <div className="mb-6">
          <Label className="text-sm font-medium text-muted-foreground mb-3 block">
            Select Account Type
          </Label>
          <LoginTypeSelector
            selectedType={userType}
            onSelectType={(type) => {
              setUserType(type);
              form.setValue('userType', type);

              if (type !== 'official') {
                form.setValue('officialRole', undefined);
                form.setValue('workerSpecialization', undefined);
              }
            }}
          />
        </div>

        {userType === 'official' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div className="space-y-2 sm:col-span-2">
              <Label>Official Role</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {OFFICIAL_ROLE_OPTIONS.map((role) => (
                  <button
                    key={role.value}
                    type="button"
                    className={cn(
                      'h-10 rounded-md border text-sm font-medium transition-colors',
                      selectedOfficialRole === role.value
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background border-input hover:bg-muted'
                    )}
                    onClick={() => {
                      form.setValue('officialRole', role.value as RegistrationFormData['officialRole'], {
                        shouldValidate: true,
                      });
                      if (role.value !== 'worker') {
                        form.setValue('workerSpecialization', undefined, { shouldValidate: true });
                      }
                    }}
                  >
                    {role.label}
                  </button>
                ))}
              </div>
              {form.formState.errors.officialRole && (
                <p className="text-sm text-destructive">{form.formState.errors.officialRole.message}</p>
              )}
            </div>

            {selectedOfficialRole === 'worker' && (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="workerSpecialization">Worker Category</Label>
                <select
                  id="workerSpecialization"
                  className={cn(
                    'h-10 w-full rounded-md border border-input bg-background px-3 text-sm',
                    form.formState.errors.workerSpecialization && 'border-destructive focus-visible:ring-destructive'
                  )}
                  value={form.watch('workerSpecialization') || ''}
                  onChange={(e) => form.setValue('workerSpecialization', e.target.value || undefined, { shouldValidate: true })}
                >
                  <option value="">Select worker category</option>
                  {WORKER_SPECIALIZATIONS.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
                {form.formState.errors.workerSpecialization && (
                  <p className="text-sm text-destructive">{form.formState.errors.workerSpecialization.message}</p>
                )}
              </div>
            )}
          </div>
        )}

        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="fullName">Full Name</Label>
            <Input
              id="fullName"
              placeholder="Enter your name"
              autoComplete="name"
              {...form.register('fullName')}
              className={cn(
                form.formState.errors.fullName && 'border-destructive focus-visible:ring-destructive'
              )}
            />
            {form.formState.errors.fullName && (
              <p className="text-sm text-destructive">
                {form.formState.errors.fullName.message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="abc@gmail.com"
                autoComplete="email"
                {...form.register('email')}
                className={cn(
                  form.formState.errors.email && 'border-destructive focus-visible:ring-destructive'
                )}
              />
              {form.formState.errors.email && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.email.message}
                </p>
              )}
            </div>

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
                  {...form.register('phone')}
                  className={cn(
                    'h-10 flex-1',
                    form.formState.errors.phone && 'border-destructive focus-visible:ring-destructive'
                  )}
                />
              </div>
              {form.formState.errors.phone && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.phone.message}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="address">Address</Label>
            <Textarea
              id="address"
              placeholder="Enter your complete address"
              rows={3}
              {...form.register('address')}
              className={cn(
                'resize-none',
                form.formState.errors.address && 'border-destructive focus-visible:ring-destructive'
              )}
            />
            {form.formState.errors.address && (
              <p className="text-sm text-destructive">
                {form.formState.errors.address.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="pincode">Pincode</Label>
            <Input
              id="pincode"
              type="text"
              inputMode="numeric"
              placeholder="123456"
              maxLength={6}
              {...form.register('pincode')}
              className={cn(
                'w-32',
                form.formState.errors.pincode && 'border-destructive focus-visible:ring-destructive'
              )}
            />
            {form.formState.errors.pincode && (
              <p className="text-sm text-destructive">
                {form.formState.errors.pincode.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Create a strong password"
                autoComplete="new-password"
                {...form.register('password')}
                className={cn(
                  'pr-10',
                  form.formState.errors.password && 'border-destructive focus-visible:ring-destructive'
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

            {password && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                {passwordRequirements.map((req, index) => (
                  <div key={index} className="flex items-center gap-1.5">
                    <CheckCircle2
                      className={cn(
                        'h-3.5 w-3.5 transition-colors',
                        req.met ? 'text-success' : 'text-muted-foreground/40'
                      )}
                    />
                    <span className={cn(
                      'text-xs transition-colors',
                      req.met ? 'text-success' : 'text-muted-foreground'
                    )}>
                      {req.label}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <div className="relative">
              <Input
                id="confirmPassword"
                type={showConfirmPassword ? 'text' : 'password'}
                placeholder="Confirm your password"
                autoComplete="new-password"
                {...form.register('confirmPassword')}
                className={cn(
                  'pr-10',
                  form.formState.errors.confirmPassword && 'border-destructive focus-visible:ring-destructive'
                )}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {form.formState.errors.confirmPassword && (
              <p className="text-sm text-destructive">
                {form.formState.errors.confirmPassword.message}
              </p>
            )}
          </div>

          <Button
            type="submit"
            className="w-full gradient-primary hover:opacity-90 transition-opacity"
            size="lg"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                Creating Account...
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <UserPlus className="h-4 w-4" />
                Create Account
              </div>
            )}
          </Button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-muted-foreground">
            Already have an account?{' '}
            <Link
              to={userType === 'official' ? '/official/login' : '/login'}
              className="text-primary font-medium hover:text-primary/80 transition-colors"
            >
              Sign In
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};
