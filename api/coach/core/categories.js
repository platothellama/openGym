/* The data categories the consent screen names (FR-09/10).
 *
 * Its own tiny module so a screen that only needs to *say* what would leave — the mobile setup
 * screen, before anything AI-related has been loaded — can import five strings without pulling
 * the payload builder and the exercise catalogue behind it. payload.js re-exports it, and
 * builds from it, so the screen cannot drift from the payload. */
export const DATA_CATEGORIES = Object.freeze([
  'plan',         // routines, exercises, sets/reps, schedule, progression settings
  'training',     // logged sets, targets, effort ratings, durations, PRs in the review window
  'bodyweight',   // weigh-ins in the window and your goal weight
  'measurements', // tape-measure sites, and the change between them
  'profile',      // the intake answers you gave the Coach, including any limitations
  'prefs',        // unit, language, effort scale
  // The five below travel only for a profile that has linked FitAI (see cleanFitai). They are
  // named here so the screen is one list; the consent wording says so on each row.
  'nutrition',    // calorie/protein targets and the logged intake of the FitAI window
  'glucose',      // fasting and post-meal readings from the window
  'fasting',      // fasting protocols started and completed
  'health',       // body weight, a body-composition scan, abnormal labs, diagnosed conditions
  'activity'      // steps, active calories, sleep and resting heart rate
]);
