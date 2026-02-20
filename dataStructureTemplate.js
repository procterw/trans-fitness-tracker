// This file is a human written outline of the data model

// LLM friendly sets of instructions that the user provides to tailor logging and Q&A
const user_profile_data_structure = {
  // A large text blob containing background on the user's health, goals, bodies, and interests
  "general": "",
  // A large text blob with more specific fitness goals, programming, injuries, interests, gym and equipment availability, even specific plans
  // This could also include shorthand for logging exercises
  "fitness": "",
  // A large text blob with more specific diet and health goals, dietary restrictions, macro preferences, nutrient concerns
  // Crucially, recipes and shorthands for logging food go in here
  "diet": "",
  // Very optional user preferences for interacting with GPT-5
  "agent": "",
};

// A "weekly checklist" approach organized into training blocks
const training_data_structure = {
  "blocks": [
    {
      "block_id": "$UUID",
      "block_start": "2026-01-19",
      "block_name": "Cycling race training block 1",
      "block_details": "Building endurance base. Whole paragraphs of text can go in here.",
      "workouts": [
        {
          // a UNIQUE name of the activity, also acting as an ID
          "name": "Long ride",
          "description": "For this block, a 50 minute to 2 hour ride averaging around zone 2",
          "category": "Cardio",
          // Whether the workout is optional in the context of the block
          "optional": false,
        },
        {
          "name": "Gym workout #1",
          "description": "Open ended lower body workout with moderate effort",
          "category": "Strength",
          "optional": false
        },
      ]
    }
  ],


  "weeks": [
    {
      // Start Monday, end Sunday
      "week_start": "2026-01-19",
      "week_end": "2026-01-25",
      // This links the week to a block. Then, weeks can be displayed together in a block
      // Additional information about the block and details about workout types also live there
      "block_id": "$UUID",
      "workouts": [
        {
          "name": "Long ride",
          "details": "Zwift ride: 15.9 mi, 50 min, 566 ft gain, 140W avg power, max 286W; 407 cal",
          "completed": true
        },
        {
          "name": "Gym workout #1",
          "details": "",
          "completed": false
        },
      ],
      // AI generated summary that updates throughout the week as more activities are logged
      "summary": "High overall volume with a demanding hike, two aerobic runs, and well-controlled glute work (one hard, one easy, one outlier). Quality run achieved without overreaching. Stopping here appropriate given cumulative load.",
    }
  ]

}

const diet_data_structure = [
  {
    "date": "2026-01-24",
    "weight_lb": null,
    "calories": 1175,
    // Just tracking macros and fiber
    "fat_g": 41,
    "carbs_g": 173,
    "protein_g": 35,
    "fiber_g": 11,
    // days are incomplete by default until the user says otherwise or a threshold of calories is reached
    "complete": false,
    // Optional quick status flag for whether the day is aligned with goals
    // Allowed values: "green", "yellow", "red", or null
    "on_track": null,
    // AI generated summray that tracks what food was eaten, as well as a general impression
    // of how it fits into the users goals and activity
    "details": "Breakfast: 3 eggs in 1-2 Tbsp butter, 2 slices rye toast. Snacks: Standard smoothie, half cheese sandwich, handful gummy worms, 3 pieces See's chocolate, cup soy milk. Dinner: Chicken teriyaki from Teriyaki Bowl with gyoza, glass of wine. Slightly elevated but diffuse and fat-paired."
  }
];
