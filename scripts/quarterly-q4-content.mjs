// Wording for the 4th quarterly review (6/15/2026 - 8/31/2026). Everything
// here is grounded in the June/July staff workbooks and the house manager's
// account of August (confirmed 9/3/2026: period 6/15-8/31, same-day discharge
// after the 8/29 seizure, physician and case manager notified, no medication
// change, no further housemate conflicts, no complaints, signer Kierra Crump,
// new housemate moved in 7/20/2026).
//
// Row `match` is tested against the text of the row's first cell (outcome /
// risk / routine-support column). `status` is one of 'Achieved', 'On track',
// 'Limited or no progress'. `planChange` (string) ticks "Plan change needed?
// Yes" and fills "If yes, describe:"; omit for No.

const PERIOD_END = '8/31/2026';

export const CONTENT = {
  previous: { periodStart: '3/15/2026', periodEnd: '6/14/2026', completedDate: '06/15/2026' },
  period: {
    start: '6/15/2026',
    end: PERIOD_END,
    quarterBoxes: ['o', 'o', 'o', 'x'], // 1st 2nd 3rd 4th
    fileTag: `6.15.2026-${PERIOD_END.replace(/\//g, '.')}`,
  },
  completedDate: '09/01/2026', // day after the period end, as last time

  rows: [
    {
      match: /Steven wants to be an active member/,
      status: 'On track',
      text:
        'Throughout this reporting period, Steve continued to take part in community and recreational activities ' +
        'that he enjoys. With staff support he went on walks in the park and downtown, visited the mall, GameStop, ' +
        'Goodwill, Carytown and Short Pump Town Center, went out for brunch and dinner, and shopped for his own ' +
        'items and groceries. He attended Inner Vision Day Support on weekdays, including community outings arranged ' +
        'by the program and trips to Busch Gardens, and he continued to choose Wednesdays as his day to rest at ' +
        'home, which staff respect as his personal choice. Steve visited his family in Fredericksburg from 6/17/2026 ' +
        'to 6/21/2026. On 8/25/2026 Steve started a new community engagement program on Tuesday and Thursday ' +
        'evenings (5:00-8:00 PM); he attended on 8/25 and 8/27, visited the park and saw animals with the group, ' +
        'and told staff he loved it. Steve continues to express interest in finding a job, and staff talked with ' +
        'him about the skills needed for employment; this goal will carry into his next plan year.',
    },
    {
      match: /Steve will become more independent with cooking/,
      status: 'On track',
      text:
        'Throughout this reporting period, Steve prepared his own breakfast almost every morning, most days ' +
        'without prompting, using the microwave and stove with staff nearby for safety. He packed his own lunch ' +
        'for day support, cooked his dinner with staff supervision most evenings, helped choose his groceries and ' +
        'made a shopping list, and on 7/2/2026 made his favorite food (tacos) at a cooking session at day support. ' +
        'On 7/17/2026 Steve burned his hand while using the microwave; staff provided first aid and reviewed using ' +
        'oven mitts and handling hot dishes safely, and no further kitchen injuries occurred. Steve continues to ' +
        'build meal-planning skills with staff guidance and often chooses to cook at home rather than eat out.',
    },
    {
      match: /Dehydration/,
      status: 'On track',
      text:
        'Throughout this reporting period, Steve continued to drink water instead of soda and told staff he is ' +
        'proud of cutting out soda and energy drinks. Staff offered water regularly, sent a water bottle with him ' +
        'to day support, and encouraged extra fluids on hot days and during community outings such as the Busch ' +
        'Gardens trips. Steve took his medications with water. No signs or symptoms of dehydration were observed ' +
        'during this reporting period.',
    },
    {
      match: /Seizure/,
      status: 'On track',
      text:
        'Throughout this reporting period, staff monitored Steve for seizure activity during every shift, ' +
        'including overnight checks, and followed his seizure protocol. No seizure activity was observed from ' +
        '6/15/2026 through 8/28/2026. At about 3:30 AM on 8/29/2026 Steve had a seizure in bed lasting about ' +
        'three minutes. Staff kept him safe on his side, timed the seizure and called 911; he was taken to the ' +
        'hospital by ambulance, was evaluated and returned home later the same morning with instructions to rest, ' +
        'drink fluids and continue his medications as prescribed. An incident report was completed, the house ' +
        'manager and his physician were notified, and staff increased overnight checks to every 30 minutes. No ' +
        'medication changes were reported, and no further seizure activity was observed through the end of the ' +
        'reporting period. Staff will continue to follow his seizure protocol and any further instructions from ' +
        'his physician.',
    },
    {
      match: /Pressure Injury/,
      status: 'On track',
      text:
        'Throughout this reporting period, Steve remained active with daily walks, outings and household tasks, ' +
        'and changed positions regularly during the day. Staff observed his skin during routine care and saw no ' +
        'redness, irritation or breakdown. No concerns related to pressure injuries were identified during this ' +
        'reporting period.',
    },
    {
      match: /Aspiration Pneumonia/,
      status: 'On track',
      text:
        'Throughout this reporting period, staff monitored Steve during meals and snacks and reminded him to eat ' +
        'and drink at a safe pace. After his mouth injury on 8/1/2026, staff offered soft foods and watched him ' +
        'closely while eating until his teeth were treated. No coughing, choking or other signs of aspiration were ' +
        'observed during this reporting period.',
    },
    {
      match: /Fall with Injury/,
      status: 'On track',
      text:
        'Throughout this reporting period, staff continued to monitor Steve\u2019s mobility at home and in the ' +
        'community, including on long walking days such as the Busch Gardens trips. Steve walked with a steady ' +
        'gait, and his seizure on 8/29/2026 occurred while he was in bed, so he was not injured by a fall. No falls ' +
        'were reported during this reporting period.',
    },
    {
      match: /Bowel Obstruction/,
      status: 'On track',
      text:
        'Throughout this reporting period, staff encouraged Steve to drink water, eat fruit and vegetables with his ' +
        'meals and choose healthy snacks, and checked in with him regularly about any discomfort. No constipation, ' +
        'abdominal discomfort or other concerns related to bowel obstruction were reported during this reporting ' +
        'period.',
    },
    {
      match: /Sepsis/,
      status: 'On track',
      text:
        'Throughout this reporting period, staff monitored Steve for any signs of illness or infection and ' +
        'encouraged good hygiene, including daily showers. After the injury to his mouth on 8/1/2026, staff watched ' +
        'for swelling, fever or other signs of infection until he was seen at the clinic on 8/6/2026; none were ' +
        'observed. No signs or symptoms related to sepsis were observed during this reporting period.',
    },
    {
      // Routine supports: Adaptive equipment/DME + Other medical
      match: /\u2612 Adaptive equipment\/DME/,
      status: 'On track',
      text:
        'Throughout this reporting period, Steve continued to receive daily routine support for his medical and ' +
        'physical health needs, and staff followed the care protocols for his chronic conditions. Steve received ' +
        'medical care for a dental injury sustained on 8/1/2026 and was seen at the clinic on 8/6/2026, where the ' +
        'doctor also noted that he had lost 9 pounds and praised his healthier eating. Steve was treated at the ' +
        'hospital after a seizure on 8/29/2026 and returned home the same day. The supports in place remain ' +
        'appropriate for his level of need, and staff continue to monitor his health and follow provider ' +
        'instructions.',
    },
    {
      match: /\u2612 Communication support/,
      status: 'On track',
      text:
        'Throughout this reporting period, Steve communicated his wants, needs and preferences clearly with staff, ' +
        'his housemate and his team. He talked with staff about his goals, including his interest in working, and ' +
        'helped his new housemate learn the house routines and rules. At day support on 6/25/2026 Steve managed his ' +
        'emotions appropriately after a peer annoyed him. On 8/1/2026 a disagreement with his housemate during a ' +
        'shopping trip escalated into a physical altercation (see the safety question below); staff supported both ' +
        'men afterward through a team meeting on 8/2/2026 and weekly Friday house meetings, where Steve talked ' +
        'about respecting each other and getting along, and no further conflicts were reported through the end of ' +
        'the reporting period.',
    },
    {
      match: /\u2612 Medication use/,
      status: 'On track',
      text:
        'Throughout this reporting period, staff administered Steve\u2019s medications as prescribed and documented ' +
        'each administration. Steve took his medications cooperatively with water, and no refusals, missed doses ' +
        'or medication errors were reported. After his hospital visit on 8/29/2026 Steve continued his medications ' +
        'as prescribed; no medication changes were reported, and staff will follow any further instructions from ' +
        'his physician.',
    },
    {
      match: /\u2612 Housekeeping/,
      status: 'On track',
      text:
        'Throughout this reporting period, Steve kept his living space in order and took part in household tasks ' +
        'with fewer prompts. He cleaned and organized his room with staff support, washed dishes and wiped the ' +
        'kitchen after cooking, helped organize the refrigerator after grocery shopping, put away the belongings he ' +
        'brought back from his family visit, helped pick out plants for the house and helped his new housemate set ' +
        'up his TV and Xbox. Staff continued to provide encouragement and occasional reminders as needed.',
    },
    {
      match: /\u2612 Laundry/,
      status: 'On track',
      text:
        'Throughout this reporting period, Steve did his laundry every week, usually on Wednesdays, his day at ' +
        'home. He washed and dried his clothes and folded and put them away with staff support and reminders as ' +
        'needed. Steve continues to gain independence with the full laundry routine.',
    },
    {
      match: /\u2612 Shopping/,
      status: 'On track',
      text:
        'Throughout this reporting period, Steve went grocery shopping with staff each week, picked out his own ' +
        'meals and snacks, and made a shopping list for the store. He used his own money to buy movies at Goodwill, ' +
        'video games at GameStop, a guitar accessory and personal items, and enjoyed window shopping at Dollar Tree ' +
        'and Five Below. Apart from the incident with his housemate at Walmart on 8/1/2026, which is described in the ' +
        'safety question below, Steve behaved appropriately in stores and handled his purchases with staff guidance.',
    },
    {
      match: /\u2612 Meal planning/,
      status: 'On track',
      text:
        'Throughout this reporting period, Steve planned and prepared most of his own meals with staff ' +
        'supervision and packed his lunch for day support. Staff talked with him regularly about healthy food ' +
        'choices, portion sizes and choosing healthier options when eating out, and Steve chose fruit as a snack, ' +
        'cut out soda and energy drinks and often decided to cook at home instead of eating out. At his clinic visit ' +
        'on 8/6/2026 the doctor noted that Steve had lost 9 pounds and praised his progress. Steve ate soft foods ' +
        'for a few days after his mouth injury on 8/1/2026.',
    },
    {
      match: /\u2612 Banking\/money management/,
      status: 'On track',
      text:
        'Throughout this reporting period, Steve continued to save money and to plan his spending with staff. ' +
        'Staff reviewed his savings with him regularly using the house record of his money, and Steve saved most of ' +
        'his $20 weekly allowance. He used his own money for video games, movies, a guitar accessory and personal ' +
        'items, and he talked with staff about wanting to earn money through a job. Staff continued to support him ' +
        'during purchases and with his savings goals.',
    },
    {
      match: /\u2612 Medical appointments/,
      status: 'On track',
      text:
        'Throughout this reporting period, staff coordinated Steve\u2019s medical care and provided transportation ' +
        'and support at appointments. On 8/6/2026 Steve was seen at the clinic, where he was checked after his ' +
        'injury on 8/1/2026 and his teeth were treated; the doctor also noted his 9-pound weight loss and praised ' +
        'his healthy eating. On 8/29/2026 Steve was taken to the hospital by ambulance after a seizure, was ' +
        'evaluated and discharged home the same day; his physician was notified, and staff will follow any further ' +
        'instructions. Steve cooperated with all care, and no barriers to attending appointments were noted.',
    },
    {
      match: /\u2612 Transportation/,
      status: 'On track',
      text:
        'Throughout this reporting period, staff provided transportation to and from Inner Vision Day Support, ' +
        'medical appointments, grocery shopping and community outings, and to and from his new community ' +
        'engagement program on Tuesday and Thursday evenings. Steve was transported to the hospital by ambulance ' +
        'on 8/29/2026 and brought home by staff. Steve traveled safely with staff supervision, and no ' +
        'transportation concerns were reported during this reporting period.',
    },
    {
      match: /Medical #1/,
      status: 'On track',
      text:
        'Throughout this reporting period, staff continued to support Steve in managing his Type II diabetes, ' +
        'epilepsy, hypertension and high cholesterol. Staff reinforced his diabetic diet, encouraged water instead ' +
        'of soda and supported his healthier choices; at his clinic visit on 8/6/2026 the doctor noted a 9-pound ' +
        'weight loss and praised him. Staff monitored for seizure activity every shift and responded to his ' +
        'seizure on 8/29/2026 according to his protocol, including calling 911. Medications were given as ' +
        'prescribed, and staff continue to follow provider recommendations and monitor for any change in his ' +
        'condition.',
    },
  ],

  questions: [
    {
      match: /safety risks/,
      answer: 'Yes',
      text:
        '(1) On 8/1/2026, during a shopping trip to Walmart, a disagreement between Steve and his housemate ' +
        'escalated into a physical altercation and Steve\u2019s teeth were broken. Staff separated them immediately, ' +
        'gave first aid, notified the house manager and completed an incident report; his case manager was notified. ' +
        'Steve was seen at the clinic on 8/6/2026 and his teeth were treated, and he has recovered. A team meeting ' +
        'was held with both men on 8/2/2026, and weekly Friday house meetings were started to review house rules and ' +
        'respecting each other; no further conflicts were reported. (2) On 8/29/2026 at about 3:30 AM Steve had a ' +
        'seizure lasting about three minutes; staff followed his seizure protocol, called 911, and he was taken to ' +
        'the hospital by ambulance and returned home the same morning. An incident report was completed, his ' +
        'physician was notified, overnight checks were increased, and no medication changes were reported. Seizure ' +
        'remains an identified risk in his plan. (3) On 7/17/2026 Steve burned his hand while using the microwave; ' +
        'staff provided first aid and reviewed kitchen safety with him, and no further injuries occurred. All events ' +
        'are documented in the daily shift notes and incident reports.',
    },
    {
      match: /desire and\/or need any changes/,
      answer: 'Yes',
      text:
        'Steve began a community engagement program on 8/25/2026 (Tuesdays and Thursdays, 5:00-8:00 PM), which he ' +
        'enjoys, and this service should be added to his plan. Steve continues to express a desire to find paid ' +
        'employment. These changes, along with the supports needed after the 8/1/2026 incident with his housemate, ' +
        'will be addressed with Steve, his family and his case manager at his annual ISP meeting for the plan year ' +
        'beginning 9/15/2026.',
    },
    {
      match: /satisfied with all services/,
      answer: 'Yes',
      text:
        'Steve reports that he likes living at Joy Group Home. He told staff he loved his new community engagement ' +
        'program, was proud of losing 9 pounds and of the praise from his doctor, and enjoys cooking his own meals ' +
        'and saving his money. He visited his family in Fredericksburg from 6/17 to 6/21/2026 and returned in good ' +
        'spirits. No concerns or dissatisfaction with services were reported by Steve or his family during this ' +
        'reporting period.',
    },
    { match: /Medicaid services/, answer: 'Yes', text: '' },
    {
      match: /significant events/,
      answer: 'Yes',
      text:
        'Steve\u2019s aunt passed away in June, and he visited his family in Fredericksburg from 6/17/2026 to ' +
        '6/21/2026; staff provided emotional support before and after the visit. A new housemate, Jerrell Wright, ' +
        'moved into the home on 7/20/2026; Steve welcomed him, helped him set up his TV and Xbox, attended a house ' +
        'meeting with him to go over the house rules, and the two enjoy movies and video games together. The health ' +
        'events of this quarter are described in question 1.',
    },
  ],
};
