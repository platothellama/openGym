import fs from 'node:fs'

const WANT = {
  'src/sheets.jsx': ['Favourite', 'One of the days you train each week.', 'Leave this day empty',
    'Make this day optional', 'Make this day required', 'New for you', 'Same equipment',
    'Same muscles', 'Same target muscle', 'Suggested for this slot',
    'You already have {0} optional days.', 'You have trained this',
    'It will fill {0} sessions a week'],
  'src/views/Plan.jsx': ['Days a week', 'Empty', 'How often', 'No days yet.',
    'No room left in a seven-day week', 'Nothing scheduled on them yet.', 'Optional days',
    'Set how often you train above', '{0} planned', 'Train them if you can'],
  'src/views/CoachIntake.jsx': ['Added {0} from the photos', 'An optional day is one',
    'Could not scan the photos', 'From an earlier answer or a scan',
    'How many of those are optional?', 'No gym equipment recognised',
    'Or photograph your gym', 'Photo scan is not available',
    'Pick as many as apply, up to {0}', 'Pick at least one to continue.',
    'Pick what you will actually keep', 'Put the one that matters most first',
    'Scan gym photos', 'Scanning', 'Seven days leaves no room',
    'Something else? Type it', 'That is as many as a plan can serve',
    'Up to 3 photos', 'comma separated'],
  'src/lib/plan-share.js': ['Not planned yet'],
}

for (const [file, keys] of Object.entries(WANT)) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  console.log(`##### ${file}`)
  for (const k of keys) {
    const i = lines.findIndex(l => l.includes(k))
    if (i < 0) { console.log(`!! not found: ${k}`); continue }
    for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 1); j++) {
      console.log(`${j + 1}: ${lines[j].trim()}`)
    }
    console.log('')
  }
}