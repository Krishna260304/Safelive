import { AuthLayout } from '@/components/layout/AuthLayout';
import { LoginForm } from '@/components/auth/LoginForm';
import { Navigate, useSearchParams } from 'react-router-dom';

const Login = () => {
  const [searchParams] = useSearchParams();

  if (searchParams.get('type') === 'official') {
    return <Navigate to="/official/login" replace />;
  }

  return (
    <AuthLayout>
      <LoginForm />
    </AuthLayout>
  );
};

export default Login;
