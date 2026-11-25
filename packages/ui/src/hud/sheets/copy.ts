// Strings of the Hand. store/strings.ts belongs to the Instrument, and these move there with the German set.
export const HAND = {
  selectOwned: 'Select an owned craft first.',
  noOwned: 'No owned craft to stop.',
  readOnly: 'Observed craft are read only.',
  notResumable: 'This craft cannot resume yet: the orphan sweep has not cleared it.',
  stopHold: 'Hold to stop',
  allStopHold: 'Hold for All stop',
  followPlaceholder: 'Follow up. Enter queues, Ctrl+Enter sends now and interrupts.',
  followSent: 'Follow-up queued',
  followNow: 'Follow-up sent, turn interrupted',
  firstNoHistory: 'No history yet.',
  observedOut: 'Observed craft are out of reach: they answer in their own windows.',
} as const;
