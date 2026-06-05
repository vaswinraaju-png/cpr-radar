{
  "functions": {
    "pages/api/cron.js": {
      "maxDuration": 120
    },
    "pages/api/cron-warmup.js": {
      "maxDuration": 300
    }
  },
  "crons": [
    {
      "path": "/api/cron-warmup",
      "schedule": "25 10 * * *"
    },
    {
      "path": "/api/cron",
      "schedule": "0 11 * * *"
    },
    {
      "path": "/api/cron-warmup",
      "schedule": "25 11 * * *"
    },
    {
      "path": "/api/cron",
      "schedule": "30 12 * * *"
    },
    {
      "path": "/api/cron-warmup",
      "schedule": "55 12 * * *"
    },
    {
      "path": "/api/cron",
      "schedule": "0 14 * * *"
    }
  ]
}
