export const OFFLINE_ALLOWED_COMMANDS = [
  'attendance.check_in',
  'pos.cash_sale',
  'shift.open',
  'shift.arqueo_close',
] as const;

export const ONLINE_ONLY_COMMANDS = [
  'point.card_payment',
  'checkout_pro.link',
  'catalog.edit',
  'inventory.product_edit',
  'inventory.stock_movement',
  'membership.sale',
  'rental.create',
  'rental.update',
  'expense.create',
  'refund.create',
  'gimi.send',
  'whatsapp.send',
  'staff.admin',
] as const;

export type OfflineCommand = (typeof OFFLINE_ALLOWED_COMMANDS)[number];
export type OnlineOnlyCommand = (typeof ONLINE_ONLY_COMMANDS)[number];
export type Command = OfflineCommand | OnlineOnlyCommand;

export const OFFLINE_ALLOWED: ReadonlySet<Command> = new Set<Command>(OFFLINE_ALLOWED_COMMANDS);

export function isAllowedOffline(cmd: Command): boolean {
  return OFFLINE_ALLOWED.has(cmd);
}

export class OnlineOnlyError extends Error {
  readonly cmd: Command;
  constructor(cmd: Command) {
    super('Requiere internet');
    this.name = 'OnlineOnlyError';
    this.cmd = cmd;
  }
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface Rule { re: RegExp; cmd: OnlineOnlyCommand }
const RULES: Rule[] = [
  { re: /^\/api\/v1\/registers\/[^/]+\/card-intent(\/|$)/, cmd: 'point.card_payment' },
  { re: /^\/api\/v1\/registers\/[^/]+\/product-sales\/card$/, cmd: 'point.card_payment' },
  { re: /^\/api\/v1\/registers\/[^/]+\/product-returns$/, cmd: 'refund.create' },
  { re: /^\/api\/v1\/registers\/[^/]+\/membership-(sales|transfer-sales)$/, cmd: 'membership.sale' },
  { re: /^\/api\/v1\/registers\/[^/]+\/membership-debt-payments$/, cmd: 'membership.sale' },
  { re: /^\/api\/v1\/registers\/[^/]+\/expenses$/, cmd: 'expense.create' },
  { re: /^\/api\/v1\/registers\/[^/]+\/cash-contributions$/, cmd: 'expense.create' },
  { re: /^\/api\/v1\/(admin\/)?expenses(\/|$)/, cmd: 'expense.create' },
  { re: /^\/api\/v1\/catalog\//, cmd: 'catalog.edit' },
  { re: /^\/api\/v1\/inventory\/products(\/|$)/, cmd: 'inventory.product_edit' },
  { re: /^\/api\/v1\/inventory\/branches\/[^/]+\/(movements|open-container)$/, cmd: 'inventory.stock_movement' },
  { re: /^\/api\/v1\/rentals(\/|$)/, cmd: 'rental.create' },
  { re: /^\/api\/v1\/admin\//, cmd: 'staff.admin' },
];

/** Maps an online-only mutating HTTP route to its command; null when the route is not guarded. */
export function classifyRequest(method: string, path: string): Command | null {
  if (!MUTATING.has(method.toUpperCase())) return null;
  const clean = path.split(/[?#]/)[0];
  for (const r of RULES) if (r.re.test(clean)) return r.cmd;
  return null;
}
