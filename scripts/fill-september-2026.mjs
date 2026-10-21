// Writes the September 2026 Daily Log Entry workbooks for Steve and Jerrell
// from the house manager's reports (notes/september-2026-client-notes.md)
// on top of each man's regular routine. She reports a few days at a time:
// REPORTED_THROUGH is the last day she has covered and nothing after it is
// written - bump it and add EVENTS entries as her reports come in.
//
//   node scripts/fill-september-2026.mjs [--individual steven|jerrell|both]
//     -> Steven_September2026_Daily_Log_Entry (filled).docx
//     -> Jerrell_September2026_Daily_Log_Entry (filled).docx
//
// Box order per date follows the workbook: 8am-4pm, 4pm-12am, 12am-8am, and
// the 12am-8am box is read literally as the early hours of that date. Shared
// afternoons/evenings (dominoes, movies, Xbox, walks, Friday meetings) use one
// key for both men so the two logs describe the same thing from each side.
//
// Wording rules the app relies on (checked with scripts/snapshot-mapping.mjs +
// review-snapshot.mjs check):
// - no health/incident vocabulary (sore, pain, upset, argument, refused,
//   hospital...) unless the house manager reported it;
// - a sentence that mentions Steve's day program in Jerrell's log says he
//   "did not go" AND carries a wish ("would like to", "looking forward") so it
//   is neither a community outing nor a declined one;
// - Steve's off days never say "day off"/"stayed home" next to "day support"
//   (that reads as a declined outing) and evening/overnight lines do not
//   mention the program (that pulls in the day-program group default);
// - group lines say "together" or "housemate"; the first line with a leisure
//   cue (guitar, music, TV, drawing, relaxed...) becomes the Individual
//   Activity, so leisure lines come before "himself"/"on his own" lines.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Packer } from 'docx';
import { INDIVIDUALS, MONTHS, buildDocument, monthDays } from './build-entry-workbook.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const YEAR = 2026;
const MONTH_INDEX = 8; // September
const REPORTED_THROUGH = 9; // Report 1 (received Sep 10) covers Sep 1-9
const HOLIDAYS = { 7: 'Labor Day' };

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const who = opt('--individual') ?? 'both';

// ---------------------------------------------------------------------------
// Calendar helpers
// ---------------------------------------------------------------------------
const dowOf = (d) => new Date(Date.UTC(YEAR, MONTH_INDEX, d)).getUTCDay();
const weekendOf = (d) => [0, 6].includes(dowOf(d));
// Steve attends Inner Vision Day Support Mon/Tue/Thu/Fri (Wednesday is his day off).
const programDay = (d) => {
  const dow = dowOf(d);
  return dow >= 1 && dow <= 5 && dow !== 3 && !HOLIDAYS[d];
};
const weekOf = (d) => Math.floor((d - 1) / 7); // Sep 4 -> 0, Sep 11 -> 1, Sep 18 -> 2, Sep 25 -> 3

const rot = (pool, d, salt = 0) => pool[(d + salt) % pool.length];
const join = (...lines) => lines.filter(Boolean).join('\n');

// Shared activities: the same key on the same date in both logs.
const EVENING_KEYS = ['dominoes', 'movie', 'guitar', 'xbox', 'walk', 'dominoes', 'game', 'movie', 'music'];
const DAYTIME_KEYS = ['movie', 'dominoes', 'xbox', 'dominoes', 'movie'];
const SOLO_KEYS = new Set(['guitar', 'music']);
const sharedEvening = (d) => EVENING_KEYS[(d + 4) % EVENING_KEYS.length];
const sharedDaytime = (d) => DAYTIME_KEYS[d % DAYTIME_KEYS.length];

// ===========================================================================
// STEVE
// ===========================================================================
const S = {
  MOODS: {
    day: ['Happy', 'Content', 'Happy, Talkative', 'Calm', 'Excited', 'Friendly', 'Happy, Outgoing'],
    evening: ['Content', 'Calm', 'Relaxed', 'Happy', 'Calm, Content', 'Happy, Relaxed', 'Content, Talkative'],
    night: ['Calm', 'Sleeping', 'Calm, Rested', 'Sleeping', 'Calm', 'Sleeping', 'Rested'],
    off: ['Relaxed', 'Happy', 'Calm', 'Content', 'Happy, Relaxed'],
  },
  // Program-day morning (the 8am-4pm box starts with Steve already up).
  READY: [
    'When staff arrived at 8:00 AM Steve was already showered, shaved and dressed for the day without any prompts.',
    'Steve was up, showered and dressed when the day shift started at 8:00 AM; he had picked out clean clothes without help.',
    'Steve had finished his morning hygiene routine without any prompts and was dressed and ready for the day by 8:00 AM.',
    'Steve was awake and dressed at the start of the shift; staff reminded him to comb his hair and he did.',
  ],
  // Leisure before breakfast (first leisure cue = Individual Activity).
  DAY_EXTRA: [
    'Steve played his guitar for about fifteen minutes in the morning and showed staff a chord he has been practicing.',
    'Steve put on music in the living room while staff got the kitchen ready and sang along to a few songs.',
    'Steve watched TV for a few minutes in the morning and chatted with staff about the weather.',
    'Steve relaxed on the couch with his guitar and worked on a new song for a few minutes.',
    'Steve read a magazine at the table in the morning and told staff about a band he likes.',
  ],
  BREAKFAST: [
    'Steve cooked scrambled eggs and whole-wheat toast for breakfast while staff supervised stove safety; he wiped the stove and put his dishes in the sink when he finished.',
    'Steve made oatmeal with a handful of berries for breakfast; staff reminded him to keep the portion small because of his diabetes and he measured it out himself.',
    'Steve prepared turkey sausage, eggs and a slice of toast for breakfast with staff nearby for stove safety, then cleaned up his dishes.',
    'Steve had Greek yogurt with sliced banana and a boiled egg for breakfast; he boiled the egg himself with staff monitoring the stove.',
    'Steve made a two-egg omelet with peppers and onions for breakfast with staff supervising at the stove; he ate at the table and rinsed his plate afterwards.',
    'Steve fixed a breakfast sandwich (egg and cheese on a whole-wheat English muffin) with staff supervision and had a glass of water with it.',
  ],
  LATE_BREAKFAST: [
    'Steve made a vegetable omelet and whole-wheat toast for a late breakfast with staff supervising the stove.',
    'Steve had oatmeal with cinnamon and a boiled egg for breakfast; he cooked it with staff nearby for stove safety.',
    'Steve cooked turkey bacon and eggs for a late breakfast with staff supervision and cleaned up afterwards.',
    'Steve made whole-grain pancakes for a late breakfast with staff nearby; staff reminded him to use sugar-free syrup and he did.',
    'Steve prepared scrambled eggs with spinach and toast for breakfast with staff supervising the stove; he washed his plate and pan afterwards.',
  ],
  MORNING_MEDS: [
    "Staff administered Steve's morning medications at 8:00 AM as prescribed; he took them without difficulty.",
    'Morning medications were given at 8:00 AM as prescribed and Steve took them without any problem.',
    'Steve received his 8:00 AM medications as prescribed; he had no complaints.',
    "Staff gave Steve his morning medications at 8:00 AM as prescribed; he took them right away without any problem.",
  ],
  GRAB_LUNCH: [
    'Steve took the lunch he packed last night from the refrigerator and filled his water bottle before leaving; staff reminded him to skip the soda at the program and he agreed.',
    'Steve got his lunch bag from the refrigerator, added a bottle of water and checked that he had everything he needed for the day.',
    'Staff reminded Steve to take his packed lunch and water bottle; he got both and set them by the door.',
    'Steve added a piece of fruit to the lunch he prepared the night before and filled his water bottle for the day.',
  ],
  DEPART: [
    'Steve left for Inner Vision Day Support at 8:30 AM in a good mood with his bag and water bottle.',
    'Steve went to Inner Vision Day Support for the day, leaving at 8:30 AM; he said goodbye to staff and told them he was ready for a good day.',
    'Steve attended Inner Vision Day Support today; he left at 8:30 AM and spent the day at the program.',
    'At 8:30 AM Steve left for his day program at Inner Vision Day Support, on time and in good spirits.',
  ],
  AT_PROGRAM: [
    'Steve was at Inner Vision Day Support from 8:30 AM until the end of the shift; the program did not call with any concerns.',
    'Steve spent the day at his program; there were no calls from Inner Vision Day Support during the shift.',
    'Steve remained at Inner Vision Day Support for the rest of the shift and the program did not report any concerns.',
  ],
  HYDRATION_DAY: [
    'Staff offered water throughout the shift and Steve drank well.',
    'Staff reminded Steve to drink water instead of juice with breakfast and sent a full water bottle with him.',
    'Fluids were offered regularly during the shift; Steve drank two cups of water before leaving for the day.',
    'Staff offered Steve water with breakfast and again before he left; he drank both times.',
  ],
  HYDRATION_HOME: [
    'Staff offered water throughout the day and Steve drank well.',
    'Fluids were offered regularly during the shift; Steve kept his water bottle with him and refilled it twice.',
    'Staff reminded Steve to drink water instead of soda with lunch and he chose water.',
  ],
  // Off days (Wednesday, weekends, holidays)
  WAKE_OFF: [
    'Steve woke up around 8:00 AM, showered and got dressed without any prompts, then came to the kitchen.',
    'Steve got up at about 8:00 AM, finished his morning hygiene routine without help and picked out comfortable clothes for a day at home.',
    'Steve was up around 8:00 AM; he showered, shaved and got dressed without any prompts from staff.',
  ],
  LAUNDRY: [
    'Steve did his laundry today: he sorted his clothes, ran the washer and dryer without help and staff helped him fold and hang his shirts.',
    'Steve washed and dried two loads of laundry; staff helped him fold the clothes and he put them away in his dresser and closet.',
    'Laundry day: Steve started the washer without help, moved the clothes to the dryer with a reminder from staff, and folded and put everything away with staff helping.',
    'Steve did his laundry, including his bed sheets; staff helped him fold the sheets and he made his bed with the clean set.',
  ],
  ROOM: [
    'Steve changed his bed sheets and vacuumed his room with a reminder from staff.',
    'Steve cleaned his room: he made his bed, dusted his dresser and took the trash out of his room.',
    'Steve tidied his room and organized his closet after putting his clean laundry away.',
    'Steve wiped down his nightstand and dresser and straightened his room on his own.',
  ],
  LUNCH_HOME: [
    'Steve made a grilled chicken salad for lunch with staff supervising the stove and had water with it.',
    'Steve prepared a turkey sandwich on wheat bread with a side of carrots for lunch and drank water with his meal.',
    'Steve cooked a vegetable and egg scramble for lunch with staff nearby; he used a small plate as staff reminded him.',
    'Steve heated up leftovers for lunch and added a side salad; he cleaned up afterwards.',
    'Steve made tuna salad on whole-wheat crackers for lunch and had a glass of water; staff reminded him about portion size.',
  ],
  SOLO_HOME: [
    'Steve played his guitar in the living room for about half an hour in the afternoon.',
    'Steve put on some music and relaxed on the couch in the afternoon.',
    'Steve took a short nap in the afternoon after finishing his chores.',
    'Steve played his guitar and worked on learning a new song; he played part of it for staff.',
    'Steve watched TV in the living room and chatted with staff about the show.',
  ],
  WALK_HOME: [
    'Steve went for a walk around the neighborhood with staff in the afternoon for exercise.',
    'Steve went for a walk with staff to the end of the street and back in the afternoon; he said the fresh air felt good.',
    'Steve went for a walk around the block with staff for about twenty minutes in the afternoon and chatted about his week.',
  ],
  GROCERY: [
    'Steve helped with the weekly grocery shopping with staff; he read the list, picked out fresh vegetables and chose sugar-free drinks with a reminder from staff about his diabetes.',
    'Steve went grocery shopping with staff for the week; he compared prices, picked out lean meats and fruit and helped carry the bags inside.',
    'Steve went along for the weekly grocery shopping with staff; he chose whole-wheat bread and vegetables for the week and helped put everything away at home.',
    'Steve and staff did the weekly grocery shopping; he picked out fruit and yogurt for his breakfasts and chose water and sugar-free drinks instead of soda.',
  ],
  HOME_DAY: [
    'Steve helped staff cook lunch (baked chicken, sweet potatoes and green beans); he set the table and cleaned up afterwards.',
    'Steve spent the morning at home; he played his guitar and watched TV in the living room.',
    'Steve cooked turkey burgers and a salad for lunch with staff supervising the grill.',
    'Steve spent a quiet morning at home with music on and playing his guitar.',
  ],
  // Evening
  RETURN: [
    'Steve returned home at 4:00 PM in a good mood; he washed his hands and had a snack of apple slices with peanut butter and a glass of water.',
    'Steve got home at 4:00 PM, put his lunch bag in the kitchen and told staff about his day; he had cheese and crackers and water for a snack.',
    'Steve came home at 4:00 PM, changed into comfortable clothes and rested on the couch for about half an hour; he said his day went well.',
    'Steve arrived home at 4:00 PM; he rinsed out his lunch containers, had a small snack of grapes and rested for a while before dinner.',
    'Steve came home at 4:00 PM and talked with staff about the activities his group did during the day; he had a glass of water and a small snack.',
  ],
  DINNER: [
    'Steve cooked baked chicken breast, brown rice and steamed broccoli for dinner with staff supervising the oven and stove; he measured his portions as staff reminded him.',
    'Steve made turkey chili for dinner with staff nearby for stove safety; he chopped the vegetables and set the table.',
    'Steve grilled chicken and made a side salad for dinner; staff supervised the grill and reminded him to check that the chicken was cooked through.',
    'Steve prepared spaghetti with lean ground turkey sauce and a green salad for dinner with staff supervising the stove; he cleaned the counters afterwards.',
    'Steve baked fish with roasted vegetables for dinner with staff supervision; he said it was one of his favorite meals.',
    'Steve heated up leftovers for dinner in the microwave and added a side salad; staff reminded him to use a smaller plate and he did.',
    'Steve made a chicken and mixed-vegetable stir-fry for dinner while staff supervised the stove; he portioned his plate with a reminder from staff about serving size and had water with his meal.',
  ],
  EVENING_MEDS: [
    'Evening medications were given at 8:00 PM as prescribed; Steve took them without difficulty.',
    "Staff administered Steve's 8:00 PM medications as prescribed and he took them without any problem.",
    'Steve received his evening medications at 8:00 PM as prescribed.',
  ],
  SOLO_EVE: [
    'Steve played his guitar in the living room for about twenty minutes in the evening.',
    'Steve put on music in the living room for a while in the evening.',
    'Steve watched TV in the living room and relaxed for a while.',
    'Steve relaxed on the couch and looked through a guitar magazine.',
    'Steve rested in his room for a while with music playing.',
  ],
  HOUSEKEEPING_EVE: [
    'Steve washed the dishes and wiped down the table on his own.',
    'Steve loaded the dishwasher and took out the kitchen trash.',
    'Steve wiped the counters and swept the kitchen floor with a reminder from staff.',
    'Steve helped staff put the leftovers away and cleaned the stove top.',
  ],
  HYDRATION_EVE: [
    'Steve drank water with dinner and staff offered water again before bed.',
    'Staff reminded Steve to choose water over soda with his meal and he did.',
    'Fluids were offered through the evening; Steve drank two cups of water.',
  ],
  HYGIENE_EVE: [
    'Steve took his shower at 9:30 PM, brushed his teeth and put on clean pajamas.',
    'Steve showered and brushed his teeth before bed and set out his clothes for the morning.',
    'Steve completed his bedtime hygiene routine without any prompts: shower, brushing his teeth and putting on clean nightclothes.',
  ],
  PACK_LUNCH_EVE: [
    'Steve packed his lunch for tomorrow (turkey sandwich, apple and a water bottle) and put it in the refrigerator.',
    'Steve prepared his lunch bag for tomorrow with a reminder from staff: leftover chicken and rice, grapes and a sugar-free drink.',
    'Steve packed his lunch for the next day without help and set his alarm for 6:45 AM.',
    'Steve made a chicken salad wrap and packed it with carrot sticks and an orange for his lunch tomorrow.',
  ],
  BEDTIME_EVE: [
    'Steve went to bed at 10:30 PM after saying goodnight to staff.',
    'Steve was in bed by 11:00 PM; staff reminded him that they would be checking on him overnight as usual.',
    'Steve settled into bed around 10:45 PM after watching the end of his show.',
  ],
  // Overnight (ends the morning of this date)
  ASLEEP: [
    'Steve was already asleep at the start of the shift at 12:00 AM.',
    'At the start of the shift Steve was in bed and asleep; his room was quiet and his door was ajar for checks.',
    'Steve was sleeping soundly at midnight when staff did the first check.',
  ],
  MONITOR: [
    'Staff completed bed checks every hour throughout the night for seizure monitoring; Steve was breathing normally and no seizure activity was observed.',
    'Hourly bed checks were completed and documented; no seizure activity was observed and Steve remained safe throughout the night.',
    'Staff checked on Steve every hour during the night; he slept in a normal position and no seizure activity was noted.',
    'Overnight seizure monitoring was completed with hourly checks; no seizure activity was observed.',
  ],
  SLEEP: [
    'Steve slept through the night without waking.',
    'Steve woke once around 2:30 AM to use the bathroom and went back to sleep within a few minutes.',
    'Steve slept soundly; he turned over once around 3:00 AM and stayed asleep.',
    'Steve got up briefly around 1:00 AM for a glass of water and returned to bed.',
  ],
  WATER_NIGHT: ["Water was available at Steve's bedside.", "A fresh glass of water was placed at Steve's bedside for the night."],
  HOUSE_NIGHT: [
    'The house was quiet and secure overnight; staff checked the doors and windows at the start of the shift.',
    'Staff kept noise to a minimum and completed the overnight housekeeping tasks while Steve slept.',
    'All doors were locked and the house stayed quiet through the night.',
  ],
  WAKE_PROGRAM: [
    'Steve woke up at 6:45 AM without prompting, showered and started getting ready for the day.',
    'Steve was up at 7:00 AM in a good mood and began his morning routine without any prompts.',
    'Steve got up at 6:50 AM when his alarm went off and went to take his shower.',
  ],
  WAKE_LATE: [
    'Steve was still asleep at the end of the shift at 8:00 AM.',
    'Steve woke up around 7:45 AM and rested in bed until the day staff arrived.',
    'Steve slept in; he was still resting comfortably at 8:00 AM.',
  ],
  // Shared activities from Steve's side
  EVE: {
    dominoes: [
      'Steve and Jerrell played dominoes together at the dining table in the evening; the game went on for almost an hour and Steve won two of the three rounds.',
      'In the evening Steve and Jerrell set up a game of dominoes and played several rounds together; they joked with each other and Steve kept score.',
      'Steve showed Jerrell a different way to score dominoes and they played three games together in the living room.',
    ],
    movie: [
      'Steve and Jerrell watched a movie together in the living room with a bowl of popcorn; Steve chose an action movie and both enjoyed it.',
      'Steve picked out a comedy and watched it together with Jerrell in the living room; both were laughing through most of it.',
      'Steve watched a movie with his housemate Jerrell in the evening and they chatted about their favorite parts.',
    ],
    guitar: [
      'Steve played his guitar in the living room for about thirty minutes and performed a song for Jerrell and staff, who clapped for him.\nAfterwards Steve and Jerrell watched TV together for a while before bed.',
      'Steve played his guitar in the evening and worked on a new song; Jerrell enjoyed it and told him it sounded good.\nSteve and Jerrell then watched TV together for a while.',
    ],
    xbox: [
      'Steve and Jerrell played Xbox together for about an hour; they took turns and got along well.',
      'Steve and Jerrell played a racing game on the Xbox together in the evening and laughed a lot.',
    ],
    walk: [
      'Around 6:30 PM Steve, Jerrell and staff went for a walk around the neighborhood together for exercise; Steve set a steady pace and enjoyed the fresh air.',
      'Around 6:30 PM Steve, Jerrell and staff went for a walk around the block together; Steve set the pace and said he wants to keep walking in the evenings.',
    ],
    game: [
      'Steve and Jerrell watched a game together on TV and cheered for their teams.',
      'Steve and Jerrell watched a game on TV together in the evening and both got into it.',
    ],
    music: [
      'Steve put on music in the living room and sang along to a few songs while staff cleaned up the kitchen.',
      'Steve put on his favorite music in the living room and relaxed for a while in the evening.',
    ],
  },
  DAY_TOGETHER: {
    movie: ['Steve and Jerrell watched a movie together in the living room in the afternoon.', 'In the afternoon Steve and Jerrell picked a movie together and watched it in the living room.'],
    dominoes: [
      'Steve and Jerrell played dominoes together at the dining table for about an hour and kept score.',
      'Steve and Jerrell played several rounds of dominoes together in the afternoon; Steve won most of them and Jerrell asked for a rematch.',
    ],
    xbox: ['Steve and Jerrell played Xbox together in the afternoon and took turns.', 'Steve and Jerrell played a few rounds of Xbox together in the living room.'],
  },
  // Index = weekOf(d): Sep 4 -> 0, Sep 11 -> 1, Sep 18 -> 2, Sep 25 -> 3.
  FRIDAY_MEETING: [
    'Steve took part in the weekly Friday house meeting with his housemate Jerrell and staff; they discussed how the first week of September went, weekend plans and keeping the shared spaces clean.',
    'At the Friday house meeting Steve, his housemate Jerrell and staff reviewed the chore chart for the coming week and discussed healthy snack choices; Steve volunteered to keep the living room tidy.',
    "Steve joined the Friday house meeting with his housemate Jerrell and staff; the topics were respecting each other's space, house safety and ideas for weekend activities.",
    'During the Friday house meeting Steve, his housemate Jerrell and staff discussed how the month has gone, what each of them enjoyed most and menu ideas for next week.',
  ],
  SAVINGS: [
    'Steve reviewed his savings with staff and put most of his $20 weekly allowance into his savings envelope, keeping a few dollars for snacks.',
    'Steve and staff counted his savings envelope; he added his allowance for the week and talked about what he might like to save for.',
    'Steve counted his savings with staff; he saved most of his $20 allowance again this week and was proud of the total.',
    'Steve went over his spending for the week with staff and put the rest of his allowance into his savings envelope.',
  ],
};

function steveRoutine(d) {
  const dow = dowOf(d);
  const wednesday = dow === 3;
  const program = programDay(d);
  const w = weekOf(d);
  const eveKey = sharedEvening(d);

  let day;
  if (program) {
    day = {
      mood: rot(S.MOODS.day, d),
      notes: join(
        rot(S.READY, d),
        rot(S.DAY_EXTRA, d),
        rot(S.BREAKFAST, d, 1),
        rot(S.MORNING_MEDS, d),
        rot(S.GRAB_LUNCH, d, 2),
        rot(S.HYDRATION_DAY, d, 1),
        rot(S.DEPART, d, 3),
        rot(S.AT_PROGRAM, d),
      ),
    };
  } else if (wednesday) {
    day = {
      mood: rot(S.MOODS.off, w),
      notes: join(
        rot(S.WAKE_OFF, d),
        rot(S.MORNING_MEDS, d),
        rot(S.LATE_BREAKFAST, d),
        rot(S.LAUNDRY, w),
        rot(S.ROOM, w),
        rot(S.LUNCH_HOME, d),
        rot(S.SOLO_HOME, w),
        rot(S.DAY_TOGETHER[sharedDaytime(d)], w),
        w % 2 === 0 ? rot(S.WALK_HOME, w) : null,
        rot(S.HYDRATION_HOME, d),
      ),
    };
  } else {
    // Weekend or holiday at home
    day = {
      mood: rot(S.MOODS.day, d, 2),
      notes: join(
        HOLIDAYS[d] ? `Steve was home for the ${HOLIDAYS[d]} holiday.` : null,
        rot(S.WAKE_OFF, d, 1),
        rot(S.MORNING_MEDS, d, 1),
        rot(S.LATE_BREAKFAST, d, 2),
        dow === 6 ? rot(S.GROCERY, w) : rot(S.HOME_DAY, w),
        dow === 6 ? rot(S.LUNCH_HOME, d, 2) : null,
        rot(S.SOLO_HOME, d),
        rot(S.DAY_TOGETHER[sharedDaytime(d)], d),
        dow === 0 ? rot(S.WALK_HOME, w, 1) : null,
        rot(S.HYDRATION_HOME, d, 1),
      ),
    };
  }

  const evening = {
    mood: rot(S.MOODS.evening, d),
    notes: join(
      program ? rot(S.RETURN, d) : null,
      rot(S.DINNER, d),
      rot(S.EVENING_MEDS, d),
      SOLO_KEYS.has(eveKey) && dow !== 5 ? null : rot(S.SOLO_EVE, d),
      dow === 5 ? S.FRIDAY_MEETING[w] : rot(S.EVE[eveKey], w),
      dow === 0 ? rot(S.SAVINGS, w) : null,
      rot(S.HOUSEKEEPING_EVE, d, 1),
      rot(S.HYDRATION_EVE, d),
      rot(S.HYGIENE_EVE, d, 2),
      programDay(d + 1) ? rot(S.PACK_LUNCH_EVE, d) : null,
      rot(S.BEDTIME_EVE, d, 1),
    ),
  };

  // 12am-8am ends on the morning of this date.
  const night = {
    mood: rot(S.MOODS.night, d),
    notes: join(
      rot(S.ASLEEP, d),
      rot(S.MONITOR, d, 1),
      rot(S.SLEEP, d, 2),
      rot(S.WATER_NIGHT, d),
      rot(S.HOUSE_NIGHT, d, 1),
      program ? rot(S.WAKE_PROGRAM, d) : rot(S.WAKE_LATE, d, 1),
    ),
  };
  return { day, evening, night };
}

// ---------------------------------------------------------------------------
// What the house manager reported for Steve (Report 1, Sep 1-9)
// ---------------------------------------------------------------------------
const STEVE_EVENTS = {
  // Tue Sep 1, evening: park outing ("memont park" - name and whether it was
  // his Tue/Thu community engagement program still to be confirmed).
  1: {
    evening: {
      mood: 'Happy, Excited',
      notes: join(
        'Steve came home at 4:00 PM, had a snack of apple slices and water, and played his guitar for a while before leaving for the evening.',
        'Steve went to the park this evening; he walked the trail, enjoyed the fresh air and spent time outdoors until it started to get dark, and staff provided transportation there and back.',
        'Steve came back at about 8:00 PM and told staff all about the park; he was in a great mood.',
        'Evening medications were given at 8:15 PM as prescribed after he returned.',
        'Steve ate the dinner staff had kept warm for him (baked chicken and vegetables) and drank water with his meal.',
        'Steve took his shower, packed his lunch for tomorrow and was in bed by 10:45 PM.',
      ),
    },
  },
  // Wed Sep 2, day: laundry (his Wednesday routine) and Burger King with Jerrell.
  2: {
    day: {
      mood: 'Happy, Relaxed',
      notes: join(
        'Steve woke up around 8:00 AM, showered and got dressed without any prompts.',
        'Morning medications were given at 8:00 AM as prescribed and Steve took them without any problem.',
        'Steve made a vegetable omelet and whole-wheat toast for breakfast with staff supervising the stove.',
        'Steve did his laundry: he sorted his clothes, ran the washer and dryer without help and staff helped him fold and put everything away.',
        'Steve and Jerrell went out for lunch at Burger King with staff; Steve ordered a grilled chicken sandwich and chose water after a reminder from staff about his diabetes. He enjoyed getting out for lunch.',
        'Back home Steve and Jerrell played dominoes together at the dining table for about an hour.',
        'Steve played his guitar in the afternoon and performed a song for staff.',
        'Staff offered water throughout the shift and Steve drank well.',
      ),
    },
  },
  // Thu Sep 3, evening: cooked his own dinner after day support, then a ride
  // and a walk ("roadride" - meaning to be confirmed).
  3: {
    evening: {
      mood: 'Content, Happy',
      notes: join(
        'Steve came home at 4:00 PM in a good mood and had a glass of water and a small snack.',
        'Steve cooked his own dinner tonight - grilled chicken with rice and mixed vegetables - with staff supervising the stove; he portioned his plate and cleaned the counters afterwards.',
        'After dinner, around 6:30 PM, staff took Steve out for a drive and then a walk; he enjoyed the fresh air and they were back home by about 7:45 PM.',
        'Evening medications were given at 8:00 PM as prescribed.',
        'Steve watched some TV together with Jerrell, then took his shower and packed his lunch for tomorrow.',
        'Steve was in bed by 10:30 PM.',
      ),
    },
  },
  // Fri Sep 4: day support (reported) - routine day; Friday house meeting evening.
  // Sat Sep 5, day: Yorktown Beach.
  5: {
    day: {
      mood: 'Excited, Happy',
      notes: join(
        'Steve woke up around 8:00 AM excited about going to the beach; he showered and got dressed without any prompts.',
        'Morning medications were given at 8:00 AM as prescribed.',
        'Steve made scrambled eggs and toast for breakfast with staff supervising the stove and packed a small cooler with water bottles and fruit for the beach.',
        'Staff drove Steve to Yorktown Beach for a community outing; they arrived around 10:30 AM. Steve applied sunscreen with a reminder from staff, walked along the shoreline, waded in the river and relaxed on the sand.',
        'Steve had a packed lunch (turkey sandwich and fruit) at a picnic table by the beach and drank plenty of water; staff reminded him to reapply sunscreen and he did.',
        'Steve said he had a great time and thanked staff for taking him.',
        'They were back home around 2:30 PM; Steve rinsed off, changed clothes and rested in the living room.',
        'Staff offered water throughout the day and Steve drank well.',
      ),
    },
  },
  // Sun Sep 6, day: the mall ("shortown mall" - name to be confirmed).
  6: {
    day: {
      mood: 'Happy, Content',
      notes: join(
        'Steve was up at 8:00 AM; he showered and got dressed without any prompts.',
        'Morning medications were given at 8:00 AM as prescribed and Steve took them without any problem.',
        'Steve made oatmeal with berries for breakfast with staff nearby and cleaned up afterwards.',
        'Staff took Steve to the mall late in the morning; he walked around, looked at guitar accessories and browsed the clothing stores, and enjoyed people-watching from a bench near the food court.',
        'Steve had lunch at the food court and chose grilled chicken and water after a reminder from staff about healthy choices.',
        'Back home around 2:00 PM Steve relaxed in the living room and played his guitar for a while.',
        'Staff offered water throughout the shift.',
      ),
    },
  },
  // Mon Sep 7, Labor Day: written as a home day (day support closed - confirm).
  7: {
    day: {
      mood: 'Relaxed, Content',
      notes: join(
        'Steve was home for the Labor Day holiday.',
        'Steve woke up around 8:00 AM, showered and got dressed without any prompts.',
        'Morning medications were given at 8:00 AM as prescribed and Steve took them without any problem.',
        'Steve cooked turkey bacon and eggs for a late breakfast with staff supervising the stove.',
        'Steve helped staff prepare a Labor Day lunch of grilled chicken, corn on the cob and a garden salad; he set the table and cleaned up afterwards.',
        'Steve played his guitar for a while in the morning.',
        'Steve and Jerrell played dominoes together for about an hour after lunch and then watched a movie together in the living room.',
        'Staff offered water throughout the day and Steve drank well.',
      ),
    },
  },
  // Wed Sep 9, day: home relaxing ("home chilling"); laundry is his Wednesday routine.
  9: {
    day: {
      mood: 'Relaxed, Calm',
      notes: join(
        'Steve woke up at 8:00 AM for his morning medications, which were given as prescribed, and then rested in bed for a while before getting up.',
        'Steve showered and got dressed without any prompts and made a two-egg omelet and toast for a late breakfast with staff nearby.',
        'Steve spent a quiet day at home relaxing: he watched TV, put on music and played his guitar in the living room.',
        'Steve did his laundry today: he ran the washer and dryer without help and staff helped him fold and put his clothes away.',
        'Steve made a chicken salad sandwich for lunch and had water with it.',
        'Steve and Jerrell watched a movie together in the afternoon.',
        'Staff offered water throughout the shift and Steve drank well.',
      ),
    },
  },
};

// ===========================================================================
// JERRELL
// ===========================================================================
const J = {
  MOODS: {
    day: ['Content', 'Calm', 'Happy', 'Relaxed', 'Content, Friendly', 'Calm, Relaxed', 'Happy, Talkative'],
    evening: ['Content', 'Relaxed', 'Calm', 'Happy', 'Calm, Content', 'Friendly', 'Relaxed, Happy'],
    night: ['Calm', 'Sleeping', 'Calm', 'Sleeping', 'Calm, Rested', 'Sleeping', 'Calm'],
  },
  BREAKFAST: [
    'Jerrell got up around 8:15 AM, washed up and came to the kitchen; he made a banana and strawberry smoothie with his smoothie machine and two slices of toast for breakfast while staff monitored the kitchen, then rinsed the blender.',
    'Jerrell woke up around 8:00 AM and made a fruit smoothie and a bowl of cereal for breakfast; staff reminded him to wipe the counter and he did.',
    'Jerrell made scrambled eggs and toast for breakfast with staff nearby and blended a mango smoothie to go with it; he washed his dishes afterwards.',
    'Jerrell had oatmeal with sliced banana and a smoothie for breakfast that he prepared with staff monitoring the kitchen.',
    'Jerrell got up around 8:30 AM in a good mood and made a peanut butter and banana smoothie and toast for breakfast; staff reminded him to put the milk back in the refrigerator.',
  ],
  LATE_BREAKFAST: [
    'Jerrell slept in and then made a smoothie and toast for breakfast with staff nearby.',
    'Jerrell got up around 9:30 AM and made a fruit smoothie and eggs for breakfast; staff monitored the kitchen.',
    'Jerrell woke up late and had cereal and a smoothie for breakfast that he prepared with staff nearby.',
    'Jerrell slept in a little, then made a strawberry smoothie and a toasted bagel for breakfast and cleaned up afterwards.',
  ],
  MORNING_MEDS: [
    'Morning medications were given at 9:00 AM as prescribed and Jerrell took them without any problem.',
    "Staff administered Jerrell's morning medications at 9:00 AM as prescribed.",
    'Jerrell received his 9:00 AM medications as prescribed and took them without any problem.',
  ],
  EVENING_MEDS: [
    'Evening medications were given at 8:00 PM as prescribed.',
    "Staff administered Jerrell's evening medications at 8:00 PM as prescribed; he took them without difficulty.",
    'Jerrell took his 8:00 PM medications as prescribed without any problem.',
  ],
  // Steve leaves for day support; Jerrell's enrollment is still pending. One
  // sentence each: "did not go" + a wish, so the app ignores it for outings.
  STEVE_LEAVES: [
    'Steve left for his day program at 8:30 AM and Jerrell did not go because his enrollment is still pending; he told staff he is looking forward to starting day support and staff explained that the house manager is still working on it.',
    'Jerrell stayed home and did not go to day support while Steve went to his program this morning; he talked about wanting to start his program soon and staff reassured him that the house manager is following up on his enrollment.',
    'Jerrell did not go to day support today because his enrollment is still pending; he said he would like to start as soon as it is set up and then chose what to do with his morning.',
    'When Steve left for his day program at 8:30 AM Jerrell said goodbye; he did not go because his enrollment is not complete yet, and he told staff he would like to go too once it is set up.',
  ],
  // Two lines each: dressing is independent, grooming takes a reminder.
  HYGIENE_DAY: [
    'Jerrell picked out his clothes and got dressed without any help from staff.\nJerrell brushed his teeth and washed his face after a reminder from staff.',
    'Jerrell got dressed without help in clean, weather-appropriate clothes.\nJerrell shaved and put on deodorant after a reminder from staff.',
    'Jerrell got dressed and combed his hair without any help from staff.\nJerrell brushed his teeth after a reminder from staff.',
    'Jerrell dressed without help and matched his clothes well; staff complimented his outfit.\nJerrell brushed his teeth after a reminder from staff.',
  ],
  ACTIVITY_DAY: [
    'Jerrell spent the morning drawing at the kitchen table and showed staff his artwork; he is working on a portrait.',
    'Jerrell watched a movie in the living room and then sketched for a while.',
    'Jerrell worked in his sketchbook for most of the morning with music playing.',
    'Jerrell put on music in his room and drew; he showed staff a finished drawing and staff praised his work.',
    'Jerrell drew at the dining table by the window and talked with staff while he worked.',
    'Jerrell watched TV (a documentary about wildlife) and talked with staff about it afterwards.',
  ],
  LUNCH: [
    'Jerrell made a turkey sandwich and a smoothie for lunch with staff nearby and cleaned up afterwards.',
    'Jerrell heated up leftovers for lunch and ate at the table; staff reminded him to use a pot holder.',
    'Jerrell had lunch (a chicken wrap and fruit) that he prepared with staff nearby.',
    'Jerrell made grilled cheese for lunch with staff supervising the stove and had water with it.',
    'Jerrell fixed a salad with grilled chicken for lunch; staff encouraged him to add vegetables because of his gout and he did.',
  ],
  LAUNDRY: [
    'Jerrell did his own laundry independently: he washed, dried and folded his clothes and put them away.',
    'Jerrell did his laundry on his own today - two loads, washed, dried, folded and put away in his closet.',
    'Jerrell washed his sheets and clothes independently and made his bed with the clean sheets.',
    'Jerrell did his laundry without any help, folded everything and put it away.',
  ],
  HOUSEKEEPING_DAY: [
    'Jerrell made his bed and tidied his room.',
    'Jerrell took out the trash and wiped the kitchen counter after lunch.',
    'Jerrell vacuumed the living room with a reminder from staff.',
    'Jerrell washed his breakfast dishes and put them away.',
    'Jerrell swept the kitchen floor after lunch on his own.',
    'Jerrell cleaned the bathroom sink and mirror with a reminder from staff.',
  ],
  HEALTH_WEEKLY: {
    1: 'Staff reminded Jerrell to drink plenty of water and choose healthy foods because of his gout; he had no gout symptoms today.',
    2: 'Staff encouraged Jerrell to eat fruit and drink water to keep his bowels regular; he reported no constipation.',
    4: 'Staff reminded Jerrell to drink water through the day and to limit soda because of his gout; he had no gout symptoms today.',
  },
  HYDRATION: ['Staff offered water through the shift.', 'Staff offered water and Jerrell drank well during the shift.', 'Jerrell kept a bottle of water with him and refilled it during the shift.'],
  WALK_DAY: [
    'Jerrell went for a walk around the block with staff before lunch.',
    'Jerrell and staff took a short walk around the neighborhood in the afternoon; staff reminded him to look both ways before crossing the street.',
    'Jerrell went for a walk to the corner and back with staff in the afternoon for some fresh air and exercise.',
  ],
  GROCERY: [
    'Jerrell went along for the weekly grocery shopping with Steve and staff; he picked out fruit for his smoothies and paid for his snacks with his spending money.',
    'Jerrell helped with the weekly grocery shopping with Steve and staff; he found the items on his part of the list and helped carry the bags inside.',
    'Jerrell went grocery shopping with Steve and staff; he chose bananas, strawberries and yogurt for his smoothies and put the cold items away at home.',
    'Jerrell went along for the weekly grocery shopping; he compared prices on fruit with staff and paid for a snack with his own money.',
  ],
  WEEKEND_HOME: [
    'Jerrell spent the morning drawing at the kitchen table.',
    'Jerrell watched a movie in the living room.',
    'Jerrell worked in his sketchbook and played music in his room.',
    'Jerrell relaxed in the living room and worked on a drawing for Steve.',
  ],
  DINNER: [
    'Jerrell ate the dinner staff prepared and washed his dishes afterwards.',
    'Jerrell helped set the table and had dinner with Steve and staff.',
    'Jerrell made a sandwich and a smoothie for dinner with staff nearby.',
    'Jerrell had the chicken and rice staff cooked for dinner and asked for seconds.',
    'Jerrell ate dinner at the table with Steve and staff and cleared his plate.',
    'Jerrell helped staff cook dinner (baked chicken, rice and green beans); he washed the vegetables and set the table.',
    'Jerrell made a smoothie to go with the dinner staff prepared and washed his dishes afterwards.',
  ],
  SOLO_EVE: [
    'Jerrell worked on a drawing in his room for a while in the evening.',
    'Jerrell put on music in his room in the evening and sketched.',
    'Jerrell watched TV in the living room for a while in the evening.',
    'Jerrell relaxed in his room with his sketchbook for a while.',
  ],
  HYGIENE_EVE: [
    'Jerrell took his shower before bed and put on clean clothes.',
    'Jerrell showered at night as usual and brushed his teeth before bed.',
    'Jerrell took his evening shower without help and put his dirty clothes in his laundry basket.',
  ],
  BEDTIME_EVE: ['Jerrell went to his room around 10:30 PM to watch TV before sleeping.', 'Jerrell was in his room by 11:00 PM.', 'Jerrell said goodnight to staff and was in his room by 10:45 PM.'],
  BEDTIME: ['Jerrell was in bed around 11:00 PM after his shower.', 'Jerrell was in bed by 10:30 PM after watching a movie in his room.', 'Jerrell was asleep by 11:15 PM with his TV turned off.'],
  NIGHT_CHECKS: [
    'Staff completed bed checks every hour; Jerrell slept through the night.',
    'Staff checked on Jerrell regularly during the night and he slept well.',
    'Bed checks were completed on schedule and Jerrell slept soundly.',
    'Jerrell got up once around 2:00 AM to use the bathroom and went back to sleep; all other checks found him sleeping.',
  ],
  HOUSE_NIGHT: ['The house was quiet and secure overnight; staff checked the doors at the start of the shift.', 'All doors were locked and the house stayed quiet through the night.'],
  WAKE_WEEKDAY: [
    'Jerrell woke up around 7:45 AM, used the bathroom and rested in bed until breakfast.',
    'Jerrell was awake around 7:30 AM and had a glass of water before the day staff arrived.',
    'Jerrell was still asleep at 8:00 AM when the day staff arrived.',
  ],
  WAKE_WEEKEND: ['Jerrell was still asleep at the end of the shift.', 'Jerrell woke up around 8:00 AM and had a glass of water.'],
  // Shared activities from Jerrell's side (same keys as Steve's)
  EVE: {
    dominoes: [
      'Jerrell and Steve played dominoes together at the dining table in the evening for almost an hour; Jerrell won one round and laughed about losing the others.',
      'In the evening Jerrell and Steve set up a game of dominoes and played several rounds together; they joked with each other and got along well.',
      'Jerrell learned a different way to score dominoes from Steve and they played three games together in the living room.',
    ],
    movie: [
      'Jerrell watched a movie with his housemate Steve in the living room with a bowl of popcorn; both enjoyed it.',
      'Jerrell and Steve watched a comedy together in the living room and both were laughing through most of it.',
      'Jerrell watched a movie together with Steve in the evening and they both liked the ending.',
    ],
    guitar: [
      'Jerrell worked on a drawing in the living room while Steve played his guitar and clapped for him when the song was over.\nAfterwards Jerrell and Steve watched TV together for a while before bed.',
      'Jerrell sat nearby while Steve played his guitar in the evening and told him it sounded good; he sketched while the music played.\nJerrell and Steve then watched TV together for a while.',
    ],
    xbox: [
      'Jerrell and Steve played Xbox together for about an hour; they took turns and got along well.',
      'Jerrell and Steve played a racing game on the Xbox together in the evening and laughed a lot.',
    ],
    walk: [
      'Around 6:30 PM Jerrell, Steve and staff went for a walk around the neighborhood together; Jerrell enjoyed the fresh air.',
      'Around 6:30 PM Jerrell, Steve and staff went for a walk around the block together; Jerrell said he wants to walk more often.',
    ],
    game: ['Jerrell and Steve watched a game together on TV.', 'Jerrell and Steve watched a game on TV together in the evening and both got into it.'],
    music: ['Jerrell put on music in his room and worked on a drawing for about an hour.', 'Jerrell had music on in his room and finished a sketch he had started earlier.'],
  },
  DAY_TOGETHER: {
    movie: ['Jerrell and Steve watched a movie together in the living room in the afternoon.', 'In the afternoon Jerrell and Steve picked a movie together and watched it in the living room.'],
    dominoes: [
      'Jerrell and Steve played dominoes together at the dining table for about an hour and kept score.',
      'Jerrell and Steve played several rounds of dominoes together in the afternoon; Jerrell asked for a rematch after Steve won.',
    ],
    xbox: ['Jerrell and Steve played Xbox together in the afternoon and took turns.', 'Jerrell and Steve played a few rounds of Xbox together in the living room.'],
  },
  FRIDAY_MEETING: [
    'Jerrell took part in the weekly Friday house meeting with his housemate Steve and staff; they discussed how the first week of September went, weekend plans and keeping the shared spaces clean.',
    'At the Friday house meeting Jerrell, his housemate Steve and staff reviewed the chore chart for the coming week and discussed healthy snack choices; Jerrell offered to take out the trash each evening.',
    "Jerrell joined the Friday house meeting with his housemate Steve and staff; the topics were respecting each other's space, house safety and ideas for weekend activities.",
    'During the Friday house meeting Jerrell, his housemate Steve and staff discussed how the month has gone, what each of them enjoyed most and menu ideas for next week.',
  ],
  SUNDAY_MONEY: [
    'Jerrell counted his spending money for the week with staff and put some aside in his savings envelope.',
    'Jerrell and staff went over his budget for the week; he set aside money for snacks and put the rest in his savings envelope.',
    'Jerrell reviewed his spending for the week with staff and decided how much to keep for snacks and how much to save.',
    'Jerrell counted his money with staff, set aside a few dollars for the week and put the rest in his savings envelope.',
  ],
};

function jerrellRoutine(d) {
  const dow = dowOf(d);
  const weekend = weekendOf(d);
  const thursday = dow === 4;
  const steveHome = !programDay(d);
  const w = weekOf(d);
  const eveKey = sharedEvening(d);

  let day;
  if (weekend || HOLIDAYS[d]) {
    day = {
      mood: rot(J.MOODS.day, d),
      notes: join(
        rot(J.LATE_BREAKFAST, d),
        rot(J.MORNING_MEDS, d),
        dow === 6 ? rot(J.GROCERY, w) : rot(J.WEEKEND_HOME, d),
        rot(J.HYGIENE_DAY, d),
        rot(J.LUNCH, d),
        rot(J.DAY_TOGETHER[sharedDaytime(d)], d, 1),
        rot(J.HOUSEKEEPING_DAY, d, 2),
        rot(J.HYDRATION, d),
      ),
    };
  } else if (steveHome) {
    // Wednesday: Steve is home on his day off.
    day = {
      mood: rot(J.MOODS.day, d),
      notes: join(
        rot(J.BREAKFAST, d),
        rot(J.MORNING_MEDS, d),
        rot(J.ACTIVITY_DAY, d),
        rot(J.HYGIENE_DAY, d),
        rot(J.WALK_DAY, w),
        rot(J.LUNCH, d),
        rot(J.DAY_TOGETHER[sharedDaytime(d)], w),
        rot(J.HOUSEKEEPING_DAY, d),
        rot(J.HYDRATION, d),
      ),
    };
  } else {
    day = {
      mood: rot(J.MOODS.day, d),
      notes: join(
        rot(J.BREAKFAST, d),
        rot(J.MORNING_MEDS, d),
        rot(J.STEVE_LEAVES, d),
        rot(J.ACTIVITY_DAY, d, 1),
        rot(J.HYGIENE_DAY, d),
        rot(J.LUNCH, d, 1),
        thursday ? rot(J.LAUNDRY, w) : rot(J.HOUSEKEEPING_DAY, d),
        J.HEALTH_WEEKLY[dow] ?? null,
        d % 3 === 0 ? rot(J.WALK_DAY, d) : null,
        rot(J.HYDRATION, d),
      ),
    };
  }

  const evening = {
    mood: rot(J.MOODS.evening, d),
    notes: join(
      rot(J.DINNER, d),
      rot(J.EVENING_MEDS, d),
      SOLO_KEYS.has(eveKey) && dow !== 5 ? null : rot(J.SOLO_EVE, d),
      dow === 5 ? J.FRIDAY_MEETING[w] : rot(J.EVE[eveKey], w),
      dow === 0 ? rot(J.SUNDAY_MONEY, w) : null,
      rot(J.HYGIENE_EVE, d),
      rot(J.BEDTIME_EVE, d),
    ),
  };

  // 12am-8am ends on the morning of this date.
  const night = {
    mood: rot(J.MOODS.night, d),
    notes: join(rot(J.BEDTIME, d), rot(J.NIGHT_CHECKS, d), rot(J.HOUSE_NIGHT, d), weekend || HOLIDAYS[d] ? rot(J.WAKE_WEEKEND, d) : rot(J.WAKE_WEEKDAY, d)),
  };
  return { day, evening, night };
}

// ---------------------------------------------------------------------------
// What the house manager reported for Jerrell (Report 1, Sep 1-9)
// ---------------------------------------------------------------------------
const JERRELL_EVENTS = {
  // Tue Sep 1, evening: Steve was out at the park; Jerrell written as home (confirm).
  1: {
    evening: {
      mood: 'Content, Relaxed',
      notes: join(
        'Jerrell had dinner (baked chicken and vegetables) at the table with staff and washed his dishes afterwards.',
        'Evening medications were given at 8:00 PM as prescribed.',
        'Jerrell watched a movie in the living room and then worked on a drawing at the kitchen table.',
        'Jerrell talked with Steve about the park when Steve got home and said he would like to go along next time.',
        'Jerrell took his shower before bed and put on clean clothes.',
        'Jerrell was in his room by 10:45 PM.',
      ),
    },
  },
  // Wed Sep 2, day: Burger King with Steve and staff (written as lunch - confirm shift).
  2: {
    day: {
      mood: 'Happy, Content',
      notes: join(
        rot(J.BREAKFAST, 2),
        rot(J.MORNING_MEDS, 2),
        'Jerrell drew in his sketchbook for a while in the morning.',
        'Steve was home today, and Jerrell and Steve watched a movie together in the living room in the morning.',
        J.HYGIENE_DAY[0],
        'Jerrell and Steve went out for lunch at Burger King with staff; Jerrell ordered a chicken sandwich and fries and chose water to drink after staff reminded him about his gout. He enjoyed getting out of the house and thanked staff for taking him.',
        'Back home Jerrell and Steve played dominoes together at the dining table for about an hour.',
        rot(J.HOUSEKEEPING_DAY, 2),
        rot(J.HYDRATION, 2),
      ),
    },
  },
  // Thu Sep 3, evening: written as going along on Steve's drive and walk (confirm).
  3: {
    evening: {
      mood: 'Content',
      notes: join(
        'Jerrell had dinner at the table with Steve and staff; Steve cooked tonight and Jerrell washed the dishes afterwards.',
        'After dinner, around 6:30 PM, Jerrell went along with Steve and staff for a drive and then a walk around the neighborhood together; he enjoyed the fresh air and they were back home by about 7:45 PM.',
        'Evening medications were given at 8:00 PM as prescribed.',
        'Jerrell watched some TV with Steve and then worked on a drawing in his room.',
        'Jerrell took his shower before bed and put on clean clothes.',
        'Jerrell was in his room by 10:30 PM.',
      ),
    },
  },
  // Fri Sep 4, day: physical examination and TB screen, then Burger King and shopping.
  4: {
    day: {
      mood: 'Content, Talkative',
      notes: join(
        rot(J.BREAKFAST, 4),
        rot(J.MORNING_MEDS, 4),
        'Steve left for his day program at 8:30 AM and Jerrell did not go; he stayed home to get ready for the morning and said he would like to start day support soon, and staff reminded him that the house manager is working on it.',
        'Jerrell showered, picked out clean clothes and got dressed without any help.',
        'Staff drove Jerrell to his physical examination; the doctor completed the exam and a TB screening test was done. Jerrell cooperated well with the nurse and the doctor and answered their questions. Staff kept the paperwork for the house manager.',
        'Afterwards staff took Jerrell out to Burger King for lunch; he had a chicken sandwich and chose water to drink.',
        'Staff then took Jerrell shopping; he picked up a few personal items and snacks, paid with his spending money and counted his change with staff.',
        'Back home Jerrell rested and drew in his sketchbook for a while.',
        rot(J.HYDRATION, 4),
      ),
    },
  },
  // Sat Sep 5, day: written as joining the Yorktown Beach trip (confirm).
  5: {
    day: {
      mood: 'Excited, Happy',
      notes: join(
        'Jerrell woke up around 8:00 AM, excited about going to the beach, and made a smoothie and toast for breakfast with staff monitoring the kitchen.',
        rot(J.MORNING_MEDS, 5),
        'Jerrell got dressed for the beach without help and packed a towel and a change of clothes with a reminder from staff.',
        'Staff drove Jerrell and Steve to Yorktown Beach for a community outing; they arrived around 10:30 AM. Jerrell applied sunscreen with a reminder from staff, walked along the shoreline together with Steve and waded in the river; he said he wanted to draw the view later.',
        'Jerrell ate a packed lunch (sandwich and fruit) at a picnic table by the beach and drank water; staff reminded him to reapply sunscreen.',
        'They were back home around 2:30 PM; Jerrell rinsed off, changed clothes and started a sketch of the beach in the living room.',
        rot(J.HYDRATION, 5),
      ),
    },
  },
  // Sun Sep 6, day: written as joining the mall trip (confirm).
  6: {
    day: {
      mood: 'Happy, Content',
      notes: join(
        rot(J.BREAKFAST, 6),
        rot(J.MORNING_MEDS, 6),
        J.HYGIENE_DAY[1],
        'Jerrell went to the mall with Steve and staff late in the morning; he walked around the stores, looked at art supplies and window-shopped.',
        'Jerrell and Steve had lunch together at the food court; Jerrell chose water instead of soda after a reminder from staff.',
        'Back home around 2:00 PM Jerrell drew in his sketchbook with music playing in his room.',
        rot(J.HYDRATION, 6),
      ),
    },
  },
  // Mon Sep 7, Labor Day: Steve home (day support closed - confirm).
  7: {
    day: {
      mood: 'Relaxed, Content',
      notes: join(
        rot(J.LATE_BREAKFAST, 7),
        rot(J.MORNING_MEDS, 7),
        'Jerrell worked in his sketchbook for a while in the morning.',
        'Steve was home today for the Labor Day holiday; Jerrell and Steve played dominoes together for about an hour after lunch and then watched a movie together in the living room.',
        J.HYGIENE_DAY[2],
        'Jerrell helped staff prepare the Labor Day lunch (grilled chicken, corn on the cob and a garden salad); he washed the vegetables and set the table.',
        rot(J.HOUSEKEEPING_DAY, 7),
        J.HEALTH_WEEKLY[1],
        rot(J.HYDRATION, 7),
      ),
    },
  },
};

// ---------------------------------------------------------------------------
// Items written from assumptions - confirm with the house manager
// ---------------------------------------------------------------------------
const PENDING = [
  'Sep 1 evening: park name ("memont park") and whether it was the Tue/Thu community engagement program; Jerrell written as home.',
  'Sep 2: Burger King written as lunch (8am-4pm box) with laundry in the morning.',
  'Sep 3 evening: "roadride" written as a drive + walk with staff (or is it Riverside, i.e. a medical visit after the Aug 29 seizure?); Jerrell written as going along.',
  'Sep 4: Jerrell physical/TB screen written as a morning appointment with staff transport and no reason given; shopping written as personal items and snacks.',
  "Sep 5 / Sep 6: Jerrell written as joining the beach and mall trips; Steve's notes do not name him.",
  'Sep 7: written as a home day for both (Labor Day, day support assumed closed).',
  "Sep 9: laundry added to Steve's home day (Wednesday routine).",
  'Tue/Thu evenings after Sep 1: no community engagement program written (status unknown).',
  'Unreported shifts Sep 1-9 (mornings, evenings, overnights, Sep 4 for Steve, Sep 8 for both, Sep 9 for Jerrell): routine placeholders.',
];

// ---------------------------------------------------------------------------
const PEOPLE = {
  steven: { individual: INDIVIDUALS.steven, month: MONTHS.find((m) => m.name === 'September'), routine: steveRoutine, events: STEVE_EVENTS },
  jerrell: { individual: INDIVIDUALS.jerrell, month: INDIVIDUALS.jerrell.months.find((m) => m.name === 'September'), routine: jerrellRoutine, events: JERRELL_EVENTS },
};
const selected = who === 'both' ? Object.keys(PEOPLE) : [who];
if (selected.some((k) => !PEOPLE[k])) {
  console.error(`Unknown --individual "${who}" (use steven, jerrell or both)`);
  process.exit(1);
}

for (const key of selected) {
  const { individual, month, routine, events } = PEOPLE[key];
  // Only the reported days are laid out; the rest of the month is added as her reports arrive.
  const partial = { ...month, days: REPORTED_THROUGH };
  const fill = {};
  for (const day of monthDays(partial)) fill[day.heading] = { ...routine(day.day), ...(events[day.day] ?? {}) };
  const bytes = await Packer.toBuffer(buildDocument(partial, fill, null, individual));
  const out = path.join(ROOT, `${individual.filePrefix}_${month.name}${month.year}_Daily_Log_Entry (filled).docx`);
  await writeFile(out, bytes);
  const boxes = Object.values(fill).reduce((n, d) => n + Object.keys(d).length, 0);
  console.log(`Wrote ${out} (${bytes.length} bytes, ${boxes} filled shift boxes, Sep 1-${REPORTED_THROUGH}; reported events on Sep ${Object.keys(events).join(', ')})`);
}
console.log(`\nWritten through Sep ${REPORTED_THROUGH} only - later days wait for the house manager's next report.`);
console.log('Assumptions to confirm with the house manager:');
for (const line of PENDING) console.log(`  - ${line}`);
