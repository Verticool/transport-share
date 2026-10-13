import type { ServiceZone, User, Scooter, Ride, Invoice, EmailMessage } from '../shared/src/domain.ts';

export interface GenerateMockResult {
  serviceZone: ServiceZone;
  users: User[];
  scooters: Scooter[];
  rides: Ride[];
  invoices: Invoice[];
  emails: EmailMessage[];
}

/** Строит детерминированный (фиксированный seed) набор мок-данных. */
export function generateMock(): GenerateMockResult;

