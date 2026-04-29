# Quick Start Guide - Smart Incident Hub

## For Frontend Developers

### Setup
```bash
# Clone and install
git clone <repo-url>
cd incident-hub
npm install

# Configure environment
cp .env.example .env
# Edit .env with your API URL

# Start development server
npm run dev
```

Visit: `http://localhost:8080`

### Project Structure
```
src/
├── pages/           # Main page components
├── components/      # Reusable UI components
├── services/        # API communication layer
├── hooks/           # Custom React hooks
├── config/          # Configuration files
└── lib/             # Utility functions
```

### Making API Calls

**Option 1: Use Custom Hooks (Recommended)**
```typescript
import { useIncidents } from '@/hooks/use-data';

function MyComponent() {
  const { incidents, loading, error, refetch } = useIncidents();
  
  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;
  
  return <div>{/* Use incidents data */}</div>;
}
```

**Option 2: Direct Service Calls**
```typescript
import { incidentService } from '@/services/incidents';

async function createIncident() {
  const response = await incidentService.createIncident({
    title: "Pothole",
    location: "Main Street",
    category: "Road"
  });
  
  if (response.success) {
    console.log(response.data);
  } else {
    console.error(response.error);
  }
}
```

### Available Services

- `authService` - Login, register, logout
- `incidentService` - CRUD operations for incidents
- `ticketService` - Ticket management for officials

### Available Hooks

- `useIncidents()` - Fetch user's incidents
- `useIncidentStats()` - Get incident statistics
- `useTickets()` - Fetch tickets (officials)
- `useTicketStats()` - Get ticket statistics (officials)

## For Backend Developers

### API Requirements

**Base URL:** Set in frontend `.env` as `VITE_API_URL`

**Authentication:** JWT token in `Authorization: Bearer <token>` header

**Response Format:**
```json
{
  "success": true,
  "data": { /* your data */ },
  "message": "Optional message"
}
```

### Required Endpoints

#### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - Logout user

#### Incidents (Citizens)
- `GET /api/incidents` - List user's incidents
- `POST /api/incidents` - Create incident
- `GET /api/incidents/:id` - Get incident details
- `PUT /api/incidents/:id` - Update incident
- `DELETE /api/incidents/:id` - Delete incident
- `GET /api/incidents/stats` - Get statistics

#### Tickets (Officials)
- `GET /api/tickets` - List all tickets
- `GET /api/tickets/:id` - Get ticket details
- `PATCH /api/tickets/:id/status` - Update status
- `POST /api/tickets/:id/assign` - Assign ticket
- `GET /api/tickets/stats` - Get statistics

**Full API documentation:** See `BACKEND_INTEGRATION.md`

## Common Tasks

### Add New API Endpoint

1. **Define in config:**
```typescript
// src/config/api.ts
export const API_ENDPOINTS = {
  EXAMPLE: {
    LIST: '/example',
    GET: (id: string) => `/example/${id}`,
  }
}
```

2. **Create service:**
```typescript
// src/services/example.ts
import { apiClient } from './api';
import { API_ENDPOINTS } from '@/config/api';

export const exampleService = {
  async getList() {
    return apiClient.get(API_ENDPOINTS.EXAMPLE.LIST);
  }
}
```

3. **Create hook (optional):**
```typescript
// src/hooks/use-data.ts
export const useExample = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    exampleService.getList().then(res => {
      if (res.success) setData(res.data);
      setLoading(false);
    });
  }, []);
  
  return { data, loading };
}
```

### Add New Page

1. Create component in `src/pages/`
2. Add route in main router
3. Import necessary hooks/services
4. Use existing UI components from `src/components/ui/`

### Testing Without Backend

Mock data is still in place. The app works without a backend for development.

To test with backend:
1. Set `VITE_API_URL` in `.env`
2. Replace mock data with hooks
3. Backend will be called automatically

## Build & Deploy

### Development
```bash
npm run dev
```

### Production Build
```bash
npm run build
```

Output: `dist/` directory

### Deploy
Compatible with:
- Vercel
- Netlify
- AWS S3 + CloudFront
- GitHub Pages
- Any static hosting

## Environment Variables

```bash
# .env
VITE_API_URL=http://localhost:3000/api
VITE_API_TIMEOUT=30000
```

**Important:** Never commit `.env` file!

## Troubleshooting

### API not connecting
1. Check `VITE_API_URL` in `.env`
2. Verify backend is running
3. Check browser console for CORS errors
4. Verify API response format matches spec

### TypeScript errors
```bash
npm run build  # Check for type errors
```

### Styling issues
- Uses Tailwind CSS
- UI components in `src/components/ui/`
- Custom styles in `src/index.css`

## Resources

- **Full API Spec:** `BACKEND_INTEGRATION.md`
- **Migration Notes:** `MIGRATION_SUMMARY.md`
- **Component Library:** shadcn/ui documentation
- **React Router:** For navigation
- **TypeScript:** For type safety

## Support

Check these files for details:
- `BACKEND_INTEGRATION.md` - Complete API documentation
- `MIGRATION_SUMMARY.md` - What changed and why
- `src/config/api.ts` - All API endpoints
- `src/services/` - Service implementations
- `src/hooks/use-data.ts` - Data fetching patterns

---

**Happy Coding! 🚀**
