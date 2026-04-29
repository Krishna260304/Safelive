from bson import ObjectId

def serialize_doc(doc: dict | None) -> dict | None:
    if doc is None:
        return None
    data = dict(doc)
    if "_id" in data:
        data["id"] = str(data.pop("_id"))
    return data

def serialize_list(docs: list[dict]) -> list[dict]:
    return [serialize_doc(doc) for doc in docs]

def to_object_id(value: str) -> ObjectId:
    return ObjectId(value)
