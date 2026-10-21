// Writes Jerrell Wright's filled Daily Log Entry workbooks from the house
// manager's account of his first weeks (given 4 Sept 2026): admitted July 20,
// 2026; day-support enrollment still pending (a recurring frustration); home
// most days - movies, drawing, his own laundry, smoothies with the machine
// bought for him, occasional walks and shopping trips, IHOP / Burger King
// outings; the Aug 1 Walmart altercation with Steve; one self-injury episode
// when Steve left for day support; a couple of times he opened the door and
// left without staff authorization. Everything else is his regular routine.
//
//   node scripts/fill-jerrell-2026.mjs
//     -> Jerrell_July2026_Daily_Log_Entry (filled).docx     (July 20-31)
//     -> Jerrell_August2026_Daily_Log_Entry (filled).docx
//
// Box order per date follows the workbook: 8am-4pm, 4pm-12am, 12am-8am, and
// the 12am-8am box is read literally as the early hours of that date (the
// admission day has no 12am-8am box). Where Steve's notes mention Jerrell
// (Xbox, movies, outings, Friday house meetings, the team meeting), Jerrell's
// boxes say the same thing from his side.
//
// Wording rules the app relies on: a sentence that mentions Steve's day
// program also says Jerrell stayed home / could not go AND carries a wish
// ("would like to", "looking forward", "talked about") so it is neither a
// community outing nor a declined one; "himself"/"his own" is kept out of
// meal lines so the drawing / movie line becomes the Individual Activity.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Packer } from 'docx';
import { INDIVIDUALS, buildDocument, monthDays } from './build-entry-workbook.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jerrell = INDIVIDUALS.jerrell;

const rot = (pool, d, salt = 0) => pool[(d + salt) % pool.length];
const join = (...lines) => lines.filter(Boolean).join('\n');

// ---------------------------------------------------------------------------
// Routine pools (rotate by day so consecutive days read differently)
// ---------------------------------------------------------------------------
const MOODS = {
  day: ['Content', 'Calm', 'Happy', 'Relaxed', 'Content, Friendly', 'Calm, Relaxed', 'Happy, Talkative'],
  evening: ['Content', 'Relaxed', 'Calm', 'Happy', 'Calm, Content', 'Friendly', 'Relaxed, Happy'],
  night: ['Calm', 'Sleeping', 'Calm', 'Sleeping', 'Calm, Rested', 'Sleeping', 'Calm'],
  frustrated: ['Frustrated, Irritable', 'Upset, Frustrated', 'Irritable'],
};

// Before the smoothie machine (bought Sunday July 26).
const BREAKFAST_PLAIN = [
  'Jerrell woke up around 8:30 AM and had cereal and a banana for breakfast; staff monitored the kitchen.',
  'Jerrell got up around 8:00 AM and made toast and eggs for breakfast with staff nearby.',
  'Jerrell slept in a little and then had a bowl of oatmeal for breakfast that he made with staff nearby.',
];
const BREAKFAST = [
  'Jerrell woke up around 8:30 AM and made a fruit smoothie with his smoothie machine and toast for breakfast; staff monitored the kitchen.',
  'Jerrell got up around 8:00 AM and blended a banana and strawberry smoothie for breakfast; he cleaned the blender afterwards.',
  'Jerrell made a smoothie and a bowl of cereal for breakfast; staff reminded him to wipe the counter.',
  'Jerrell had eggs and toast for breakfast that he made with staff nearby, then made a smoothie to go with it.',
];
const LATE_BREAKFAST = [
  'Jerrell slept in and then made a smoothie and toast for breakfast with staff nearby.',
  'Jerrell got up around 9:30 AM and made a fruit smoothie and eggs for breakfast; staff monitored the kitchen.',
  'Jerrell woke up late and had cereal and a smoothie for breakfast that he prepared with staff nearby.',
];
const MORNING_MEDS = [
  'Morning medications were given at 9:00 AM as prescribed and Jerrell took them without any problem.',
  "Staff administered Jerrell's morning medications at 9:00 AM as prescribed.",
];
const EVENING_MEDS = [
  'Evening medications were given at 8:00 PM as prescribed.',
  "Staff administered Jerrell's evening medications at 8:00 PM as prescribed; he took them without difficulty.",
];
// Steve leaves for day support (Mon/Tue/Thu/Fri); Jerrell's enrollment is
// still pending. Calm versions.
const STEVE_LEAVES = [
  'Steve left for his day program at 8:00 AM and Jerrell stayed home; he talked about wanting to start his day support soon and staff explained that the house manager is still working on his enrollment.',
  'Jerrell stayed home while Steve went to day support; he told staff he is looking forward to starting his program and staff explained that the house manager is still working on his enrollment.',
  'Jerrell did not go to day support today because his enrollment is still pending; he would like to start as soon as it is set up and staff explained that the house manager is following up.',
  'Steve left for his day program at 8:00 AM and Jerrell stayed home; staff talked about the plans for the day with him and he chose to draw.',
];
// Argumentative versions (behavioral difficulty: yes).
const STEVE_LEAVES_UPSET = [
  'When Steve left for his day program at 8:00 AM Jerrell was frustrated that he could not go too; he said he would like to start right away and argued with staff about it for a few minutes.',
  'Jerrell was upset that he could not go to day support with Steve this morning; he raised his voice at staff and said he does not want to wait any longer and would like to start now.',
];
const UPSET_FOLLOWUP = [
  'Staff listened, explained again that his enrollment is still being arranged and redirected him to the kitchen table with his pencils; he calmed down after about ten minutes.',
  'Staff kept their voices low, gave him some space and then talked with him about it; he calmed down after a few minutes.',
];
// Two lines each: dressing is independent, grooming takes a reminder.
const HYGIENE_DAY = [
  'Jerrell picked out his clothes and got dressed without any help from staff.\nJerrell brushed his teeth after a reminder from staff.',
  'Jerrell got dressed without help this morning.\nJerrell shaved after a reminder from staff.',
  'Jerrell got dressed and combed his hair without any help from staff.\nJerrell brushed his teeth after a reminder from staff.',
];
const ACTIVITY_DAY = [
  'Jerrell spent the morning drawing at the kitchen table and showed staff his artwork.',
  'Jerrell watched a movie in the living room.',
  'Jerrell worked in his sketchbook for most of the morning.',
  'Jerrell put on music and drew in his room.',
  'Jerrell watched a movie and then drew for a while in the living room.',
];
const LUNCH = [
  'Jerrell made a sandwich for lunch with staff nearby.',
  'Jerrell heated up leftovers for lunch and ate at the table; staff reminded him to be careful with the hot pan.',
  'Jerrell had lunch (a sandwich and fruit) that he prepared with staff nearby.',
  'Jerrell made a smoothie and a sandwich for lunch and cleaned up afterwards.',
];
const LAUNDRY = [
  'Jerrell did his own laundry independently: he washed, dried and folded his clothes and put them away.',
  'Jerrell did his laundry on his own today, folded his clothes and put them away in his closet.',
];
const HOUSEKEEPING_DAY = [
  'Jerrell made his bed and tidied his room.',
  'Jerrell took out the trash and wiped the kitchen counter after lunch.',
  'Jerrell vacuumed the living room with a reminder from staff.',
  'Jerrell washed his breakfast dishes and put them away.',
];
const HEALTH_WEEKLY = {
  1: 'Staff reminded Jerrell to drink plenty of water and choose healthy foods because of his gout; he had no gout symptoms today.',
  2: 'Staff encouraged Jerrell to eat fruit and drink water to keep his bowels regular; he reported no constipation.',
};
const HYDRATION = ['Staff offered water through the shift.', 'Staff offered water and Jerrell drank well during the shift.'];
const WALK_DAY = [
  'Jerrell took a walk around the block with staff before lunch.',
  'Jerrell and staff took a short walk around the neighborhood in the afternoon; staff reminded him to look both ways before crossing the street.',
];
const DINNER = [
  'Jerrell ate the dinner staff prepared and washed his dishes afterwards.',
  'Jerrell helped set the table and had dinner with Steve and staff.',
  'Jerrell made a sandwich and a smoothie for dinner with staff nearby.',
  'Jerrell had the chicken and rice staff cooked for dinner and asked for seconds.',
  'Jerrell ate dinner at the table with Steve and staff and cleared his plate.',
];
// Evening leisure; August indexes match Steve's evening pool so both logs
// describe the same shared evenings (0 Xbox, 1 movie, 5 game on TV).
const LEISURE_EVE = [
  'Jerrell and Steve played Xbox together in the living room.',
  'Jerrell watched a movie with his housemate Steve.',
  'Jerrell worked on a drawing in his room and showed it to staff.',
  'Jerrell took a short walk around the block with staff after dinner.',
  'Jerrell put on music in his room while drawing.',
  'Jerrell and Steve watched a game together on TV.',
];
const HYGIENE_EVE = [
  'Jerrell took his shower before bed and put on clean clothes.',
  'Jerrell showered at night as usual and brushed his teeth before bed.',
];
const BEDTIME_EVE = ['Jerrell went to his room around 10:30 PM to watch TV before sleeping.', 'Jerrell was in his room by 11:00 PM.'];
// Index = floor(day/7): Aug 28 -> 0, Aug 7 -> 1, Aug 14 -> 2, Aug 21 -> 3 (same topics as Steve's log).
const FRIDAY_MEETING = [
  'Jerrell took part in the Friday house meeting with staff and Steve; everyone talked about how the week went and Steve told the group about his new evening program.',
  'Jerrell joined the weekly Friday house meeting with staff and Steve; everyone talked about house rules, respecting each other and plans for the coming days.',
  'At the Friday house meeting Jerrell, Steve and staff talked together about chores for the week and healthy food choices.',
  'During the Friday house meeting Jerrell and Steve talked together with staff about getting along well and keeping the house tidy.',
];
const SUNDAY_MONEY = [
  'Jerrell counted his spending money for the week with staff and put some aside in his savings envelope.',
  'Jerrell and staff went over his budget for the week; he set aside money for snacks and put the rest in his savings envelope.',
];
const BEDTIME = ['Jerrell was in bed around 11:00 PM after his shower.', 'Jerrell was in bed by 10:30 PM after watching a movie in his room.'];
const NIGHT_CHECKS = [
  'Staff completed bed checks every hour; Jerrell slept through the night.',
  'Staff checked on Jerrell regularly during the night and he slept well.',
  'Bed checks were completed on schedule and Jerrell slept soundly.',
];
const WAKE_WEEKDAY = ['Jerrell woke up around 7:45 AM and had a glass of water.', 'Jerrell was awake around 7:30 AM and started his morning routine on his own.'];
const WAKE_WEEKEND = ['Jerrell was still asleep at the end of the shift.', 'Jerrell woke up around 8:00 AM and had a glass of water.'];
const WEEKEND_HOME = [
  'Jerrell spent the morning drawing at the kitchen table.',
  'Jerrell watched a movie in the living room.',
  'Jerrell worked in his sketchbook and played music in his room.',
];
// Wednesdays Steve is home too (his day off from day support).
const WEDNESDAY_WITH_STEVE = ['Jerrell and Steve watched a movie together in the living room.', 'Jerrell and Steve played Xbox together.'];

// ---------------------------------------------------------------------------
// Routine boxes
// ---------------------------------------------------------------------------
function routine(monthName, d, dow) {
  const weekend = dow === 0 || dow === 6;
  const wednesday = dow === 3;
  const thursday = dow === 4;
  const friday = dow === 5;
  const august = monthName === 'August';
  const a = august ? d + 31 : d; // running day number for rotation
  const breakfast = august || d >= 27 ? rot(BREAKFAST, a) : rot(BREAKFAST_PLAIN, a);

  let day;
  if (weekend) {
    day = {
      mood: rot(MOODS.day, a),
      notes: join(rot(LATE_BREAKFAST, a), rot(MORNING_MEDS, a), rot(WEEKEND_HOME, a), rot(HYGIENE_DAY, a), rot(LUNCH, a), rot(HYDRATION, a)),
    };
  } else if (wednesday) {
    day = {
      mood: rot(MOODS.day, a),
      notes: join(
        breakfast,
        rot(MORNING_MEDS, a),
        august ? WEDNESDAY_WITH_STEVE[Math.floor(d / 7) % 2] : rot(ACTIVITY_DAY, a),
        rot(HYGIENE_DAY, a),
        rot(WALK_DAY, Math.floor(a / 7)),
        rot(LUNCH, a),
        rot(HOUSEKEEPING_DAY, a),
        rot(HYDRATION, a),
      ),
    };
  } else {
    day = {
      mood: rot(MOODS.day, a),
      notes: join(
        breakfast,
        rot(MORNING_MEDS, a),
        rot(STEVE_LEAVES, a),
        rot(ACTIVITY_DAY, a),
        rot(HYGIENE_DAY, a),
        rot(LUNCH, a),
        thursday ? rot(LAUNDRY, Math.floor(a / 7)) : rot(HOUSEKEEPING_DAY, a),
        HEALTH_WEEKLY[dow] ?? null,
        rot(HYDRATION, a),
      ),
    };
  }

  const leisure = august && friday ? FRIDAY_MEETING[Math.floor(d / 7)] : august ? LEISURE_EVE[d % 6] : rot(LEISURE_EVE, a, 1);
  const evening = {
    mood: rot(MOODS.evening, a),
    notes: join(
      rot(DINNER, a),
      rot(EVENING_MEDS, a),
      leisure,
      dow === 0 ? rot(SUNDAY_MONEY, Math.floor(d / 7)) : null,
      rot(HYGIENE_EVE, a),
      rot(BEDTIME_EVE, a),
    ),
  };

  // 12am-8am ends on the morning of this date.
  const night = {
    mood: rot(MOODS.night, a),
    notes: join(rot(BEDTIME, a), rot(NIGHT_CHECKS, a), weekend ? rot(WAKE_WEEKEND, a) : rot(WAKE_WEEKDAY, a)),
  };
  return { day, evening, night };
}

// Argumentative morning about day support (behavioral difficulty: yes).
function upsetMorning(a, smoothie = true, extra = null) {
  return {
    mood: rot(MOODS.frustrated, a),
    notes: join(
      smoothie ? rot(BREAKFAST, a) : rot(BREAKFAST_PLAIN, a),
      rot(MORNING_MEDS, a),
      rot(STEVE_LEAVES_UPSET, a),
      rot(UPSET_FOLLOWUP, a),
      rot(ACTIVITY_DAY, a),
      rot(HYGIENE_DAY, a),
      rot(LUNCH, a),
      extra ?? rot(HOUSEKEEPING_DAY, a),
      rot(HYDRATION, a),
    ),
  };
}

// ---------------------------------------------------------------------------
// What the house manager reported - July (admission Monday July 20)
// ---------------------------------------------------------------------------
const JULY = {
  20: {
    day: {
      mood: 'Excited, a little nervous',
      notes: join(
        'Jerrell moved into the group home today; he arrived around 11:00 AM with his belongings and staff welcomed him and showed him his bedroom, the bathroom and the kitchen.',
        'Staff helped him unpack his clothes and set up his room; he hung some of his drawings on the wall.',
        'Staff went over the house rules, the emergency exits and the safety rules of the house with him and answered his questions.',
        "Jerrell's medications and paperwork were checked in and locked in the medication cabinet; no medication was due during the shift.",
        'Jerrell had a sandwich and fruit for lunch that staff prepared and drank water.',
        'In the afternoon Jerrell relaxed in his room and drew in his sketchbook while staff finished his intake paperwork.',
        'He asked about starting a day program like Steve and said he would like to go as soon as possible; staff explained that the house manager is arranging his enrollment.',
      ),
    },
    evening: {
      mood: 'Content, Friendly',
      notes: join(
        'Jerrell had dinner with his housemate Steve and staff; Steve welcomed him and the two had a long conversation to get to know each other.',
        'Evening medications were given at 8:00 PM as prescribed.',
        'Jerrell finished setting up his room and watched a movie in the living room.',
        'Jerrell took his shower before bed and put on clean clothes; staff showed him how the shower works.',
        'Jerrell went to his room around 10:30 PM; staff reminded him that they are available overnight if he needs anything.',
      ),
    },
  },
  21: {
    day: {
      mood: 'Content, Talkative',
      notes: join(
        'Jerrell woke up around 8:00 AM and had cereal and a banana for his first breakfast at the house; staff showed him where everything is in the kitchen.',
        'Morning medications were given at 9:00 AM as prescribed and Jerrell took them without any problem.',
        'Steve left for his day program at 8:00 AM and Jerrell stayed home; he talked about starting day support like Steve and staff explained that the house manager is setting up his enrollment.',
        'Jerrell spent the morning drawing at the kitchen table and showed staff his artwork.',
        HYGIENE_DAY[0],
        'Jerrell made a sandwich for lunch with staff nearby.',
        'Jerrell made his bed and tidied his room.',
        'Staff offered water through the shift.',
      ),
    },
    evening: {
      mood: 'Happy, Excited',
      notes: join(
        'Jerrell ate dinner at the table with Steve and staff and cleared his plate.',
        'Evening medications were given at 8:00 PM as prescribed.',
        'Steve helped Jerrell set up his TV and Xbox in his room and the two played a game together afterwards.',
        'Jerrell attended the house meeting together with Steve and staff to go over the rules and regulations of the house.',
        'Jerrell took his shower before bed and put on clean clothes.',
        'Jerrell went to his room around 10:30 PM to watch TV before sleeping.',
      ),
    },
  },
  22: {
    day: {
      mood: 'Happy, Friendly',
      notes: join(
        'Jerrell got up around 8:00 AM and made toast and eggs for breakfast with staff nearby.',
        "Staff administered Jerrell's morning medications at 9:00 AM as prescribed.",
        'Jerrell and Steve had their first long talk together in the living room and found out they both like movies.',
        'Jerrell watched a movie in the living room after that.',
        HYGIENE_DAY[1],
        'Jerrell took a walk around the block with staff before lunch.',
        'Jerrell heated up leftovers for lunch and ate at the table; staff reminded him to be careful with the hot pan.',
        'Jerrell washed his breakfast dishes and put them away.',
        'Staff offered water through the shift.',
      ),
    },
  },
  23: { day: upsetMorning(23, false, LAUNDRY[0]) },
  25: {
    day: {
      mood: 'Happy, Excited',
      notes: join(
        'Jerrell got up early and got dressed without any help from staff.',
        'Jerrell went out for breakfast at IHOP with Steve and staff to welcome him to the house; he ordered pancakes and paid for his meal with his spending money.',
        'Staff drove them to the restaurant and back.',
        'Morning medications were given at 9:00 AM as prescribed before they left.',
        'After breakfast Jerrell, Steve and staff walked together to the garden center to pick out plants for the house; Jerrell chose a small plant for his room.',
        'Then they did the grocery shopping at Walmart; Jerrell picked out fruit and snacks and staff helped him count his money so he stayed within his budget.',
        'Back at home Jerrell watered his new plant and relaxed in his room.',
        'Staff offered water through the shift.',
      ),
    },
    evening: {
      mood: 'Content, Relaxed',
      notes: join(
        'Jerrell drew for a while in his room before dinner.',
        'Jerrell helped set the table and had dinner with Steve and staff.',
        'Evening medications were given at 8:00 PM as prescribed.',
        'Jerrell and Steve watched a movie together in the living room.',
        'Jerrell showered at night as usual and brushed his teeth before bed.',
        'Jerrell was in his room by 11:00 PM.',
      ),
    },
  },
  26: {
    day: {
      mood: 'Calm, Content',
      notes: join(
        'Jerrell slept in and then had cereal and a banana for breakfast with staff nearby.',
        'Morning medications were given at 9:00 AM as prescribed and Jerrell took them without any problem.',
        'Jerrell spent the morning drawing at the kitchen table and showed staff his artwork.',
        HYGIENE_DAY[2],
        'Jerrell made a sandwich for lunch with staff nearby.',
        'He watched a movie in the living room in the afternoon.',
        'Staff offered water and Jerrell drank well during the shift.',
      ),
    },
    evening: {
      mood: 'Happy, Excited',
      notes: join(
        'Jerrell and Steve played Connect Four together in the living room before dinner.',
        'Jerrell ate dinner at the table with Steve and staff and cleared his plate.',
        'Staff drove Jerrell and Steve to Walmart for a quick grocery shopping trip; a smoothie machine was bought for Jerrell and he picked out frozen fruit, bananas and yogurt to make smoothies.',
        'Back at home Jerrell made his first smoothie with staff showing him how to use the machine.',
        'Evening medications were given at 8:00 PM as prescribed.',
        'Jerrell walked around the yard with Steve and staff after dinner.',
        'Jerrell and Steve watched a movie together and then Jerrell took his shower before bed.',
        'Jerrell was in his room by 11:00 PM.',
      ),
    },
  },
  27: {
    day: {
      mood: 'Happy, Creative',
      notes: join(
        'Jerrell woke up around 8:30 AM and made his first breakfast smoothie with his new smoothie machine on his own; he cleaned it afterwards.',
        'Morning medications were given at 9:00 AM as prescribed and Jerrell took them without any problem.',
        STEVE_LEAVES[0],
        'Jerrell worked in his sketchbook for most of the morning.',
        HYGIENE_DAY[1],
        'Jerrell made a sandwich for lunch with staff nearby.',
        'Jerrell took out the trash and wiped the kitchen counter after lunch.',
        HEALTH_WEEKLY[1],
        'Staff offered water through the shift.',
      ),
    },
    evening: {
      mood: 'Content, Talkative',
      notes: join(
        'Jerrell ate the dinner staff prepared and washed his dishes afterwards.',
        'Evening medications were given at 8:00 PM as prescribed.',
        'Jerrell and Steve talked together for a while in the living room after dinner and then Jerrell watched a movie in his room.',
        'Jerrell took his shower before bed and put on clean clothes.',
        'Jerrell went to his room around 10:30 PM to watch TV before sleeping.',
      ),
    },
  },
  28: { day: upsetMorning(28) },
  29: {
    evening: {
      mood: 'Happy, Relaxed',
      notes: join(
        'Jerrell drew for a while in his room before dinner.',
        'Jerrell helped set the table and had dinner with Steve and staff.',
        "Staff administered Jerrell's evening medications at 8:00 PM as prescribed; he took them without difficulty.",
        'Jerrell and Steve had a good time together in the living room playing Xbox after dinner.',
        'Jerrell showered at night as usual and brushed his teeth before bed.',
        'Jerrell was in his room by 11:00 PM.',
      ),
    },
  },
  // Thu Jul 30, 4pm-12am: opened the front door and stepped out without telling staff.
  30: {
    evening: {
      mood: 'Restless',
      notes: join(
        'Jerrell ate the dinner staff prepared (chicken and rice) and cleared his plate.',
        'Evening medications were given at 8:00 PM as prescribed.',
        'Around 8:30 PM Jerrell opened the front door and stepped outside onto the porch without telling staff; staff followed him right away and he came back inside after a few minutes.',
        'Staff reminded Jerrell to stay safe and to let staff know before he goes outside; he said okay.',
        'Jerrell watched a movie in the living room and then took his shower before bed.',
        'Jerrell went to his room around 10:30 PM to watch TV before sleeping.',
      ),
    },
  },
};

// ---------------------------------------------------------------------------
// What the house manager reported - August
// ---------------------------------------------------------------------------
const AUGUST = {
  // Sat Aug 1, 4pm-12am: Walmart trip with Steve and staff; argument became a fight, Jerrell hit Steve.
  1: {
    evening: {
      mood: 'Angry, Agitated',
      notes: join(
        'Jerrell finished a drawing in his room before dinner.',
        'Staff drove Jerrell and Steve to Walmart together to go shopping for groceries and snacks; Jerrell picked out fruit for his smoothies and paid for his snacks with his spending money.',
        'While they were in the checkout line Jerrell and Steve had a disagreement that escalated into a fight and Jerrell hit Steve in the mouth.',
        "Staff followed Jerrell's crisis plan: they separated the two men right away, spoke to Jerrell calmly, reminded him to keep his hands to himself and redirected him away from Steve until the situation was under control.",
        'Jerrell appeared angry and agitated after what happened and stayed quiet for the rest of the evening.',
        'Staff notified the house manager right away and an incident report was completed.',
        'Staff drove both men back to the group home; Jerrell spent time in his room to cool down and staff checked on him regularly.',
        'Evening medications were given at 8:00 PM as prescribed.',
        'Later in the evening Jerrell ate the dinner staff prepared and talked with staff about what happened; he agreed to talk it through with Steve and staff at a house meeting.',
        'Jerrell took his shower and was in his room by 10:30 PM; staff monitored him closely for the rest of the shift.',
      ),
    },
  },
  // Sun Aug 2: night after the incident, team meeting.
  2: {
    night: {
      mood: 'Restless, Tired',
      notes: join(
        'Jerrell went to bed late, around midnight, and was restless after what happened on Saturday evening.',
        'Staff checked on him more often than usual overnight; he was asleep by 12:30 AM and slept through the rest of the night.',
        'Jerrell woke up around 7:30 AM and had a glass of water.',
      ),
    },
    day: {
      mood: 'Calm, Polite',
      notes: join(
        'Jerrell slept in and then made a smoothie and toast for breakfast with staff nearby.',
        'Morning medications were given at 9:00 AM as prescribed and Jerrell took them without any problem.',
        'A team meeting was held at the house with staff, Steve and Jerrell; everyone talked about house safety, respecting each other and getting along after what happened on Saturday.',
        'Jerrell listened and said he would talk to staff first the next time he gets upset with his housemate.',
        'In the afternoon Jerrell worked on a drawing in the living room and watched a movie.',
        HYGIENE_DAY[0],
        'Jerrell made a sandwich for lunch with staff nearby.',
        'Staff offered water through the shift.',
      ),
    },
    evening: {
      mood: 'Calm, Content',
      notes: join(
        'Jerrell had dinner with staff and Steve; the two housemates were polite to each other.',
        'Evening medications were given at 8:00 PM as prescribed.',
        'Jerrell watched a movie in his room.',
        SUNDAY_MONEY[0],
        'Jerrell took his shower before bed and put on clean clothes.',
        'Jerrell was in his room by 11:00 PM.',
      ),
    },
  },
  4: { day: upsetMorning(35) },
  // Thu Aug 6: drew a portrait of Hanna (staff) and gave it to her.
  6: {
    day: {
      mood: 'Happy, Creative',
      notes: join(
        rot(BREAKFAST, 37),
        rot(MORNING_MEDS, 37),
        STEVE_LEAVES[3],
        'Jerrell drew a portrait of Hanna (staff) and gave it to her; she thanked him and he was proud of his artwork.',
        rot(HYGIENE_DAY, 37),
        rot(LUNCH, 37),
        LAUNDRY[1],
        rot(HYDRATION, 37),
      ),
    },
  },
  // Sat Aug 8: park with Steve and staff.
  8: {
    day: {
      mood: 'Happy, Outgoing',
      notes: join(
        rot(LATE_BREAKFAST, 39),
        rot(MORNING_MEDS, 39),
        'Staff drove Jerrell and Steve to the park for a walk; Jerrell enjoyed the fresh air and he and Steve watched the ducks together.',
        'Staff reminded Jerrell to stay close to staff on the path near the pond for safety.',
        rot(HYGIENE_DAY, 39),
        'Back at home Jerrell made a sandwich for lunch and drew in his sketchbook.',
        rot(HYDRATION, 39),
      ),
    },
  },
  // Sun Aug 9: grocery shopping with Steve and staff, Burger King on the way home.
  9: {
    day: {
      mood: 'Happy, Content',
      notes: join(
        rot(LATE_BREAKFAST, 40),
        rot(MORNING_MEDS, 40),
        'Jerrell went grocery shopping together with Steve and staff at Walmart; staff drove and Jerrell picked out fruit for his smoothies and paid for his snacks with his spending money.',
        'On the way home staff stopped at Burger King and Jerrell bought a burger and fries with his spending money; staff helped him count his change.',
        rot(HYGIENE_DAY, 40),
        'Jerrell watched a movie in the living room in the afternoon.',
        rot(HYDRATION, 40),
      ),
    },
  },
  // Tue Aug 11: became upset when Steve left for day support and hurt his hand punching the wall.
  11: {
    day: {
      mood: 'Angry, Upset',
      notes: join(
        rot(BREAKFAST, 42),
        rot(MORNING_MEDS, 42),
        'Steve left for his day program at 8:00 AM and Jerrell became upset that he could not go with him; he said he would like to start his program now.',
        'Jerrell went to his room, yelled and punched the wall several times and scraped and bruised the knuckles of his right hand.',
        'Staff spoke to him calmly, encouraged him to take a few deep breaths, redirected him to sit down and gave him space, then cleaned the scrape and gave him an ice pack for his hand; the bruising was minor and no further medical treatment was needed.',
        'Staff notified the house manager and completed an incident report.',
        'Once he calmed down Jerrell told staff he had no thoughts of self-harm and that he was only angry about waiting for his program to start.',
        'Jerrell appeared angry and upset for most of the morning and was quieter after lunch.',
        'Jerrell spent the rest of the morning drawing at the kitchen table and had no further problems for the rest of the shift; staff monitored his hand and checked in with him regularly.',
        'Jerrell made a sandwich for lunch with staff nearby.',
        'Staff offered water through the shift.',
      ),
    },
    evening: {
      mood: 'Calm, Quiet',
      notes: join(
        'Jerrell ate the dinner staff prepared and washed his dishes afterwards.',
        'Staff checked the scrape on his hand; it looked fine and he said it did not bother him anymore.',
        'Evening medications were given at 8:00 PM as prescribed.',
        'Jerrell and Steve watched a game together on TV.',
        'Jerrell showered at night as usual and brushed his teeth before bed.',
        'Jerrell was in his room by 11:00 PM.',
      ),
    },
  },
  12: {
    night: {
      mood: 'Calm',
      notes: join(
        'Jerrell went to bed around 11:00 PM after his shower.',
        'Staff checked on Jerrell a little more often than usual after the morning before; he slept through the night.',
        'Jerrell woke up around 7:45 AM and had a glass of water.',
      ),
    },
  },
  // Sat Aug 15: brunch at IHOP with Steve and staff.
  15: {
    day: {
      mood: 'Happy, Excited',
      notes: join(
        'Jerrell slept in and had a smoothie when he got up; staff monitored the kitchen.',
        rot(MORNING_MEDS, 46),
        'Jerrell went out for brunch at IHOP together with Steve and staff; he had pancakes and eggs and paid for his meal with his spending money.',
        'Staff drove them to the restaurant and back.',
        rot(HYGIENE_DAY, 46),
        'Back at home Jerrell drew in his sketchbook and watched a movie in the living room.',
        rot(HYDRATION, 46),
      ),
    },
  },
  // Sun Aug 16: park with Steve and staff.
  16: {
    day: {
      mood: 'Calm, Content',
      notes: join(
        rot(LATE_BREAKFAST, 47),
        rot(MORNING_MEDS, 47),
        'Staff drove Jerrell and Steve to the park for some fresh air; Jerrell and Steve walked a lap around the pond together with staff and then Jerrell sat in the shade drawing.',
        rot(HYGIENE_DAY, 47),
        rot(LUNCH, 47),
        rot(HYDRATION, 47),
      ),
    },
  },
  // Mon Aug 17: left the house without staff authorization; staff followed and brought him back.
  17: {
    day: {
      mood: 'Frustrated, Irritable',
      notes: join(
        rot(BREAKFAST, 48),
        rot(MORNING_MEDS, 48),
        'Steve left for his day program at 8:00 AM; Jerrell said he was frustrated because he could not go to day support like Steve and that he would like to start soon, and staff explained again that his enrollment is still pending.',
        'Around 11:00 AM Jerrell left the house without staff authorization and started down the street; staff followed him right away, caught up with him at the corner and he came back to the house with staff after a few minutes.',
        'Staff reminded him to stay safe and to tell staff before going outside, and talked with him about the safety rules of the house.',
        'Staff notified the house manager and an incident report was completed.',
        'Staff kept their voices low, gave him space and redirected him to the kitchen table with his pencils once he was back inside; he had no further problems for the rest of the shift.',
        'Jerrell appeared frustrated and irritable this morning but was in a better mood by the afternoon.',
        'Jerrell spent the afternoon drawing at the kitchen table and watched a movie.',
        rot(HYGIENE_DAY, 48),
        rot(LUNCH, 48),
        rot(HYDRATION, 48),
      ),
    },
  },
  // Thu Aug 20: argued about cleaning up his dishes.
  20: {
    day: {
      mood: 'Irritable',
      notes: join(
        rot(BREAKFAST, 51),
        rot(MORNING_MEDS, 51),
        STEVE_LEAVES[0],
        'Jerrell was irritable this morning and had an argument with staff when they reminded him to clean up his breakfast dishes; he calmed down after a few minutes and washed the dishes.',
        rot(ACTIVITY_DAY, 51),
        rot(HYGIENE_DAY, 51),
        rot(LUNCH, 51),
        LAUNDRY[0],
        rot(HYDRATION, 51),
      ),
    },
  },
  // Sat Aug 22: Goodwill and Burger King with Steve and staff.
  22: {
    day: {
      mood: 'Happy, Outgoing',
      notes: join(
        rot(LATE_BREAKFAST, 53),
        rot(MORNING_MEDS, 53),
        'Jerrell went along with Steve and staff to Goodwill; he looked at the movies and bought two DVDs with his spending money.',
        'Afterwards staff stopped at Burger King and Jerrell had a burger and fries for lunch, which he paid for with his spending money; staff helped him count his change.',
        rot(HYGIENE_DAY, 53),
        'Back at home Jerrell and Steve played Xbox together.',
        'Jerrell watched a movie from his new DVDs in the living room in the afternoon.',
        rot(HYDRATION, 53),
      ),
    },
  },
  // Sun Aug 23: neighborhood walk with Steve and staff.
  23: {
    day: {
      mood: 'Calm, Relaxed',
      notes: join(
        rot(LATE_BREAKFAST, 54),
        rot(MORNING_MEDS, 54),
        'Jerrell went for a walk around the neighborhood with Steve and staff; staff reminded him to look both ways before crossing the street.',
        rot(HYGIENE_DAY, 54),
        rot(LUNCH, 54),
        'Jerrell watched a movie in the living room in the afternoon.',
        rot(HYDRATION, 54),
      ),
    },
  },
  // Tue Aug 25 / Thu Aug 27: Steve is out at his evening program 5-8 PM.
  25: {
    evening: {
      mood: 'Content',
      notes: join(
        'Steve was out at his evening program from 5:00 to 8:00 PM; Jerrell asked where he went and staff explained; Jerrell stayed home and watched a movie in the living room.',
        rot(DINNER, 56),
        rot(EVENING_MEDS, 56),
        'Jerrell worked on a drawing in his room and showed it to staff.',
        rot(HYGIENE_EVE, 56),
        rot(BEDTIME_EVE, 56),
      ),
    },
  },
  27: {
    evening: {
      mood: 'Calm, Content',
      notes: join(
        'Steve was out at his evening program from 5:00 to 8:00 PM and Jerrell stayed home; he made a smoothie and drew in his sketchbook.',
        rot(DINNER, 58),
        rot(EVENING_MEDS, 58),
        'When Steve came back Jerrell and Steve watched a game together on TV.',
        rot(HYGIENE_EVE, 58),
        rot(BEDTIME_EVE, 58),
      ),
    },
  },
  // Sat Aug 29: Steve's medical emergency overnight (3:30 AM); Steve home ~10 AM.
  29: {
    night: {
      mood: 'Sleepy, Worried',
      notes: join(
        'Jerrell went to bed around 11:00 PM after watching a movie with Steve.',
        'Around 3:30 AM Jerrell woke up because of the commotion when Steve became unwell and paramedics came to the house; staff explained what was happening and reassured him.',
        'Jerrell went back to bed once the house was quiet and slept until about 8:00 AM.',
      ),
    },
    day: {
      mood: 'Calm, Caring',
      notes: join(
        'Jerrell had a late breakfast (smoothie and toast) and asked staff how Steve was doing; staff told him Steve was being looked after and would be home later in the morning.',
        rot(MORNING_MEDS, 60),
        'Steve came home around 10:00 AM and Jerrell was glad to see him; the two watched TV together in the living room while Steve rested.',
        rot(HYGIENE_DAY, 60),
        'Jerrell drew in his sketchbook in the afternoon and made a sandwich for lunch.',
        rot(HYDRATION, 60),
      ),
    },
    evening: {
      mood: 'Calm, Content',
      notes: join(
        'Jerrell ate dinner at the table with Steve and staff and cleared his plate.',
        rot(EVENING_MEDS, 60),
        'Jerrell and Steve watched a movie together in the living room after dinner.',
        rot(HYGIENE_EVE, 60),
        'Jerrell was in his room by 10:30 PM.',
      ),
    },
  },
  // Sun Aug 30: weekly grocery shopping with Steve and staff.
  30: {
    day: {
      mood: 'Content, Friendly',
      notes: join(
        rot(LATE_BREAKFAST, 61),
        rot(MORNING_MEDS, 61),
        'Jerrell went along for the weekly grocery shopping with Steve and staff; he picked out fruit for his smoothies and paid for his snacks with his spending money.',
        rot(HYGIENE_DAY, 61),
        rot(LUNCH, 61),
        'Back home Jerrell and Steve played Xbox together.',
        'Jerrell drew in his sketchbook in the afternoon.',
        rot(HYDRATION, 61),
      ),
    },
  },
};

// ---------------------------------------------------------------------------
const MONTH_INDEX = { July: 6, August: 7 };
const EVENTS = { July: JULY, August: AUGUST };
let total = 0;
for (const month of jerrell.months.filter((m) => m.name === 'July' || m.name === 'August')) {
  const fill = {};
  for (const day of monthDays(month)) {
    const d = day.day;
    const dow = new Date(Date.UTC(month.year, MONTH_INDEX[month.name], d)).getUTCDay();
    fill[day.heading] = { ...routine(month.name, d, dow), ...(EVENTS[month.name][d] ?? {}) };
    if (month.startDay && d === month.startDay) delete fill[day.heading].night; // no pre-admission box
  }
  const bytes = await Packer.toBuffer(buildDocument(month, fill, null, jerrell));
  const out = path.join(ROOT, `${jerrell.filePrefix}_${month.name}${month.year}_Daily_Log_Entry (filled).docx`);
  await writeFile(out, bytes);
  const boxes = Object.values(fill).reduce((n, day) => n + Object.keys(day).length, 0);
  total += boxes;
  console.log(`Wrote ${out} (${bytes.length} bytes, ${boxes} filled shift boxes)`);
}
console.log(`${total} shift boxes in total`);
