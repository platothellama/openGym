import fs from 'node:fs'

const KEYS = [
  'Favourites', 'Add to favourites', 'Load plan', 'Week schedule', 'Rest / skip this day',
  'Pick one to continue.', 'How many days a week?', 'Suggested', 'Suggested for you',
  'Suggested (a) — change', 'Any', 'Other', 'Something else', 'Type here',
  'An error', 'Retry', 'Remove', 'Empty', 'No plan yet', 'No plan loaded',
  'Scan', 'Photo', 'camera', 'This is as many', 'days a week', '{0} sessions',
  'Existing routines are kept', 'Sent to', 'not stored', 'Check the suggestions',
  'untick', 'Untick', 'tap to remove', 'from the photos', 'leave {0} open',
]

for (const l of ['ar', 'de', 'es', 'fr', 'hi', 'hu', 'it', 'ko', 'pl', 'pt', 'ru', 'th', 'tr', 'uk', 'zh']) {
  const lines = fs.readFileSync(`src/locales/${l}.js`, 'utf8').split(/\r?\n/)
  const hits = []
  for (const k of KEYS) {
    const needle = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`^\\s*'${needle}'\\s*:`)
    hits.push(...lines.filter(x => re.test(x)).map(x => x.trim()))
  }
  console.log(`===== ${l} =====\n${hits.join('\n')}`)
}