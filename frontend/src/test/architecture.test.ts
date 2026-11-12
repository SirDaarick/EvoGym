import { describe, expect, it } from 'vitest';

/**
 * Baseline of non-test files outside src/demo/ that may import demo modules.
 * Keys are paths relative to src/, values are demo module names (no extension).
 * This must only shrink: pure business helpers live in shared/formatters and domain.
 */
const ALLOWED_DEMO_IMPORTS: Record<string, string[]> = {
  'app/App.tsx': ['DemoProvider', 'inventoryOperations', 'shiftOperations'],
  'app/ProductRoutes.tsx': ['DemoProvider', 'adapter'],
  'features/gimi/GimiChatWidget.tsx': ['DemoProvider'],
  'features/gimi/GimiDashboard.tsx': ['DemoProvider'],
  'features/inventory/DemoReceptionInventory.tsx': ['DemoProvider', 'inventoryOperations'],
  'features/members/MemberDetail.tsx': ['DemoProvider', 'memberAnalyticsSelector', 'memberNotes'],
  'features/members/MemberSearch.tsx': ['DemoProvider'],
  'features/members/Members.tsx': ['DemoProvider', 'attendanceOperations', 'operations'],
  'features/members/NewMemberRegistration.tsx': ['DemoProvider', 'newMemberRegistration', 'plans'],
  'features/owner/AlertCenter.tsx': ['DemoProvider', 'alertCenterSelector'],
  'features/owner/AttendanceAnalytics.tsx': ['DemoProvider', 'adapter', 'attendanceAnalyticsSelector'],
  'features/owner/ExpenseReport.tsx': ['DemoProvider', 'adapter', 'expenseReportSelector', 'financeReportSelector', 'fixedCostsStore'],
  'features/owner/History.tsx': ['DemoProvider', 'ownerOperations'],
  'features/owner/InventoryAnalytics.tsx': ['DemoProvider', 'adapter', 'inventoryAnalyticsSelector'],
  'features/owner/Overview.tsx': ['DemoProvider', 'alertCenterSelector', 'attendanceAnalyticsSelector', 'inventoryAnalyticsSelector', 'memberAnalyticsSelector', 'ownerOperations'],
  'features/owner/OwnerMemberAnalytics.tsx': ['memberAnalyticsSelector'],
  'features/owner/PlanCatalog.tsx': ['DemoProvider', 'plans'],
  'features/owner/finance/BudgetView.tsx': ['expenseReportSelector', 'fixedCostsStore'],
  'features/owner/finance/ExpensesView.tsx': ['expenseReportSelector'],
  'features/payments/MembershipPayment.tsx': ['DemoProvider', 'operations', 'plans'],
  'features/reception/DevolucionesModal.tsx': ['returnOperations'],
  'features/reception/ExtraModal.tsx': ['DemoProvider', 'extraOperations'],
  'features/reception/GastoModal.tsx': ['DemoProvider', 'expenseOperations'],
  'features/reception/MermaModal.tsx': ['inventoryOperations'],
  'features/reception/ReceptionHome.tsx': ['DemoProvider', 'inventoryOperations', 'salesOperations'],
  'features/reception/StaffAttendanceView.tsx': ['DemoProvider', 'adapter', 'inventoryOperations', 'staffAttendanceOperations'],
  'features/reception/SuplementosModal.tsx': ['DemoProvider', 'supplementOperations'],
  'features/sales/Sales.tsx': ['DemoProvider', 'inventoryOperations', 'salesOperations'],
  'features/shifts/ShiftCloseDialog.tsx': ['DemoProvider'],
  'features/shifts/ShiftOpenModal.tsx': ['inventoryOperations'],
  'features/shifts/Shifts.tsx': ['DemoProvider', 'shiftDashboard', 'shiftOperations'],
  'features/staff/DevicePairingView.tsx': ['adapter'],
  'features/staff/StaffProfileSelection.tsx': ['adapter'],
  'features/staff/staffStore.ts': ['adapter', 'expenseReportSelector'],
};

// Raw sources of every module under src/ (keys look like '/src/domain/plans.ts').
const sources = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;

function specifiersOf(file: string): string[] {
  const source = sources[file] ?? '';
  return [...source.matchAll(SPECIFIER)].map(match => match[1]);
}

function dirOf(path: string): string { return path.slice(0, path.lastIndexOf('/')); }

/** Resolves relative and `@/` specifiers to a path relative to src/, or null for packages. */
function resolveSpecifier(file: string, specifier: string): string | null {
  let segments: string[];
  if (specifier.startsWith('@/')) segments = ['src', ...specifier.slice(2).split('/')];
  else if (specifier.startsWith('.')) segments = [...dirOf(file).split('/').filter(Boolean), ...specifier.split('/')];
  else return null;
  const out: string[] = [];
  for (const part of segments) {
    if (part === '..') out.pop();
    else if (part !== '.' && part !== '') out.push(part);
  }
  return out.slice(1).join('/');
}

const files = Object.keys(sources)
  .filter(file => !file.endsWith('.d.ts'))
  .map(file => ({ file, rel: file.replace(/^\/src\//, '') }));
const outsideDemo = files.filter(({ rel }) => !rel.startsWith('demo/'));
const isTest = (rel: string) => /\.test\.tsx?$/.test(rel) || rel.startsWith('test/');

function imports(file: string) {
  return specifiersOf(file)
    .map(specifier => ({ specifier, target: resolveSpecifier(file, specifier) }))
    .filter((item): item is { specifier: string; target: string } => item.target !== null);
}
const intoDemo = (target: string) => target === 'demo' || target.startsWith('demo/');

describe('architecture boundaries', () => {
  it('Rule A: api/, shared/ and domain/ never import demo/', () => {
    const offenders = outsideDemo
      .filter(({ rel }) => /^(api|shared|domain)\//.test(rel))
      .flatMap(({ rel, file }) => imports(file).filter(item => intoDemo(item.target)).map(item => `${rel} -> ${item.specifier}`));
    expect(offenders, `Forbidden demo/ imports:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('Rule B: other non-test files import only allowlisted demo modules', () => {
    const offenders = outsideDemo
      .filter(({ rel }) => !/^(api|shared|domain)\//.test(rel) && !isTest(rel))
      .flatMap(({ rel, file }) => imports(file)
        .filter(item => intoDemo(item.target))
        .filter(item => !(ALLOWED_DEMO_IMPORTS[rel] ?? []).includes(item.target.replace(/^demo\//, '')))
        .map(item => `${rel} -> ${item.specifier} (not in ALLOWED_DEMO_IMPORTS)`));
    expect(offenders, `New demo/ imports are not allowed; move pure logic to shared/ or domain/:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('Rule B: the allowlist has no stale entries', () => {
    const stale = Object.entries(ALLOWED_DEMO_IMPORTS).flatMap(([rel, modules]) => {
      const entry = outsideDemo.find(item => item.rel === rel);
      if (!entry) return [`${rel} (file not found)`];
      const used = new Set(imports(entry.file).filter(item => intoDemo(item.target)).map(item => item.target.replace(/^demo\//, '')));
      return modules.filter(name => !used.has(name)).map(name => `${rel} -> ${name}`);
    });
    expect(stale, `Remove stale ALLOWED_DEMO_IMPORTS entries:\n${stale.join('\n')}`).toEqual([]);
  });

  it('Rule C: shared/formatters and domain stay pure (no features/ or api/ imports)', () => {
    const offenders = outsideDemo
      .filter(({ rel }) => /^(shared\/formatters|domain)\//.test(rel))
      .flatMap(({ rel, file }) => imports(file)
        .filter(item => /^(features|api)(\/|$)/.test(item.target))
        .map(item => `${rel} -> ${item.specifier}`));
    expect(offenders, `Pure modules must not import features/ or api/:\n${offenders.join('\n')}`).toEqual([]);
  });
});
