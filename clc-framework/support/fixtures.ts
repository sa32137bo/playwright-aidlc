// Known-good QA data — named constants for facts multiple real bolts have
// independently re-discovered live, so exploration can re-*verify* one fact
// quickly instead of re-*discovering* it from zero.
//
// These are facts about the live QA environment's current data, not about
// the application's code — they drift. Each entry should be dated to when it
// was last confirmed. Treat every one of these as a hypothesis to re-check
// quickly (a single existence/value check), never as something to assume
// still holds without looking — the same rule this kit applies to
// knowledge/project/* generally.
//
// The bar for an entry: two independent confirmations (two bolts, or a bolt
// plus a domain expert's own run), or it is marked `status: 'unverified'`.
//
// Hotel Admin data needs no entry: bolt US-CLC-001 generates its own via
// `newHotelFixture()` in `clc.ts`. The first entries are the Reporting
// module's slices below, which read existing data and cannot create their
// own.

// ---------------------------------------------------------------------------
// Report slices: known-good filter sets for the Reporting module
// ---------------------------------------------------------------------------
//
// Test data, referenced BY NAME. A bolt's intake.yml `test_data:` and its plan
// name the slice; a spec imports it and passes its values to
// selectReportFilter / setReportDateRange in clc.ts. Never copy the values
// into a spec: a correction here must reach every spec that uses it.
//
// Every report has its own Airline / Station / Hotel filters, which start
// empty and are not set by the header airline, so a spec sets all of them.
// A report without a Hotel filter (Room Cancelation) ignores `hotel`.
//
// Keep entries lean: values, provenance, what the data contains. Narrative
// belongs in the bolt's own audit, not here.

export interface ReportSlice {
  env: 'UAT' | 'QA';
  airline: string;
  station: string;
  /** Option text as the Hotel dropdown shows it: `<key> - <name>`. */
  hotel?: string;
  from: string;
  to: string;
  /** Which reports this slice was confirmed on, and what they contained. */
  contains: string;
  source: string;
  verified: string;
  status: 'verified' | 'unverified' | 'open-question';
  /** A defect this slice is known to show. A spec on it is EXPECTED to go red
   *  on exactly this; that is the regression test working, not a data fault. */
  knownIssue?: string;
  note?: string;
}

/** LOD-76916's own window. Confirmed by the account team's manual export and
 *  the run-8 fix run's automated export, which matched cell for cell. */
export const REPORT_SLICE_CRK_SEP26: ReportSlice = {
  env: 'UAT',
  airline: '5J',
  station: 'CRK',
  hotel: '4595 - Quest Plus Conference Center Clark',
  from: '9/1/2026',
  to: '9/4/2026',
  contains:
    'Reservation Detail, Master Reservation Detail, Total Spend, Crew Sign In: 123 rows; Global Billing: 126. ' +
    'One shared room on 9/1-9/2 (Rez 9910634-35), both names shown. Room Cancelation: 8 rows, no shared room. ' +
    'Daily Crew Report covers 9/4 only, which has no shared room.',
  source: 'account team manual export + run-8 fix run, 2026-09-25',
  verified: '2026-09-25',
  status: 'verified',
};

/** The only slice with shared-room cancellations. */
export const REPORT_SLICE_DXB_SEP26: ReportSlice = {
  env: 'UAT',
  airline: '5J',
  station: 'DXB',
  hotel: '14033 - Marriott Hotel Al Jaddaf, Dubai',
  from: '9/1/2026',
  to: '9/4/2026',
  contains:
    'Room Cancelation: 18 rows, 5 shared-room cancellations, both names shown. ' +
    'Reservation Detail: 42 rows, 10 shared rooms (20 D rows); every Room Cancelation reservation is in it.',
  source: 'account team manual exports, 2026-09-25 and 2026-09-27 (dates 9/1-9/4 confirmed; Crew Sign In and Daily Crew Report on 9/1-9/2)',
  verified: '2026-09-27',
  status: 'unverified',
  knownIssue:
    'Shared rooms 256548/25533 (Rez 9909304-05) and 261112/25689 (Rez 9909629-30), 9/1-9/2: the second crew ' +
    'has no name. Reservation Detail shows 0/0; Crew Sign In and Daily Crew Report show NAME/.. . The other 8 ' +
    'shared rooms are fine. Probably crew-record data (possibly Name Change, LOD-77515): the ticket\'s own ' +
    '9/17 "UAT passed" RDR export already showed NAME/. for 256548/25533. But Reservation Detail now hides the ' +
    'first crew too (0/0), which it did not on 9/17. Tag these failures @unconfirmed until the functional team ' +
    'answers; do not call them a product defect or loosen the check.',
  note:
    'Not yet run by a bolt. Hotel option text is inferred from the export (key 14033); if it differs, ' +
    'selectReportFilter fails at that step. Room Cancelation has no Hotel filter.',
};

/** Holds the one open LOD-76916 question. */
export const REPORT_SLICE_MIA_HGI_SEP26: ReportSlice = {
  env: 'UAT',
  airline: '5J',
  station: 'MIA',
  hotel: '1023 - Hilton Garden Inn Brickell',
  from: '9/1/2026',
  to: '9/25/2026',
  contains: 'Room Cancelation: 6 rows; shared ID 255013/25482 (9/4-9/5) shows only one crew name.',
  source: 'account team manual export, 2026-09-25',
  verified: '2026-09-25',
  status: 'open-question',
  note:
    'Expected behaviour or the bug? Asked of the account team. A spec on this slice fails on that row until ' +
    'answered: tag it @unconfirmed. Hotel option text inferred from the export key.',
};

/** Second window from LOD-76916's own screenshot (RDR export, 1,544 rows with
 *  shared rooms). Never run by a bolt or the account team; data may have moved. */
export const REPORT_SLICE_CEB_SEP26: ReportSlice = {
  env: 'UAT',
  airline: '5J',
  station: 'CEB',
  // No hotel: the ticket gives only key 14039, and selectReportFilter needs the
  // exact option text ("<key> - <name>"). Station-only is enough for these checks.
  from: '9/14/2026',
  to: '9/17/2026',
  contains: 'Per the ticket screenshot: Reservation Detail shared rooms, Rez 9928426-29.',
  source: 'LOD-76916 attachment (RDR (50).xlsx screenshot)',
  verified: '',
  status: 'unverified',
  note: 'Ticket names hotel 14039 (Lapu Lapu City); add its exact option text once seen. Confirm the data still exists before relying on it.',
};
