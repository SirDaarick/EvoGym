export type Role = 'OWNER' | 'RECEPTION';
export type Money = number; // Integer MXN centavos; format only at presentation boundaries.

export interface Member {
  id: string;
  name: string;
  phone: string;
  creditMinor: Money;
  membership: { planName: string; startsOn: string; endsOn: string } | null;
}

export interface DemoState {
  members: Member[];
  revision: number;
}
