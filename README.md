# Public Transport Routing App

A simple web app to view Auckland bus stops and plan routes on a Leaflet/OpenStreetMap map.

## Setup

1. **Backend**

   ```bash
   cd backend
   cp .env.example .env
   # add your AT_API_KEY
   npm install
   npm run dev
   ```

   Runs on <http://localhost:4000>

2. **Frontend**

   ```bash
   cd frontend
   cp .env.local.example .env.local
   # set NEXT_PUBLIC_API_URL=http://localhost:4000/api
   npm install
   npm run dev
   ```

   Open <http://localhost:3000>

## Features

- Lists GTFS versions & stops (by date)
- 404 on invalid stop IDs
- Map with a marker for every stop
- Draggable, pan/zoom-enabled

## Lint & Formatter

- ESLint + Prettier
- Husky + lint-staged on commit

## License

MIT
