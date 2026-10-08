export interface Plan {
  id: string;
  name: string;
  amountMinor: number;
  applicability: string;
  restriction?: string;
  kind: 'membership' | 'visit';
}

// Prices confirmed by the owner interview; eligibility is not inferred from a name or age.
export const plans: Plan[] = [
  { id: 'gym-month', name: 'Gym mensual', amountMinor: 50000, applicability: 'Una área: Gym. Mensual por fechas de calendario.', kind: 'membership' },
  { id: 'box-month', name: 'Box mensual', amountMinor: 50000, applicability: 'Una área: Box. Mensual por fechas de calendario.', kind: 'membership' },
  { id: 'combo-month', name: 'Gym + Box mensual', amountMinor: 75000, applicability: 'Ambas áreas. Mensual por fechas de calendario.', kind: 'membership' },
  ...(['gym', 'box'] as const).flatMap(area => [
    { id: `${area}-student`, name: `${area === 'gym' ? 'Gym' : 'Box'} estudiante`, amountMinor: 40000, applicability: 'Estudiante; una sola área.', restriction: 'Validación de estudiante pendiente; no disponible en esta demo.', kind: 'membership' as const },
    { id: `${area}-quarter`, name: `${area === 'gym' ? 'Gym' : 'Box'} trimestral`, amountMinor: 120000, applicability: 'Individual; una sola área. Trimestre.', kind: 'membership' as const },
    { id: `${area}-semester`, name: `${area === 'gym' ? 'Gym' : 'Box'} semestral`, amountMinor: 230000, applicability: 'Individual; una sola área. Semestre.', kind: 'membership' as const },
    { id: `${area}-annual`, name: `${area === 'gym' ? 'Gym' : 'Box'} anual`, amountMinor: 450000, applicability: 'Individual; una sola área. Año.', kind: 'membership' as const },
  ]),
  { id: 'box-scholarship', name: 'Box beca', amountMinor: 35000, applicability: 'Solo beca seleccionada por el entrenador de Box; no es una tarifa general.', restriction: 'Selección del entrenador no validada en esta demo.', kind: 'membership' },
  { id: 'box-kids', name: 'Box kids', amountMinor: 35000, applicability: 'Niños de 5 a 9 años.', restriction: 'Elegibilidad de edad no validada en esta demo.', kind: 'membership' },
  { id: 'gym-week', name: 'Gym semana', amountMinor: 15000, applicability: 'Gym; 8 días. Fechas efectivas pendientes en esta demo.', kind: 'membership' },
  { id: 'visit-single', name: 'Visita una área', amountMinor: 5000, applicability: 'Gym o Box; una visita.', kind: 'visit' },
  { id: 'visit-combo', name: 'Visita Gym + Box', amountMinor: 10000, applicability: 'Ambas áreas; una visita.', kind: 'visit' },
];
