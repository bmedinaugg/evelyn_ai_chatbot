import { z } from 'zod';

// Account data for the chatbot's read-only tools. Each schema keeps only allowlisted fields
// (no documents, payment instruments, names or contact data) — see docs/api/magicline.md.

const money = z
  .object({ amount: z.number(), currency: z.string() })
  .transform(({ amount, currency }) => ({ amount, currency }));
const period = z
  .object({ periodValue: z.number().int(), periodUnit: z.enum(['DAY', 'WEEK', 'MONTH', 'YEAR']) })
  .transform(({ periodValue, periodUnit }) => ({ periodValue, periodUnit }));
const sliced = <T extends z.ZodType>(item: T) =>
  z.object({ result: z.array(item) }).transform(({ result }) => result);

export const membershipSchema = z
  .object({
    rateName: z.string(),
    startDate: z.string(),
    endDate: z.string().nullish(),
    contractStatus: z.enum(['ACTIVE', 'INACTIVE']),
    cancelled: z.boolean(),
    cancellationDate: z.string().nullish(),
    lastPossibleCancellationDate: z.string().nullish(),
    cancellationPeriod: period.nullish(),
    term: period.nullish(),
    price: z.number().nullish(),
  })
  .transform((c) => ({
    rateName: c.rateName,
    startDate: c.startDate,
    endDate: c.endDate ?? null,
    contractStatus: c.contractStatus,
    cancelled: c.cancelled,
    cancellationDate: c.cancellationDate ?? null,
    lastPossibleCancellationDate: c.lastPossibleCancellationDate ?? null,
    cancellationPeriod: c.cancellationPeriod ?? null,
    term: c.term ?? null,
    price: c.price ?? null,
  }));
export type MembershipInfo = z.output<typeof membershipSchema>;

export const balanceSchema = z
  .object({
    accountBalance: money.nullish(),
    inDebtCollection: z.boolean(),
    dunningLevel: z.string().nullish(),
  })
  .transform((b) => ({
    accountBalance: b.accountBalance ?? null,
    inDebtCollection: b.inDebtCollection,
    dunningLevel: b.dunningLevel ?? null,
  }));
export type BalanceInfo = z.output<typeof balanceSchema>;

export const upcomingPaymentsSchema = sliced(
  z
    .object({
      dueDate: z.string(),
      description: z.string().nullish(),
      amount: money.nullish(),
      openAmount: money.nullish(),
    })
    .transform((p) => ({
      dueDate: p.dueDate,
      description: p.description ?? null,
      amount: p.amount ?? null,
      openAmount: p.openAmount ?? null,
    })),
);
export type PaymentInfo = z.output<typeof upcomingPaymentsSchema>[number];

export const checkinsSchema = sliced(
  z
    .object({ checkInDateTime: z.string().nullish(), studioName: z.string().nullish() })
    .transform((c) => ({
      checkInDateTime: c.checkInDateTime ?? null,
      studioName: c.studioName ?? null,
    })),
);
export type VisitInfo = z.output<typeof checkinsSchema>[number];

export const classBookingsSchema = sliced(
  z
    .object({
      bookingStatus: z.string(),
      classInformation: z.object({ title: z.string() }),
      classSlotInformation: z.object({
        startDateTime: z.string().nullish(),
        endDateTime: z.string().nullish(),
      }),
      studioInformation: z.object({ name: z.string().nullish() }).nullish(),
    })
    .transform((b) => ({
      title: b.classInformation.title,
      startDateTime: b.classSlotInformation.startDateTime ?? null,
      endDateTime: b.classSlotInformation.endDateTime ?? null,
      studioName: b.studioInformation?.name ?? null,
      bookingStatus: b.bookingStatus,
    })),
);
export type ClassBookingInfo = z.output<typeof classBookingsSchema>[number];
