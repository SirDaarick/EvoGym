import { describe, expect, it } from 'vitest';
import {
  checkKnowledgeExpiry,
  answerGimiQuery,
  INITIAL_KNOWLEDGE_VAULT,
} from './gimiStore';
import { createDemoState } from '../../demo/adapter';
import type { KnowledgeItem } from '../../domain/gimi';

describe('gimiStore & logic engine', () => {
  it('correctly calculates expiration status and days remaining', () => {
    const referenceDate = '2026-10-08T12:00:00-06:00';

    // 1. Permanent item (no expiresAt)
    const permanentItem: KnowledgeItem = {
      id: 'p1',
      title: 'Permanent Rules',
      category: 'regulations',
      content: 'Rules',
      createdAt: '2026-01-01T00:00:00-06:00',
      expiresAt: null,
      tags: [],
      authorName: 'Admin',
    };
    expect(checkKnowledgeExpiry(permanentItem, referenceDate)).toEqual({
      status: 'active',
      daysRemaining: null,
    });

    // 2. Expiring soon item (within 7 days)
    const expiringSoonItem: KnowledgeItem = {
      ...permanentItem,
      expiresAt: '2026-10-12T23:59:59-06:00', // 5 days from reference
    };
    const soonResult = checkKnowledgeExpiry(expiringSoonItem, referenceDate);
    expect(soonResult.status).toBe('expiring_soon');
    expect(soonResult.daysRemaining).toBeLessThanOrEqual(7);
    expect(soonResult.daysRemaining).toBeGreaterThan(0);

    // 3. Expired item
    const expiredItem: KnowledgeItem = {
      ...permanentItem,
      expiresAt: '2026-10-05T00:00:00-06:00', // 3 days in the past
    };
    const expiredResult = checkKnowledgeExpiry(expiredItem, referenceDate);
    expect(expiredResult.status).toBe('expired');
    expect(expiredResult.daysRemaining).toBe(0);
  });

  it('answers promotion queries with active promotions and ignores expired ones', () => {
    const state = createDemoState();
    const result = answerGimiQuery('¿Hay alguna promoción o descuento?', 'RECEPTION', state);

    expect(result.content).toContain('promociones vigentes');
    expect(result.content).toContain('Promoción de Otoño');
    // Ensure expired items (like Horario especial fin de año 2025) are excluded from active promos
    expect(result.content).not.toContain('Horario especial de fin de año 2025');
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it('provides tailored business metrics for OWNER and front-desk guidance for RECEPTION', () => {
    const state = createDemoState();

    const ownerResult = answerGimiQuery('¿Cómo van los socios y la asistencia?', 'OWNER', state);
    expect(ownerResult.content).toContain('Métricas de Dirección EvoGym');
    expect(ownerResult.content).toContain('Socios totales:');
    expect(ownerResult.content).toContain('Frecuencia promedio');

    const receptionResult = answerGimiQuery('¿Cómo van los socios?', 'RECEPTION', state);
    expect(receptionResult.content).toContain('socios activos');
    expect(receptionResult.content).toContain('asistencias');
  });

  it('answers questions about gloves, lockers, inventory and cash drawer correctly', () => {
    const state = createDemoState();

    // Gloves & lockers
    const rentalsResult = answerGimiQuery('¿Cuánto cuesta la renta de casilleros y guantes?', 'RECEPTION', state);
    expect(rentalsResult.content).toContain('Guantes:');
    expect(rentalsResult.content).toContain('Casilleros:');

    // Inventory & Supplements
    const stockResult = answerGimiQuery('¿Qué suplementos y bebidas tenemos en stock?', 'RECEPTION', state);
    expect(stockResult.content).toContain('Proteína Whey');
    expect(stockResult.content).toContain('Creatina');

    // Shift & Cash rules
    const cashResult = answerGimiQuery('¿Cómo registro un gasto en la caja del turno?', 'RECEPTION', state);
    expect(cashResult.content).toContain('Procedimiento de Caja y Turnos');
    expect(cashResult.content).toContain('Gasto');
  });
});
