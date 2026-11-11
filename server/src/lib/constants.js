export const STATUSES = {
  new: 'New',
  under_review: 'Under Review',
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  done: 'Done',
  not_now: 'Not Right Now',
};

/** The "why" behind a Not Right Now decision. */
export const NOT_NOW_REASONS = {
  timing: 'Timing — the season or calendar isn’t right yet',
  budget: 'Budget — resources aren’t available right now',
  capacity: 'Capacity — we don’t have the people to do it well yet',
  vision: 'Vision — doesn’t fit our current focus',
  exists: 'Already happening — something similar is in place',
  details: 'Needs more detail — help us understand it better',
  other: 'Other',
};

export const RATING_LABELS = {
  1: 'Ah, whatever',
  2: 'Could be cool',
  3: 'I’d love to see it',
  4: 'Can’t stop thinking about it',
  5: 'Word of the Lord',
};

export const REPORT_REASONS = ['Spam', 'Inappropriate', 'Duplicate', 'Other'];
