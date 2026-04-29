# Smart Incident Hub

A modern, AI-powered civic issue reporting and management platform for smart cities.

## Features

- 🤖 AI-powered incident detection and classification
- 📍 GPS location mapping
- 🔔 Real-time alerts and notifications
- 📊 Analytics dashboard with comprehensive insights
- 💬 Direct communication with authorities
- 🎫 Automatic ticket generation and assignment

## Getting Started

### Prerequisites

- Node.js 18+ & npm/yarn/bun installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

### Installation

```sh
# Clone the repository
git clone <YOUR_GIT_URL>

# Navigate to the project directory
cd incident-hub

# Step 3: Install the necessary dependencies.
npm install

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env

# Start the development server
npm run dev
```

The application will be available at `http://localhost:8080`

## Technology Stack

- **Frontend Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **UI Library**: shadcn-ui components
- **Styling**: Tailwind CSS
- **State Management**: React Hooks
- **API Client**: Fetch API with custom wrapper
- **Routing**: React Router

## Backend Integration

The application is ready for backend integration. API services are configured in:

- `/src/config/api.ts` - API endpoints configuration
- `/src/services/` - API service modules (auth, incidents, tickets)
- `/src/hooks/use-data.ts` - Custom hooks for data fetching

### Environment Variables

Create a `.env` file with:

```env
VITE_API_URL=http://localhost:3000/api
VITE_API_TIMEOUT=30000
```

### API Integration Steps

1. Set up your backend API server
2. Update `VITE_API_URL` in `.env` file
3. Implement the API endpoints defined in `src/config/api.ts`
4. The frontend will automatically connect to your backend

### Expected Backend API Structure

```
POST   /api/auth/login
POST   /api/auth/register
GET    /api/incidents
POST   /api/incidents
GET    /api/incidents/:id
PUT    /api/incidents/:id
GET    /api/tickets
GET    /api/tickets/:id
PATCH  /api/tickets/:id/status
```

See `src/config/api.ts` for complete API endpoint list.

## Deployment

### Build for Production

```sh
npm run build
```

The build output will be in the `dist/` directory.

### Deploy to Hosting

You can deploy to any static hosting service:

- Vercel: `vercel deploy`
- Netlify: `netlify deploy`
- AWS S3 + CloudFront
- GitHub Pages
- Docker container

## Project Structure

```
src/
├── components/     # Reusable UI components
├── pages/         # Page components
├── services/      # API service modules
├── hooks/         # Custom React hooks
├── lib/           # Utility functions
├── types/         # TypeScript type definitions
└── config/        # Configuration files
```
