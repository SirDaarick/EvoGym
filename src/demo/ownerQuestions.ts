export type QuestionStatus = 'provisional' | 'open' | 'deferred';
export const questionStatusLabels: Record<QuestionStatus, string> = {
  provisional: 'Provisional', open: 'Por definir', deferred: 'Más adelante',
};

// IDs follow the SDD question log; these summaries are not business approval.
export const ownerQuestions = {
  'Q-01': { status: 'provisional', question: '¿Puede entrar el día de vencimiento?', note: 'Preferencia de la demo: permitirlo. Falta confirmar.' },
  'Q-02': { status: 'open', question: '¿Qué zona horaria usa el gimnasio?', note: 'Define el día de asistencia y el cierre a las 22:00.' },
  'Q-03': { status: 'provisional', question: '¿Puede entrar varias veces al día?', note: 'Preferencia de la demo: visitas separadas. Falta confirmar.' },
  'Q-04': { status: 'open', question: '¿Desde qué fecha cuenta una renovación?', note: 'Confirmar pagos adelantados y renovaciones tardías.' },
  'Q-05': { status: 'open', question: '¿Qué determina una membresía activa?', note: 'Las fechas ilustrativas no prueban acceso real.' },
  'Q-06': { status: 'deferred', question: '¿Cómo funcionará la prórroga?', note: 'Por ahora una membresía vencida requiere renovación.' },
  'Q-07': { status: 'open', question: '¿Quién puede corregir una asistencia?', note: 'El cierre automático no indica la salida real.' },
  'Q-08': { status: 'open', question: '¿Debe cerrar visitas con la app apagada?', note: 'Esta demo en memoria no ofrece un cierre persistente.' },
  'Q-09': { status: 'open', question: '¿Se permiten entradas fuera del horario?', note: 'Cerrar a las 22:00 no define el horario de acceso.' },
  'Q-10': { status: 'open', question: '¿Qué billetes y monedas cuentan?', note: 'Confirmar denominaciones MXN y monedas fraccionarias.' },
  'Q-11': { status: 'open', question: '¿Cómo reciben y verifican cada pago?', note: 'Confirmar métodos, transferencias y cambio.' },
  'Q-12': { status: 'open', question: '¿Qué fotos usarán para los productos?', note: 'Imágenes pendientes; por ahora se muestra un marcador.' },
  'Q-13': { status: 'deferred', question: '¿Cómo accederá cada empleado después?', note: 'Por ahora solo Admin y Recepción, sin credenciales.' },
  'Q-14': { status: 'open', question: '¿Se conserva una compra al cambiar de pantalla?', note: 'Confirmar cuándo conservar o descartar el carrito.' },
  'Q-15': { status: 'open', question: '¿La transferencia se confirma por compra o producto?', note: 'No debe descontar stock ni confirmar ingresos antes de verificarla.' },
} satisfies Record<string, { status: QuestionStatus; question: string; note: string }>;

export type QuestionId = keyof typeof ownerQuestions;
