import type { components } from '@trainmore/magicline';

type Customer = components['schemas']['Customer'];

/** Synthetic profiles only (example.com). Never put real customer data here. */
export const profiles: Customer[] = [
  {
    id: 1,
    customerNumber: 'M-0001',
    firstName: 'Sanne',
    lastName: 'Test',
    email: 'member.single@example.com',
    status: 'MEMBER',
    studioId: 1001,
    accessRefusal: false,
  },
  {
    id: 2,
    customerNumber: 'M-0002',
    firstName: 'Pieter',
    lastName: 'Test',
    email: 'prospect@example.com',
    status: 'PROSPECT',
    studioId: 1001,
    accessRefusal: false,
  },
  {
    id: 3,
    customerNumber: 'M-0003',
    firstName: 'Fleur',
    lastName: 'Test',
    email: 'former@example.com',
    status: 'FORMER_MEMBER',
    studioId: 1002,
    accessRefusal: false,
  },
  {
    id: 4,
    customerNumber: 'M-0004',
    firstName: 'Daan',
    lastName: 'Test',
    email: 'multi@example.com',
    status: 'MEMBER',
    studioId: 1001,
    accessRefusal: false,
  },
  {
    id: 5,
    customerNumber: 'M-0005',
    firstName: 'Daan',
    lastName: 'Test',
    email: 'multi@example.com',
    status: 'MEMBER',
    studioId: 1002,
    accessRefusal: false,
  },
];
