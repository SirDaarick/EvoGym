import { beforeEach, describe, expect, it } from 'vitest';
import type { DemoState, ExpenseRecord, ExtraRecord, StockMovement } from '../domain/models';
import { createDemoState } from './adapter';
import {
  classifyExpenseConcept,
  computeFixedCostsSummary,
  getExpenseReport,
  type ExpensePeriodInput,
} from './expenseReportSelector';
import {
  DEFAULT_FIXED_COSTS,
  resetFixedCosts,
  saveFixedCosts,
} from './fixedCostsStore';
import {
  resetStaff,
  saveStaffProfile,
  toggleStaffActive,
} from '../features/staff/staffStore';

describe('expenseReportSelector', () => {
  const baseClock = '2026-10-08T12:00:00-06:00';

  beforeEach(() => {
    resetFixedCosts();
    resetStaff();
    if (typeof window !== 'undefined') {
      window.localStorage?.clear();
      window.sessionStorage?.clear();
    }
  });

  function buildStateWithExpenses(overrides?: {
    expenses?: ExpenseRecord[];
    extras?: ExtraRecord[];
    stockMovements?: StockMovement[];
  }): DemoState {
    const base = createDemoState();
    return {
      ...base,
      demoClock: baseClock,
      expenses: overrides?.expenses ?? base.expenses ?? [],
      extras: overrides?.extras ?? base.extras ?? [],
      stockMovements: overrides?.stockMovements ?? base.stockMovements ?? [],
    };
  }

  describe('category clustering with Excel categories', () => {
    it('classifies concepts into Consumibles, Limpieza, Mantenimiento (Piso/Peso/Cardio/Box), Servicios, and General', () => {
      // Consumibles
      expect(classifyExpenseConcept('Agua purificada para garrafón')).toBe('Consumibles');
      expect(classifyExpenseConcept('Vasos desechables y café')).toBe('Consumibles');

      // Limpieza
      expect(classifyExpenseConcept('Compra de cloro, jabón y detergente')).toBe('Limpieza');
      expect(classifyExpenseConcept('Toallas desinfectantes y sanitizante')).toBe('Limpieza');

      // Mantenimiento subcategories
      expect(classifyExpenseConcept('Piso de caucho y losetas rotas')).toBe('Mantenimiento: Piso');
      expect(classifyExpenseConcept('Mantenimiento de pesas y mancuernas')).toBe('Mantenimiento: Peso');
      expect(classifyExpenseConcept('Reparación de caminadora y polea')).toBe('Mantenimiento: Cardio');
      expect(classifyExpenseConcept('Reparación de costal de box y guantes')).toBe('Mantenimiento: Box');

      // Servicios
      expect(classifyExpenseConcept('Recibo de luz CFE')).toBe('Servicios');
      expect(classifyExpenseConcept('Servicio de internet Telmex')).toBe('Servicios');

      // General fallback
      expect(classifyExpenseConcept('Trámite de permisos municipales')).toBe('General');
    });
  });

  describe('fixed costs structure and break-even calculations', () => {
    it('provides fixed costs matching master Excel: Renta $66k, Nómina $80k, Servicios $18k = $164,000/mes', () => {
      const state = buildStateWithExpenses();
      const report = getExpenseReport(state, 'month');

      expect(report.fixedCosts.rentMinor).toBe(6600000); // $66,000.00
      expect(report.fixedCosts.payrollMinor).toBe(8000000); // $80,000.00
      expect(report.fixedCosts.servicesMinor).toBe(1800000); // $18,000.00
      expect(report.fixedCosts.totalFixedMonthlyMinor).toBe(16400000); // $164,000.00

      // Services breakdown
      expect(report.fixedCosts.servicesBreakdown.aguaMinor).toBe(900000); // $9,000.00
      expect(report.fixedCosts.servicesBreakdown.luzMinor).toBe(800000); // $8,000.00
      expect(report.fixedCosts.servicesBreakdown.internetMinor).toBe(80000); // $800.00
      expect(report.fixedCosts.servicesBreakdown.basuraMinor).toBe(20000); // $200.00
    });

    it('calculates daily break-even ($8,200/día) and per-shift break-even ($4,100/turno)', () => {
      const state = buildStateWithExpenses();
      const report = getExpenseReport(state, 'month');

      expect(report.fixedCosts.dailyBreakEvenMinor).toBe(820000); // $8,200.00
      expect(report.fixedCosts.perShiftBreakEvenMinor).toBe(410000); // $4,100.00 (from Excel: $4,100 por turno)
      expect(report.fixedCosts.weeklyBreakEvenMinor).toBe(4100000); // $41,000.00
      expect(report.kpis.dailyBreakEvenFormatted).toBe('$8,200.00');
    });

    it('contains exact 9-member payroll schedule summing to $80,000/mes ($20,000/semana)', () => {
      const state = buildStateWithExpenses();
      const report = getExpenseReport(state, 'month');

      const staff = report.fixedCosts.staffPayroll;
      expect(staff).toHaveLength(9);

      const totalMonthly = staff.reduce((sum, s) => sum + s.monthlySalaryMinor, 0);
      const totalWeekly = staff.reduce((sum, s) => sum + s.weeklySalaryMinor, 0);
      expect(totalMonthly).toBe(8000000); // $80,000.00
      expect(totalWeekly).toBe(2000000); // $20,000.00

      // Verify specific staff members from Excel
      const emigdio = staff.find(s => s.name === 'Emigdio');
      expect(emigdio?.monthlySalaryMinor).toBe(1400000); // $14,000
      expect(emigdio?.weeklySalaryMinor).toBe(350000); // $3,500
      expect(emigdio?.dailySalaryMinor).toBe(70000); // $700

      const silvia = staff.find(s => s.name === 'Silvia');
      expect(silvia?.monthlySalaryMinor).toBe(800000); // $8,000
      expect(silvia?.weeklySalaryMinor).toBe(200000); // $2,000

      const inaky = staff.find(s => s.name === 'Iñaky');
      expect(inaky?.monthlySalaryMinor).toBe(400000); // $4,000
      expect(inaky?.weeklySalaryMinor).toBe(100000); // $1,000
    });

    it('calculates consolidated total combining prorated fixed costs and variable expenses', () => {
      const state = buildStateWithExpenses({
        expenses: [
          {
            id: 'exp-1',
            concept: 'Agua purificada para garrafón',
            payeeName: 'Agua Cristalina',
            amountMinor: 7000, // $70.00
            shiftId: 'demo-shift-01',
            recordedAt: '2026-10-08T09:00:00-06:00',
          },
        ],
      });

      // Month period
      const monthReport = getExpenseReport(state, 'month');
      expect(monthReport.kpis.proratedFixedMinor).toBe(16400000); // $164,000.00
      expect(monthReport.kpis.totalMinor).toBe(7000); // $70.00
      expect(monthReport.kpis.consolidatedTotalMinor).toBe(16407000); // $164,070.00
      expect(monthReport.kpis.consolidatedTotalFormatted).toBe('$164,070.00');

      // Week period
      const weekReport = getExpenseReport(state, 'week');
      expect(weekReport.kpis.proratedFixedMinor).toBe(4100000); // $41,000.00
      expect(weekReport.kpis.consolidatedTotalMinor).toBe(4107000); // $41,070.00
      expect(weekReport.kpis.consolidatedTotalFormatted).toBe('$41,070.00');
    });

    it('provides major cost blocks for TanStack Chart comparison (Nómina, Renta, Servicios, Variables)', () => {
      const state = buildStateWithExpenses({
        expenses: [
          {
            id: 'exp-var',
            concept: 'Toallas y cloro',
            payeeName: 'Abarrotes',
            amountMinor: 15000, // $150.00
            shiftId: 'demo-shift-01',
            recordedAt: '2026-10-08T09:00:00-06:00',
          },
        ],
      });

      const report = getExpenseReport(state, 'month');
      const blocks = report.majorCostBlocks;

      expect(blocks).toHaveLength(4);
      const payrollBlock = blocks.find(b => b.name === 'Nómina');
      expect(payrollBlock?.amountMinor).toBe(8000000); // $80,000

      const rentBlock = blocks.find(b => b.name === 'Renta');
      expect(rentBlock?.amountMinor).toBe(6600000); // $66,000

      const servicesBlock = blocks.find(b => b.name === 'Servicios');
      expect(servicesBlock?.amountMinor).toBe(1800000); // $18,000

      const varBlock = blocks.find(b => b.name === 'Variables');
      expect(varBlock?.amountMinor).toBe(15000); // $150
    });
  });

  describe('SSOT dynamic reactivity with fixedCostsStore and staffStore', () => {
    it('updates break-even and OPEX when fixedCostsStore is modified', () => {
      const state = buildStateWithExpenses();

      // Initial state
      const initialReport = getExpenseReport(state, 'month');
      expect(initialReport.fixedCosts.rentMinor).toBe(6600000);
      expect(initialReport.fixedCosts.totalFixedMonthlyMinor).toBe(16400000);

      // Modify rent via store
      saveFixedCosts({ rentMinor: 7000000 }); // +$4,000

      const updatedReport = getExpenseReport(state, 'month');
      expect(updatedReport.fixedCosts.rentMinor).toBe(7000000);
      expect(updatedReport.fixedCosts.totalFixedMonthlyMinor).toBe(16800000); // $168,000
      expect(updatedReport.fixedCosts.dailyBreakEvenMinor).toBe(840000); // $8,400/día
      expect(updatedReport.fixedCosts.perShiftBreakEvenMinor).toBe(420000); // $4,200/turno
      expect(updatedReport.fixedCosts.weeklyBreakEvenMinor).toBe(4200000); // $42,000/semana
    });

    it('dynamically recalculates total payroll when staff salary or active status changes', () => {
      const state = buildStateWithExpenses();

      // Deactivate Iñaky ($4,000 / 400000 minor)
      toggleStaffActive('staff-inaky');

      const reportAfterDeactivate = getExpenseReport(state, 'month');
      expect(reportAfterDeactivate.fixedCosts.staffPayroll).toHaveLength(8);
      expect(reportAfterDeactivate.fixedCosts.payrollMinor).toBe(7600000); // $76,000 ($80k - $4k)
      expect(reportAfterDeactivate.fixedCosts.totalFixedMonthlyMinor).toBe(16000000); // $160,000

      // Update Silvia's salary from $8,000 to $10,000
      saveStaffProfile({
        id: 'staff-silvia',
        name: 'Silvia',
        role: 'RECEPTION',
        shift: 'Matutino',
        salaryMinor: 1000000,
        active: true,
        hasPin: true,
      });

      const reportAfterRaise = getExpenseReport(state, 'month');
      expect(reportAfterRaise.fixedCosts.payrollMinor).toBe(7800000); // $78,000
      const silviaItem = reportAfterRaise.fixedCosts.staffPayroll.find(s => s.name === 'Silvia');
      expect(silviaItem?.monthlySalaryMinor).toBe(1000000);
      expect(silviaItem?.weeklySalaryMinor).toBe(250000);
    });

    it('respects direct options passed into getExpenseReport without modifying stores', () => {
      const state = buildStateWithExpenses();

      const customReport = getExpenseReport(state, 'month', undefined, {
        fixedCosts: {
          ...DEFAULT_FIXED_COSTS,
          rentMinor: 5000000, // $50,000
        },
      });

      expect(customReport.fixedCosts.rentMinor).toBe(5000000);
      expect(customReport.fixedCosts.totalFixedMonthlyMinor).toBe(14800000);
    });
  });

  describe('strict domain boundary', () => {
    it('never mixes receptionist extras, stock movements or inventory waste into expenses', () => {
      const state = buildStateWithExpenses({
        expenses: [
          {
            id: 'exp-1',
            concept: 'Agua para recepción',
            payeeName: 'Agua Cristalina',
            amountMinor: 7000,
            shiftId: 'demo-shift-01',
            recordedAt: '2026-10-08T09:00:00-06:00',
          },
        ],
        extras: [
          {
            id: 'extra-1',
            concept: 'Feria propia para dar cambio',
            staffName: 'Mariana López',
            amountMinor: 50000, // Should NOT be in expenses!
            shiftId: 'demo-shift-01',
            recordedAt: '2026-10-08T10:00:00-06:00',
          },
        ],
        stockMovements: [
          {
            id: 'move-waste-1',
            productId: 'demo-water',
            shiftId: 'demo-shift-01',
            kind: 'waste',
            quantity: 3,
            recordedAt: '2026-10-08T11:00:00-06:00',
          },
        ],
      });

      const report = getExpenseReport(state, 'all');

      expect(report.kpis.count).toBe(1);
      expect(report.kpis.totalMinor).toBe(7000);
      expect(report.items).toHaveLength(1);
      expect(report.items[0].id).toBe('exp-1');
      expect(report.items.some(i => i.id === 'extra-1' || i.id === 'move-waste-1')).toBe(false);
    });

    it('handles null/undefined expenses safely with zero variable KPIs while retaining fixed structure', () => {
      const state = { ...createDemoState(), expenses: undefined };
      const report = getExpenseReport(state, 'all');

      expect(report.kpis.count).toBe(0);
      expect(report.kpis.totalMinor).toBe(0);
      expect(report.kpis.averageMinor).toBe(0);
      expect(report.items).toEqual([]);
      expect(report.categoryDistribution).toEqual([]);
      expect(report.byShift).toEqual([]);
      expect(report.fixedCosts.totalFixedMonthlyMinor).toBe(16400000);
    });
  });

  describe('period filtering anchored to demoClock', () => {
    const multiDateState = buildStateWithExpenses({
      expenses: [
        {
          id: 'exp-today',
          concept: 'Insumo toallas húmedas',
          payeeName: 'Suministros Gym',
          amountMinor: 10000,
          shiftId: 'demo-shift-01',
          recordedAt: '2026-10-08T08:00:00-06:00', // Today
        },
        {
          id: 'exp-3days-ago',
          concept: 'Servicio de internet',
          payeeName: 'Telmex',
          amountMinor: 65000,
          shiftId: 'demo-shift-previous',
          recordedAt: '2026-10-05T10:00:00-06:00', // 3 days ago (in week)
        },
        {
          id: 'exp-15days-ago',
          concept: 'Mantenimiento de pesas',
          payeeName: 'Herrería El Güero',
          amountMinor: 40000,
          shiftId: 'demo-shift-old',
          recordedAt: '2026-09-23T16:00:00-06:00', // 15 days ago (not in week, in month)
        },
        {
          id: 'exp-60days-ago',
          concept: 'Pintura y brocha',
          payeeName: 'Comex',
          amountMinor: 30000,
          shiftId: 'demo-shift-archive',
          recordedAt: '2026-08-09T11:00:00-06:00', // 60 days ago (only in all)
        },
      ],
    });

    it('filters for "week" (last 7 days from demoClock)', () => {
      const report = getExpenseReport(multiDateState, 'week');
      expect(report.kpis.count).toBe(2);
      expect(report.kpis.totalMinor).toBe(75000);
      const ids = report.items.map(i => i.id);
      expect(ids).toContain('exp-today');
      expect(ids).toContain('exp-3days-ago');
      expect(ids).not.toContain('exp-15days-ago');
      expect(ids).not.toContain('exp-60days-ago');
    });

    it('filters for "month" (last 30 days from demoClock)', () => {
      const report = getExpenseReport(multiDateState, 'month');
      expect(report.kpis.count).toBe(3);
      expect(report.kpis.totalMinor).toBe(115000);
      const ids = report.items.map(i => i.id);
      expect(ids).toContain('exp-today');
      expect(ids).toContain('exp-3days-ago');
      expect(ids).toContain('exp-15days-ago');
      expect(ids).not.toContain('exp-60days-ago');
    });

    it('returns everything for "all"', () => {
      const report = getExpenseReport(multiDateState, 'all');
      expect(report.kpis.count).toBe(4);
      expect(report.kpis.totalMinor).toBe(145000);
      expect(report.kpis.averageMinor).toBe(Math.round(145000 / 4));
    });

    it('filters correctly for "custom" period date range', () => {
      const customInput: ExpensePeriodInput = {
        period: 'custom',
        customRange: { from: '2026-09-20', to: '2026-09-30' },
      };
      const report = getExpenseReport(multiDateState, customInput);
      expect(report.kpis.count).toBe(1);
      expect(report.items[0].id).toBe('exp-15days-ago');
    });

    it('supports direct date range object as period input', () => {
      const report = getExpenseReport(multiDateState, { from: '2026-10-01', to: '2026-10-08' });
      expect(report.kpis.count).toBe(2);
      const ids = report.items.map(i => i.id);
      expect(ids).toContain('exp-today');
      expect(ids).toContain('exp-3days-ago');
    });
  });

  describe('KPI aggregations, shift breakdown, and variable chart data', () => {
    it('aggregates category distribution with percentages, amounts, and colors', () => {
      const state = buildStateWithExpenses({
        expenses: [
          {
            id: 'e1',
            concept: 'Cloro y desinfectante de pisos', // Limpieza
            payeeName: 'Abarrotes Don Pepe',
            amountMinor: 3000,
            shiftId: 'demo-shift-01',
            recordedAt: '2026-10-08T08:00:00-06:00',
          },
          {
            id: 'e2',
            concept: 'Agua para garrafón', // Consumibles
            payeeName: 'Agua Ciel',
            amountMinor: 7000,
            shiftId: 'demo-shift-01',
            recordedAt: '2026-10-08T09:00:00-06:00',
          },
          {
            id: 'e3',
            concept: 'Pago CFE bimestre', // Servicios
            payeeName: 'CFE',
            amountMinor: 90000,
            shiftId: 'demo-shift-previous',
            recordedAt: '2026-10-07T15:00:00-06:00',
          },
        ],
      });

      const report = getExpenseReport(state, 'all');

      expect(report.kpis.totalMinor).toBe(100000);
      expect(report.kpis.count).toBe(3);
      expect(report.kpis.averageMinor).toBe(33333);

      // Category breakdown
      const consumibles = report.categoryDistribution.find(c => c.category === 'Consumibles');
      expect(consumibles).toBeDefined();
      expect(consumibles?.totalMinor).toBe(7000);
      expect(consumibles?.count).toBe(1);
      expect(consumibles?.percent).toBe(7);

      const limpieza = report.categoryDistribution.find(c => c.category === 'Limpieza');
      expect(limpieza).toBeDefined();
      expect(limpieza?.totalMinor).toBe(3000);
      expect(limpieza?.count).toBe(1);
      expect(limpieza?.percent).toBe(3);

      const servicios = report.categoryDistribution.find(c => c.category === 'Servicios');
      expect(servicios).toBeDefined();
      expect(servicios?.totalMinor).toBe(90000);
      expect(servicios?.count).toBe(1);
      expect(servicios?.percent).toBe(90);

      // By shift breakdown
      expect(report.byShift).toHaveLength(2);
      const shift01 = report.byShift.find(s => s.shiftId === 'demo-shift-01');
      expect(shift01).toBeDefined();
      expect(shift01?.totalMinor).toBe(10000);
      expect(shift01?.shiftWindow).toBe('06:00–14:00');

      // Itemized items format
      const item0 = report.items.find(i => i.id === 'e1')!;
      expect(item0.concept).toBe('Cloro y desinfectante de pisos');
      expect(item0.category).toBe('Limpieza');
      expect(item0.payeeName).toBe('Abarrotes Don Pepe');
      expect(item0.amountMinor).toBe(3000);
      expect(item0.amountFormatted).toBe('$30.00');
      expect(item0.shiftWindow).toBe('06:00–14:00');
      expect(item0.formattedDate).toBeDefined();
    });
  });
});
