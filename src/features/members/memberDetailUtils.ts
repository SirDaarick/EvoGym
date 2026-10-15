export function rentalStatus(expiresAt: string | null | undefined, now: string): 'none' | 'active' | 'overdue' | 'eviction-status' {
  if (!expiresAt) return 'none';
  const expiry = Date.parse(expiresAt), current = Date.parse(now);
  if (!Number.isFinite(expiry) || !Number.isFinite(current)) return 'none';
  if (current <= expiry) return 'active';
  return (current - expiry) / 86400000 > 14 ? 'eviction-status' : 'overdue';
}

export function formatAttendanceError(message: string): string {
  if (/Q-03|visitas repetidas/i.test(message)) return 'No se permiten visitas repetidas el mismo día.';
  if (/Q-01|día de vencimiento/i.test(message)) return 'No se permite registrar la entrada el día de vencimiento.';
  if (/Q-09|después del cierre/i.test(message)) return 'No se permite registrar la entrada después del cierre.';
  if (/hora demo|hora de demostración/i.test(message)) return 'Verifica la hora de registro.';
  if (/demo|demostración|prueba|escenario|provisional|Q-\d+/i.test(message)) return 'No se pudo registrar la asistencia. Verifica las condiciones de acceso vigentes.';
  return message;
}
