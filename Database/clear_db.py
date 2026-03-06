"""
Clear all database collections except user accounts (login details)
"""
from pymongo import MongoClient
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'Backend'))

from app.config.settings import settings

def clear_database():
    """Clear all collections except users"""
    client = MongoClient(settings.MONGO_URL)
    db = client[settings.DB_NAME]
    
    collections_to_clear = [
        "incidents",
        "tickets",
        "messages",
        "password_resets",
        "otp_challenges",
        "incident_logs",
        "counters"
    ]
    
    print(f"Connecting to database: {settings.DB_NAME}")
    print("=" * 60)
    
    for collection_name in collections_to_clear:
        collection = db[collection_name]
        count_before = collection.count_documents({})
        result = collection.delete_many({})
        print(f"✓ Cleared {collection_name}: {result.deleted_count} documents removed")
    
    users_count = db["users"].count_documents({})
    print("=" * 60)
    print(f"✓ Preserved users collection: {users_count} users kept")
    print("=" * 60)
    print("\n✅ Database cleared successfully (login details preserved)")
    
    client.close()

if __name__ == "__main__":
    try:
        clear_database()
    except Exception as e:
        print(f"\n❌ Error: {e}")
        sys.exit(1)
