import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { authService } from '@/services/auth';

type RouteGuardProps = {
  role?: 'citizen' | 'official' | 'head_supervisor';
};

export const RouteGuard = ({ role }: RouteGuardProps) => {
  const location = useLocation();
  const isAuthenticated = authService.isAuthenticated();
  const user = authService.getCurrentUser();

  if (!isAuthenticated || !user) {
    const loginPath = location.pathname.startsWith('/official') ? '/official/login' : '/login';
    return <Navigate to={loginPath} replace />;
  }

  if (!role) {
    return <Outlet />;
  }

  const redirectToOfficial = <Navigate to="/official/dashboard" replace />;

  if (role === 'head_supervisor') {
    if (user.userType !== 'head_supervisor') {
      if (user.userType === 'official') {
        return redirectToOfficial;
      }
      return <Navigate to="/dashboard" replace />;
    }
    return <Outlet />;
  }

  if (role === 'official') {
    if (user.userType !== 'official') {
      if (user.userType === 'head_supervisor') {
        return redirectToOfficial;
      }
      return <Navigate to="/dashboard" replace />;
    }
    return <Outlet />;
  }

  if (role === 'citizen' && user.userType !== 'citizen') {
    if (user.userType === 'official') {
      return redirectToOfficial;
    }
    if (user.userType === 'head_supervisor') {
      return redirectToOfficial;
    }
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
};











