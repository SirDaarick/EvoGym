// Re-export barrel. Implementation lives in ./staff (container / presentational split).
import { DemoStaffManagement } from './staff/DemoStaffManagement';

export type { ManagedStaffProfile } from './staff/utils';
export { DemoStaffManagement as StaffManagement } from './staff/DemoStaffManagement';
export { ApiStaffManagement } from './staff/ApiStaffManagement';

export function LiveStaffManagement() {
  return <DemoStaffManagement />;
}
