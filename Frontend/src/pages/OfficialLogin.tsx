import { AuthLayout } from '@/components/layout/AuthLayout';
import { OfficialLoginFormComponent } from '@/components/auth/OfficialLoginFormComponent';

const OfficialLogin = () => {
  return (
    <AuthLayout>
      <OfficialLoginFormComponent />
    </AuthLayout>
  );
};

export default OfficialLogin;
