from pymongo import MongoClient, ASCENDING, DESCENDING
from datetime import datetime
from bson import ObjectId
import bcrypt

MONGO_URI = "mongodb://localhost:27017/"
DATABASE_NAME = "safelive"

def hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')

def initialize_database():
    client = MongoClient(MONGO_URI)
    db = client[DATABASE_NAME]
    
    print(f"Connected to MongoDB. Initializing database: {DATABASE_NAME}")
    
    collections = ["users", "incidents", "tickets", "notifications"]
    for collection_name in collections:
        if collection_name in db.list_collection_names():
            print(f"Collection '{collection_name}' already exists. Skipping creation.")
        else:
            db.create_collection(collection_name)
            print(f"Collection '{collection_name}' created.")
    
    users_collection = db.users
    incidents_collection = db.incidents
    tickets_collection = db.tickets
    notifications_collection = db.notifications
    
    print("\nCreating indexes...")
    
    users_collection.create_index([("email", ASCENDING)], unique=True)
    users_collection.create_index([("userType", ASCENDING)])
    print("Users indexes created.")
    
    incidents_collection.create_index([("status", ASCENDING)])
    incidents_collection.create_index([("category", ASCENDING)])
    incidents_collection.create_index([("severity", ASCENDING)])
    incidents_collection.create_index([("createdAt", DESCENDING)])
    incidents_collection.create_index([("reportedBy", ASCENDING)])
    print("Incidents indexes created.")
    
    tickets_collection.create_index([("status", ASCENDING)])
    tickets_collection.create_index([("incidentId", ASCENDING)])
    tickets_collection.create_index([("department", ASCENDING)])
    tickets_collection.create_index([("priority", ASCENDING)])
    print("Tickets indexes created.")
    
    notifications_collection.create_index([("userId", ASCENDING)])
    notifications_collection.create_index([("read", ASCENDING)])
    notifications_collection.create_index([("createdAt", DESCENDING)])
    print("Notifications indexes created.")
    
    print("\n" + "="*60)
    print("Database initialization complete!")
    print("="*60)
    print(f"\nDatabase: {DATABASE_NAME}")
    print(f"Collections: {', '.join(collections)}")
    print("\nThe database is now ready for use!")
    print("Register new users through the application's registration page.")
    
    client.close()

if __name__ == "__main__":
    try:
        initialize_database()
    except Exception as e:
        print(f"Error initializing database: {e}")
