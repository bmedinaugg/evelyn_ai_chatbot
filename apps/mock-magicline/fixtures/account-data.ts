// Synthetic account data per mock customer id (see profiles.ts). Never real customer data.
const eur = (amount: number) => ({ amount, currency: 'EUR' });
const month = (periodValue: number) => ({ periodValue, periodUnit: 'MONTH' });

type AccountData = {
  contracts: unknown[];
  balance: unknown;
  upcoming: unknown[];
  checkins: unknown[];
  classBookings: unknown[];
};

const activeContract = (rateName: string, price: number) => ({
  id: 100,
  customerId: 0,
  createdDate: '2025-12-15',
  startDate: '2026-01-01',
  endDate: '2027-01-31',
  rateName,
  rateCodes: ['SYN'],
  contractStatus: 'ACTIVE',
  cancelled: false,
  price,
  priceDetails: {},
  cancellationPeriod: month(1),
  term: month(12),
  lastPossibleCancellationDate: '2026-12-31',
  flatFeeContracts: [],
  moduleContracts: [],
  reversed: false,
  signedDocumentUrl: 'https://example.com/contract.pdf',
});

const booking = (title: string, start: string, studioName: string) => ({
  bookingId: 1,
  bookingStatus: 'BOOKED',
  customerId: 0,
  participantStatus: 'REGISTERED',
  classInformation: { id: 3, title, description: 'Synthetic class.' },
  classSlotInformation: {
    id: 9,
    status: 'PLANNED',
    startDateTime: start,
    endDateTime: start.replace('T18', 'T19'),
  },
  studioInformation: { id: 1001, name: studioName },
});

export const accountData: Record<number, AccountData> = {
  1: {
    contracts: [activeContract('Flex', 29.99)],
    balance: {
      accountBalance: eur(0),
      inDebtCollection: false,
      dunningLevel: null,
      consumptionCredit: eur(0),
    },
    upcoming: [
      {
        id: 1,
        dueDate: '2026-12-01',
        description: 'Contributie december',
        amount: eur(29.99),
        openAmount: eur(29.99),
        installmentPlan: false,
        chargeType: 'CONTRACT',
      },
      {
        id: 2,
        dueDate: '2027-01-01',
        description: 'Contributie januari',
        amount: eur(29.99),
        openAmount: eur(29.99),
        installmentPlan: false,
        chargeType: 'CONTRACT',
      },
    ],
    checkins: [
      '2026-11-10',
      '2026-11-07',
      '2026-11-03',
      '2026-10-30',
      '2026-10-27',
      '2026-10-21',
    ].map((day, i) => ({
      checkinId: i + 1,
      checkInDateTime: `${day}T07:45:00Z`,
      studioId: 1001,
      studioName: 'TrainMore Amsterdam (test)',
    })),
    classBookings: [
      booking('Spinning', '2026-11-14T18:00:00Z', 'TrainMore Amsterdam (test)'),
      booking('Yoga', '2026-11-18T18:00:00Z', 'TrainMore Amsterdam (test)'),
    ],
  },
  2: {
    contracts: [],
    balance: { accountBalance: eur(0), inDebtCollection: false, dunningLevel: null },
    upcoming: [],
    checkins: [],
    classBookings: [
      booking('Proefles Bootcamp', '2026-11-15T18:00:00Z', 'TrainMore Amsterdam (test)'),
    ],
  },
  3: {
    contracts: [
      {
        ...activeContract('Basic', 19.99),
        contractStatus: 'INACTIVE',
        cancelled: true,
        startDate: '2025-07-01',
        endDate: '2026-06-30',
        cancellationDate: '2026-05-20',
        lastPossibleCancellationDate: null,
      },
    ],
    balance: { accountBalance: eur(-49.9), inDebtCollection: true, dunningLevel: 'SECOND' },
    upcoming: [],
    checkins: [],
    classBookings: [],
  },
  4: {
    contracts: [activeContract('Premium', 39.99)],
    balance: { accountBalance: eur(0), inDebtCollection: false, dunningLevel: null },
    upcoming: [
      {
        id: 3,
        dueDate: '2026-12-01',
        description: 'Contributie december',
        amount: eur(39.99),
        openAmount: eur(39.99),
        installmentPlan: false,
        chargeType: 'CONTRACT',
      },
    ],
    checkins: [],
    classBookings: [],
  },
  5: {
    contracts: [activeContract('Flex', 29.99)],
    balance: { accountBalance: eur(0), inDebtCollection: false, dunningLevel: null },
    upcoming: [],
    checkins: [],
    classBookings: [],
  },
};
