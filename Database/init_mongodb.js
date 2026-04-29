use safelive;

db.createCollection("users");
db.createCollection("incidents");
db.createCollection("tickets");
db.createCollection("notifications");

db.users.createIndex({ email: 1 }, { unique: true });
db.users.createIndex({ userType: 1 });

db.incidents.createIndex({ status: 1 });
db.incidents.createIndex({ category: 1 });
db.incidents.createIndex({ severity: 1 });
db.incidents.createIndex({ createdAt: -1 });
db.incidents.createIndex({ reportedBy: 1 });

db.tickets.createIndex({ status: 1 });
db.tickets.createIndex({ incidentId: 1 });
db.tickets.createIndex({ department: 1 });
db.tickets.createIndex({ priority: 1 });

db.notifications.createIndex({ userId: 1 });
db.notifications.createIndex({ read: 1 });
db.notifications.createIndex({ createdAt: -1 });

print("Database 'safelive' initialized successfully!");
print("Collections created: users, incidents, tickets, notifications");
print("Indexes created successfully!");
print("\nDatabase is ready for production use.");
print("Users must register through the application interface.");
