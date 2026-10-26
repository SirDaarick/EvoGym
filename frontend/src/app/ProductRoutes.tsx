import { Navigate, useLocation } from 'react-router';
import { StaffProfileSelection } from '../features/staff/StaffProfileSelection';
import { useProductAccess } from '../features/auth/ProductAccessProvider';
import { DemoProvider } from '../demo/DemoProvider';
import { App } from './App';
import { ApiProductApp } from './ApiProductApp';
import { isDemoModeEnabled } from '../demo/adapter';

export function ProductRoutes() {
  const location = useLocation();
  const access = useProductAccess();
  const principal = access.principal;
  const isAuthRoute = location.pathname === '/' || location.pathname === '/login' || location.pathname === '/profiles';

  if (isAuthRoute) {
    if (principal) {
      return <Navigate to={principal.kind === 'admin' ? '/owner/overview' : '/reception/home'} replace />;
    }
    return <StaffProfileSelection />;
  }

  const demoAllowed = isDemoModeEnabled();
  const isDemo = demoAllowed && !principal && typeof window !== 'undefined' && window.sessionStorage.getItem('evogym:demo-mode') === 'true';

  if (!principal && !isDemo) {
    return <Navigate to="/" replace />;
  }

  if (principal) return <ApiProductApp />;
  if (!demoAllowed || !isDemo) return <Navigate to="/" replace />;
  return <DemoProvider><App /></DemoProvider>;
}
