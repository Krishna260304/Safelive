import base64
import os
from datetime import datetime
from uuid import uuid4
from app.config.settings import settings

def save_image(image_base64):

    if not os.path.exists(settings.IMAGE_DIR):
        os.makedirs(settings.IMAGE_DIR)

    image_bytes = base64.b64decode(image_base64)

    filename = f"{datetime.utcnow().strftime('%Y%m%d_%H%M%S_%f')}_{uuid4().hex[:8]}.jpg"
    path = os.path.join(settings.IMAGE_DIR, filename)

    with open(path, "wb") as f:
        f.write(image_bytes)

    return path
