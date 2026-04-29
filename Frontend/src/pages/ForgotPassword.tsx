import { AuthLayout } from '@/components/layout/AuthLayout';
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';

const ForgotPassword = () => {
  return (
    <AuthLayout>
      <ForgotPasswordForm />
    </AuthLayout>
  );
};

export default ForgotPassword;
