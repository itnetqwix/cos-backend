/** Engineering defaults chosen from the 420 Dating blueprint. */
export const DATING_LIKE_LIMIT_PER_DAY = 100;
export const DATING_MESSAGE_LIMIT_PER_MINUTE = 30;
export const DATING_REPORT_LIMIT_PER_DAY = 5;
export const DATING_PHOTO_PRESIGN_LIMIT_PER_HOUR = 10;
export const DATING_MAX_PHOTOS = 6;
export const DATING_MAX_PROMPTS = 3;
export const DATING_MESSAGE_MAX = 2000;
export const DATING_COMMENT_MAX = 500;
export const DATING_BIO_MAX = 1000;
export const DATING_CAPTION_MAX = 140;
export const DATING_DISPLAY_NAME_MAX = 40;
export const DATING_AUTO_PAUSE_REPORTS = 3;
export const DATING_AUTO_BAN_SOLICITATIONS = 3;

export const DATING_CONSUMPTION_HABITS = [
  'Daily',
  'Weekends',
  'Occasional',
  'Medical Only',
  'Socially',
  'Edibles Only',
] as const;

export const DATING_METHODS = [
  'Joint',
  'Blunt',
  'Bong',
  'Pipe',
  'Dab Rig',
  'Vaporizer',
  'Edibles',
  'Beverage',
] as const;

export const DATING_PROMPT_CATALOG = [
  { promptId: 'highest-thought', question: "The highest thought I've ever had..." },
  { promptId: 'ideal-420-date', question: 'Our ideal 4/20 date would be...' },
  { promptId: 'munchies', question: 'My ultimate munchies snack combo is...' },
  { promptId: 'sesh-soundtrack', question: 'The soundtrack to our first sesh is...' },
  { promptId: 'green-flag', question: 'A green flag I look for is...' },
] as const;

export const DATING_POLICY_REJECTION =
  'Your text contains prohibited terms. Ripskis strictly prohibits commercial drug sales, pricing, or off-platform handles.';
