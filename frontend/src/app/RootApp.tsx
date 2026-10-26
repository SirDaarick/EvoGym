import { AdminAccessApp } from '../features/auth/AdminAccessApp';
import { FirstPinChangePage } from '../features/auth/FirstPinChangePage';
import { ProductAccessProvider } from '../features/auth/ProductAccessProvider';
import { ProductRoutes } from './ProductRoutes';
import { useLocation } from 'react-router';

function isAdminEmailAction(search: string): boolean {
  const query = new URLSearchParams(search);
  return query.has('approval_token') || query.has('token');
}

export function RootApp() {
  const location = useLocation();
  if (location.pathname === '/staff/first-pin-change') return <FirstPinChangePage />;
  if (location.pathname.startsWith('/admin') && isAdminEmailAction(location.search)) return <AdminAccessApp />;
  if (location.pathname === '/admin/recovery') return <AdminAccessApp />;

  return <ProductAccessProvider>
    <ProductRoutes />
  </ProductAccessProvider>;
}
