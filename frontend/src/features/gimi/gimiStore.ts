import type {
  KnowledgeItem,
  KnowledgeCategory,
  KnowledgeStatus,
  GimiConversation,
  GimiAlert,
  GimiChatMessage,
} from '../../domain/gimi';
import type { DemoState, Role } from '../../domain/models';
import { formatMoney } from '../../demo/adapter';

const STORAGE_KEY_VAULT = 'evogym_gimi_vault_items';
const STORAGE_KEY_ALERTS = 'evogym_gimi_alerts';
const STORAGE_KEY_CONVERSATIONS = 'evogym_gimi_conversations';
const STORAGE_KEY_MESSAGES = 'evogym_gimi_chat_history';

export const INITIAL_KNOWLEDGE_VAULT: KnowledgeItem[] = [
  {
    id: 'vault-01',
    title: 'Promoción de Otoño: 2x1 en inscripción trimestral Gym',
    category: 'tariffs_promos',
    content:
      'Aplica durante octubre 2026. Al contratar un plan Gym Trimestral ($1,350 MXN), el acompañante recibe 50% de descuento en su primer mes. Válido únicamente con pago en efectivo o transferencia.',
    createdAt: '2026-10-01T09:00:00-06:00',
    expiresAt: '2026-10-15T23:59:59-06:00', // Expira pronto (7 días desde la fecha demo)
    tags: ['promoción', 'otoño', 'trimestral', 'descuento'],
    authorName: 'Erick R. (Dueño)',
  },
  {
    id: 'vault-02',
    title: 'Horario especial de fin de año 2025',
    category: 'schedules_classes',
    content:
      'El gimnasio operará en horario reducido de 8:00 AM a 2:00 PM los días 24 y 31 de diciembre. Los días 25 de diciembre y 1 de enero permanecerá cerrado.',
    createdAt: '2025-12-15T10:00:00-06:00',
    expiresAt: '2026-01-02T00:00:00-06:00', // Ya expiró
    tags: ['horario', 'festivo', 'diciembre'],
    authorName: 'Erick R. (Dueño)',
  },
  {
    id: 'vault-03',
    title: 'Reglamento de renta de guantes y casilleros',
    category: 'regulations',
    content:
      'Renta de guantes: $25 MXN por sesión individual (o $30 MXN para 16oz). Se entregan limpios y deben devolverse antes de terminar el turno.\n' +
      'Renta de casilleros: $150 MXN mensuales. Si el pago se atrasa más de 14 días, la administración procede con notificación de desalojo preventivo.',
    createdAt: '2026-01-10T12:00:00-06:00',
    expiresAt: null, // Permanente
    tags: ['guantes', 'casilleros', 'rentas', 'normativa'],
    authorName: 'Valeria M. (Recepción)',
  },
  {
    id: 'vault-04',
    title: 'Tarifario de membresías y clases 2026',
    category: 'tariffs_promos',
    content:
      'Gym Mensual: $500 MXN.\n' +
      'Box Mensual: $500 MXN.\n' +
      'Combo Gym + Box Mensual: $750 MXN.\n' +
      'Gym Estudiante: $400 MXN (requiere credencial vigente).\n' +
      'Clase de prueba / visita individual: $100 MXN.\n' +
      'Gym Trimestral: $1,350 MXN ($450/mes).',
    createdAt: '2026-01-01T08:00:00-06:00',
    expiresAt: null, // Permanente
    tags: ['tarifas', 'precios', 'planes', 'estudiantes'],
    authorName: 'Erick R. (Dueño)',
  },
  {
    id: 'vault-05',
    title: 'Horarios de clases de Box y Sparring guiado',
    category: 'schedules_classes',
    content:
      'Clases de Boxeo:\n' +
      '- Matutino: Lunes a Viernes 7:00 AM – 8:30 AM y 9:00 AM – 10:30 AM.\n' +
      '- Vespertino: Lunes a Viernes 6:00 PM – 7:30 PM y 7:30 PM – 9:00 PM.\n' +
      '- Sparring supervisado: Sábados 10:00 AM a 12:00 PM con uso obligatorio de careta y guantes de 14oz o 16oz.',
    createdAt: '2026-02-01T10:00:00-06:00',
    expiresAt: null, // Permanente
    tags: ['box', 'horarios', 'sparring', 'clases'],
    authorName: 'Coach Javier',
  },
  {
    id: 'vault-06',
    title: 'Guía de venta de suplementación en barra',
    category: 'supplements_store',
    content:
      'Proteína Whey (Vainilla o Chocolate): $35 MXN por scoop (24g de proteína).\n' +
      'Creatina Monohidratada (Sin sabor): $20 MXN por scoop (5g).\n' +
      'Pre-Entreno Nitro Frutos Rojos: $30 MXN por scoop.\n' +
      'BCAA Aminoácidos Limón: $25 MXN por scoop.\n' +
      'Agua Natural 1L: $20 MXN.\n' +
      'Todos los suplementos se pueden agregar a la cuenta del socio o cobrar en efectivo/tarjeta.',
    createdAt: '2026-03-01T11:00:00-06:00',
    expiresAt: null, // Permanente
    tags: ['suplementos', 'proteina', 'creatina', 'barra'],
    authorName: 'Valeria M. (Recepción)',
  },
];

export const INITIAL_CONVERSATIONS: GimiConversation[] = [
  {
    id: 'conv-01',
    clientName: 'Alejandro Morales',
    clientPhone: '+52 55 4192 8812',
    channel: 'whatsapp',
    contactType: 'sales',
    status: 'active',
    startedAt: '2026-10-08T09:30:00-06:00',
    lastMessageAt: '2026-10-08T09:42:00-06:00',
    messagesCount: 8,
    needsHumanAttention: true,
    summary: 'Interesado en membresía para 4 compañeros de trabajo; solicita cotización corporativa.',
    alertReason: 'Prospecto de alto valor (venta grupal) solicitando descuento especial.',
  },
  {
    id: 'conv-02',
    clientName: 'Daniela Solares',
    clientPhone: '+52 55 8821 0034',
    channel: 'whatsapp',
    contactType: 'inquiry',
    status: 'resolved',
    startedAt: '2026-10-08T08:15:00-06:00',
    lastMessageAt: '2026-10-08T08:22:00-06:00',
    messagesCount: 5,
    needsHumanAttention: false,
    summary: 'Preguntó por horarios de Box matutino y requisitos de clase de prueba. Se le brindó información completa.',
  },
  {
    id: 'conv-03',
    clientName: 'Mariana López (Socia)',
    clientPhone: '+52 55 5000 0001',
    channel: 'whatsapp',
    contactType: 'customer_support',
    status: 'escalated',
    startedAt: '2026-10-08T10:05:00-06:00',
    lastMessageAt: '2026-10-08T10:14:00-06:00',
    messagesCount: 6,
    needsHumanAttention: true,
    summary: 'Reporta que la cerradura del casillero #07 se atora al abrir.',
    alertReason: 'Incidencia física en casillero asignado.',
  },
  {
    id: 'conv-04',
    clientName: 'Recepción Valeria M.',
    channel: 'web',
    contactType: 'internal_ops',
    status: 'resolved',
    startedAt: '2026-10-08T10:30:00-06:00',
    lastMessageAt: '2026-10-08T10:32:00-06:00',
    messagesCount: 4,
    needsHumanAttention: false,
    summary: 'Consulta sobre costo de renta de guantes de 16oz y disponibilidad actual.',
  },
  {
    id: 'conv-05',
    clientName: 'Jorge Beltrán',
    clientPhone: '+52 55 1199 4432',
    channel: 'whatsapp',
    contactType: 'inquiry',
    status: 'resolved',
    startedAt: '2026-10-07T18:20:00-06:00',
    lastMessageAt: '2026-10-07T18:25:00-06:00',
    messagesCount: 4,
    needsHumanAttention: false,
    summary: 'Consultó ubicación y promociones para estudiantes.',
  },
];

export const INITIAL_ALERTS: GimiAlert[] = [
  {
    id: 'alert-01',
    conversationId: 'conv-01',
    clientName: 'Alejandro Morales',
    channel: 'whatsapp',
    type: 'high_intent_lead',
    severity: 'high',
    message: 'Prospecto solicita cotización corporativa para 4 personas con acceso a Box y Gym.',
    timestamp: '2026-10-08T09:42:00-06:00',
    status: 'pending',
  },
  {
    id: 'alert-02',
    conversationId: 'conv-03',
    clientName: 'Mariana López (Socia)',
    channel: 'whatsapp',
    type: 'complaint',
    severity: 'medium',
    message: 'Reporte de cerradura atascada en casillero #07. Requiere revisión de mantenimiento.',
    timestamp: '2026-10-08T10:14:00-06:00',
    status: 'pending',
  },
  {
    id: 'alert-03',
    conversationId: 'conv-04',
    clientName: 'Roberto Garza (Socio)',
    channel: 'whatsapp',
    type: 'churn_risk',
    severity: 'medium',
    message: 'Socio con plan trimestral consultó políticas de congelamiento por viaje de trabajo.',
    timestamp: '2026-10-07T16:10:00-06:00',
    status: 'resolved',
  },
];

/**
 * Checks expiration status for a knowledge resource.
 * If expired, Gimi ignores it in its RAG queries.
 */
export function checkKnowledgeExpiry(
  item: KnowledgeItem,
  nowIso = '2026-10-08T12:00:00-06:00'
): { status: KnowledgeStatus; daysRemaining: number | null } {
  if (!item.expiresAt) {
    return { status: 'active', daysRemaining: null };
  }

  const nowTime = new Date(nowIso).getTime();
  const expiryTime = new Date(item.expiresAt).getTime();
  const diffDays = Math.ceil((expiryTime - nowTime) / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) {
    return { status: 'expired', daysRemaining: 0 };
  }
  if (diffDays <= 7) {
    return { status: 'expiring_soon', daysRemaining: diffDays };
  }
  return { status: 'active', daysRemaining: diffDays };
}

// Local Storage / Session Store helpers
export function getStoredKnowledgeVault(): KnowledgeItem[] {
  if (typeof window === 'undefined') return INITIAL_KNOWLEDGE_VAULT;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY_VAULT);
    if (!raw) return INITIAL_KNOWLEDGE_VAULT;
    return JSON.parse(raw);
  } catch {
    return INITIAL_KNOWLEDGE_VAULT;
  }
}

export function saveStoredKnowledgeVault(items: KnowledgeItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(STORAGE_KEY_VAULT, JSON.stringify(items));
  } catch (err) {
    console.warn('Failed to persist knowledge vault to sessionStorage', err);
  }
}

export function getStoredAlerts(): GimiAlert[] {
  if (typeof window === 'undefined') return INITIAL_ALERTS;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY_ALERTS);
    if (!raw) return INITIAL_ALERTS;
    return JSON.parse(raw);
  } catch {
    return INITIAL_ALERTS;
  }
}

export function saveStoredAlerts(alerts: GimiAlert[]): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(STORAGE_KEY_ALERTS, JSON.stringify(alerts));
  } catch (err) {
    console.warn('Failed to persist alerts', err);
  }
}

export function getStoredConversations(): GimiConversation[] {
  if (typeof window === 'undefined') return INITIAL_CONVERSATIONS;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY_CONVERSATIONS);
    if (!raw) return INITIAL_CONVERSATIONS;
    return JSON.parse(raw);
  } catch {
    return INITIAL_CONVERSATIONS;
  }
}

export function getStoredChatHistory(): GimiChatMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY_MESSAGES);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveStoredChatHistory(messages: GimiChatMessage[]): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(STORAGE_KEY_MESSAGES, JSON.stringify(messages));
  } catch (err) {
    console.warn('Failed to save chat history', err);
  }
}

/**
 * Intelligent Answer Engine for Gimi Assistant in EvoGym.
 * Integrates live demo state and active knowledge items from the vault.
 */
export function answerGimiQuery(
  rawQuery: string,
  role: Role,
  state: DemoState
): { content: string; suggestions: string[] } {
  const query = rawQuery.toLowerCase().trim();
  const vaultItems = getStoredKnowledgeVault();
  const activeVault = vaultItems.filter(item => checkKnowledgeExpiry(item, state.demoClock).status !== 'expired');

  // 1. Promociones y Ofertas
  if (query.includes('promo') || query.includes('oferta') || query.includes('descuento')) {
    const promoItems = activeVault.filter(i => i.category === 'tariffs_promos');
    if (promoItems.length > 0) {
      const details = promoItems
        .map(p => {
          const exp = checkKnowledgeExpiry(p, state.demoClock);
          const expText = exp.daysRemaining ? ` · Vence en ${exp.daysRemaining} días` : '';
          return `• **${p.title}**${expText}\n  ${p.content}`;
        })
        .join('\n\n');
      return {
        content: `¡Claro! Estas son las promociones vigentes en el Knowledge Vault de EvoGym:\n\n${details}\n\n*(Los recursos expirados fueron excluidos automáticamente del catálogo).*`,
        suggestions: ['¿Cuáles son los precios regulares?', '¿Cómo registro un plan de estudiante?'],
      };
    }
    return {
      content: 'Actualmente no hay promociones activas registradas en el Vault de conocimiento. Todos los planes se cobran con las tarifas regulares de catálogo.',
      suggestions: ['Ver precios de membresías', '¿Cómo registro un nuevo socio?'],
    };
  }

  // 2. Precios, tarifas o membresías
  if (query.includes('precio') || query.includes('tarifa') || query.includes('membresia') || query.includes('costo')) {
    return {
      content:
        'Aquí tienes el tarifario oficial de EvoGym:\n\n' +
        '• **Gym Mensual:** $500 MXN\n' +
        '• **Box Mensual:** $500 MXN\n' +
        '• **Combo Gym + Box:** $750 MXN\n' +
        '• **Gym Estudiante:** $400 MXN *(credencial vigente)*\n' +
        '• **Gym Trimestral:** $1,350 MXN ($450/mes)\n' +
        '• **Visita / Clase de prueba:** $100 MXN\n\n' +
        (role === 'RECEPTION'
          ? '💡 *Recuerda que para registrar un pago puedes ir a la pestaña "Socios" y cobrar directamente.*'
          : '📊 *El ARPU actual promedia alrededor de $550 MXN por socio activo.*'),
      suggestions: ['¿Hay promociones activas?', '¿Cuál es la política de casilleros?'],
    };
  }

  // 3. Guantes o Casilleros
  if (query.includes('guante') || query.includes('casillero') || query.includes('renta')) {
    const availableGloves = (state.gloves ?? []).filter(g => g.status === 'available').length;
    const availableLockers = (state.lockers ?? []).filter(l => l.status === 'available').length;
    return {
      content:
        `**Rentas y Disponibilidad actual:**\n\n` +
        `🥊 **Guantes:** $25 MXN sesión ($30 para 16oz). Actualmente hay **${availableGloves} pares disponibles** para renta.\n` +
        `🔒 **Casilleros:** $150 MXN mensuales. Hay **${availableLockers} casilleros libres** de 42 totales.\n\n` +
        `*Normativa:* Los guantes deben devolverse al cerrar turno. Los casilleros toleran hasta 14 días de retraso antes de advertencia de desalojo.`,
      suggestions: ['Ver disponibilidad de guantes', '¿Cómo cobro una renta en mostrador?'],
    };
  }

  // 4. Inventario o Suplementos
  if (query.includes('inventario') || query.includes('suplemento') || query.includes('proteina') || query.includes('stock')) {
    const productsInfo = (state.products ?? []).map(p => `• ${p.name}: ${p.openingQuantity} en stock (${formatMoney(p.priceMinor)} MXN)`).join('\n');
    return {
      content:
        `**Estado de Mostrador y Barra:**\n\n` +
        `🥤 **Suplementos por scoop:** Proteína Whey ($35 MXN), Creatina ($20 MXN), Pre-Entreno ($30 MXN), BCAA ($25 MXN).\n\n` +
        `📦 **Productos en stock:**\n${productsInfo}`,
      suggestions: ['¿Cuál es el ticket promedio en mostrador?', 'Registrar venta de suplemento'],
    };
  }

  // 5. Asistencia, Socios o Métricas de Negocio
  if (query.includes('socio') || query.includes('asistencia') || query.includes('ingreso') || query.includes('metrica') || query.includes('arpu')) {
    const totalMembers = state.members.length;
    const activeMembers = state.members.filter(m => m.membership && m.membership.endsOn >= state.demoClock.slice(0, 10)).length;
    const todayVisits = state.attendance.filter(v => v.observedCheckIn.slice(0, 10) === state.demoClock.slice(0, 10)).length;

    if (role === 'OWNER') {
      return {
        content:
          `📊 **Métricas de Dirección EvoGym:**\n\n` +
          `• **Socios totales:** ${totalMembers} (${activeMembers} con membresía vigente · ${Math.round((activeMembers / totalMembers) * 100)}% de la base)\n` +
          `• **Visitas registradas hoy:** ${todayVisits} accesos\n` +
          `• **Frecuencia promedio semanal:** ~3.4 días por socio activo\n` +
          `• **Retención:** Mediana de permanencia en 4.0 meses\n\n` +
          `*Puedes consultar los gráficos de cohortes y desglose de disciplinas en "Socios".*`,
        suggestions: ['¿Hay socios con membresía por vencer?', 'Ver top de productos favoritos'],
      };
    }

    return {
      content:
        `👥 **Estado de Socios:**\n\n` +
        `Hay **${activeMembers} socios activos** registrados en la base y hoy se han registrado **${todayVisits} asistencias**.\n` +
        `Puedes buscar a cualquier socio en la barra superior o presionar "Nuevo" para registrar a alguien.`,
      suggestions: ['¿Cómo registrar asistencia?', '¿Cuáles son las tarifas de membresía?'],
    };
  }

  // 6. Turno, Caja o Cierre
  if (query.includes('turno') || query.includes('caja') || query.includes('cierre') || query.includes('gasto')) {
    return {
      content:
        `💵 **Procedimiento de Caja y Turnos:**\n\n` +
        `1. Al registrar gastos menores (ej. garrafones de agua), usa el botón **Gasto** en la vista de Turno.\n` +
        `2. Si un cliente necesita cambio de billete, usa **Extra** para mantener el arqueo cuadrado.\n` +
        `3. Al cerrar turno, realiza el conteo por denominaciones en la ventana de cierre para asegurar que no haya faltante de efectivo.`,
      suggestions: ['¿Qué hago si hay diferencia en caja?', 'Ver gastos del turno actual'],
    };
  }

  // Respuesta por defecto con orientación cálida
  return {
    content:
      `¡Hola! Soy **Gimi**, el asistente inteligente de EvoGym. 🤖✨\n\n` +
      (role === 'OWNER'
        ? 'Puedo ayudarte a revisar métricas clave del gimnasio (asistencias, ingresos, retención), consultar políticas en el Vault de conocimiento o dar seguimiento a las alertas de clientes.'
        : 'Estoy aquí para resolver dudas operativas de mostrador: tarifas vigentes, disponibilidad de guantes o casilleros, horarios de clases y reglas de caja.'),
    suggestions:
      role === 'OWNER'
        ? ['¿Cómo van las métricas de socios?', '¿Cuáles son las promociones vigentes?', 'Ver estado de casilleros']
        : ['¿Cuáles son los precios de membresías?', 'Disponibilidad de guantes y casilleros', '¿Qué suplementos vendemos?'],
  };
}
