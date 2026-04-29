import { AuthLayout } from '@/components/layout/AuthLayout';
import { RegisterForm } from '@/components/auth/RegisterForm';

const Register = () => {
  return (
    <AuthLayout>
      <RegisterForm />
    </AuthLayout>
  );
};

export default Register;
