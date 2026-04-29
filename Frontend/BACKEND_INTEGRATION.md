# Backend Integration Guide

This document provides guidelines for implementing the backend API to integrate with the Smart Incident Hub frontend.

## Quick Start

1. The frontend expects a REST API at the URL specified in `.env` file (`VITE_API_URL`)
2. All API endpoints are defined in `/src/config/api.ts`
3. Authentication uses JWT tokens sent in `Authorization: Bearer <token>` header
4. All responses should follow the standard API response format

## API Response Format

All API endpoints should return responses in this format:

```json
{
  "success": true,
  "data": { /* your data here */ },
  "message": "Optional success message"
}
```

For errors:

```json
{
  "success": false,
  "error": "Error message here",
  "message": "User-friendly error message"
}
```

## Authentication Endpoints

### POST /api/auth/register

Register a new user.

**Request Body:**
```json
{
  "name": "string",
  "email": "string (optional)",
  "phone": "string (optional)",
  "password": "string",
  "userType": "citizen | official"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "token": "jwt_token_here",
    "user": {
      "id": "string",
      "name": "string",
      "email": "string",
      "phone": "string",
      "userType": "citizen | official"
    }
  }
}
```

### POST /api/auth/login

Login user.

**Request Body:**
```json
{
  "email": "string (optional)",
  "phone": "string (optional)",
  "password": "string"
}
```

Note: Either email or phone must be provided.

**Response:** Same as register

### POST /api/auth/logout

Logout user (invalidate token).

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

### POST /api/auth/forgot-password

Request password reset.

**Request Body:**
```json
{
  "email": "string (optional)",
  "phone": "string (optional)"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Password reset link sent"
}
```

## Incident Endpoints (Citizen)

### GET /api/incidents

Get all incidents for the authenticated user.

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "string",
      "title": "string",
      "description": "string",
      "category": "string",
      "status": "open | in_progress | resolved | verified | rejected",
      "location": "string",
      "latitude": "number",
      "longitude": "number",
      "images": ["url1", "url2"],
      "reportedBy": "string",
      "createdAt": "ISO date string",
      "updatedAt": "ISO date string",
      "hasMessages": "boolean"
    }
  ]
}
```

### POST /api/incidents

Create a new incident.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "title": "string",
  "description": "string",
  "category": "string",
  "location": "string",
  "latitude": "number (optional)",
  "longitude": "number (optional)"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "string",
    "title": "string",
    "status": "open",
    ...
  }
}
```

### GET /api/incidents/:id

Get single incident details.

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "string",
    "title": "string",
    ...
  }
}
```

### PUT /api/incidents/:id

Update incident (only allowed before official response).

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "title": "string (optional)",
  "description": "string (optional)",
  "category": "string (optional)",
  "location": "string (optional)"
}
```

### DELETE /api/incidents/:id

Delete incident (only if no official has started work).

**Headers:** `Authorization: Bearer <token>`

### GET /api/incidents/stats

Get incident statistics for user.

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "success": true,
  "data": {
    "total": 12,
    "open": 2,
    "inProgress": 3,
    "resolved": 7,
    "pending": 2
  }
}
```

## Ticket Endpoints (Official)

### GET /api/tickets

Get all tickets (for officials).

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**
- `status`: Filter by status (optional)
- `priority`: Filter by priority (optional)
- `category`: Filter by category (optional)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "string",
      "title": "string",
      "category": "string",
      "priority": "low | medium | high | critical",
      "status": "open | in_progress | resolved | verified",
      "location": "string",
      "reportedBy": "string",
      "assignedTo": "string (optional)",
      "createdAt": "ISO date string",
      "updatedAt": "ISO date string"
    }
  ]
}
```

### GET /api/tickets/:id

Get single ticket details.

**Headers:** `Authorization: Bearer <token>`

### PATCH /api/tickets/:id/status

Update ticket status.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "status": "open | in_progress | resolved | verified",
  "notes": "string (optional)"
}
```

### POST /api/tickets/:id/assign

Assign ticket to an official.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "assignedTo": "user_id",
  "notes": "string (optional)"
}
```

### GET /api/tickets/stats

Get ticket statistics.

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "success": true,
  "data": {
    "totalTickets": 1247,
    "openTickets": 156,
    "inProgress": 89,
    "resolvedToday": 34,
    "avgResponseTime": "2.5h",
    "resolutionRate": 87.5
  }
}
```

## Message Endpoints

### GET /api/incidents/:incidentId/messages

Get all messages for an incident.

**Headers:** `Authorization: Bearer <token>`

### POST /api/incidents/:incidentId/messages

Send a message.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "message": "string"
}
```

## User Endpoints

### GET /api/users/profile

Get current user profile.

**Headers:** `Authorization: Bearer <token>`

### PUT /api/users/profile

Update user profile.

**Headers:** `Authorization: Bearer <token>`

## File Upload

For image uploads, use `multipart/form-data`:

```
POST /api/incidents/:id/upload
Content-Type: multipart/form-data

file: <image file>
```

## Error Codes

- `400` - Bad Request (validation error)
- `401` - Unauthorized (missing/invalid token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `500` - Internal Server Error

## Security Considerations

1. Implement JWT token expiration (recommended: 24 hours)
2. Hash passwords using bcrypt or similar
3. Validate all input data
4. Implement rate limiting
5. Use HTTPS in production
6. Sanitize user input to prevent XSS
7. Implement CORS properly

## Database Schema Suggestions

### Users Table
- id (UUID)
- name
- email (unique, nullable)
- phone (unique, nullable)
- password_hash
- user_type (citizen/official)
- created_at
- updated_at

### Incidents Table
- id (UUID)
- title
- description
- category
- status
- priority (auto-calculated)
- location
- latitude
- longitude
- reported_by (user_id)
- assigned_to (user_id, nullable)
- created_at
- updated_at

### Messages Table
- id (UUID)
- incident_id
- user_id
- message
- created_at

## Testing the Integration

1. Start your backend server
2. Update `.env` file with `VITE_API_URL=http://localhost:YOUR_PORT/api`
3. Start the frontend: `npm run dev`
4. Test registration, login, and other features

## Support

For questions or issues with frontend integration, check:
- `/src/services/` - API service implementations
- `/src/config/api.ts` - Endpoint definitions
- `/src/hooks/use-data.ts` - Data fetching hooks
