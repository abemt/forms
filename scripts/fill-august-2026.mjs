// Writes the filled August 2026 Daily Log Entry workbook from the house
// manager's recollection of the month (given 3 Sept 2026), on top of the
// routine June/July pattern. Upload the result to the Form §680 app.
//
//   node scripts/fill-august-2026.mjs
//     -> Steven_August2026_Daily_Log_Entry (filled).docx
//
// Box order per date follows the workbook: 8am-4pm, 4pm-12am, 12am-8am, and
// the 12am-8am box is read literally as the early hours of that date.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Packer } from 'docx';
import { MONTHS, buildDocument, monthDays } from './build-entry-workbook.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const month = MONTHS.find((m) => m.name === 'August');

// ---------------------------------------------------------------------------
// Routine pools (rotate by day of month so consecutive days read differently)
// ---------------------------------------------------------------------------
const rot = (pool, d, salt = 0) => pool[(d + salt) % pool.length];

const MOODS = {
  day: ['Happy', 'Excited', 'Content', 'Happy, Outgoing', 'Calm', 'Friendly', 'Happy, Talkative'],
  evening: ['Content', 'Calm', 'Happy', 'Relaxed', 'Calm, Content', 'Happy, Relaxed', 'Excited'],
  night: ['Calm', 'Sleeping', 'Calm', 'Sleeping', 'Calm, Rested', 'Sleeping', 'Calm'],
};

const BREAKFAST = [
  'Steve woke up on time and prepared his own breakfast with staff supervision.',
  'Steve made his own breakfast (eggs and toast) while staff monitored kitchen safety.',
  'Steve got up at 7:00 AM and made himself oatmeal for breakfast; staff reminded him about portion size.',
  'Steve prepared a breakfast sandwich on his own; staff stayed nearby for stove safety.',
  'Steve cooked eggs and bacon for breakfast with staff supervision and cleaned up afterwards.',
];
const LATE_BREAKFAST = [
  'Steve slept in and then made his own breakfast with staff supervision.',
  'Steve woke up late and made pancakes for breakfast with staff nearby.',
  'Steve got up around 9:30 AM and prepared his own breakfast; staff reminded him about portion size.',
];
const MORNING_MEDS = [
  'Morning medications were given at 8:00 AM as prescribed.',
  "Staff administered Steve's morning medications at 8:00 AM as prescribed; he took them without difficulty.",
];
const EVENING_MEDS = [
  'Evening medications were given at 8:00 PM as prescribed.',
  "Staff administered Steve's evening medications at 8:00 PM as prescribed.",
];
const DAY_SUPPORT = [
  'Staff drove Steve to Inner Vision Day Support for the day.',
  'Steve went to Inner Vision Day Support; staff provided transportation.',
  'Steve attended his day program at Inner Vision Day Support; staff dropped him off in the morning and picked him up in the afternoon.',
];
const HYDRATION_DAY = [
  'Staff offered water throughout the shift.',
  'Staff reminded Steve to drink water and sent a water bottle with him.',
  'Fluids were offered regularly during the shift and Steve drank well.',
];
const HYDRATION_EVE = [
  'Staff offered water and Steve drank well with dinner.',
  'Fluids were offered through the evening.',
  'Staff reminded Steve to drink water instead of soda with dinner.',
];
const DAY_EXTRA = [
  'Steve packed his lunch for the day program before leaving.',
  'Steve played his guitar for a while before leaving for the day.',
  'Staff and Steve talked about healthy food choices for lunch.',
  'Steve chatted with staff about his favorite music while getting ready.',
];
const RETURN = [
  'Steve got home at 4:00 PM in a good mood and took a short nap.',
  'Steve came back at 4:00 PM and rested for a while.',
  'Steve came back at 4:00 PM and told staff about his day.',
];
const DINNER = [
  'Steve cooked his own dinner with staff supervision.',
  'Steve made dinner with staff supervision and did most of the cooking himself.',
  'Steve prepared dinner (chicken and rice) with staff nearby.',
  'Steve heated up his dinner in the microwave and cleaned up after himself.',
  'Steve grilled a steak for dinner with staff supervision; he said it was his favorite meal.',
];
const HYGIENE = [
  'Steve took his shower and got ready for bed.',
  'Steve took a shower and brushed his teeth before bed.',
];
const PACK_LUNCH = ['Steve packed his lunch for tomorrow.', 'Steve packed his lunch for the next day at day support.'];
const LEISURE_EVE = [
  'Steve and Jerrell played Xbox together in the living room.',
  'Steve watched a movie with his housemate Jerrell.',
  'Steve played his guitar in his room.',
  'Steve went for a walk around the neighborhood with staff.',
  'Steve and staff talked about his savings and spending for the week.',
  'Steve and Jerrell watched a game together on TV.',
];
const HOUSEKEEPING = [
  'Steve wiped the kitchen counters and took out the trash after dinner.',
  'Steve washed the dishes after dinner.',
  'Steve helped tidy the living room before bed.',
];
const BEDTIME = ['Steve went to bed around 11:00 PM after his bedtime routine.', 'Steve was in bed by 10:30 PM.'];
const NIGHT_MONITOR = [
  'Staff monitored Steve through the night for seizure activity; none was observed.',
  'Bed checks were completed every hour and no seizure activity was observed.',
  'Staff checked on Steve regularly during the night; he slept well and no seizure activity was noted.',
];
const SLEEP = ['Steve slept through the night.', 'Steve woke once to use the bathroom and went back to sleep.'];
const WAKE_WEEKDAY = [
  'Steve woke up around 7:00 AM and prepared his own breakfast.',
  'Steve got up at 7:00 AM and started his morning routine on his own.',
  'Steve woke up in a good mood and got ready for day support.',
];
const WAKE_WEEKEND = [
  'Steve was still asleep at the end of the shift.',
  'Steve woke up around 8:00 AM and started his morning routine on his own.',
];
const WATER_NIGHT = ["Water was available at Steve's bedside."];
const WEEKEND_OUTING_SAT = [
  'Steve and Jerrell went grocery shopping at Walmart with staff; Steve picked out healthy snacks.',
  'Staff took Steve for a walk in the park; he enjoyed watching the ducks.',
  'Steve went out for brunch with staff and Jerrell.',
  'Steve and staff went to Goodwill and he found a movie at a fair price.',
];
const WEEKEND_OUTING_SUN = [
  'Steve went for a walk around the neighborhood with staff.',
  'Steve helped staff with the weekly grocery shopping and organized the refrigerator afterwards.',
  'Staff took Steve and Jerrell to the park for some fresh air.',
];
const WEEKEND_HOME = [
  'Steve played his guitar.',
  'Steve cooked his own lunch with staff supervision.',
  'Steve and Jerrell played Xbox together.',
  'Steve watched a movie in the living room.',
];
const SAVINGS = [
  'Steve counted his savings with staff; he saved most of his $20 allowance again this week.',
  'Steve and staff reviewed his savings; he is saving most of his $20 weekly allowance and is proud of it.',
];
const LAUNDRY = [
  'Steve did his laundry: staff helped him fold his clothes and put them away.',
  'Steve washed and dried his clothes; staff helped him fold them and put them away.',
];
const ROOM = ['Steve cleaned his room and vacuumed the living room.', 'Steve made his bed and tidied his room.'];
const WED_SOLO = ['Steve took a long nap in the afternoon.', 'Steve played his guitar in his room.', 'Steve listened to music in his room.'];
const WED_GROUP = ['Steve and Jerrell watched a movie together.', 'Steve and Jerrell played Xbox together.'];
// Index = floor(day/7): Aug 28 -> 0, Aug 7 -> 1, Aug 14 -> 2, Aug 21 -> 3.
const FRIDAY_MEETING = [
  'Steve took part in the Friday house meeting with staff and Jerrell; everyone talked about how the week went and his new community engagement program.',
  'Steve joined the weekly Friday house meeting with staff and Jerrell; everyone talked about house rules, respecting each other and plans for the coming days.',
  'At the Friday house meeting Steve, Jerrell and staff talked together about chores for the week and healthy food choices.',
  'During the Friday house meeting Steve and Jerrell talked together with staff about getting along well and keeping the house tidy.',
];

const join = (...lines) => lines.filter(Boolean).join('\n');

// ---------------------------------------------------------------------------
// Routine boxes
// ---------------------------------------------------------------------------
function routine(d, dow) {
  const weekend = dow === 0 || dow === 6;
  const wednesday = dow === 3;

  let day;
  if (weekend) {
    day = {
      mood: rot(MOODS.day, d),
      notes: join(
        rot(LATE_BREAKFAST, d),
        rot(MORNING_MEDS, d),
        rot(dow === 6 ? WEEKEND_OUTING_SAT : WEEKEND_OUTING_SUN, Math.floor(d / 7)),
        rot(WEEKEND_HOME, d),
        rot(HYDRATION_DAY, d),
      ),
    };
  } else if (wednesday) {
    day = {
      mood: rot(['Relaxed', 'Happy', 'Calm', 'Content'], Math.floor(d / 7)),
      notes: join(
        rot(LATE_BREAKFAST, d),
        rot(MORNING_MEDS, d),
        rot(LAUNDRY, Math.floor(d / 7)),
        rot(ROOM, Math.floor(d / 7)),
        'Steve cooked his own lunch with staff supervision.',
        rot(WED_SOLO, Math.floor(d / 7)),
        rot(WED_GROUP, Math.floor(d / 7)),
        rot(HYDRATION_DAY, d),
      ),
    };
  } else {
    day = {
      mood: rot(MOODS.day, d),
      notes: join(rot(BREAKFAST, d), rot(MORNING_MEDS, d), rot(DAY_SUPPORT, d), rot(DAY_EXTRA, d), rot(HYDRATION_DAY, d)),
    };
  }

  const evening = {
    mood: rot(MOODS.evening, d),
    notes: join(
      weekend || wednesday ? null : rot(RETURN, d),
      rot(DINNER, d),
      rot(EVENING_MEDS, d),
      dow === 5 ? rot(FRIDAY_MEETING, Math.floor(d / 7)) : rot(LEISURE_EVE, d),
      rot(HOUSEKEEPING, d),
      dow === 0 ? rot(SAVINGS, Math.floor(d / 7)) : null,
      rot(HYDRATION_EVE, d),
      rot(HYGIENE, d),
      weekend || dow === 5 ? null : rot(PACK_LUNCH, d),
    ),
  };

  // 12am-8am ends on the morning of this date.
  const night = {
    mood: rot(MOODS.night, d),
    notes: join(
      rot(BEDTIME, d),
      rot(NIGHT_MONITOR, d),
      rot(SLEEP, d),
      rot(WATER_NIGHT, d),
      weekend || wednesday ? rot(WAKE_WEEKEND, d) : rot(WAKE_WEEKDAY, d),
    ),
  };
  return { day, evening, night };
}

// ---------------------------------------------------------------------------
// What the house manager reported for August
// ---------------------------------------------------------------------------
const EVENTS = {
  // Sat Aug 1, 4pm-12am: Walmart trip, fight with housemate, broken teeth.
  1: {
    evening: {
      mood: 'Upset and agitated',
      notes: join(
        'Steve and his housemate Jerrell Wright went shopping at Walmart with staff for groceries and snacks.',
        'While at the store Steve and Jerrell had a disagreement that escalated into a fight; Jerrell hit Steve in the mouth and broke his teeth.',
        "Steve's mouth was bleeding and he was in pain and upset; staff separated them immediately, gave first aid with a cold compress and kept both men calm.",
        'Staff notified the house manager right away and an incident report was completed.',
        'Staff drove both men back to the group home and monitored Steve closely for the rest of the shift.',
        'Evening medications were given at 8:00 PM as prescribed.',
        'Steve ate a soft dinner and took his shower before bed.',
      ),
    },
  },
  // Sun Aug 2: night after the incident, team meeting, savings.
  2: {
    night: {
      mood: 'Tired, upset',
      notes: join(
        'Steve went to bed around 11:00 PM.',
        'Staff checked on Steve more often than usual overnight because of his mouth injury.',
        'Steve complained of a sore mouth around 1:00 AM; staff gave him a cold compress and water and he went back to sleep.',
        'No seizure activity was observed and Steve slept until about 7:30 AM.',
        'Steve had a soft breakfast (oatmeal) in the morning because of his teeth.',
      ),
    },
    day: {
      mood: 'Content, a bit tired',
      notes: join(
        'Steve woke up late and prepared his own breakfast with staff supervision.',
        'Morning medications were given at 8:00 AM as prescribed.',
        "Steve's mouth was still sore; staff gave him a cold compress and soft foods.",
        'A team meeting was held at the house with staff, Steve and Jerrell; everyone talked about house safety and getting along with each other.',
        'Steve talked with staff about his savings; he has been saving most of his $20 weekly allowance and is proud of it.',
        'Staff offered water throughout the day.',
      ),
    },
  },
  // Thu Aug 6: clinic visit - checked after the injury, teeth fixed, doctor
  // praised the 9 lb weight loss.
  6: {
    day: {
      mood: 'Happy, Excited',
      notes: join(
        'Steve prepared his own breakfast and morning medications were given at 8:00 AM as prescribed.',
        "Staff drove Steve to the clinic for his doctor's appointment; the doctor checked him over after the incident on August 1 and his teeth were fixed.",
        "The doctor was very happy with Steve's progress: he has lost 9 pounds since his last visit, and the doctor praised him for his healthy eating and exercise.",
        'Steve was proud of himself and told staff he wants to keep making healthy choices.',
        'After the appointment staff dropped Steve off at Inner Vision Day Support for the rest of the day.',
        'Staff offered water throughout the shift.',
      ),
    },
  },
  // Fridays: the weekly house meeting is part of the routine evening.
  // (Steve helping Jerrell set up his TV/Xbox is in the staff's July 21 notes.)
  // Tue Aug 25: first community engagement session (5-8 PM, Tue/Thu).
  25: {
    evening: {
      mood: 'Excited, Happy',
      notes: join(
        'Steve started his new community engagement program today; staff drove him there for 5:00 PM and picked him up at 8:00 PM.',
        'The group went to the park where Steve saw animals with the other participants; he said he loved it and could not stop talking about it.',
        'Evening medications were given at 8:30 PM after he returned.',
        'Steve had a late dinner that he heated up himself with staff nearby.',
        'Staff offered water and Steve drank well with dinner.',
        'Steve took his shower and packed his lunch for tomorrow.',
      ),
    },
  },
  // Thu Aug 27: second community engagement session.
  27: {
    evening: {
      mood: 'Happy, Outgoing',
      notes: join(
        'Steve attended his community engagement program from 5:00 PM to 8:00 PM; staff provided transportation there and back.',
        'He went to the park again with the other participants and enjoyed seeing the animals; he told staff he loves the program.',
        'Evening medications were given at 8:30 PM after he returned.',
        'Steve ate the dinner staff had kept warm for him and cleaned up after himself.',
        'Fluids were offered through the evening.',
        'Steve took a shower and packed his lunch for tomorrow.',
      ),
    },
  },
  // Sat Aug 29: seizure on the 12am-8am shift, 911, hospital; home later that morning.
  29: {
    night: {
      mood: 'Tired and scared after the seizure',
      notes: join(
        'Steve went to bed around 11:00 PM after his bedtime routine.',
        'At about 3:30 AM Steve had a seizure in his bed; staff timed it and kept him safe on his side.',
        'The seizure lasted about three minutes; staff called 911 right away.',
        'The ambulance arrived and Steve was taken to the hospital; staff went with him and notified the house manager.',
        'An incident report was completed.',
      ),
    },
    day: {
      mood: 'Tired, calm',
      notes: join(
        'Staff drove Steve back to the group home from the hospital at about 10:00 AM after the doctor checked him following his seizure overnight.',
        'Discharge instructions were reviewed with staff: rest, fluids and continue medications as prescribed; the house manager was updated.',
        'Morning medications were given as prescribed once he was home.',
        'Steve rested most of the day and had a light lunch; staff monitored him closely for any further seizure activity and none occurred.',
        'Steve listened to music in his room in the afternoon.',
        'Staff offered water regularly through the day.',
      ),
    },
    evening: {
      mood: 'Calm, Content',
      notes: join(
        'Steve was feeling better in the evening; he ate dinner and watched a movie with Jerrell.',
        'Evening medications were given at 8:00 PM as prescribed.',
        'Staff monitored Steve for seizure activity through the evening; none was observed.',
        'Fluids were offered through the evening.',
        'Steve took his shower and went to bed early.',
      ),
    },
  },
  // Sun Aug 30 / Mon Aug 31: close follow-up after the seizure.
  30: {
    night: {
      mood: 'Calm',
      notes: join(
        'Steve was in bed by 10:00 PM.',
        'Staff checked on Steve every 30 minutes after his seizure the day before; no seizure activity was observed.',
        'Steve slept through the night.',
        "Water was available at Steve's bedside.",
        'Steve woke up around 8:00 AM feeling rested and started his morning routine on his own.',
      ),
    },
  },
  31: {
    night: {
      mood: 'Calm',
      notes: join(
        'Steve went to bed around 10:30 PM.',
        'Staff continued close checks after the seizure over the weekend; no seizure activity was observed.',
        'Steve slept well through the night.',
        "Water was available at Steve's bedside.",
        'Steve woke up around 7:00 AM and prepared his own breakfast for day support.',
      ),
    },
  },
};

// ---------------------------------------------------------------------------
const fill = {};
for (const day of monthDays(month)) {
  const d = Number(day.heading.match(/\b(\d{2}),/)[1]);
  const dow = new Date(Date.UTC(month.year, 7, d)).getUTCDay();
  fill[day.heading] = { ...routine(d, dow), ...(EVENTS[d] ?? {}) };
}

const bytes = await Packer.toBuffer(buildDocument(month, fill));
const out = path.join(ROOT, 'Steven_August2026_Daily_Log_Entry (filled).docx');
await writeFile(out, bytes);
const boxes = Object.values(fill).reduce((n, day) => n + Object.keys(day).length, 0);
console.log(`Wrote ${out} (${bytes.length} bytes, ${boxes} filled shift boxes)`);
