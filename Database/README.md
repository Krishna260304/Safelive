# SafeLive MongoDB Database

## Database Structure

Database Name: **safelive**

### Collections

1. **users** - Stores user accounts (citizens, officials, admins)
2. **incidents** - Stores incident reports from citizens
3. **tickets** - Stores work tickets assigned to departments
4. **notifications** - Stores user notifications

## Schemas

### Users Collection
```javascript
{
    _id: ObjectId,
    name: String,
    email: String (unique),
    phone: String,
    password: String (hashed),
    userType: enum['citizen', 'official', 'admin'],
    department: String (for officials),
    createdAt: Date
}
```

### Incidents Collection
```javascript
{
    _id: ObjectId,
    title: String,
    description: String,
    category: enum['garbage', 'pothole', 'streetlight', 'water', 'security'],
    location: String,
    latitude: Number,
    longitude: Number,
    imageUrl: String,
    severity: enum['low', 'medium', 'high'],
    status: enum['open', 'in_progress', 'resolved'],
    createdAt: Date,
    updatedAt: Date,
    reportedBy: ObjectId (ref: users)
}
```

### Tickets Collection
```javascript
{
    _id: ObjectId,
    incidentId: ObjectId (ref: incidents),
    department: enum['Sanitation', 'Road', 'Electricity', 'Water', 'Police'],
    assignedTo: String,
    priority: enum['low', 'medium', 'high'],
    status: enum['open', 'in_progress', 'resolved'],
    notes: String,
    resolvedAt: Date,
    createdAt: Date,
    updatedAt: Date
}
```

### Notifications Collection
```javascript
{
    _id: ObjectId,
    userId: ObjectId (ref: users),
    type: enum['incident_created', 'incident_updated', 'ticket_assigned', 'ticket_resolved', 'system'],
    title: String,
    message: String,
    incidentId: ObjectId (ref: incidents),
    ticketId: ObjectId (ref: tickets),
    read: Boolean,
    createdAt: Date
}
```

## Indexes

### Users
- email (unique)
- userType

### Incidents
- status
- category
- severity
- createdAt (descending)
- reportedBy

### Tickets
- status
- incidentId
- department
- priority

### Notifications
- userId
- read
- createdAt (descending)

## Installation & Setup

### Method 1: MongoDB Shell (mongosh)

```bash
mongosh < init_mongodb.js
```

### Method 2: Python (PyMongo)

```bash
pip install pymongo bcrypt
python pymongo_init.py
```

### Method 3: Node.js (Mongoose)

```bash
npm install mongoose
node -e "require('./mongoose_schemas.js')"
```

## Sample Credentials

After initialization, you can use these credentials:

**Citizen Account:**
- Email: john@example.com
- Password: password123

**Official Account:**
- Email: jane.official@safelive.com
- Password: password123
- Department: Sanitation

**Admin Account:**
- Email: admin@safelive.com
- Password: admin123

## Connection String

```
mongodb://localhost:27017/safelive
```

## Usage Examples

### Python (PyMongo)

```python
from pymongo import MongoClient

client = MongoClient("mongodb://localhost:27017/")
db = client.safelive

users = db.users.find({"userType": "citizen"})
incidents = db.incidents.find({"status": "open"})
```

### Node.js (Mongoose)

```javascript
const mongoose = require('mongoose');
const { User, Incident } = require('./mongoose_schemas');

mongoose.connect('mongodb://localhost:27017/safelive');

const users = await User.find({ userType: 'citizen' });
const incidents = await Incident.find({ status: 'open' });
```

## Maintenance

### Backup Database
```bash
mongodump --db safelive --out ./backup
```

### Restore Database
```bash
mongorestore --db safelive ./backup/safelive
```

### Drop Database
```bash
mongosh safelive --eval "db.dropDatabase()"
```
